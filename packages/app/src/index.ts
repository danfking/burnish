// @burnish/app — headless SDK for navigation, sessions, streaming, and output transformation

export {
    getNodeById,
    getChildren,
    getRootNodes,
    getAncestryPath,
    getActivePath,
    getDescendantIds,
    type TreeNode,
    type TreeSession,
} from './navigation-tree.js';

export {
    SessionStore,
    type SessionMeta,
    type AppNode,
    type AppSession,
} from './session-store.js';

export {
    transformOutput,
    type TransformOutputOptions,
} from './output-transformer.js';

export {
    isWriteTool,
    getDrillDownPrompt,
    generateFallbackForm,
} from './drill-down.js';

export {
    StreamOrchestrator,
    type StreamCallbacks,
    type WorkflowStep,
} from './stream-orchestrator.js';

export {
    generateSummary,
    formatTimeAgo,
} from './summary.js';
