// @burnish/server — MCP orchestration, LLM streaming, and session management

export {
    ConversationStore,
    type Message,
    type Conversation,
} from './conversation.js';

export {
    McpHub,
    type McpServerConfig,
    type McpServersConfig,
    type ToolDef,
} from './mcp-hub.js';

export {
    LlmOrchestrator,
    type LlmOrchestratorOptions,
    type StreamChunk,
    type WorkflowStep,
} from './llm.js';

export {
    isWriteTool,
    authorizeToolCall,
    consumeAuthorization,
    guardToolExecution,
    type GuardResult,
} from './guards.js';

export {
    getCatalog,
    getPreset,
    searchCatalog,
    getPopularServers,
    CATALOG,
    type PresetServer,
    type ServerCategory,
} from './catalog.js';

export { buildSystemPrompt } from './prompt-template.js';
