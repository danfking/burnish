/**
 * Burnish Demo Server — thin Hono wrapper over @burnish/server.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    McpHub,
    ConversationStore,
    LlmOrchestrator,
    getCatalog,
    type McpServerConfig,
} from '@burnish/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

// --- Instantiate @burnish/server classes ---
const mcpHub = new McpHub();
const conversations = new ConversationStore();
const llm = new LlmOrchestrator(mcpHub, conversations);

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
    const body = await c.req.json<{ name: string; config: McpServerConfig }>();
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

app.post('/api/title', async (c) => {
    const { prompt, response } = await c.req.json<{ prompt: string; response: string }>();
    try {
        const title = await llm.generateTitle(prompt, response);
        return c.json({ title });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.warn('[burnish] Title generation failed:', msg);
        return c.json({ error: msg }, 500);
    }
});

// Lookup result cache — avoids redundant LLM calls for identical prompts
const lookupCache = new Map<string, { results: unknown[]; timestamp: number }>();
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

app.post('/api/lookup', async (c) => {
    const { prompt } = await c.req.json<{ prompt: string }>();

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
        lookupCache.set(prompt, { results, timestamp: Date.now() });
    }

    return results.length > 0
        ? c.json({ results })
        : c.json({ results: [], raw: result });
});

// --- Static Files ---

const repoRoot = resolve(__dirname, '../../..');
const demoRoot = resolve(__dirname, '..');

// Serve @burnish/app dist files
app.get('/app/:file{.+}', async (c) => {
    const { readFile } = await import('node:fs/promises');
    const filePath = resolve(repoRoot, 'packages/app/dist', c.req.param('file'));
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
    const { readFile } = await import('node:fs/promises');
    const filePath = resolve(repoRoot, 'packages/renderer/dist', c.req.param('file'));
    try {
        const content = await readFile(filePath, 'utf-8');
        c.header('Content-Type', 'application/javascript');
        return c.body(content);
    } catch {
        return c.text('Not found', 404);
    }
});

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

app.get('/tokens.css', async (c) => {
    const { readFile } = await import('node:fs/promises');
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

    llm.configure({
        backend: llmBackend,
        apiKey,
        model: modelName,
        cwd: resolve(__dirname, '..'),
        mcpConfigPath: configPath,
    });

    try {
        await mcpHub.initialize(configPath);
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
