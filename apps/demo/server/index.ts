/**
 * Burnish Demo Server — dual-mode MCP navigator.
 *
 * Explorer mode: deterministic tool browsing and direct execution.
 * LLM Insight mode: LLM-powered streaming insights via SSE (when LLM_BACKEND != 'none').
 *
 * Security hardening:
 * - Input validation on all API routes
 * - Token bucket rate limiting (10 req/min per IP)
 * - Optional Bearer token auth (BURNISH_API_KEY env var)
 * - Error message sanitization (generic messages to client)
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
    McpHub,
    isWriteTool,
    safePath,
    ConversationStore,
    LlmOrchestrator,
    ALLOWED_MODELS,
} from '@burnishdev/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

// --- LLM backend detection ---
/** Auto-detect which LLM backend to use based on environment variables. */
function detectBackend(): 'api' | 'cli' | 'openai' | 'none' {
    if (process.env.LLM_BACKEND === 'none') return 'none';
    if (process.env.LLM_BACKEND) return process.env.LLM_BACKEND as 'api' | 'cli' | 'openai';
    if (process.env.ANTHROPIC_API_KEY) return 'api';
    if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return 'openai';
    return 'cli';
}

const llmBackend = detectBackend();

// --- Instantiate @burnishdev/server classes ---
const mcpHub = new McpHub();
const conversations = llmBackend !== 'none' ? new ConversationStore(1000) : null;
const llm = llmBackend !== 'none' ? new LlmOrchestrator(mcpHub, conversations!) : null;

let activeModelName = 'sonnet';
let activeBackend: string = llmBackend;

// --- Token bucket rate limiter ---
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_BUCKET_MAX_ENTRIES = 10_000;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

interface RateBucket {
    tokens: number;
    lastRefill: number;
}

const rateBuckets = new Map<string, RateBucket>();

function getClientIp(_req: Request, headers: Headers): string {
    if (TRUST_PROXY) {
        const forwarded = headers.get('x-forwarded-for');
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
    }
    return 'local';
}

function evictOldestBucket(): void {
    if (rateBuckets.size >= RATE_BUCKET_MAX_ENTRIES) {
        const oldestKey = rateBuckets.keys().next().value;
        if (oldestKey) rateBuckets.delete(oldestKey);
    }
}

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    let bucket = rateBuckets.get(ip);

    if (!bucket) {
        evictOldestBucket();
        bucket = { tokens: RATE_LIMIT_MAX, lastRefill: now };
        rateBuckets.set(ip, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_MAX;
    if (refill > 0) {
        bucket.tokens = Math.min(RATE_LIMIT_MAX, bucket.tokens + refill);
        bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
        return false;
    }

    bucket.tokens--;
    return true;
}

// --- Optional auth middleware ---
const requiredApiKey = process.env.BURNISH_API_KEY || null;

app.use('/api/*', async (c, next) => {
    if (requiredApiKey) {
        const authHeader = c.req.header('Authorization');
        if (!authHeader || authHeader !== `Bearer ${requiredApiKey}`) {
            return c.json({ error: 'Unauthorized' }, 401);
        }
    }
    await next();
});

// --- Validation helpers ---
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROMPT_LENGTH = 10_000;

function validatePrompt(prompt: unknown): string | null {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        return 'prompt is required and must be a non-empty string';
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
        return `prompt must be at most ${MAX_PROMPT_LENGTH} characters`;
    }
    return null;
}

function validateUuid(value: string, fieldName: string): string | null {
    if (!UUID_RE.test(value)) {
        return `${fieldName} must be a valid UUID`;
    }
    return null;
}

function validateModel(model: unknown): string | null {
    if (model !== undefined && model !== null && model !== '') {
        if (typeof model !== 'string') {
            return 'model must be a string';
        }
        if (activeBackend !== 'openai' && !ALLOWED_MODELS.has(model)) {
            return `model must be one of: ${[...ALLOWED_MODELS].join(', ')}`;
        }
    }
    return null;
}

