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
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import * as mcpHub from './mcp-hub.js';
import * as conversations from './conversation.js';
import { buildSystemPrompt } from './prompt-template.js';

const MAX_TOOL_ROUNDS = 5;

let backend: 'api' | 'cli' = 'api';
let client: Anthropic | null = null;
let model = 'claude-sonnet-4-5-20250514';

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
 * Routes to API or CLI backend based on configuration.
 */
export async function* streamResponse(
    conversationId: string,
): AsyncGenerator<string> {
    if (backend === 'cli') {
        yield* streamResponseCli(conversationId);
    } else {
        yield* streamResponseApi(conversationId);
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Backend — uses `claude` CLI with your subscription auth
// ═══════════════════════════════════════════════════════════════

async function* streamResponseCli(
    conversationId: string,
): AsyncGenerator<string> {
    const conv = conversations.get(conversationId);
    if (!conv) return;

    // Build enriched system prompt with pre-fetched MCP tool data
    const systemPrompt = buildEnrichedSystemPrompt();

    // Build user message from conversation history
    const userMessage = buildUserMessage(conv);

    // Write system prompt to temp file (avoids command-line size limits)
    const tempFile = join(tmpdir(), `mcpui-prompt-${randomUUID()}.txt`);
    await writeFile(tempFile, systemPrompt, 'utf-8');

    try {
        // CLI command: claude.cmd on Windows, claude on Unix
        const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';

        const args = [
            '--print',
            '--verbose',
            '--output-format', 'stream-json',
            '--include-partial-messages',
            '--tools', '',
            '--model', model,
            '--system-prompt-file', tempFile,
            '--setting-sources', 'user',
        ];

        // Spawn the CLI process
        const env = { ...process.env };
        // Remove CLAUDECODE env var to prevent "nested session" error
        // when this app is running inside Claude Code itself
        delete env.CLAUDECODE;

        const proc = spawn(claudeCmd, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
            cwd: tmpdir(),
            shell: process.platform === 'win32',
        });

        // Send user message via stdin (avoids Windows quoting issues)
        proc.stdin.write(userMessage);
        proc.stdin.end();

        // Capture stderr for error reporting
        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        // Parse streaming JSON from stdout
        const rl = createInterface({ input: proc.stdout });
        let fullResponse = '';

        for await (const line of rl) {
            if (!line.trim()) continue;

            let doc: any;
            try { doc = JSON.parse(line); } catch { continue; }

            // CLI emits "stream_event" wrappers around standard Anthropic API events
            if (doc.type !== 'stream_event') continue;
            const event = doc.event;
            if (!event) continue;

            if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta' &&
                event.delta?.text
            ) {
                const chunk = event.delta.text;
                fullResponse += chunk;
                yield chunk;
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

/**
 * Build system prompt enriched with pre-fetched MCP tool data.
 * Since CLI mode doesn't support tool calling, we embed all available
 * data directly in the system prompt context.
 */
function buildEnrichedSystemPrompt(): string {
    const base = buildSystemPrompt();

    // Pre-fetch data from all connected MCP servers
    const tools = mcpHub.getAllTools();
    if (tools.length === 0) return base;

    const toolListText = tools
        .map(t => `- **${t.name}** (${t.serverName}): ${t.description}`)
        .join('\n');

    return `${base}

## Connected Tools (reference only — data will be provided by the user or in context)
${toolListText}

## Important
Since you cannot call tools directly in this mode, work with whatever data
the user provides or ask them to specify what they want to explore.
When the user asks about data, generate the best mcpui-* component layout
you can based on the information available.`;
}

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
): AsyncGenerator<string> {
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

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const params: Anthropic.MessageCreateParams = {
            model,
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

        for await (const event of stream) {
            if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
            ) {
                const text = event.delta.text;
                fullResponse += text;
                textAccumulator += text;
                yield text;
            }
        }

        const finalMessage = await stream.finalMessage();
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

    if (fullResponse) {
        conversations.addMessage(conversationId, 'assistant', fullResponse);
    }
}
