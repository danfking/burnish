/**
 * Burnish Demo Server — Explorer mode.
 *
 * Deterministic MCP tool browsing and direct execution.
 *
 * Security hardening:
 * - Input validation on all API routes
 * - Token bucket rate limiting (10 req/min per IP)
 * - Optional Bearer token auth (BURNISH_API_KEY env var)
 * - Error message sanitization (generic messages to client)
 */

import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { McpHub, isWriteTool, safePath } from '@burnishdev/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

// --- Compression (gzip/deflate) ---
app.use(compress());

const mcpHub = new McpHub();

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

app.use('/api/tools/execute', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

// --- Telemetry ingestion (burnish CLI opt-in pings) ---
//
// Accepts anonymous opt-in telemetry from the burnish CLI (see
// packages/cli/src/telemetry.ts and issue #382). There is intentionally no
// persistent storage for v1.0 — we log validated payloads to stdout as a
// single JSON line prefixed with `telemetry_ping ` so they are greppable in
// `fly logs`. A real datastore can be swapped in later if volume warrants it.
//
// The route deliberately sits outside `/api/*` so that the optional
// BURNISH_API_KEY Bearer auth does NOT apply — the CLI has no credentials.

const TELEMETRY_RATE_LIMIT_MAX = 60; // 60 pings/min per IP
const TELEMETRY_RATE_WINDOW_MS = 60_000;
const TELEMETRY_MAX_BODY_BYTES = 1024; // 1KB hard cap

interface TelemetryBucket {
    tokens: number;
    lastRefill: number;
}
const telemetryBuckets = new Map<string, TelemetryBucket>();

function evictOldestTelemetryBucket(): void {
    if (telemetryBuckets.size >= RATE_BUCKET_MAX_ENTRIES) {
        const oldestKey = telemetryBuckets.keys().next().value;
        if (oldestKey) telemetryBuckets.delete(oldestKey);
    }
}

function checkTelemetryRateLimit(ip: string): boolean {
    const now = Date.now();
    let bucket = telemetryBuckets.get(ip);
    if (!bucket) {
        evictOldestTelemetryBucket();
        bucket = { tokens: TELEMETRY_RATE_LIMIT_MAX, lastRefill: now };
        telemetryBuckets.set(ip, bucket);
    }
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / TELEMETRY_RATE_WINDOW_MS) * TELEMETRY_RATE_LIMIT_MAX;
    if (refill > 0) {
        bucket.tokens = Math.min(TELEMETRY_RATE_LIMIT_MAX, bucket.tokens + refill);
        bucket.lastRefill = now;
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens--;
    return true;
}

const TELEMETRY_ALLOWED_KEYS = new Set(['v', 'os', 'node', 'bucket', 'id', 'schema_version']);
const TELEMETRY_ALLOWED_OS = new Set(['darwin', 'linux', 'win32', 'other']);
const TELEMETRY_ALLOWED_BUCKETS = new Set(['1', '2-5', '6-20', '21+']);

function validateTelemetryPayload(body: unknown): string | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'payload must be a JSON object';
    }
    const obj = body as Record<string, unknown>;
    const keys = Object.keys(obj);
    for (const k of keys) {
        if (!TELEMETRY_ALLOWED_KEYS.has(k)) return `unexpected field: ${k}`;
    }
    for (const required of TELEMETRY_ALLOWED_KEYS) {
        if (!(required in obj)) return `missing field: ${required}`;
    }
    if (typeof obj.v !== 'string' || obj.v.length > 32) return 'v must be a short string';
    if (typeof obj.os !== 'string' || !TELEMETRY_ALLOWED_OS.has(obj.os)) return 'os invalid';
    if (typeof obj.node !== 'string' || obj.node.length > 8) return 'node must be a short string';
    if (typeof obj.bucket !== 'string' || !TELEMETRY_ALLOWED_BUCKETS.has(obj.bucket)) return 'bucket invalid';
    if (typeof obj.id !== 'string' || obj.id.length < 8 || obj.id.length > 64) return 'id invalid';
    if (typeof obj.schema_version !== 'string' || obj.schema_version.length > 8) return 'schema_version invalid';
    return null;
}

