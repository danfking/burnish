/**
 * Burnish Demo Server — deterministic MCP navigator.
 *
 * Connects to MCP servers, lists tools, and executes them directly.
 * No LLM, no streaming, no SSE — synchronous execution only.
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
import { resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
    McpHub,
    isWriteTool,
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

// --- Rate limiting on tool execution ---
app.use('/api/tools/execute', async (c, next) => {
    const ip = getClientIp(c.req.raw, c.req.raw.headers);
    if (!checkRateLimit(ip)) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    await next();
});

// --- API Routes ---

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

    // Write tools require explicit confirmation from the frontend
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
        const result = await mcpHub.executeTool(toolName, args);
        return c.json({ result, toolName, serverName: tool.serverName });
    } catch (err) {
        console.error('[burnish] Direct tool execution failed:', err);
        return c.json({ error: 'Tool execution failed' }, 500);
    }
});

// --- Static Files ---
// Cache-busting: use startup timestamp so all assets refresh on server restart
const CACHE_BUSTER = `v=${Date.now()}`;

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
        c.header('Cache-Control', 'no-cache, must-revalidate');
        c.header('ETag', CACHE_BUSTER);
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
    const rawConfigPath = resolve(__dirname, '../mcp-servers.json');

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
