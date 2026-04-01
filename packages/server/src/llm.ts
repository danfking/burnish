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
import type { McpHub } from './mcp-hub.js';
import type { ConversationStore, Conversation } from './conversation.js';
import { buildSystemPrompt } from './prompt-template.js';
import { guardToolExecution } from './guards.js';

export interface WorkflowStep {
    server: string;
    tool: string;
    status: 'pending' | 'running' | 'success' | 'error';
}

export type StreamChunk =
    | { type: 'content'; text: string }
    | { type: 'progress'; stage: string; detail?: string; meta?: { model?: string; server?: string } }
    | { type: 'workflow_trace'; steps: WorkflowStep[] }
    | { type: 'stats'; durationMs: number; inputTokens: number; outputTokens: number; costUsd?: number };

const DEFAULT_MAX_TOOL_ROUNDS = 8;

/**
 * Strip stack traces, file paths, and internal details from error messages
 * before sending to the client stream.
 */
function sanitizeErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    // Strip file paths (Unix and Windows)
    let sanitized = raw.replace(/(?:[A-Z]:)?[/\\][\w./\\-]+/gi, '[path]');
    // Strip stack trace lines
    sanitized = sanitized.replace(/\n\s+at\s+.*/g, '');
    // Truncate to prevent excessive error data
    if (sanitized.length > 200) {
        sanitized = sanitized.slice(0, 200) + '…';
    }
    return sanitized || 'An internal error occurred';
}

/** Allowlisted model identifiers for CLI subprocess. */
const ALLOWED_MODELS = new Set([
    'sonnet', 'haiku', 'opus',
    'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6',
    'claude-sonnet-4-5-20250514',
]);

