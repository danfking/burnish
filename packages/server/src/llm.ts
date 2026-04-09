/**
 * LLM Orchestrator — selects backend and manages the conversation flow.
 *
 * Three backends:
 * - "api": Direct Anthropic SDK (needs ANTHROPIC_API_KEY)
 * - "cli": Spawns `claude` CLI subprocess (uses your Claude Code subscription auth)
 * - "openai": OpenAI-compatible API (Ollama, llama.cpp, vLLM, LM Studio, OpenAI)
 */

import type { McpHub, ToolDef } from './mcp-hub.js';
import type { ConversationStore, Conversation } from './conversation.js';
import { buildRetryPrompt } from './prompt-template.js';
import { detectPivotCommand } from './pivot-detector.js';
import { AnthropicBackend } from './backends/anthropic.js';
import { ClaudeCliBackend } from './backends/claude-cli.js';
import { OpenAiBackend } from './backends/openai.js';

// Re-export shared types so existing consumers can import from llm.js
export type { WorkflowStep, StreamChunk } from './llm-types.js';
import type { StreamChunk } from './llm-types.js';

const DEFAULT_MAX_TOOL_ROUNDS = 8;

/** Allowed model name allowlist for CLI subprocess argument validation. */
export const ALLOWED_MODELS = new Set([
    'sonnet',
    'haiku',
    'opus',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-6',
    'claude-sonnet-4-5-20250514',
    // OpenAI models
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
]);

export interface LlmOrchestratorOptions {
    backend?: 'api' | 'cli' | 'openai';
    apiKey?: string;
    model?: string;
    /** Working directory for CLI subprocess (typically the demo app root) */
    cwd?: string;
    /** Path to MCP server config JSON file (for CLI backend) */
    mcpConfigPath?: string;
    /** Maximum tool-call rounds per request (default 8) */
    maxToolRounds?: number;
    /** Base URL for OpenAI-compatible API (e.g., http://localhost:11434/v1 for Ollama) */
    openaiBaseUrl?: string;
}

export class LlmOrchestrator {
    private backend: 'api' | 'cli' | 'openai' = 'api';
    private model = 'sonnet';
    private maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS;

    private anthropicBackend: AnthropicBackend | null = null;
    private cliBackend: ClaudeCliBackend | null = null;
    private openaiBackend: OpenAiBackend | null = null;

    constructor(
        private mcpHub: McpHub,
        private conversations: ConversationStore,
    ) {}

