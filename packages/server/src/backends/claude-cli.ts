/**
 * Claude CLI backend — spawns the `claude` CLI subprocess with subscription auth.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { McpHub } from '../mcp-hub.js';
import type { ConversationStore } from '../conversation.js';
import type { StreamChunk } from '../llm-types.js';
import { buildAdaptiveSystemPrompt, buildAdaptiveNoToolsPrompt } from '../prompt-template.js';
import { detectPivotCommand, buildPivotPrompt } from '../pivot-detector.js';
import { extractServerName } from '../tool-executor.js';

export class ClaudeCliBackend {
    constructor(
        private mcpConfigPath: string | undefined,
        private cwd: string | undefined,
    ) {}

    static readonly TITLE_SYSTEM_PROMPT =
        'Generate a concise 3-6 word title that describes the user\'s request. ' +
        'Return ONLY the title text, no quotes, no punctuation at the end, no explanation.';

    async generateTitle(userMessage: string): Promise<string> {
        const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const fullPrompt = `${ClaudeCliBackend.TITLE_SYSTEM_PROMPT}\n\n${userMessage}`;

        return new Promise<string>((resolve, reject) => {
            const proc = spawn(claudeCmd, [
                '--print',
                '--model', 'haiku',
                '--tools', '',
                '--setting-sources', 'user',
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
                shell: process.platform === 'win32',
            });

            proc.stdin.write(fullPrompt);
            proc.stdin.end();

            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code: number | null) => {
                if (code !== 0) {
                    reject(new Error(`claude exited with code ${code}: ${stderr}`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    /**
     * Build the user message from conversation history.
     */
    buildUserMessage(conv: { messages: Array<{ role: string; content: string }> }): string {
        if (conv.messages.length === 1) {
            return conv.messages[0].content;
        }

        // If the latest user message is a direct tool invocation (e.g. from a form
        // submission), it already contains all needed context (tool name + params).
        // Including truncated history would strip the tool context the LLM needs,
        // so we return only the tool-call instruction.
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg.role === 'user' && /^Call the tool\b/i.test(lastMsg.content)) {
            return lastMsg.content;
        }

        // Check if the latest user message is a pivot/transformation command.
        // If so, include the full previous assistant response (not truncated)
        // so the LLM can re-derive the view from the data.
        if (lastMsg.role === 'user') {
            const pivotCommand = detectPivotCommand(lastMsg.content);
            if (pivotCommand) {
                // Find the most recent assistant response with content
                const lastAssistant = [...conv.messages]
                    .reverse()
                    .find(m => m.role === 'assistant' && m.content.length > 0);

                if (lastAssistant) {
                    console.log(`[llm] Pivot command detected: ${pivotCommand.type}${pivotCommand.field ? ` by ${pivotCommand.field}` : ''}`);
                    return buildPivotPrompt(pivotCommand, lastAssistant.content);
                }
            }
        }

        return conv.messages
            .map(m => {
                if (m.role === 'user') return `User: ${m.content}`;
                const content = m.content.length > 200
                    ? '[Previous dashboard response]'
                    : m.content;
                return `Assistant: ${content}`;
            })
            .join('\n\n');
    }

    async *streamResponse(
        conversations: ConversationStore,
        conversationId: string,
        mcpHub: McpHub,
        useModel: string,
        noTools: boolean,
        extraInstructions?: string,
    ): AsyncGenerator<StreamChunk> {
        const conv = conversations.get(conversationId);
        if (!conv) return;

        const systemPrompt = noTools ? buildAdaptiveNoToolsPrompt(useModel) : buildAdaptiveSystemPrompt(useModel, extraInstructions);
        const userMessage = this.buildUserMessage(conv);

        // Write system prompt to temp file (avoids command-line size limits)
        const tempFile = join(tmpdir(), `burnish-prompt-${randomUUID()}.txt`);
        await writeFile(tempFile, systemPrompt, 'utf-8');

        try {
            // CLI command: claude.cmd on Windows, claude on Unix
            const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';

            // Build allowed tools list from connected MCP servers
            const mcpTools = mcpHub.getAllTools();
            const allowedToolNames = noTools ? [] : mcpTools.map(t => `mcp__${t.serverName}__${t.name}`);

            const mcpConfigPath = this.mcpConfigPath;
            if (!mcpConfigPath) throw new Error('mcpConfigPath required for CLI backend');

            const args = [
                '--print',
                '--verbose',
                '--output-format', 'stream-json',
                '--include-partial-messages',
                '--model', useModel,
                '--system-prompt-file', tempFile,
                // Only include MCP config and tools when tools are not explicitly disabled
                ...(noTools ? [] : ['--mcp-config', mcpConfigPath, '--strict-mcp-config']),
                '--tools', '',
                '--setting-sources', 'user',
                ...(allowedToolNames.length > 0
                    ? ['--allowedTools', ...allowedToolNames]
                    : []),
            ];

            console.log(`[llm-cli] Launching with MCP config: ${mcpConfigPath}`);
            yield { type: 'progress', stage: 'starting', detail: 'Sending request…', meta: { model: useModel } } as StreamChunk;

            // Spawn the CLI process
            const env = { ...process.env };
            delete env.CLAUDECODE;

            const proc = spawn(claudeCmd, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
                cwd: this.cwd,
                shell: process.platform === 'win32',
            });

            // Send user message via stdin
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

                if (doc.type === 'system' && doc.subtype === 'init') {
                    const serverNames: string[] = (doc.mcp_servers || []).map((s: any) => s.name || 'unknown');
                    const label = serverNames.length === 1
                        ? `Connecting to MCP server…`
                        : `Connecting to ${serverNames.length} MCP servers…`;
                    const server = serverNames.length === 1 ? serverNames[0] : serverNames.join(', ');
                    yield { type: 'progress', stage: 'connecting', detail: label, meta: { server } };
                    continue;
                }

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

                if (doc.type === 'assistant' && doc.message?.content) {
                    for (const block of doc.message.content) {
                        if (block.type === 'thinking') {
                            yield { type: 'progress', stage: 'thinking', detail: 'Thinking…', meta: { model: useModel } };
                        } else if (block.type === 'tool_use') {
                            const fullToolName = block.name || '';
                            const shortName = fullToolName.replace(/^mcp__\w+__/, '');
                            const server = extractServerName(fullToolName);
                            yield { type: 'progress', stage: 'tool_call', detail: `Calling ${shortName}…`, meta: server ? { server } : undefined };
                        } else if (block.type === 'tool_result') {
                            yield { type: 'progress', stage: 'tool_result', detail: 'Processing results…' };
                        } else if (block.type === 'text' && block.text) {
                            if (!fullResponse) {
                                fullResponse += block.text;
                                yield { type: 'content', text: block.text };
                            }
                        }
                    }
                    continue;
                }

                if (doc.type === 'result') {
                    if (doc.result && !fullResponse) {
                        fullResponse = doc.result;
                        yield { type: 'content', text: doc.result };
                    }
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
                proc.on('close', (code: number | null) => resolve(code ?? 0));
            });

            if (exitCode !== 0) {
                console.warn(`[llm-cli] claude exited with code ${exitCode}: ${stderr}`);
            }

            if (fullResponse) {
                conversations.addMessage(conversationId, 'assistant', fullResponse);
            }
        } finally {
            await unlink(tempFile).catch(() => {});
        }
    }
}
