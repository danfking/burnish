/**
 * DOMPurify configuration generator for Burnish components.
 *
 * Auto-generates ADD_TAGS and ADD_ATTR from a component registry,
 * so consumers don't need to manually maintain sanitizer config.
 */

export interface ComponentDef {
    tag: string;
    attrs: string[];
}

export interface SanitizerConfig {
    ADD_TAGS: string[];
    ADD_ATTR: string[];
}

/** Default Burnish component definitions */
export const BURNISH_COMPONENTS: ComponentDef[] = [
    { tag: 'burnish-card', attrs: ['title', 'status', 'body', 'meta', 'item-id', 'source'] },
    { tag: 'burnish-stat-bar', attrs: ['items'] },
    { tag: 'burnish-table', attrs: ['title', 'columns', 'rows', 'status-field'] },
    { tag: 'burnish-chart', attrs: ['type', 'config'] },
    { tag: 'burnish-section', attrs: ['label', 'count', 'status', 'collapsed'] },
    { tag: 'burnish-metric', attrs: ['label', 'value', 'unit', 'trend'] },
    { tag: 'burnish-message', attrs: ['role', 'content', 'streaming'] },
    { tag: 'burnish-pipeline', attrs: ['steps'] },
];

/**
 * Build a DOMPurify config from component definitions.
 * Merges all component tags and their attributes into a single config.
 */
export function buildSanitizerConfig(
    components: ComponentDef[] = BURNISH_COMPONENTS,
    extraAttrs: string[] = ['class'],
): SanitizerConfig {
    const tags = new Set<string>();
    const attrs = new Set<string>(extraAttrs);

    for (const comp of components) {
        tags.add(comp.tag);
        for (const attr of comp.attrs) {
            attrs.add(attr);
        }
    }

    return {
        ADD_TAGS: [...tags],
        ADD_ATTR: [...attrs],
    };
}

/**
 * Create a sanitizer config with a custom tag prefix.
 * Useful when consumers re-register components with a different prefix.
 */
export function buildSanitizerConfigWithPrefix(
    prefix: string,
    extraComponents: ComponentDef[] = [],
    extraAttrs: string[] = ['class'],
): SanitizerConfig {
    // Remap default components to new prefix
    const remapped = BURNISH_COMPONENTS.map(c => ({
        tag: c.tag.replace('burnish-', prefix),
        attrs: c.attrs,
    }));

    return buildSanitizerConfig([...remapped, ...extraComponents], extraAttrs);
}