    configure(options: LlmOrchestratorOptions): void {
        this.backend = options.backend ?? 'api';
        if (options.model) {
            // For the openai backend, allow any model name (local servers use arbitrary names)
            if (this.backend !== 'openai' && !ALLOWED_MODELS.has(options.model)) {
                throw new Error(`Invalid model: ${options.model}. Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
            }
            this.model = options.model;
        }

        let mcpConfigPath: string | undefined;
        if (options.mcpConfigPath) {
            // Validate config path does not contain suspicious characters (path traversal guard)
            if (/\.\.[/\\]/.test(options.mcpConfigPath)) {
                throw new Error('mcpConfigPath must not contain path traversal sequences');
            }
            mcpConfigPath = options.mcpConfigPath;
        }

        if (options.maxToolRounds != null) this.maxToolRounds = options.maxToolRounds;

        if (this.backend === 'api') {
            if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY required for api backend');
            this.anthropicBackend = new AnthropicBackend(options.apiKey);
        } else if (this.backend === 'cli') {
            this.cliBackend = new ClaudeCliBackend(mcpConfigPath, options.cwd);
        } else if (this.backend === 'openai') {
            this.openaiBackend = new OpenAiBackend(
                options.apiKey,
                options.openaiBaseUrl || 'http://localhost:11434/v1',
            );
        }

        const baseUrlSuffix = this.backend === 'openai' && options.openaiBaseUrl
            ? `, Base URL: ${options.openaiBaseUrl}` : '';
        console.log(`[llm] Backend: ${this.backend}, Model: ${this.model}${baseUrlSuffix}`);
    }

    /** Regex to detect at least one burnish-* component tag in a response. */
    private static readonly BURNISH_TAG_RE = /<burnish-[a-z]/;

    /**
     * Stream a response for a conversation.
     * Yields StreamChunk objects (content text or progress updates).
     *
     * When the model returns prose-only output (no burnish-* tags), a single
     * retry is attempted with a stricter prompt that emphasizes component usage.
     * This helps small models that sometimes emit markdown instead of components.
     */
    async *streamResponse(
        conversationId: string,
        requestModel?: string,
        noTools?: boolean,
        extraInstructions?: string,
    ): AsyncGenerator<StreamChunk> {
        // For openai backend, allow any model; for others, validate against allowlist
        if (requestModel && this.backend !== 'openai' && !ALLOWED_MODELS.has(requestModel)) {
            throw new Error(`Invalid model: ${requestModel}`);
        }
        const useModel = requestModel || this.model;

        // Auto-detect pivot commands — skip tools for data reshaping
        if (!noTools) {
            const conv = this.conversations.get(conversationId);
            if (conv) {
                const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user');
                if (lastUserMsg && detectPivotCommand(lastUserMsg.content)) {
                    noTools = true;
                    yield { type: 'progress', stage: 'transforming', detail: 'Reshaping data…', meta: { model: useModel } };
                }
            }
        }

        // First attempt
        let fullContent = '';
        for await (const chunk of this.streamBackend(conversationId, useModel, noTools, extraInstructions)) {
            if (chunk.type === 'content') {
                fullContent += chunk.text;
            }
            yield chunk;
        }

        // Check if the response contains any burnish-* tags.
        // Skip retry when: the response is empty, the model was asked a
        // clarifying question (plain text is correct), or noTools was set
        // (ambiguous/conversational requests don't need components).
        if (
            !fullContent ||
            noTools ||
            LlmOrchestrator.BURNISH_TAG_RE.test(fullContent)
        ) {
            return;
        }

        // Prose-only response detected — retry once with stricter prompt
        console.log('[llm] Prose-only response detected, retrying with stricter prompt');
        yield { type: 'progress', stage: 'retrying', detail: 'Reformatting with components…', meta: { model: useModel } };

        // Inject a user message asking the model to reformat
        this.conversations.addMessage(conversationId, 'user', buildRetryPrompt());

        for await (const chunk of this.streamBackend(conversationId, useModel, noTools, extraInstructions)) {
            yield chunk;
        }
    }

    /**
     * Dispatch to the appropriate backend streaming implementation.
     */
    private async *streamBackend(
        conversationId: string,
        useModel: string,
        noTools?: boolean,
        extraInstructions?: string,
    ): AsyncGenerator<StreamChunk> {
        if (this.backend === 'cli') {
            if (!this.cliBackend) throw new Error('CLI backend not configured');
            yield* this.cliBackend.streamResponse(
                this.conversations,
                conversationId,
                this.mcpHub,
                useModel,
                noTools ?? false,
                extraInstructions,
            );
        } else if (this.backend === 'openai') {
            if (!this.openaiBackend) throw new Error('OpenAI backend not configured');
            yield* this.openaiBackend.streamResponse(
                this.conversations,
                conversationId,
                this.mcpHub,
                useModel,
                noTools ?? false,
                this.maxToolRounds,
                (tools) => this.getRelevantTools(this.conversations.get(conversationId)!, tools),
                extraInstructions,
            );
        } else {
            if (!this.anthropicBackend) throw new Error('Anthropic backend not configured');
            yield* this.anthropicBackend.streamResponse(
                this.conversations,
                conversationId,
                this.mcpHub,
                useModel,
                noTools ?? false,
                this.maxToolRounds,
                (tools) => this.getRelevantTools(this.conversations.get(conversationId)!, tools),
                extraInstructions,
            );
        }
    }

    /**
     * Filter tools to only the relevant server's tools when the user prompt
     * mentions a specific server name. This avoids overwhelming small models
     * (e.g. Qwen 2.5 7B) with too many tool definitions.
     */
    private getRelevantTools(conv: Conversation, allTools: ToolDef[]): ToolDef[] {
        const serverInfo = this.mcpHub.getServerInfo();

        // Get the latest user message
        const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return allTools;

        const promptLower = lastUserMsg.content.toLowerCase();

        // Check if prompt mentions a specific server name
        const matchedServer = serverInfo.find(s =>
            promptLower.includes(s.name.toLowerCase())
        );

        if (matchedServer) {
            // Filter to only that server's tools
            const filtered = allTools.filter(t => t.serverName === matchedServer.name);
            if (filtered.length > 0) {
                console.log(`[llm] Filtered tools to server "${matchedServer.name}": ${filtered.length}/${allTools.length} tools`);
                return filtered;
            }
        }

        // No server match — return all tools
        return allTools;
    }

    /**
     * Generate a short descriptive title for a session based on the first exchange.
     * Uses haiku for speed and cost efficiency.
     */
    async generateTitle(prompt: string, response: string): Promise<string> {
        const truncatedResponse = response.slice(0, 500);
        const userMessage = `User prompt: ${prompt}\n\nAssistant response (truncated): ${truncatedResponse}`;

        if (this.backend === 'cli') {
            if (!this.cliBackend) throw new Error('CLI backend not configured');
            return this.cliBackend.generateTitle(userMessage);
        } else if (this.backend === 'openai') {
            if (!this.openaiBackend) throw new Error('OpenAI backend not configured');
            return this.openaiBackend.generateTitle(this.model, userMessage);
        } else {
            if (!this.anthropicBackend) throw new Error('Anthropic backend not configured');
            return this.anthropicBackend.generateTitle(userMessage);
        }
    }

    /**
     * Lightweight lookup: uses a minimal system prompt and tools to extract
     * a JSON array of values. Much cheaper than the full dashboard prompt.
     */
    async *streamLookupResponse(
        conversationId: string,
    ): AsyncGenerator<StreamChunk> {
        if (this.backend === 'cli') {
            if (!this.cliBackend) throw new Error('CLI backend not configured');
            yield* this.cliBackend.streamResponse(
                this.conversations,
                conversationId,
                this.mcpHub,
                this.model,
                false,
            );
            return;
        }
        if (this.backend === 'openai') {
            if (!this.openaiBackend) throw new Error('OpenAI backend not configured');
            // For openai backend, reuse the main streaming method for lookups
            yield* this.openaiBackend.streamResponse(
                this.conversations,
                conversationId,
                this.mcpHub,
                this.model,
                false,
                this.maxToolRounds,
                (tools) => this.getRelevantTools(this.conversations.get(conversationId)!, tools),
            );
            return;
        }

        if (!this.anthropicBackend) throw new Error('Anthropic backend not configured');
        yield* this.anthropicBackend.streamLookupResponse(
            this.conversations,
            conversationId,
            this.mcpHub,
            this.model,
            this.maxToolRounds,
        );
    }
}
