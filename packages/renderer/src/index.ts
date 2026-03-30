// @burnish/renderer — streaming render engine for MCP UI

export {
    findStreamElements,
    appendStreamElement,
    extractHtmlContent,
    containsTags,
    type StreamElement,
    type StreamParserOptions,
} from './stream-parser.js';

export {
    buildSanitizerConfig,
    buildSanitizerConfigWithPrefix,
    BURNISH_COMPONENTS,
    type ComponentDef,
    type SanitizerConfig,
} from './sanitizer.js';

export {
    inferComponent,
    type ComponentSuggestion,
    type MapperOptions,
} from './component-mapper.js';

export {
    ChatClient,
    type ChatCallbacks,
    type ChatClientOptions,
} from './chat-client.js';
