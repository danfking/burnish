/**
 * Burnish Demo Server — thin Hono wrapper over @burnish/server.
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
    getCatalog,
    type McpServerConfig,
} from '@burnish/server';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Interpolate ${ENV_VAR} placeholders in a JSON config string
 * with values from process.env. Unresolved vars become empty strings.
 */
function interpolateEnvVars(raw: string): string {
    return raw.replace(/\$\{([^}]+)\}/g, (_, varName) => process.env[varName] || '');
}

const app = new Hono();

// --- Instantiate @burnish/server classes ---
const mcpHub = new McpHub();
const conversations = new ConversationStore();
const llm = new LlmOrchestrator(mcpHub, conversations);

// --- Rate Limiting ---

const RATE_LIMIT_MAX = 10; // max tokens (requests)
const RATE_LIMIT_REFILL_MS = 60_000; // refill window: 1 minute
const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const MAX_RATE_BUCKETS = 10_000;

function getRateLimitBucket(ip: string): { tokens: number; lastRefill: number } {
    let bucket = rateBuckets.get(ip);
    const now = Date.now();
    if (!bucket) {
        // Evict oldest entries if map grows too large
        if (rateBuckets.size >= MAX_RATE_BUCKETS) {
            const firstKey = rateBuckets.keys().next().value!;
            rateBuckets.delete(firstKey);
        }
        bucket = { tokens: RATE_LIMIT_MAX, lastRefill: now };
        rateBuckets.set(ip, bucket);
        return bucket;
    }
    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    if (elapsed >= RATE_LIMIT_REFILL_MS) {
        bucket.tokens = RATE_LIMIT_MAX;
        bucket.lastRefill = now;
    }
    return bucket;
}

app.use('/api/chat*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const bucket = getRateLimitBucket(ip);
    if (bucket.tokens <= 0) {
        return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
    }
    bucket.tokens--;
    return next();
});

app.use('/api/lookup', async (c, next) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const bucket = getRateLimitBucket(ip);
    if (bucket.tokens <= 0) {
        return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
    }
    bucket.tokens--;
    return next();
});

// --- Auth Middleware ---

const BURNISH_API_KEY = process.env.BURNISH_API_KEY;
if (!BURNISH_API_KEY) {
    console.warn('[burnish] BURNISH_API_KEY not set — API routes are unauthenticated (dev mode)');
}

app.use('/api/*', async (c, next) => {
    if (!BURNISH_API_KEY) return next();
    const authHeader = c.req.header('Authorization');
    if (!authHeader || authHeader !== `Bearer ${BURNISH_API_KEY}`) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
});

// --- Validation ---

const MAX_PROMPT_LENGTH = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MODELS = new Set(['sonnet', 'opus', 'haiku', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001']);

// --- API Routes ---

app.post('/api/chat', async (c) => {
    const body = await c.req.json<{ prompt: string; conversationId?: string; model?: string }>();

    if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
        return c.json({ error: 'prompt is required and must be a non-empty string' }, 400);
    }
    if (body.prompt.length > MAX_PROMPT_LENGTH) {
        return c.json({ error: `prompt exceeds max length of ${MAX_PROMPT_LENGTH} characters` }, 400);
    }
    if (body.conversationId !== undefined && !UUID_RE.test(body.conversationId)) {
        return c.json({ error: 'conversationId must be a valid UUID' }, 400);
    }
    if (body.model !== undefined && !ALLOWED_MODELS.has(body.model)) {
        return c.json({ error: `model must be one of: ${[...ALLOWED_MODELS].join(', ')}` }, 400);
    }

    const conv = conversations.getOrCreate(body.conversationId);
    conversations.addMessage(conv.id, 'user', body.prompt);
    const modelParam = body.model ? `?model=${encodeURIComponent(body.model)}` : '';
    return c.json({
        conversationId: conv.id,
        streamUrl: `/api/chat/${conv.id}/stream${modelParam}`,
    });
});

app.get('/api/chat/:id/stream', async (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) {
        return c.json({ error: 'Invalid conversation ID format' }, 400);
    }
    const requestModel = c.req.query('model') || undefined;
    if (requestModel && !ALLOWED_MODELS.has(requestModel)) {
        return c.json({ error: 'Invalid model' }, 400);
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
                const data = JSON.stringify({ type: 'error', message: 'Internal server error' });
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
});

app.get('/api/chat/:id', (c) => {
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) {
        return c.json({ error: 'Invalid conversation ID format' }, 400);
    }
    const conv = conversations.get(id);
    return conv ? c.json(conv) : c.json({ error: 'Not found' }, 404);
});

app.get('/api/servers', (c) => {
    return c.json({ servers: mcpHub.getServerInfo() });
});

app.get('/api/servers/catalog', (c) => {
    return c.json({ catalog: getCatalog() });
});

