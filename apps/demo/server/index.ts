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
