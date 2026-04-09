/**
 * OpenAI-compatible backend — Ollama, llama.cpp, vLLM, LM Studio, and OpenAI.
 */

import OpenAI from 'openai';
import type { McpHub, ToolDef } from '../mcp-hub.js';
import type { ConversationStore } from '../conversation.js';
import type { WorkflowStep, StreamChunk } from '../llm-types.js';
import { buildAdaptiveSystemPrompt, buildAdaptiveNoToolsPrompt, buildFormattingPrompt } from '../prompt-template.js';
import { detectPivotCommand } from '../pivot-detector.js';
import { isWriteTool } from '../guards.js';
import { extractServerName } from '../tool-executor.js';
import { resolveIntent } from '../intent-resolver.js';

/** Default max tokens for OpenAI-compatible completions. */
const OPENAI_MAX_TOKENS = 4096;

export class OpenAiBackend {
    private client: OpenAI;

    constructor(apiKey: string | undefined, baseURL: string) {
        this.client = new OpenAI({
            apiKey: apiKey || 'not-needed',
            baseURL,
        });
    }

    static readonly TITLE_SYSTEM_PROMPT =
        'Generate a concise 3-6 word title that describes the user\'s request. ' +
        'Return ONLY the title text, no quotes, no punctuation at the end, no explanation.';

    async generateTitle(model: string, userMessage: string): Promise<string> {
        const result = await this.client.chat.completions.create({
            model,
            max_tokens: 30,
            messages: [
                { role: 'system', content: OpenAiBackend.TITLE_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
        });

        return (result.choices?.[0]?.message?.content || '').trim();
    }

    /**
     * Try to resolve the user prompt deterministically and execute the tool
     * directly, bypassing the LLM tool-call loop. If successful, streams
     * the tool result through the LLM for formatting only.
     *
     * Yields nothing (returns without yielding) if resolution fails or
     * confidence is too low — the caller should then fall back to the
     * normal LLM tool-call loop.
     */
    async *tryDirectExecution(
        conversations: ConversationStore,
        conversationId: string,
        mcpHub: McpHub,
        useModel: string,
    ): AsyncGenerator<StreamChunk> {
        const conv = conversations.get(conversationId);
        if (!conv || conv.messages.length === 0) return;

        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg.role !== 'user') return;

        const tools = mcpHub.getAllTools();
        const serverNames = mcpHub.getServerInfo().map(s => s.name);

        const resolution = resolveIntent(lastMsg.content, tools, serverNames);
        if (!resolution || resolution.confidence < 0.5) return;

        console.log(`[intent] Resolved: ${resolution.tool.name} (${resolution.confidence.toFixed(2)}) — ${resolution.reason}`);

        // Phase 1: Execute tool directly
        yield { type: 'progress', stage: 'tool_call', detail: `Calling ${resolution.tool.name}...`, meta: { server: resolution.tool.serverName } };

        let toolResult;
        try {
            toolResult = await mcpHub.executeTool(resolution.tool.name, resolution.params);
        } catch (err) {
            // Tool execution failed — fall back (caller will continue to LLM loop)
            console.warn(`[intent] Direct execution failed for ${resolution.tool.name}:`, err);
            return;
        }

        yield { type: 'workflow_trace', steps: [{ server: resolution.tool.serverName, tool: resolution.tool.name, status: toolResult.isError ? 'error' : 'success' }] };

        // Phase 2: Ask LLM to format results (no tools, simple formatting task)
        yield { type: 'progress', stage: 'thinking', detail: 'Formatting results...', meta: { model: useModel } };

        const formattingPrompt = buildFormattingPrompt(resolution.tool.name, toolResult.content);
        const apiStartTime = Date.now();

        const stream = await this.client.chat.completions.create({
            model: useModel,
            messages: [
                { role: 'system', content: formattingPrompt },
                { role: 'user', content: 'Format the tool results above as burnish-* HTML components.' },
            ],
            max_tokens: OPENAI_MAX_TOKENS,
            stream: true,
        });

        let fullResponse = '';
        for await (const chunk of stream) {
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
                fullResponse += content;
                yield { type: 'content', text: content };
            }
        }

        // Store response
        conversations.addMessage(conversationId, 'assistant', fullResponse);

        yield { type: 'stats', durationMs: Date.now() - apiStartTime, inputTokens: 0, outputTokens: 0 };
    }

    async *streamResponse(
        conversations: ConversationStore,
        conversationId: string,
        mcpHub: McpHub,
        useModel: string,
        noTools: boolean,
        maxToolRounds: number,
        getRelevantTools: (tools: ToolDef[]) => ToolDef[],
        extraInstructions?: string,
    ): AsyncGenerator<StreamChunk> {
        if (!this.client) throw new Error('OpenAI client not configured — call configure() first');

        const conv = conversations.get(conversationId);
        if (!conv) return;

        const systemPrompt = noTools ? buildAdaptiveNoToolsPrompt(useModel) : buildAdaptiveSystemPrompt(useModel, extraInstructions);
        const messages: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
        ];

        // Check if the latest user message is a pivot command
        const lastUserMsgOpenai = [...conv.messages].reverse().find(m => m.role === 'user');
        const isPivotOpenai = lastUserMsgOpenai ? detectPivotCommand(lastUserMsgOpenai.content) !== null : false;
        if (isPivotOpenai) {
            console.log(`[llm-openai] Pivot command detected, preserving full conversation context`);
        }