app.post('/api/servers', async (c) => {
    const body = await c.req.json<{ name: string; config: McpServerConfig }>();
    if (typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 100) {
        return c.json({ error: 'name is required and must be 1-100 characters' }, 400);
    }
    if (!body.config || typeof body.config.command !== 'string') {
        return c.json({ error: 'config.command is required' }, 400);
    }
    try {
        await mcpHub.addServer(body.name, body.config);
        return c.json({ ok: true, servers: mcpHub.getServerInfo() });
    } catch (err) {
        console.error('[burnish] Failed to add server:', err);
        return c.json({ error: 'Failed to add server' }, 500);
    }
});

app.delete('/api/servers/:name', async (c) => {
    const name = c.req.param('name');
    try {
        await mcpHub.removeServer(name);
        return c.json({ ok: true, servers: mcpHub.getServerInfo() });
    } catch (err) {
        console.error('[burnish] Failed to remove server:', err);
        return c.json({ error: 'Server not found or removal failed' }, 404);
    }
});

app.post('/api/title', async (c) => {
    const { prompt, response } = await c.req.json<{ prompt: string; response: string }>();
    if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
        return c.json({ error: 'prompt is required and must be a non-empty string' }, 400);
    }
    if (typeof response !== 'string' || response.length === 0) {
        return c.json({ error: 'response is required and must be a non-empty string' }, 400);
    }
    try {
        const title = await llm.generateTitle(prompt, response);
        return c.json({ title });
    } catch (err) {
        console.error('[burnish] Title generation failed:', err);
        return c.json({ error: 'Title generation failed' }, 500);
    }
});

// Lookup result cache — avoids redundant LLM calls for identical prompts
const lookupCache = new Map<string, { results: unknown[]; timestamp: number }>();
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LOOKUP_CACHE_MAX_SIZE = 1000;

/** Evict oldest entries to keep cache bounded. */
function evictLookupCache(): void {
    while (lookupCache.size >= LOOKUP_CACHE_MAX_SIZE) {
        const oldestKey = lookupCache.keys().next().value!;
        lookupCache.delete(oldestKey);
    }
}

app.post('/api/lookup', async (c) => {
    const { prompt } = await c.req.json<{ prompt: string }>();
    if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
        return c.json({ error: 'prompt is required and must be a non-empty string' }, 400);
    }

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
});

// --- Static Files ---

const repoRoot = resolve(__dirname, '../../..');
const demoRoot = resolve(__dirname, '..');

/** Resolve a file path and ensure it stays within the allowed base directory. */
function safePath(baseDir: string, userPath: string): string | null {
    const resolved = normalize(resolve(baseDir, userPath));
    const base = normalize(baseDir);
    return resolved.startsWith(base + '\\') || resolved.startsWith(base + '/') || resolved === base
        ? resolved
        : null;
}

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
    const modelName = process.env.ANTHROPIC_MODEL || 'sonnet';
    const llmBackend = (process.env.LLM_BACKEND || (apiKey ? 'api' : 'cli')) as 'api' | 'cli';

    if (llmBackend === 'api' && !apiKey) {
        console.error('[burnish] ANTHROPIC_API_KEY required for api backend.');
        console.error('[burnish] Set LLM_BACKEND=cli to use your Claude Code subscription instead.');
        process.exit(1);
    }

    const configPath = resolve(__dirname, '../mcp-servers.json');

    // Interpolate env vars in MCP config (e.g., ${GITHUB_TOKEN})
    const rawConfig = await readFile(configPath, 'utf-8');
    const resolvedConfig = interpolateEnvVars(rawConfig);
    const tmpDir = await mkdtemp(resolve(tmpdir(), 'burnish-'));
    const resolvedConfigPath = resolve(tmpDir, 'mcp-servers.json');
    await writeFile(resolvedConfigPath, resolvedConfig, 'utf-8');

    llm.configure({
        backend: llmBackend,
        apiKey,
        model: modelName,
        cwd: resolve(__dirname, '..'),
        mcpConfigPath: resolvedConfigPath,
    });

    try {
        await mcpHub.initialize(resolvedConfigPath);
    } catch (err) {
        console.warn('[burnish] Could not initialize MCP servers:', err);
        console.warn('[burnish] Starting without MCP server connections');
    }

    const serverInfo = mcpHub.getServerInfo();
    console.log(`[burnish] Connected to ${serverInfo.length} MCP server(s)`);
    for (const s of serverInfo) {
        console.log(`  - ${s.name}: ${s.toolCount} tools (${s.tools.map(t => t.name).join(', ')})`);
    }

    serve({ fetch: app.fetch, port }, () => {
        console.log(`[burnish] Demo server running at http://localhost:${port}`);
    });

    process.on('SIGINT', async () => {
        console.log('\n[burnish] Shutting down...');
        await mcpHub.shutdown();
        process.exit(0);
    });
}

start();
