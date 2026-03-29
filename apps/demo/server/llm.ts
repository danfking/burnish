/**
 * LLM Orchestrator — handles tool-call loop with streaming.
 *
 * Two backends:
 * - "api": Direct Anthropic SDK (needs ANTHROPIC_API_KEY)
 * - "cli": Spawns `claude` CLI subprocess (uses your Claude Code subscription auth)
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import * as mcpHub from './mcp-hub.js';
import * as conversations from './conversation.js';
import { buildSystemPrompt } from './prompt-template.js';

export type StreamChunk =
    | { type: 'content'; text: string }
    | { type: 'progress'; stage: string; detail?: string }
    | { type: 'stats'; durationMs: number; inputTokens: number; outputTokens: number; costUsd?: number };

const MAX_TOOL_ROUNDS = 5;

let backend: 'api' | 'cli' = 'api';
let client: Anthropic | null = null;
let model = 'sonnet';

export function configure(options: {
    backend?: 'api' | 'cli';
    apiKey?: string;
    model?: string;
}): void {
    backend = options.backend ?? 'api';
    if (options.model) model = options.model;

    if (backend === 'api') {
        if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY required for api backend');
        client = new Anthropic({ apiKey: options.apiKey });
    }

    console.log(`[llm] Backend: ${backend}, Model: ${model}`);
}

/**
 * Stream a response for a conversation.
 * Yields StreamChunk objects (content text or progress updates).
 */
export async function* streamResponse(
    conversationId: string,
    requestModel?: string,
): AsyncGenerator<StreamChunk> {
    const useModel = requestModel || model;
    if (backend === 'cli') {
        yield* streamResponseCli(conversationId, useModel);
    } else {
        yield* streamResponseApi(conversationId, useModel);
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Backend — uses `claude` CLI with your subscription auth
// ═══════════════════════════════════════════════════════════════

async function* streamResponseCli(
    conversationId: string,
    useModel = model,
): AsyncGenerator<StreamChunk> {
    const conv = conversations.get(conversationId);
    if (!conv) return;

    // Use the base system prompt (no need to pre-fetch — CLI handles tool calling via MCP)
    const systemPrompt = buildSystemPrompt();

    // Build user message from conversation history
    const userMessage = buildUserMessage(conv);

    // Write system prompt to temp file (avoids command-line size limits)
    const tempFile = join(tmpdir(), `mcpui-prompt-${randomUUID()}.txt`);
    await writeFile(tempFile, systemPrompt, 'utf-8');

    // Resolve the MCP server config path
    const mcpConfigPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../mcp-servers.json',
    );

    try {
        // CLI command: claude.cmd on Windows, claude on Unix
        const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';

        // Build allowed tools list from connected MCP servers
        // The CLI needs explicit permission for MCP tools
        const mcpTools = mcpHub.getAllTools();
        const allowedToolNames = mcpTools.map(t => `mcp__${t.serverName}__${t.name}`);

        const args = [
            '--print',
            '--verbose',
            '--output-format', 'stream-json',
            '--model', useModel,
            '--system-prompt-file', tempFile,
            '--mcp-config', mcpConfigPath,
            '--strict-mcp-config',
            '--tools', '',
            '--setting-sources', 'user',
            ...(allowedToolNames.length > 0
                ? ['--allowedTools', ...allowedToolNames]
                : []),
        ];

        console.log(`[llm-cli] Launching with MCP config: ${mcpConfigPath}`);

        // Spawn the CLI process
        const env = { ...process.env };
        // Remove CLAUDECODE env var to prevent "nested session" error
        // when this app is running inside Claude Code itself
        delete env.CLAUDECODE;

        const proc = spawn(claudeCmd, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
            shell: process.platform === 'win32',
        });

        // Send user message via stdin (avoids Windows quoting issues)
        proc.stdin.write(userMessage);
        proc.stdin.end();

        // Capture stderr for error reporting
        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        // Parse streaming JSON from stdout — emit both content and progress events
        const rl = createInterface({ input: proc.stdout });
        let fullResponse = '';

        for await (const line of rl) {
            if (!line.trim()) continue;

            let doc: any;
            try { doc = JSON.parse(line); } catch { continue; }

            // System init — MCP servers connecting
            if (doc.type === 'system' && doc.subtype === 'init') {
                const serverCount = doc.mcp_servers?.length ?? 0;
                yield { type: 'progress', stage: 'connecting', detail: `Connected to ${serverCount} MCP server(s)` };
                continue;
            }

            // Handle stream_event wrappers (streaming mode)
            if (doc.type === 'stream_event') {
                const event = doc.event;
                if (
                    event?.type === 'content_block_delta' &&
                    event.delta?.type === 'text_delta' &&
                    event.delta?.text
                ) {
                    fullResponse += event.delta.text;
                    yield { type: 'content', text: event.delta.text };
                }
                continue;
            }

            // Handle assistant messages — extract progress from thinking/tool_use blocks
            if (doc.type === 'assistant' && doc.message?.content) {
                for (const block of doc.message.content) {
                    if (block.type === 'thinking') {
                        yield { type: 'progress', stage: 'thinking', detail: 'Analyzing your request...' };
                    } else if (block.type === 'tool_use') {
                        const toolName = (block.name || '').replace(/^mcp__\w+__/, '');
                        yield { type: 'progress', stage: 'tool_call', detail: `Calling ${toolName}...` };
                    } else if (block.type === 'tool_result') {
                        yield { type: 'progress', stage: 'tool_result', detail: 'Processing results...' };
                    } else if (block.type === 'text' && block.text) {
                        fullResponse += block.text;
                        yield { type: 'content', text: block.text };
                    }
                }
                continue;
            }

            // Handle result message (final)
            if (doc.type === 'result') {
                if (doc.result && !fullResponse) {
                    fullResponse = doc.result;
                    yield { type: 'content', text: doc.result };
                }
                // Emit stats from the result event (LLM-agnostic: all providers report usage)
                const usage = doc.usage || {};
                yield {
                    type: 'stats',
                    durationMs: doc.duration_ms || 0,
                    inputTokens: usage.input_tokens || 0,
                    outputTokens: usage.output_tokens || 0,
                    costUsd: doc.total_cost_usd,
                };
            }
        }

        // Wait for process exit
        const exitCode = await new Promise<number>((resolve) => {
            proc.on('close', (code) => resolve(code ?? 0));
        });

        if (exitCode !== 0) {
            console.warn(`[llm-cli] claude exited with code ${exitCode}: ${stderr}`);
        }

        // Save response to conversation history
        if (fullResponse) {
            conversations.addMessage(conversationId, 'assistant', fullResponse);
        }
    } finally {
        // Clean up temp file
        await unlink(tempFile).catch(() => {});
    }
}

