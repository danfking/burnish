// @burnish/renderer — render engine for MCP UI

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
    findStreamElements,
    appendStreamElement,
    containsTags,
    extractHtmlContent,
    type StreamElement,
} from './stream-parser.js';
