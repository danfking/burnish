/**
 * LLM Orchestrator — handles tool-call loop with streaming.
 * Uses Anthropic SDK for Claude. Designed to be swappable.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as mcpHub from './mcp-hub.js';
import * as conversations from './conversation.js';
import { buildSystemPrompt } from './prompt-template.js';

const MAX_TOOL_ROUNDS = 5;

let client: Anthropic | null = null;
let model = 'claude-sonnet-4-5-20250514';

export function configure(options: { apiKey?: string; model?: string }): void {
    client = new Anthropic({ apiKey: options.apiKey });
    if (options.model) model = options.model;
}

/**
 * Stream a response for a conversation. Handles the tool-call loop internally.
 * Yields text chunks as they arrive.
 */
export async function* streamResponse(
    conversationId: string,
): AsyncGenerator<string> {
    if (!client) throw new Error('LLM not configured — call configure() first');

    const conv = conversations.get(conversationId);
    if (!conv) return;

    // Build message history for API
    const messages: Anthropic.MessageParam[] = conv.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    // Build tool definitions from connected MCP servers
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

        // Stream the response
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

        // Get the final message to check for tool use
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

        // Build assistant message with text + tool_use blocks
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

        // Execute tools and build results
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

    // Save the full response to conversation history
    if (fullResponse) {
        conversations.addMessage(conversationId, 'assistant', fullResponse);
    }
}