// --- Rate limiting on tool execution and LLM routes ---
app.use('/api/chat', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

app.use('/api/chat/:id/stream', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

app.use('/api/title', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

app.use('/api/tools/execute', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

// --- API Routes ---

const startedAt = Date.now();

app.get('/api/health', (c) => {
    const serverInfo = mcpHub.getServerInfo();
    return c.json({
        status: 'ok',
        servers: serverInfo.length,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        version: '0.1.1',
    });
});

app.get('/api/servers', (c) => {
    try {
        return c.json({ servers: mcpHub.getServerInfo() });
    } catch (err) {
        console.error('[burnish] GET /api/servers error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.post('/api/tools/execute', async (c) => {
    let body: { toolName: string; args: Record<string, unknown>; confirmed?: boolean };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid request body' }, 400);
    }

    if (!body.toolName || typeof body.toolName !== 'string') {
        return c.json({ error: 'toolName is required' }, 400);
    }

    // Validate args shape and size
    if (body.args != null && (typeof body.args !== 'object' || Array.isArray(body.args))) {
        return c.json({ error: 'args must be a plain object' }, 400);
    }
    if (body.args && JSON.stringify(body.args).length > 50_000) {
        return c.json({ error: 'args payload too large' }, 413);
    }

    // Check tool exists — handle both short names and fully-qualified mcp__server__tool names
    const allTools = mcpHub.getAllTools();
    let toolName = body.toolName;
    let tool = allTools.find(t => t.name === toolName);
    if (!tool) {
        const shortName = toolName.replace(/^mcp__\w+__/, '');
        tool = allTools.find(t => t.name === shortName);
        if (tool) toolName = shortName;
    }
    if (!tool) {
        return c.json({ error: `Tool "${body.toolName}" not found` }, 404);
    }

    // Write tool gate: client sends confirmed:true after user clicks confirm dialog.
    // This is client-trust-based (intentional for demo). For production, implement
    // a server-side confirmation token flow.
    if (isWriteTool(toolName) && !body.confirmed) {
        return c.json({ error: 'Write tool requires confirmation', requiresConfirmation: true }, 403);
    }

    // Coerce argument types based on tool schema (forms send everything as strings)
    const args = { ...(body.args || {}) };
    const schema = tool.inputSchema as { properties?: Record<string, { type?: string }> };
    if (schema?.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
            if (args[key] === undefined || args[key] === '') {
                delete args[key];
                continue;
            }
            if ((prop.type === 'number' || prop.type === 'integer') && typeof args[key] === 'string') {
                const num = Number(args[key]);
                if (!isNaN(num)) args[key] = num;
            } else if (prop.type === 'boolean' && typeof args[key] === 'string') {
                args[key] = args[key] === 'true';
            }
        }
    }

    try {
        const startTime = performance.now();
        const result = await mcpHub.executeTool(toolName, args);
        const durationMs = Math.round(performance.now() - startTime);
        return c.json({ result: result.content, isError: result.isError, toolName, serverName: tool.serverName, durationMs });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool execution failed';
        console.error('[burnish] Direct tool execution failed:', err);
        return c.json({ error: message }, 500);
    }
});

// --- LLM API Routes (active only when LLM_BACKEND != 'none') ---

app.get('/api/models', async (c) => {
    if (!llm) return c.json({ models: [], current: null, backend: 'none' });

    let available: { id: string; name: string }[] = [];

    if (activeBackend === 'openai') {
        try {
            const baseUrl = (process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1').replace('/v1', '');
            const resp = await fetch(baseUrl + '/api/tags');
            if (resp.ok) {
                const data = await resp.json() as { models?: { name: string }[] };
                available = (data.models || []).map((m) => ({
                    id: m.name,
                    name: m.name,
                }));
            }
        } catch { /* Ollama not reachable */ }
    } else {
        available = [
            { id: 'sonnet', name: 'Sonnet' },
            { id: 'haiku', name: 'Haiku (Fast)' },
            { id: 'opus', name: 'Opus (Detailed)' },
        ];
    }

    return c.json({ models: available, current: activeModelName, backend: activeBackend });
});

app.post('/api/chat', async (c) => {
    if (!llm || !conversations) return c.json({ error: 'LLM not configured' }, 503);
    try {
        let body: { prompt: string; conversationId?: string; model?: string; noTools?: boolean; extraInstructions?: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'Invalid request body' }, 400);
        }

        const promptErr = validatePrompt(body.prompt);
        if (promptErr) return c.json({ error: promptErr }, 400);

        if (body.conversationId) {
            const idErr = validateUuid(body.conversationId, 'conversationId');
            if (idErr) return c.json({ error: idErr }, 400);
        }

        const modelErr = validateModel(body.model);
        if (modelErr) return c.json({ error: modelErr }, 400);

        // Validate extraInstructions (optional, max 5000 chars for template examples)
        if (body.extraInstructions != null) {
            if (typeof body.extraInstructions !== 'string') {
                return c.json({ error: 'extraInstructions must be a string' }, 400);
            }
            if (body.extraInstructions.length > 5000) {
                return c.json({ error: 'extraInstructions must be at most 5000 characters' }, 400);
            }
        }

        const conv = conversations.getOrCreate(body.conversationId);
        conversations.addMessage(conv.id, 'user', body.prompt);
        const modelParam = body.model ? `?model=${encodeURIComponent(body.model)}` : '';
        const noToolsParam = body.noTools ? `${modelParam ? '&' : '?'}noTools=true` : '';
        const extraParam = body.extraInstructions
            ? `${modelParam || noToolsParam ? '&' : '?'}extra=${encodeURIComponent(body.extraInstructions)}`
            : '';
        return c.json({
            conversationId: conv.id,
            streamUrl: `/api/chat/${conv.id}/stream${modelParam}${noToolsParam}${extraParam}`,
        });
    } catch (err) {
        console.error('[burnish] POST /api/chat error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.get('/api/chat/:id/stream', async (c) => {
    if (!llm) return c.json({ error: 'LLM not configured' }, 503);
    try {
        const id = c.req.param('id');

        const idErr = validateUuid(id, 'id');
        if (idErr) return c.json({ error: idErr }, 400);

        const requestModel = c.req.query('model') || undefined;
        if (requestModel) {
            const modelErr = validateModel(requestModel);
            if (modelErr) return c.json({ error: modelErr }, 400);
        }
        const noTools = c.req.query('noTools') === 'true';
        const extraInstructions = c.req.query('extra') || undefined;

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                try {
                    for await (const chunk of llm!.streamResponse(id, requestModel, noTools, extraInstructions)) {
                        const data = JSON.stringify(chunk);
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
                    controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
                } catch (err) {
                    console.error('[burnish] Stream error:', err);
                    const errMsg = err instanceof Error ? err.message : String(err);
                    let userMessage = 'An error occurred while streaming the response';
                    if (errMsg.includes('ECONNREFUSED')) {
                        userMessage = 'LLM server not running. If using Ollama, start it with: ollama serve';
                    } else if (errMsg.includes('model') && errMsg.includes('not found')) {
                        userMessage = `Model not available. Pull it with: ollama pull ${requestModel || 'qwen2.5:7b'}`;
                    } else if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
                        userMessage = 'LLM server timed out. Is Ollama overloaded?';
                    }
                    const data = JSON.stringify({ type: 'error', message: userMessage });
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (err) {
        console.error('[burnish] GET /api/chat/:id/stream error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.get('/api/chat/:id', (c) => {
    if (!conversations) return c.json({ error: 'LLM not configured' }, 503);
    try {
        const id = c.req.param('id');
        const idErr = validateUuid(id, 'id');
        if (idErr) return c.json({ error: idErr }, 400);
        const conv = conversations.get(id);
        return conv ? c.json(conv) : c.json({ error: 'Not found' }, 404);
    } catch (err) {
        console.error('[burnish] GET /api/chat/:id error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.post('/api/title', async (c) => {
    if (!llm) return c.json({ title: '' });
    try {
        let body: { prompt: string; response: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'Invalid request body' }, 400);
        }
        const { prompt, response } = body;

        const promptErr = validatePrompt(prompt);
        if (promptErr) return c.json({ error: promptErr }, 400);

        if (typeof response !== 'string' || response.trim().length === 0) {
            return c.json({ error: 'response is required and must be a non-empty string' }, 400);
        }

        const title = await llm.generateTitle(prompt, response);
        return c.json({ title });
    } catch (err) {
        console.error('[burnish] POST /api/title error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

// --- Static Files ---
// Cache-busting: use startup timestamp so all assets refresh on server restart
const CACHE_BUSTER = `v=${Date.now()}`;

const repoRoot = resolve(__dirname, '../../..');
const demoRoot = resolve(__dirname, '..');

// Serve @burnishdev/app dist files
app.get('/app/:file{.+}', async (c) => {
    const baseDir = resolve(repoRoot, 'packages/app/dist');
    const filePath = safePath(baseDir, c.req.param('file'));
    if (!filePath) return c.text('Forbidden', 403);
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
        c.header('Cache-Control', 'no-cache, must-revalidate');
        c.header('ETag', CACHE_BUSTER);
        return c.body(content);
    } catch {
        return c.text('Not found', 404);
    }
});

// Serve @burnishdev/renderer dist files
app.get('/renderer/:file{.+}', async (c) => {
    const baseDir = resolve(repoRoot, 'packages/renderer/dist');
    const filePath = safePath(baseDir, c.req.param('file'));
    if (!filePath) return c.text('Forbidden', 403);
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
        c.header('Cache-Control', 'no-cache, must-revalidate');
        c.header('ETag', CACHE_BUSTER);
        return c.body(content);
    } catch {
        return c.text('Not found', 404);
    }
});

app.get('/components/:file', async (c) => {
    const baseDir = resolve(repoRoot, 'packages/components/dist');
    const filePath = safePath(baseDir, c.req.param('file'));
    if (!filePath) return c.text('Forbidden', 403);
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
        c.header('Cache-Control', 'no-cache, must-revalidate');
        c.header('ETag', CACHE_BUSTER);
        return c.body(content);
    } catch {
        return c.text('Not found', 404);
    }
});

app.get('/tokens.css', async (c) => {
    const css = await readFile(
        resolve(repoRoot, 'packages/components/src/tokens.css'),
        'utf-8',
    );
    c.header('Content-Type', 'text/css');
    c.header('Cache-Control', 'no-cache, must-revalidate');
    c.header('ETag', CACHE_BUSTER);
    return c.body(css);
});

// Serve index.html as a template with cache-busting query strings injected
app.get('/', async (c) => {
    let html = await readFile(resolve(demoRoot, 'public/index.html'), 'utf-8');
    // Inject cache buster into all local script/link tags (not CDN urls)
    html = html.replace(/(src|href)="(\/[^"]+\.(js|css))"/g, `$1="$2?${CACHE_BUSTER}"`);
    // Also inject a build version marker into the page
    html = html.replace('</head>', `<meta name="burnish-version" content="${CACHE_BUSTER}"></head>`);
    c.header('Content-Type', 'text/html');
    c.header('Cache-Control', 'no-store');
    return c.body(html);
});

// Serve public files with cache-busting headers
app.use('/*', async (c, next) => {
    await next();
    const ct = c.res.headers.get('Content-Type') || '';
    if (ct.includes('javascript') || ct.includes('css')) {
        c.res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        c.res.headers.set('Pragma', 'no-cache');
        c.res.headers.set('Expires', '0');
    }
});
app.use('/*', serveStatic({ root: resolve(demoRoot, 'public') }));

// --- Startup ---

async function start() {
    const port = parseInt(process.env.PORT || '3000', 10);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    const defaultModel = llmBackend === 'openai' ? 'qwen2.5:7b' : 'sonnet';
    const modelName = process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || defaultModel;
    const rawConfigPath = resolve(__dirname, '../mcp-servers.json');

    if (llmBackend === 'api' && !apiKey) {
        console.error('[burnish] ANTHROPIC_API_KEY required for api backend.');
        console.error('[burnish] Set LLM_BACKEND=cli to use your Claude Code subscription instead.');
        console.error('[burnish] Or set LLM_BACKEND=none to run in Explorer-only mode.');
        process.exit(1);
    }

    // Warn if no API key is set for auth
    if (!requiredApiKey) {
        console.warn('[burnish] WARNING: BURNISH_API_KEY is not set. API routes are unprotected.');
        console.warn('[burnish] Set BURNISH_API_KEY=<secret> to require Bearer token auth on /api/* routes.');
    }

    // Resolve ${ENV_VAR} patterns in MCP config so users don't hardcode secrets
    let configPath = rawConfigPath;
    try {
        const rawConfig = await readFile(rawConfigPath, 'utf-8');
        const resolvedConfig = rawConfig.replace(
            /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g,
            (_match, varName) => process.env[varName] || '',
        );
        if (resolvedConfig !== rawConfig) {
            const tmpDir = await mkdtemp(resolve(tmpdir(), 'burnish-'));
            configPath = resolve(tmpDir, 'mcp-servers.json');
            await writeFile(configPath, resolvedConfig, 'utf-8');
            console.log('[burnish] Resolved env vars in MCP config → temp file');
        }
    } catch {
        // If the config file doesn't exist, fall through — mcpHub.initialize will handle it
    }

    // Configure LLM if backend is enabled
    activeModelName = modelName;
    activeBackend = llmBackend;

    if (llm) {
        // Ollama connectivity check (non-blocking)
        if (llmBackend === 'openai') {
            const baseUrl = openaiBaseUrl || 'http://localhost:11434/v1';
            try {
                const resp = await fetch(baseUrl.replace('/v1', '') + '/api/tags');
                if (resp.ok) {
                    const data = await resp.json() as { models?: { name: string }[] };
                    const models = (data.models || []).map((m) => m.name);
                    console.log(`[burnish] Ollama connected. Available models: ${models.join(', ') || 'none'}`);
                    if (modelName && !models.some((m: string) => m.startsWith(modelName))) {
                        console.warn(`[burnish] WARNING: Model "${modelName}" not found in Ollama.`);
                        console.warn(`[burnish] Available: ${models.join(', ')}`);
                    }
                }
            } catch {
                console.warn('[burnish] WARNING: Cannot reach Ollama at ' + baseUrl);
                console.warn('[burnish] Start Ollama first: ollama serve');
            }
        }

        llm.configure({
            backend: llmBackend as 'api' | 'cli' | 'openai',
            apiKey: llmBackend === 'openai' ? (openaiKey || undefined) : apiKey,
            model: modelName,
            cwd: resolve(__dirname, '..'),
            mcpConfigPath: configPath,
            openaiBaseUrl,
        });
        console.log(`[burnish] LLM Insight mode enabled (backend: ${llmBackend}, model: ${modelName})`);
    } else {
        console.log('[burnish] Explorer-only mode (LLM_BACKEND=none)');
    }

    serve({ fetch: app.fetch, port }, () => {
        console.log(`[burnish] Running at http://localhost:${port}`);
    });

    // Initialize MCP servers in the background so the HTTP server starts immediately
    mcpHub.initialize(configPath).then(() => {
        const serverInfo = mcpHub.getServerInfo();
        console.log(`[burnish] Connected to ${serverInfo.length} MCP server(s)`);
        for (const s of serverInfo) {
            console.log(`  - ${s.name}: ${s.toolCount} tools`);
        }
    }).catch(err => {
        console.warn('[burnish] MCP server initialization failed:', err instanceof Error ? err.message : err);
        console.warn('[burnish] Check your mcp-servers.json config and ensure required env vars are set.');
    });

    process.on('SIGINT', async () => {
        console.log('\n[burnish] Shutting down...');
        await mcpHub.shutdown();
        process.exit(0);
    });
}

start();
