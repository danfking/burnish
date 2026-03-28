/**
 * MCPUI Demo Server — Hono API + static file serving.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamText } from 'hono/streaming';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as mcpHub from './mcp-hub.js';
import * as llm from './llm.js';
import * as conversations from './conversation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

// --- API Routes ---

app.post('/api/chat', async (c) => {
    const body = await c.req.json<{ prompt: string; conversationId?: string }>();
    const conv = conversations.getOrCreate(body.conversationId);
    conversations.addMessage(conv.id, 'user', body.prompt);
    return c.json({
        conversationId: conv.id,
        streamUrl: `/api/chat/${conv.id}/stream`,
    });
});

app.get('/api/chat/:id/stream', async (c) => {
    const id = c.req.param('id');
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return streamText(c, async (stream) => {
        try {
            for await (const chunk of llm.streamResponse(id)) {
                const data = JSON.stringify({ type: 'content', text: chunk });
                await stream.write(`data: ${data}\n\n`);
            }
            await stream.write('data: {"type":"done"}\n\n');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            const data = JSON.stringify({ type: 'error', message: msg });
            await stream.write(`data: ${data}\n\n`);
        }
    });
});

app.get('/api/chat/:id', (c) => {
    const conv = conversations.get(c.req.param('id'));
    return conv ? c.json(conv) : c.json({ error: 'Not found' }, 404);
});

app.get('/api/servers', (c) => {
    return c.json({ servers: mcpHub.getServerInfo() });
});

// --- Static Files ---

// Serve built component JS files at /components/*
app.use('/components/*', serveStatic({
    root: resolve(__dirname, '../../packages/components/dist'),
    rewriteRequestPath: (path) => path.replace('/components', ''),
}));

// Serve tokens.css from components package
app.get('/tokens.css', async (c) => {
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(
        resolve(__dirname, '../../packages/components/src/tokens.css'),
        'utf-8',
    );
    c.header('Content-Type', 'text/css');
    return c.body(css);
});

// Serve public directory
app.use('/*', serveStatic({ root: resolve(__dirname, '../public') }));

// --- Startup ---

async function start() {
    const port = parseInt(process.env.PORT || '3000', 10);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const modelName = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250514';
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
