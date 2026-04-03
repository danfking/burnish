/**
 * Burnish Demo Server — thin Hono wrapper over @burnish/server.
 *
 * Security hardening:
 * - Input validation on all API routes
 * - Token bucket rate limiting (10 req/min per IP)
 * - Optional Bearer token auth (BURNISH_API_KEY env var)
 * - Error message sanitization (generic messages to client)
 * - Bounded caches and stores
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
    McpHub,
    ConversationStore,
    LlmOrchestrator,
    ALLOWED_MODELS,
} from '@burnish/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

/**
 * Resolve a user-supplied path against a base directory and verify
 * it does not escape outside the base (prevents path traversal).
 */
function safePath(baseDir: string, userPath: string): string | null {
    const resolved = normalize(resolve(baseDir, userPath));
    const base = normalize(baseDir);
    return resolved.startsWith(base + '\\') || resolved.startsWith(base + '/') || resolved === base
        ? resolved : null;
}

// --- Instantiate @burnish/server classes ---
const mcpHub = new McpHub();
const conversations = new ConversationStore(1000);
const llm = new LlmOrchestrator(mcpHub, conversations);

let activeModelName = 'sonnet'; // Set during start()
let activeBackend = 'cli';

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

/** Auto-detect which LLM backend to use based on environment variables. */
function detectBackend(): 'api' | 'cli' | 'openai' {
    if (process.env.LLM_BACKEND) return process.env.LLM_BACKEND as 'api' | 'cli' | 'openai';
    if (process.env.ANTHROPIC_API_KEY) return 'api';
    if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return 'openai';
    return 'cli';
}

function validateModel(model: unknown): string | null {
    if (model !== undefined && model !== null && model !== '') {
        if (typeof model !== 'string') {
            return 'model must be a string';
        }
        // For OpenAI-compatible backends, allow any model name (local servers use arbitrary names)
        const currentBackend = detectBackend();
        if (currentBackend !== 'openai' && !ALLOWED_MODELS.has(model)) {
            return `model must be one of: ${[...ALLOWED_MODELS].join(', ')}`;
        }
    }
    return null;
}

// --- Token bucket rate limiter ---
// By default, all requests share a single rate-limit bucket ('local').
// Set TRUST_PROXY=true (or '1') to use the X-Forwarded-For header for per-IP
// rate limiting — only enable this when running behind a trusted reverse proxy
// that sets X-Forwarded-For reliably (e.g., nginx, Cloudflare, AWS ALB).
// Without a trusted proxy, X-Forwarded-For is trivially spoofable.

const RATE_LIMIT_MAX = 10;          // requests per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_BUCKET_MAX_ENTRIES = 10_000;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

interface RateBucket {
    tokens: number;
    lastRefill: number;
}

const rateBuckets = new Map<string, RateBucket>();

function getClientIp(req: Request, headers: Headers): string {
    if (TRUST_PROXY) {
        const forwarded = headers.get('x-forwarded-for');
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
    }
    // Without TRUST_PROXY, use a single global bucket to prevent header spoofing bypass
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

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_MAX;
    if (refill > 0) {
        bucket.tokens = Math.min(RATE_LIMIT_MAX, bucket.tokens + refill);
        bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
        return false; // rate limited
    }

    bucket.tokens--;
    return true;
}

// --- Optional auth middleware ---
// If BURNISH_API_KEY is set, require Authorization: Bearer <key> on all /api/* routes.

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

// --- Rate limiting middleware for expensive routes ---

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

