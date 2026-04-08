/**
 * Translate raw error messages from the MCP SDK and Node.js into
 * user-friendly CLI messages.
 */

/**
 * Pattern-match common MCP and network errors and return a
 * human-readable message. Falls back to the original string when
 * no pattern matches.
 *
 * @param raw  The raw error message (e.g. from McpError or fetch)
 * @param serverName  Optional server name for contextual messages
 */
export function formatMcpError(raw: string, serverName?: string): string {
    const server = serverName ? `"${serverName}"` : 'server';

    // ENOENT / command not found (stdio transport)
    if (/ENOENT|spawn .+ ENOENT|command not found/i.test(raw)) {
        const cmdMatch = raw.match(/spawn\s+(\S+)/);
        const cmd = cmdMatch ? cmdMatch[1] : null;
        return cmd
            ? `Could not start server ${server} \u2014 "${cmd}" command not found`
            : `Could not start server ${server} \u2014 command not found`;
    }

    // Connection refused (SSE / HTTP transport)
    if (/ECONNREFUSED|connection refused|fetch failed/i.test(raw)) {
        const urlMatch = raw.match(/https?:\/\/\S+/);
        const url = urlMatch ? urlMatch[0] : null;
        return url
            ? `Could not connect to SSE server at ${url} \u2014 connection refused`
            : `Could not connect to server ${server} \u2014 connection refused`;
    }

    // MCP protocol-level errors (e.g. "MCP error -32000: Connection closed")
    if (/MCP error -?\d+/i.test(raw)) {
        const detail = raw.replace(/^MCP error -?\d+:\s*/i, '').trim();
        return `Server ${server} connection failed: ${detail || 'protocol error'}`;
    }

    // Connection closed / transport error
    if (/connection closed|transport/i.test(raw)) {
        return `Server ${server} connection closed unexpectedly`;
    }

    // Timeout
    if (/timeout|timed?\s*out/i.test(raw)) {
        return `Server ${server} did not respond in time`;
    }

    // Fallback — return original message without a stack trace
    return raw.split('\n')[0];
}
