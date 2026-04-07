/**
 * Burnish CLI Server — Explorer-only mode.
 * Serves the Burnish UI and API for browsing/testing MCP tools.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { resolve, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import open from 'open';

import { McpHub, isWriteTool } from '@burnishdev/server';
import { buildConfigFile, cleanupTempConfig } from './config.js';
import type { CliOptions } from './cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, '../assets');

/**
 * Options for starting the server with a pre-initialized McpHub.
 */
export interface ServerOptions {
    /** Port to listen on (default: 3000). */
    port?: number;
    /** Open browser after starting (default: false). */
    open?: boolean;
}

/**
 * Resolve a user-supplied path against a base directory and verify
 * it does not escape outside the base (prevents path traversal).
 */
function safePath(baseDir: string, userPath: string): string | null {
    const resolved = normalize(resolve(baseDir, userPath));
    const base = normalize(baseDir);
    return resolved.startsWith(base + '\\') || resolved.startsWith(base + '/') || resolved === base
        ? resolved
        : null;
}

/** Map file extensions to MIME types. */
function mimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const types: Record<string, string> = {
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
    };
    return types[ext] || 'application/octet-stream';
}

/**
 * Build the Hono app wired to the given McpHub.
 * Exported so consumers can mount the app in their own server.
 */
export function buildApp(hub: McpHub): Hono {
    const app = new Hono();

    // --- API Routes ---

    app.get('/api/servers', (c) => {
        try {
            return c.json({ servers: hub.getServerInfo() });
        } catch (err) {
            console.error('[burnish] GET /api/servers error:', err);
            return c.json({ error: 'Internal server error' }, 500);
        }
    });

    app.get('/api/models', (c) => {
        return c.json({ models: [], current: null, backend: 'none' });
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

        // Check tool exists — handle both short names and fully-qualified mcp__server__tool names
        const allTools = hub.getAllTools();
        let toolName = body.toolName;
        let tool = allTools.find((t) => t.name === toolName);
        if (!tool) {
            const shortName = toolName.replace(/^mcp__\w+__/, '');
            tool = allTools.find((t) => t.name === shortName);
            if (tool) toolName = shortName;
        }
        if (!tool) {
            return c.json({ error: `Tool "${body.toolName}" not found` }, 404);
        }

        // Write tool gate
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
            const result = await hub.executeTool(toolName, args);
            const durationMs = Math.round(performance.now() - startTime);
            return c.json({ result, toolName, serverName: tool.serverName, durationMs });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Tool execution failed';
            console.error('[burnish] Tool execution failed:', err);
            return c.json({ error: message }, 500);
        }
    });

    // --- Static file serving from assets/ ---

    // Serve index.html at root
    app.get('/', async (c) => {
        try {
            const html = await readFile(resolve(assetsDir, 'index.html'), 'utf-8');
            c.header('Content-Type', 'text/html');
            c.header('Cache-Control', 'no-store');
            return c.body(html);
        } catch {
            return c.text('index.html not found — run "pnpm build" in packages/cli first', 500);
        }
    });

    // Catch-all static file handler
    app.get('/*', async (c) => {
        const urlPath = c.req.path;
        const filePath = safePath(assetsDir, urlPath);
        if (!filePath) return c.text('Forbidden', 403);

        try {
            const content = await readFile(filePath);
            c.header('Content-Type', mimeType(filePath));
            c.header('Cache-Control', 'no-cache, must-revalidate');
            return c.body(content);
        } catch {
            return c.text('Not found', 404);
        }
    });

    return app;
}

/**
 * Start the Burnish server with a pre-initialized McpHub.
 *
 * This is the programmatic entry point for embedding Burnish in other
 * applications (e.g., Express middleware, test harnesses).
 *
 * @param hub  An already-configured McpHub instance
 * @param opts Server options (port, open browser)
 */
export async function startServerWithHub(hub: McpHub, opts?: ServerOptions): Promise<void> {
    const port = opts?.port ?? 3000;
    const shouldOpen = opts?.open ?? false;

    const app = buildApp(hub);

    serve({ fetch: app.fetch, port }, () => {
        console.log(`[burnish] Explorer UI: http://localhost:${port}`);
    });

    if (shouldOpen) {
        try {
            await open(`http://localhost:${port}`);
        } catch {
            // Ignore — some environments don't have a browser
        }
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n[burnish] Shutting down...');
        await hub.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

/**
 * Start the Burnish server from CLI options.
 *
 * Creates an McpHub, initializes it from the config, and delegates
 * to startServerWithHub.
 */
export async function startServer(opts: CliOptions): Promise<void> {
    const mcpHub = new McpHub();

    console.log('[burnish] Connecting to MCP server...');

    const configPath = await buildConfigFile(opts);

    // Start the HTTP server immediately (before MCP init completes)
    const app = buildApp(mcpHub);

    serve({ fetch: app.fetch, port: opts.port }, () => {
        console.log(`[burnish] Explorer UI: http://localhost:${opts.port}`);
    });

    // Initialize MCP servers
    try {
        await mcpHub.initialize(configPath);
        const serverInfo = mcpHub.getServerInfo();
        const totalTools = serverInfo.reduce((sum, s) => sum + s.toolCount, 0);
        console.log(`[burnish] Connected: ${totalTools} tools available`);
        for (const s of serverInfo) {
            console.log(`  - ${s.name}: ${s.toolCount} tools (${s.status})`);
        }
    } catch (err) {
        console.error('[burnish] MCP server connection failed:', err instanceof Error ? err.message : err);
        console.error('[burnish] The UI is running but no tools are available.');
    }

    // Open browser
    if (opts.open) {
        try {
            await open(`http://localhost:${opts.port}`);
        } catch {
            // Ignore — some environments don't have a browser
        }
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n[burnish] Shutting down...');
        await mcpHub.shutdown();
        await cleanupTempConfig();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