app.use('/api/lookup', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

// --- API Routes ---

app.post('/api/chat', async (c) => {
    try {
        let body: { prompt: string; conversationId?: string; model?: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'Invalid request body' }, 400);
        }

        // Validate prompt
        const promptErr = validatePrompt(body.prompt);
        if (promptErr) return c.json({ error: promptErr }, 400);

        // Validate conversationId if provided
        if (body.conversationId) {
            const idErr = validateUuid(body.conversationId, 'conversationId');
            if (idErr) return c.json({ error: idErr }, 400);
        }

        // Validate model if provided
        const modelErr = validateModel(body.model);
        if (modelErr) return c.json({ error: modelErr }, 400);

        const conv = conversations.getOrCreate(body.conversationId);
        conversations.addMessage(conv.id, 'user', body.prompt);
        const modelParam = body.model ? `?model=${encodeURIComponent(body.model)}` : '';
        return c.json({
            conversationId: conv.id,
            streamUrl: `/api/chat/${conv.id}/stream${modelParam}`,
        });
    } catch (err) {
        console.error('[burnish] POST /api/chat error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.get('/api/chat/:id/stream', async (c) => {
    try {
        const id = c.req.param('id');

        // Validate id is UUID
        const idErr = validateUuid(id, 'id');
        if (idErr) return c.json({ error: idErr }, 400);

        // Validate model query param if provided
        const requestModel = c.req.query('model') || undefined;
        if (requestModel) {
            const modelErr = validateModel(requestModel);
            if (modelErr) return c.json({ error: modelErr }, 400);
        }

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                try {
                    for await (const chunk of llm.streamResponse(id, requestModel)) {
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
    try {
        const id = c.req.param('id');

        // Validate id is UUID
        const idErr = validateUuid(id, 'id');
        if (idErr) return c.json({ error: idErr }, 400);

        const conv = conversations.get(id);
        return conv ? c.json(conv) : c.json({ error: 'Not found' }, 404);
    } catch (err) {
        console.error('[burnish] GET /api/chat/:id error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.get('/api/servers', (c) => {
    try {
        return c.json({ servers: mcpHub.getServerInfo() });
    } catch (err) {
        console.error('[burnish] GET /api/servers error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.get('/api/models', async (c) => {
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

app.post('/api/title', async (c) => {
    try {
        let body: { prompt: string; response: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'Invalid request body' }, 400);
        }
        const { prompt, response } = body;

        // Validate prompt
        const promptErr = validatePrompt(prompt);
        if (promptErr) return c.json({ error: promptErr }, 400);

        // Validate response
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

// Lookup result cache — avoids redundant LLM calls for identical prompts
// Bounded to 1,000 entries with FIFO eviction.
const LOOKUP_CACHE_MAX = 1_000;
const lookupCache = new Map<string, { results: unknown[]; timestamp: number }>();
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Evict the oldest cache entry (first key in Map insertion order) when at capacity. */
function evictLookupCache(): void {
    if (lookupCache.size >= LOOKUP_CACHE_MAX) {
        const oldestKey = lookupCache.keys().next().value;
        if (oldestKey) lookupCache.delete(oldestKey);
    }
}

app.post('/api/lookup', async (c) => {
    try {
        let body: { prompt: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'Invalid request body' }, 400);
        }
        const { prompt } = body;

        // Validate prompt
        const promptErr = validatePrompt(prompt);
        if (promptErr) return c.json({ error: promptErr }, 400);

        const cached = lookupCache.get(prompt);
        if (cached && Date.now() - cached.timestamp < LOOKUP_CACHE_TTL_MS) {
            console.log(`[lookup] Cache hit for: ${prompt.slice(0, 60)}...`);
            return c.json({ results: cached.results });
        }

        const conv = conversations.getOrCreate(null);
        conversations.addMessage(conv.id, 'user', prompt);

        let result = '';
        for await (const chunk of llm.streamLookupResponse(conv.id)) {
            if (chunk.type === 'content') result += chunk.text;
        }

        let results: unknown[] = [];
        try {
            const match = result.match(/\[[\s\S]*?\]/);
            if (match) results = JSON.parse(match[0]);
        } catch { /* fall through */ }

        if (results.length > 0) {
            evictLookupCache();
            lookupCache.set(prompt, { results, timestamp: Date.now() });
        }

        return results.length > 0
            ? c.json({ results })
            : c.json({ results: [], raw: result });
    } catch (err) {
        console.error('[burnish] POST /api/lookup error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

// --- Static Files ---

const repoRoot = resolve(__dirname, '../../..');
const demoRoot = resolve(__dirname, '..');

// Serve @burnish/app dist files
app.get('/app/:file{.+}', async (c) => {
    const baseDir = resolve(repoRoot, 'packages/app/dist');
    const filePath = safePath(baseDir, c.req.param('file'));
    if (!filePath) return c.text('Forbidden', 403);
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
        return c.body(content);
    } catch {
        return c.text('Not found', 404);
    }
});

// Serve @burnish/renderer dist files
app.get('/renderer/:file{.+}', async (c) => {
    const baseDir = resolve(repoRoot, 'packages/renderer/dist');
    const filePath = safePath(baseDir, c.req.param('file'));
    if (!filePath) return c.text('Forbidden', 403);
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
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
    return c.body(css);
});

app.use('/*', serveStatic({ root: resolve(demoRoot, 'public') }));

// --- Startup ---

async function start() {
    const port = parseInt(process.env.PORT || '3000', 10);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    const llmBackend = detectBackend();
    const defaultModel = llmBackend === 'openai' ? 'qwen2.5:7b' : 'sonnet';
    const modelName = process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || defaultModel;

    if (llmBackend === 'api' && !apiKey) {
        console.error('[burnish] ANTHROPIC_API_KEY required for api backend.');
        console.error('[burnish] Set LLM_BACKEND=cli to use your Claude Code subscription instead.');
        console.error('[burnish] Or set LLM_BACKEND=openai with OPENAI_BASE_URL for local models.');
        process.exit(1);
    }

    // Warn if no API key is set for auth
    if (!requiredApiKey) {
        console.warn('[burnish] WARNING: BURNISH_API_KEY is not set. API routes are unprotected.');
        console.warn('[burnish] Set BURNISH_API_KEY=<secret> to require Bearer token auth on /api/* routes.');
    }

    const rawConfigPath = resolve(__dirname, '../mcp-servers.json');

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
                    console.warn(`[burnish] Pull it: ollama pull ${modelName}`);
                }
            }
        } catch {
            console.warn('[burnish] WARNING: Cannot reach Ollama at ' + baseUrl);
            console.warn('[burnish] Start Ollama first: ollama serve');
            console.warn('[burnish] Then pull a model: ollama pull ' + modelName);
        }
    }

    activeModelName = modelName;
    activeBackend = llmBackend;

    llm.configure({
        backend: llmBackend,
        apiKey: llmBackend === 'openai' ? (openaiKey || undefined) : apiKey,
        model: modelName,
        cwd: resolve(__dirname, '..'),
        mcpConfigPath: configPath,
        openaiBaseUrl,
    });

    serve({ fetch: app.fetch, port }, () => {
        console.log(`[burnish] Demo server running at http://localhost:${port}`);
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
