/**
 * Anthropic API backend — direct Anthropic SDK with tool-call loop, prompt caching, and workflow trace.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { McpHub, ToolDef } from '../mcp-hub.js';
import type { ConversationStore } from '../conversation.js';
import type { WorkflowStep, StreamChunk } from '../llm-types.js';
import { buildAdaptiveSystemPrompt, buildAdaptiveNoToolsPrompt } from '../prompt-template.js';
import { detectPivotCommand } from '../pivot-detector.js';
import { extractServerName, executeToolCalls } from '../tool-executor.js';

export class AnthropicBackend {
    private client: Anthropic;

    constructor(apiKey: string) {
        this.client = new Anthropic({ apiKey });
    }

    static readonly TITLE_SYSTEM_PROMPT =
        'Generate a concise 3-6 word title that describes the user\'s request. ' +
        'Return ONLY the title text, no quotes, no punctuation at the end, no explanation.';

    static readonly LOOKUP_SYSTEM_PROMPT =
        'You are a lookup assistant. Given a user prompt describing what values are needed, ' +
        'call the appropriate tool(s) and return ONLY a JSON array of strings with the valid values. ' +
        'No explanation, no markdown — just the JSON array.';

    async generateTitle(userMessage: string): Promise<string> {
        const result = await this.client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 30,
            system: AnthropicBackend.TITLE_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        });

        const text = result.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map(b => b.text)
            .join('');
        return text.trim();
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
        if (!this.client) throw new Error('LLM not configured — call configure() first');

        const conv = conversations.get(conversationId);
        if (!conv) return;

        // Check if the latest user message is a pivot command — if so,
        // preserve the previous assistant response in full for context
        const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user');
        const isPivot = lastUserMsg ? detectPivotCommand(lastUserMsg.content) !== null : false;
        if (isPivot) {
            console.log(`[llm-api] Pivot command detected, preserving full conversation context`);
        }

        const messages: Anthropic.MessageParam[] = conv.messages.map((m, i) => {
            if (
                m.role === 'assistant' &&
                i < conv.messages.length - 1 &&
                m.content.length > 200 &&
                !isPivot
            ) {
                return { role: 'assistant' as const, content: '[Previous dashboard response]' };
            }
            return { role: m.role, content: m.content };
        });

        const allTools = mcpHub.getAllTools();
        const mcpTools = noTools ? [] : getRelevantTools(allTools);
        const tools: Anthropic.Tool[] = mcpTools.map((t, i) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
            ...(i === mcpTools.length - 1
                ? { cache_control: { type: 'ephemeral' as const } }
                : {}),
        }));

        const systemPrompt = noTools ? buildAdaptiveNoToolsPrompt(useModel) : buildAdaptiveSystemPrompt(useModel, extraInstructions);
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

        for (let round = 0; round < maxToolRounds; round++) {
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
            for await (const item of executeToolCalls(pendingToolCalls, mcpHub, workflowSteps)) {
                if ('chunk' in item) {
                    // Re-label progress chunks with server info already embedded
                    yield item.chunk;
                } else {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: item.result.tool_use_id,
                        content: item.result.content,
                        ...(item.result.is_error ? { is_error: true } : {}),
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
            conversations.addMessage(conversationId, 'assistant', fullResponse);
        }
    }

    async *streamLookupResponse(
        conversations: ConversationStore,
        conversationId: string,
        mcpHub: McpHub,
        model: string,
        maxToolRounds: number,
    ): AsyncGenerator<StreamChunk> {
        if (!this.client) throw new Error('LLM not configured — call configure() first');

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

        let fullResponse = '';

        for (let round = 0; round < maxToolRounds; round++) {
            const params: Anthropic.MessageCreateParams = {
                model,
                max_tokens: 1024,
                system: AnthropicBackend.LOOKUP_SYSTEM_PROMPT,
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
                    const result = await mcpHub.executeTool(tc.name, tc.input);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: result.content,
                        ...(result.isError ? { is_error: true } : {}),
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
}