// buildEnrichedSystemPrompt removed — CLI now handles tool calling
// directly via --mcp-config, so the base system prompt is sufficient.

/**
 * Build the user message from conversation history.
 * For CLI mode, we concatenate the full conversation into a single prompt.
 */
function buildUserMessage(conv: conversations.Conversation): string {
    if (conv.messages.length === 1) {
        return conv.messages[0].content;
    }

    // For multi-turn, build a formatted conversation
    return conv.messages
        .map(m => {
            if (m.role === 'user') return `User: ${m.content}`;
            // Truncate long assistant responses (they contain HTML)
            const content = m.content.length > 200
                ? '[Previous dashboard response]'
                : m.content;
            return `Assistant: ${content}`;
        })
        .join('\n\n');
}

// ═══════════════════════════════════════════════════════════════
// API Backend — direct Anthropic SDK with tool-call loop
// ═══════════════════════════════════════════════════════════════

async function* streamResponseApi(
    conversationId: string,
    useModel = model,
): AsyncGenerator<StreamChunk> {
    if (!client) throw new Error('LLM not configured — call configure() first');

    const conv = conversations.get(conversationId);
    if (!conv) return;

    const messages: Anthropic.MessageParam[] = conv.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    const mcpTools = mcpHub.getAllTools();
    const tools: Anthropic.Tool[] = mcpTools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const systemPrompt = buildSystemPrompt();
    let fullResponse = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const apiStartTime = Date.now();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const params: Anthropic.MessageCreateParams = {
            model: useModel,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            ...(tools.length > 0 ? { tools } : {}),
        };

        const stream = client.messages.stream(params);
        let textAccumulator = '';
        const pendingToolCalls: Array<{
            id: string;
            name: string;
            input: Record<string, unknown>;
        }> = [];

        if (round === 0) {
            yield { type: 'progress', stage: 'thinking', detail: 'Analyzing your request...' };
        }

        for await (const event of stream) {
            if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
            ) {
                const text = event.delta.text;
                fullResponse += text;
                textAccumulator += text;
                yield { type: 'content', text };
            }
        }

        const finalMessage = await stream.finalMessage();
        totalInputTokens += finalMessage.usage?.input_tokens || 0;
        totalOutputTokens += finalMessage.usage?.output_tokens || 0;
        for (const block of finalMessage.content) {
            if (block.type === 'tool_use') {
                pendingToolCalls.push({
                    id: block.id,
                    name: block.name,
                    input: block.input as Record<string, unknown>,
                });
            }
        }

        if (pendingToolCalls.length === 0) break;

        const assistantContent: Anthropic.ContentBlockParam[] = [];
        if (textAccumulator) {
            assistantContent.push({ type: 'text', text: textAccumulator });
        }
        for (const tc of pendingToolCalls) {
            assistantContent.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.input,
            });
        }
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tc of pendingToolCalls) {
            try {
                yield { type: 'progress', stage: 'tool_call', detail: `Calling ${tc.name}...` };
                console.log(`[llm] Executing tool: ${tc.name}`);
                const result = await mcpHub.executeTool(tc.name, tc.input);
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tc.id,
                    content: result,
                });
            } catch (err) {
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tc.id,
                    content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    is_error: true,
                });
            }
        }

        messages.push({ role: 'user', content: toolResults });
        textAccumulator = '';
    }

    // Emit stats (LLM-agnostic: all providers report token usage)
    yield {
        type: 'stats',
        durationMs: Date.now() - apiStartTime,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
    };

    if (fullResponse) {
        conversations.addMessage(conversationId, 'assistant', fullResponse);
    }
}