// CORS preflight — allow POST from any origin (CLI is the main caller but
// other tools may legitimately ping).
app.options('/telemetry/v1/ping', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'content-type');
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
});

app.post('/telemetry/v1/ping', async (c) => {
    c.header('Access-Control-Allow-Origin', '*');

    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkTelemetryRateLimit(ip)) {
        return c.json({ error: 'Too many requests' }, 429);
    }

    // Enforce 1KB cap before parsing JSON.
    const lenHeader = c.req.header('content-length');
    if (lenHeader) {
        const len = parseInt(lenHeader, 10);
        if (!isNaN(len) && len > TELEMETRY_MAX_BODY_BYTES) {
            return c.json({ error: 'payload too large' }, 413);
        }
    }

    let raw: string;
    try {
        raw = await c.req.text();
    } catch {
        return c.json({ error: 'invalid body' }, 400);
    }
    if (raw.length > TELEMETRY_MAX_BODY_BYTES) {
        return c.json({ error: 'payload too large' }, 413);
    }

    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return c.json({ error: 'invalid JSON' }, 400);
    }

    const validationError = validateTelemetryPayload(body);
    if (validationError) {
        return c.json({ error: validationError }, 400);
    }

    // Structured single-line log for `fly logs | grep telemetry_ping`.
    // No IP is logged — we only use it for rate limiting, then drop it.
    console.log('telemetry_ping ' + JSON.stringify({ ...(body as Record<string, unknown>), at: new Date().toISOString() }));

    return c.body(null, 204);
});

// --- API Routes ---

const startedAt = Date.now();

app.get('/api/health', (c) => {
    const serverInfo = mcpHub.getServerInfo();
    return c.json({
        status: 'ok',
        servers: serverInfo.length,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        version: '0.3.0',
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

    if (body.args != null && (typeof body.args !== 'object' || Array.isArray(body.args))) {
        return c.json({ error: 'args must be a plain object' }, 400);
    }
    if (body.args && JSON.stringify(body.args).length > 50_000) {
        return c.json({ error: 'args payload too large' }, 413);
    }

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

    if (isWriteTool(toolName) && !body.confirmed) {
        return c.json({ error: 'Write tool requires confirmation', requiresConfirmation: true }, 403);
    }

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

// --- Static Files ---
const CACHE_BUSTER = `v=${Date.now()}`;

const repoRoot = resolve(__dirname, '../../..');
const demoRoot = resolve(__dirname, '..');

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

app.get('/', async (c) => {
    let html = await readFile(resolve(demoRoot, 'public/index.html'), 'utf-8');
    html = html.replace(/(src|href)="(\/[^"]+\.(js|css))"/g, `$1="$2?${CACHE_BUSTER}"`);
    html = html.replace('</head>', `<meta name="burnish-version" content="${CACHE_BUSTER}"></head>`);
    c.header('Content-Type', 'text/html');
    c.header('Cache-Control', 'no-store');
    return c.body(html);
});

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
    const userConfigPath = resolve(__dirname, '../mcp-servers.json');
    const defaultConfigPath = resolve(__dirname, '../mcp-servers.default.json');
    const rawConfigPath = existsSync(userConfigPath) ? userConfigPath : defaultConfigPath;
    if (rawConfigPath === defaultConfigPath) {
        console.log('[burnish] No mcp-servers.json found — using mcp-servers.default.json (showcase example-server).');
        console.log('[burnish] Create apps/demo/mcp-servers.json to configure your own MCP servers.');
    }

    if (!requiredApiKey) {
        console.warn('[burnish] WARNING: BURNISH_API_KEY is not set. API routes are unprotected.');
        console.warn('[burnish] Set BURNISH_API_KEY=<secret> to require Bearer token auth on /api/* routes.');
    }

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
        // Config file doesn't exist — mcpHub.initialize will handle it
    }

    serve({ fetch: app.fetch, port }, () => {
        console.log(`[burnish] Running at http://localhost:${port}`);
    });

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
