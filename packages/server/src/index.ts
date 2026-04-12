// @burnishdev/server — MCP orchestration and session management

export {
    McpHub,
    type CliToolConfig,
    type McpServerConfig,
    type McpServersConfig,
    type ToolDef,
    type ToolResult,
} from './mcp-hub.js';

export {
    safePath,
    isWriteTool,
    authorizeToolCall,
    consumeAuthorization,
    guardToolExecution,
    type GuardResult,
} from './guards.js';

export { resolveIntent, type IntentResolution } from './intent-resolver.js';
