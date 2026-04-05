// @burnish/server — MCP orchestration and session management

// ConversationStore is used by LlmOrchestrator in Copilot mode
export {
    ConversationStore,
    type Message,
    type Conversation,
} from './conversation.js';

export {
    McpHub,
    type CliToolConfig,
    type McpServerConfig,
    type McpServersConfig,
    type ToolDef,
} from './mcp-hub.js';

export {
    isWriteTool,
    authorizeToolCall,
    consumeAuthorization,
    guardToolExecution,
    type GuardResult,
} from './guards.js';

export {
    LlmOrchestrator,
    ALLOWED_MODELS,
    type StreamChunk,
    type WorkflowStep,
} from './llm.js';

export { buildSystemPrompt, buildNoToolsPrompt, buildFormattingPrompt } from './prompt-template.js';

export { resolveIntent, type IntentResolution } from './intent-resolver.js';
