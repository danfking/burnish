/**
 * Shared types for LLM streaming and workflow tracing.
 * Extracted to avoid circular imports between llm.ts and its backends.
 */

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
