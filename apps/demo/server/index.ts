/**
 * MCPUI Demo Server — Hono API + static file serving.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as mcpHub from './mcp-hub.js';
import { getCatalog } from './catalog.js';
import * as llm from './llm.js';
import * as conversations from './conversation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

// --- API Routes ---

app.post('/api/chat', async (c) => {
    const body = await c.req.json<{ prompt: string; conversationId?: string; model?: string }>();
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
    const requestModel = c.req.query('model') || undefined;

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
                const msg = err instanceof Error ? err.message : 'Unknown error';
                const data = JSON.stringify({ type: 'error', message: msg });
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
    const conv = conversations.get(c.req.param('id'));
    return conv ? c.json(conv) : c.json({ error: 'Not found' }, 404);
});

app.get('/api/servers', (c) => {
    return c.json({ servers: mcpHub.getServerInfo() });
});

app.get('/api/servers/catalog', (c) => {
    return c.json({ catalog: getCatalog() });
});

app.post('/api/servers', async (c) => {
    const body = await c.req.json<{ name: string; config: mcpHub.McpServerConfig }>();
    try {
        await mcpHub.addServer(body.name, body.config);
        return c.json({ ok: true, servers: mcpHub.getServerInfo() });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error: msg }, 500);
    }
});

app.delete('/api/servers/:name', async (c) => {
    const name = c.req.param('name');
    try {
        await mcpHub.removeServer(name);
        return c.json({ ok: true, servers: mcpHub.getServerInfo() });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error: msg }, 404);
    }
});

// --- Static Files ---

// Resolve paths relative to the repo root (apps/demo/server -> ../../..)
const repoRoot = resolve(__dirname, '../../..');
const demoRoot = resolve(__dirname, '..');

// Serve built component JS files at /components/*
app.get('/components/:file', async (c) => {
    const { readFile } = await import('node:fs/promises');
    const filePath = resolve(repoRoot, 'packages/components/dist', c.req.param('file'));
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
        return c.body(content);
    } catch {
        return c.text('Not found', 404);
    }
});

// Serve tokens.css from components package
app.get('/tokens.css', async (c) => {
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(
        resolve(repoRoot, 'packages/components/src/tokens.css'),
        'utf-8',
    );
    c.header('Content-Type', 'text/css');
    return c.body(css);
});

// Serve public directory
app.use('/*', serveStatic({ root: resolve(demoRoot, 'public') }));

// --- Startup ---

async function start() {
    const port = parseInt(process.env.PORT || '3000', 10);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const modelName = process.env.ANTHROPIC_MODEL || 'sonnet';
    const llmBackend = (process.env.LLM_BACKEND || (apiKey ? 'api' : 'cli')) as 'api' | 'cli';

    if (llmBackend === 'api' && !apiKey) {
        console.error('[mcpui] ANTHROPIC_API_KEY required for api backend.');
        console.error('[mcpui] Set LLM_BACKEND=cli to use your Claude Code subscription instead.');
        process.exit(1);
    }

    llm.configure({ backend: llmBackend, apiKey, model: modelName });

    // Connect to MCP servers
    const configPath = resolve(__dirname, '../mcp-servers.json');
    try {
        await mcpHub.initialize(configPath);
    } catch (err) {
        console.warn('[mcpui] Could not initialize MCP servers:', err);
        console.warn('[mcpui] Starting without MCP server connections');
    }

    const serverInfo = mcpHub.getServerInfo();
    console.log(`[mcpui] Connected to ${serverInfo.length} MCP server(s)`);
    for (const s of serverInfo) {
        console.log(`  - ${s.name}: ${s.toolCount} tools (${s.tools.join(', ')})`);
    }

    serve({ fetch: app.fetch, port }, () => {
        console.log(`[mcpui] Demo server running at http://localhost:${port}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[mcpui] Shutting down...');
        await mcpHub.shutdown();
        process.exit(0);
    });
}

start();