        // Build message history
        for (let i = 0; i < conv.messages.length; i++) {
            const m = conv.messages[i];
            if (m.role === 'assistant' && i < conv.messages.length - 1 && m.content.length > 200 && !isPivotOpenai) {
                messages.push({ role: 'assistant', content: '[Previous dashboard response]' });
            } else {
                messages.push({ role: m.role, content: m.content });
            }
        }

        // Convert MCP tools to OpenAI function calling format (omit when noTools)
        const allTools = mcpHub.getAllTools();
        const mcpTools = noTools ? [] : getRelevantTools(allTools);
        const tools: OpenAI.ChatCompletionTool[] = mcpTools.map(t => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description || '',
                parameters: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
            },
        }));

        let fullResponse = '';
        const apiStartTime = Date.now();
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        const workflowSteps: WorkflowStep[] = [];

        yield { type: 'progress', stage: 'starting', detail: 'Sending request…', meta: { model: useModel } };

        // Try deterministic intent resolution first (for small model reliability)
        if (!noTools) {
            let directHandled = false;
            for await (const chunk of this.tryDirectExecution(conversations, conversationId, mcpHub, useModel)) {
                yield chunk;
                directHandled = true;
            }
            if (directHandled) return;
        }

        for (let round = 0; round < maxToolRounds; round++) {
            if (round === 0) {
                yield { type: 'progress', stage: 'thinking', detail: 'Thinking…', meta: { model: useModel } };
            }

            const params: OpenAI.ChatCompletionCreateParams = {
                model: useModel,
                max_tokens: OPENAI_MAX_TOKENS,
                messages,
                stream: true,
                ...(tools.length > 0 ? { tools } : {}),
            };

            const stream = await this.client.chat.completions.create(params);

            let textAccumulator = '';
            // Accumulate tool calls from streaming deltas
            const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

            for await (const chunk of stream) {
                const choice = chunk.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;

                // Text content
                if (delta?.content) {
                    fullResponse += delta.content;
                    textAccumulator += delta.content;
                    yield { type: 'content', text: delta.content };
                }

                // Tool call deltas — streamed incrementally
                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallAccumulator.has(idx)) {
                            toolCallAccumulator.set(idx, {
                                id: tc.id || '',
                                name: tc.function?.name || '',
                                arguments: '',
                            });
                        }
                        const acc = toolCallAccumulator.get(idx)!;
                        if (tc.id) acc.id = tc.id;
                        if (tc.function?.name) acc.name = tc.function.name;
                        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                    }
                }

                // Accumulate usage from the final chunk
                if (chunk.usage) {
                    totalPromptTokens += chunk.usage.prompt_tokens || 0;
                    totalCompletionTokens += chunk.usage.completion_tokens || 0;
                }
            }

            const pendingToolCalls = [...toolCallAccumulator.values()].filter(tc => tc.name);

            if (pendingToolCalls.length === 0) break;

            // Build assistant message with tool calls for the conversation
            const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
                role: 'assistant',
                content: textAccumulator || null,
                tool_calls: pendingToolCalls.map((tc, i) => ({
                    id: tc.id || `call_${round}_${i}`,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.arguments },
                })),
            };
            messages.push(assistantMsg);

            // Execute each tool call and add results
            for (const tc of pendingToolCalls) {
                const server = extractServerName(tc.name) || 'unknown';
                const shortName = tc.name.replace(/^mcp__\w+__/, '');
                const step: WorkflowStep = { server, tool: shortName, status: 'running' };
                workflowSteps.push(step);
                yield { type: 'workflow_trace', steps: [...workflowSteps] };

                let resultContent: string;
                try {
                    // Block write tools from being auto-called by the model
                    if (isWriteTool(tc.name)) {
                        console.log(`[llm-openai] Blocked write tool: ${tc.name}`);
                        step.status = 'error';
                        resultContent = `Tool "${tc.name}" is a write operation and requires user confirmation. Generate a burnish-form component instead so the user can review and submit.`;
                    } else {
                        yield { type: 'progress', stage: 'tool_call', detail: `Calling ${tc.name}…`, meta: { server } };
                        console.log(`[llm-openai] Executing tool: ${tc.name}`);

                        let args: Record<string, unknown> = {};
                        try { args = JSON.parse(tc.arguments || '{}'); } catch { console.warn('[llm-openai] Failed to parse tool call arguments:', tc.arguments); }

                        const result = await mcpHub.executeTool(tc.name, args);
                        step.status = result.isError ? 'error' : 'success';
                        resultContent = result.content;
                    }
                } catch (err) {
                    step.status = 'error';
                    resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
                }

                yield { type: 'workflow_trace', steps: [...workflowSteps] };

                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id || `call_${round}`,
                    content: resultContent,
                });
            }

            yield { type: 'progress', stage: 'thinking', detail: 'Thinking…', meta: { model: useModel } };
            textAccumulator = '';
        }

        yield {
            type: 'stats',
            durationMs: Date.now() - apiStartTime,
            inputTokens: totalPromptTokens,
            outputTokens: totalCompletionTokens,
        };

        if (fullResponse) {
            conversations.addMessage(conversationId, 'assistant', fullResponse);
        }
    }
}