/** Validate model name against allowlist. */
function validateModel(model: string): string {
    if (!ALLOWED_MODELS.has(model)) {
        throw new Error(`Invalid model: "${model}". Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
    }
    return model;
}

/** Validate mcpConfigPath — must be a plausible file path with no shell metacharacters. */
function validateConfigPath(configPath: string): string {
    // Block shell metacharacters that could enable command injection
    const dangerous = /[;|&$`!><(){}\[\]'"\\#~\n\r]/;
    if (dangerous.test(configPath)) {
        throw new Error(`Invalid mcpConfigPath: contains dangerous characters`);
    }
    // Must end in .json
    if (!configPath.endsWith('.json')) {
        throw new Error(`Invalid mcpConfigPath: must end in .json`);
    }
    return configPath;
}

function extractServerName(toolName: string): string | undefined {
    const match = toolName.match(/^mcp__([^_]+)__/);
    return match?.[1];
}

export interface LlmOrchestratorOptions {
    backend?: 'api' | 'cli';
    apiKey?: string;
    model?: string;
    /** Working directory for CLI subprocess (typically the demo app root) */
    cwd?: string;
    /** Path to MCP server config JSON file (for CLI backend) */
    mcpConfigPath?: string;
    /** Maximum tool-call rounds per request (default 8) */
    maxToolRounds?: number;
}

export class LlmOrchestrator {
    private backend: 'api' | 'cli' = 'api';
    private client: Anthropic | null = null;
    private model = 'sonnet';
    private cwd: string | undefined;
    private mcpConfigPath: string | undefined;
    private maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS;

    constructor(
        private mcpHub: McpHub,
        private conversations: ConversationStore,
    ) {}

    configure(options: LlmOrchestratorOptions): void {
        this.backend = options.backend ?? 'api';
        if (options.model) this.model = options.model;
        if (options.cwd) this.cwd = options.cwd;
        if (options.mcpConfigPath) this.mcpConfigPath = options.mcpConfigPath;
        if (options.maxToolRounds != null) this.maxToolRounds = options.maxToolRounds;

        if (this.backend === 'api') {
            if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY required for api backend');
            this.client = new Anthropic({ apiKey: options.apiKey });
        }

        console.log(`[llm] Backend: ${this.backend}, Model: ${this.model}`);
    }

    /**
     * Stream a response for a conversation.
     * Yields StreamChunk objects (content text or progress updates).
     */
    async *streamResponse(
        conversationId: string,
        requestModel?: string,
    ): AsyncGenerator<StreamChunk> {
        const useModel = requestModel || this.model;
        if (this.backend === 'cli') {
            yield* this.streamResponseCli(conversationId, useModel);
        } else {
            yield* this.streamResponseApi(conversationId, useModel);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CLI Backend — uses `claude` CLI with your subscription auth
    // ═══════════════════════════════════════════════════════════════

    private async *streamResponseCli(
        conversationId: string,
        useModel = this.model,
    ): AsyncGenerator<StreamChunk> {
        const conv = this.conversations.get(conversationId);
        if (!conv) return;

        const systemPrompt = buildSystemPrompt();
        const userMessage = this.buildUserMessage(conv);

        // Write system prompt to temp file (avoids command-line size limits)
        const tempFile = join(tmpdir(), `burnish-prompt-${randomUUID()}.txt`);
        await writeFile(tempFile, systemPrompt, 'utf-8');

        try {
            // CLI command: claude.cmd on Windows, claude on Unix
            const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';

            // Build allowed tools list from connected MCP servers
            const mcpTools = this.mcpHub.getAllTools();
            const allowedToolNames = mcpTools.map(t => `mcp__${t.serverName}__${t.name}`);

            const mcpConfigPath = this.mcpConfigPath;
            if (!mcpConfigPath) throw new Error('mcpConfigPath required for CLI backend');
            validateConfigPath(mcpConfigPath);
            const validatedModel = validateModel(useModel);

            const args = [
                '--print',
                '--verbose',
                '--output-format', 'stream-json',
                '--include-partial-messages',
                '--model', validatedModel,
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
                this.conversations.addMessage(conversationId, 'assistant', fullResponse);
            }
        } finally {
            await unlink(tempFile).catch(() => {});
        }
    }

    /**
     * Build the user message from conversation history.
     */
    private buildUserMessage(conv: Conversation): string {
        if (conv.messages.length === 1) {
            return conv.messages[0].content;
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

    // ═══════════════════════════════════════════════════════════════
    // API Backend — direct Anthropic SDK with tool-call loop
    // ═══════════════════════════════════════════════════════════════

    private async *streamResponseApi(
        conversationId: string,
        useModel = this.model,
    ): AsyncGenerator<StreamChunk> {
        if (!this.client) throw new Error('LLM not configured — call configure() first');

        const conv = this.conversations.get(conversationId);
        if (!conv) return;

        const messages: Anthropic.MessageParam[] = conv.messages.map((m, i) => {
            if (
                m.role === 'assistant' &&
                i < conv.messages.length - 1 &&
                m.content.length > 200
            ) {
                return { role: 'assistant' as const, content: '[Previous dashboard response]' };
            }
            return { role: m.role, content: m.content };
        });

        const mcpTools = this.mcpHub.getAllTools();
        const tools: Anthropic.Tool[] = mcpTools.map((t, i) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
            ...(i === mcpTools.length - 1
                ? { cache_control: { type: 'ephemeral' as const } }
                : {}),
        }));

        const systemPrompt = buildSystemPrompt();
        const system: Anthropic.MessageCreateParams['system'] = [
            {
                type: 'text' as const,
                text: systemPrompt,
                cache_control: { type: 'ephemeral' } as const,
            },
        ];

        let fullResponse = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        const apiStartTime = Date.now();
        const workflowSteps: WorkflowStep[] = [];

        yield { type: 'progress', stage: 'starting', detail: 'Sending request…', meta: { model: useModel } };

        for (let round = 0; round < this.maxToolRounds; round++) {
            const params: Anthropic.MessageCreateParams = {
                model: useModel,
                max_tokens: 4096,
                system,
                messages,
                ...(tools.length > 0 ? { tools } : {}),
            };

            const stream = this.client.messages.stream(params);
            let textAccumulator = '';
            const pendingToolCalls: Array<{
                id: string;
                name: string;
                input: Record<string, unknown>;
            }> = [];

            if (round === 0) {
                yield { type: 'progress', stage: 'thinking', detail: 'Thinking…', meta: { model: useModel } };
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
            const usage = finalMessage.usage as unknown as Record<string, number>;
            cacheReadTokens += usage?.cache_read_input_tokens || 0;
            cacheCreationTokens += usage?.cache_creation_input_tokens || 0;
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
                const server = extractServerName(tc.name) || 'unknown';
                const shortName = tc.name.replace(/^mcp__\w+__/, '');
                const step: WorkflowStep = { server, tool: shortName, status: 'running' };
                workflowSteps.push(step);
                yield { type: 'workflow_trace', steps: [...workflowSteps] };

                try {
                    // Pre-execution guard check
                    const guard = guardToolExecution(tc.name, tc.input);
                    if (!guard.allowed) {
                        step.status = 'error';
                        yield { type: 'workflow_trace', steps: [...workflowSteps] };
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: tc.id,
                            content: guard.reason || `Tool "${tc.name}" blocked by guard`,
                            is_error: true,
                        });
                        continue;
                    }

                    yield { type: 'progress', stage: 'tool_call', detail: `Calling ${tc.name}…`, meta: { server } };
                    console.log(`[llm] Executing tool: ${tc.name}`);
                    const result = await this.mcpHub.executeTool(tc.name, tc.input);
                    step.status = 'success';
                    yield { type: 'workflow_trace', steps: [...workflowSteps] };
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: result,
                    });
                } catch (err) {
                    step.status = 'error';
                    yield { type: 'workflow_trace', steps: [...workflowSteps] };
                    console.error(`[llm] Tool execution error for ${tc.name}:`, err);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: `Error: ${sanitizeErrorMessage(err)}`,
                        is_error: true,
                    });
                }
            }

            messages.push({ role: 'user', content: toolResults });
            yield { type: 'progress', stage: 'thinking', detail: 'Thinking…', meta: { model: useModel } };
            textAccumulator = '';
        }

        if (cacheReadTokens > 0 || cacheCreationTokens > 0) {
            console.log(`[llm] Cache: ${cacheReadTokens} read, ${cacheCreationTokens} created`);
        }

        yield {
            type: 'stats',
            durationMs: Date.now() - apiStartTime,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
        };

        if (fullResponse) {
            this.conversations.addMessage(conversationId, 'assistant', fullResponse);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Title Generation — lightweight LLM call to auto-title sessions
    // ═══════════════════════════════════════════════════════════════

    private static readonly TITLE_SYSTEM_PROMPT =
        'Generate a concise 3-6 word title that describes the user\'s request. ' +
        'Return ONLY the title text, no quotes, no punctuation at the end, no explanation.';

    /**
     * Generate a short descriptive title for a session based on the first exchange.
     * Uses haiku for speed and cost efficiency.
     */
    async generateTitle(prompt: string, response: string): Promise<string> {
        const truncatedResponse = response.slice(0, 500);
        const userMessage = `User prompt: ${prompt}\n\nAssistant response (truncated): ${truncatedResponse}`;

        if (this.backend === 'cli') {
            return this.generateTitleCli(userMessage);
        } else {
            return this.generateTitleApi(userMessage);
        }
    }

    private async generateTitleApi(userMessage: string): Promise<string> {
        if (!this.client) throw new Error('LLM not configured');

        const result = await this.client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 30,
            system: LlmOrchestrator.TITLE_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        });

        const text = result.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map(b => b.text)
            .join('');
        return text.trim();
    }

    private async generateTitleCli(userMessage: string): Promise<string> {
        const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const fullPrompt = `${LlmOrchestrator.TITLE_SYSTEM_PROMPT}\n\n${userMessage}`;

        return new Promise<string>((resolve, reject) => {
            const validatedTitleModel = validateModel('haiku');
            const proc = spawn(claudeCmd, [
                '--print',
                '--model', validatedTitleModel,
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
                    console.error(`[llm-cli] claude exited with code ${code}: ${stderr}`);
                    reject(new Error(`LLM subprocess failed (exit code ${code})`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // Lightweight Lookup — minimal prompt, no tools, text-in/text-out
    // ═══════════════════════════════════════════════════════════════

    private static readonly LOOKUP_SYSTEM_PROMPT =
        'You are a lookup assistant. Given a user prompt describing what values are needed, ' +
        'call the appropriate tool(s) and return ONLY a JSON array of strings with the valid values. ' +
        'No explanation, no markdown — just the JSON array.';

    /**
     * Lightweight lookup: uses a minimal system prompt and tools to extract
     * a JSON array of values. Much cheaper than the full dashboard prompt.
     */
    async *streamLookupResponse(
        conversationId: string,
    ): AsyncGenerator<StreamChunk> {
        if (this.backend === 'cli') {
            yield* this.streamResponseCli(conversationId, this.model);
            return;
        }

        if (!this.client) throw new Error('LLM not configured — call configure() first');

        const conv = this.conversations.get(conversationId);
        if (!conv) return;

        const messages: Anthropic.MessageParam[] = conv.messages.map(m => ({
            role: m.role,
            content: m.content,
        }));

        const mcpTools = this.mcpHub.getAllTools();
        const tools: Anthropic.Tool[] = mcpTools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
        }));

        let fullResponse = '';

        for (let round = 0; round < this.maxToolRounds; round++) {
            const params: Anthropic.MessageCreateParams = {
                model: this.model,
                max_tokens: 1024,
                system: LlmOrchestrator.LOOKUP_SYSTEM_PROMPT,
                messages,
                ...(tools.length > 0 ? { tools } : {}),
            };

            const stream = this.client.messages.stream(params);
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
                    fullResponse += event.delta.text;
                    textAccumulator += event.delta.text;
                    yield { type: 'content', text: event.delta.text };
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
                    // Pre-execution guard check
                    const guard = guardToolExecution(tc.name, tc.input);
                    if (!guard.allowed) {
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: tc.id,
                            content: guard.reason || `Tool "${tc.name}" blocked by guard`,
                            is_error: true,
                        });
                        continue;
                    }

                    const result = await this.mcpHub.executeTool(tc.name, tc.input);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: result,
                    });
                } catch (err) {
                    console.error(`[llm] Lookup tool error for ${tc.name}:`, err);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: `Error: ${sanitizeErrorMessage(err)}`,
                        is_error: true,
                    });
                }
            }

            messages.push({ role: 'user', content: toolResults });
            textAccumulator = '';
        }

        if (fullResponse) {
            this.conversations.addMessage(conversationId, 'assistant', fullResponse);
        }
    }
}
