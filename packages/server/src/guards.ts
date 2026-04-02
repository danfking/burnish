/**
 * Deterministic enforcement guards for MCP tool execution.
 * These run as CODE, not prompts — they cannot be ignored by the LLM.
 */

const WRITE_PATTERNS = /^(create|update|delete|remove|push|write|edit|move|fork|merge|add|set|close|lock|assign)/i;

/**
 * Classify a tool as read-only or write/mutate based on its name.
 */
export function isWriteTool(toolName: string): boolean {
    // Extract the tool name from fully qualified name (mcp__server__toolname)
    const parts = toolName.split('__');
    const baseName = parts[parts.length - 1] || toolName;
    return WRITE_PATTERNS.test(baseName);
}

export interface GuardResult {
    allowed: boolean;
    reason?: string;
}

// Track which tool calls have been explicitly authorized by user form submission
const authorizedCalls = new Set<string>();

/**
 * Authorize a tool call — called when a user submits a form.
 * Returns a one-time authorization token.
 */
export function authorizeToolCall(toolName: string): string {
    const token = `${toolName}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    authorizedCalls.add(token);
    // Auto-expire after 60 seconds
    setTimeout(() => authorizedCalls.delete(token), 60_000);
    return token;
}

/**
 * Check if a tool call is authorized.
 * Consumes the token (one-time use).
 */
export function consumeAuthorization(token: string): boolean {
    if (authorizedCalls.has(token)) {
        authorizedCalls.delete(token);
        return true;
    }
    return false;
}

/**
 * Pre-execution guard — runs before every tool call.
 * Returns whether the call should proceed.
 */
export function guardToolExecution(
    toolName: string,
    _args: Record<string, unknown>,
): GuardResult {
    if (isWriteTool(toolName)) {
        return {
            allowed: false,
            reason: `Blocked: "${toolName}" is a write operation and requires explicit user authorization via form submission.`,
        };
    }
    return { allowed: true };
}
