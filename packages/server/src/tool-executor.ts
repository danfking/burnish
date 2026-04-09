/**
 * Shared tool execution utilities used by all LLM backends.
 */

import type { McpHub } from './mcp-hub.js';
import type { WorkflowStep, StreamChunk } from './llm-types.js';

export function extractServerName(toolName: string): string | undefined {
    const match = toolName.match(/^mcp__([^_]+)__/);
    return match?.[1];
}

export async function* executeToolCalls(
    toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
    mcpHub: McpHub,
    workflowSteps: WorkflowStep[],
): AsyncGenerator<
    | { chunk: StreamChunk }
    | { result: { tool_use_id: string; content: string; is_error?: boolean } }
> {
    for (const tc of toolCalls) {
        const server = extractServerName(tc.name) || 'unknown';
        const shortName = tc.name.replace(/^mcp__\w+__/, '');
        const step: WorkflowStep = { server, tool: shortName, status: 'running' };
        workflowSteps.push(step);
        yield { chunk: { type: 'workflow_trace', steps: [...workflowSteps] } };

        try {
            yield { chunk: { type: 'progress', stage: 'tool_call', detail: `Calling ${tc.name}…`, meta: { server } } };
            console.log(`[llm] Executing tool: ${tc.name}`);
            const result = await mcpHub.executeTool(tc.name, tc.input);
            step.status = result.isError ? 'error' : 'success';
            yield { chunk: { type: 'workflow_trace', steps: [...workflowSteps] } };
            yield {
                result: {
                    tool_use_id: tc.id,
                    content: result.content,
                    ...(result.isError ? { is_error: true } : {}),
                },
            };
        } catch (err) {
            step.status = 'error';
            yield { chunk: { type: 'workflow_trace', steps: [...workflowSteps] } };
            yield {
                result: {
                    tool_use_id: tc.id,
                    content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    is_error: true,
                },
            };
        }
    }
}
