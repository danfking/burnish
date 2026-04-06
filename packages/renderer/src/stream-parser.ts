/**
 * Progressive streaming HTML parser for Burnish components.
 *
 * Parses streamed text into a flat list of elements for progressive rendering.
 * Container tags (like burnish-section) emit separate open/close entries so their
 * children can render individually as they arrive.
 */

import {
    containsMarkdownStructures,
    convertMarkdownToComponents,
    type FallbackOptions,
} from './markdown-fallback.js';

export interface StreamElement {
    type: 'open' | 'leaf' | 'close';
    tagName: string;
    html: string;
}

export interface StreamParserOptions {
    /** Tag prefix to match (default: 'burnish-') */
    prefix?: string;
    /** Tags whose children should stream individually */
    containerTags?: Set<string>;
    /** Additional allowed HTML tags beyond prefixed components */
    extraTags?: string[];
}

const DEFAULT_PREFIX = 'burnish-';
const DEFAULT_CONTAINERS = new Set(['burnish-section']);

const MCP_OPEN_TAG = '<use_mcp_tool';
const MCP_CLOSE_TAG = '</use_mcp_tool>';

/**
 * Strip MCP tool call XML blocks using indexOf instead of regex
 * to avoid polynomial backtracking on malformed input.
 */
function stripMcpToolCalls(text: string): string {
    let result = text;
    let start = result.indexOf(MCP_OPEN_TAG);
    while (start !== -1) {
        const end = result.indexOf(MCP_CLOSE_TAG, start);
        if (end === -1) break; // Incomplete block — leave as is
        result = result.substring(0, start) + result.substring(end + MCP_CLOSE_TAG.length);
        start = result.indexOf(MCP_OPEN_TAG);
    }
    return result;
}

/**
 * Check if text contains any component tags with the given prefix.
 */
export function containsTags(text: string, prefix = DEFAULT_PREFIX): boolean {
    return new RegExp(`<${prefix}[a-z]`).test(text);
}

/**
 * Parse streamed text into a flat list of elements for progressive rendering.
 * Returns array of {type, html, tagName} where type is 'open', 'leaf', or 'close'.
 */
export function findStreamElements(
    text: string,
    options: StreamParserOptions = {},
): StreamElement[] {
    const prefix = options.prefix ?? DEFAULT_PREFIX;
    const containerTags = options.containerTags ?? DEFAULT_CONTAINERS;
    const elements: StreamElement[] = [];

    // Clean MCP tool call XML blocks
    const cleaned = stripMcpToolCalls(text);

    // Match component tags + common HTML tags
    const extraTags = options.extraTags ?? ['div', 'h[1-6]', 'p', 'section', 'ul', 'ol', 'table'];
    const allTags = `${prefix}[a-z-]+|${extraTags.join('|')}`;
    const re = new RegExp(`<(/?)(${allTags})(\\s[^>]*)?>`, 'g');
    let m: RegExpExecArray | null;

    while ((m = re.exec(cleaned)) !== null) {
        const isClose = m[1] === '/';
        const tagName = m[2];

        if (isClose) {
            if (containerTags.has(tagName)) {
                elements.push({ type: 'close', tagName, html: m[0] });
            }
            continue;
        }

        if (containerTags.has(tagName)) {
            elements.push({ type: 'open', tagName, html: m[0] });
            continue;
        }

        // Self-closing check
        if (cleaned[m.index + m[0].length - 2] === '/') {
            elements.push({ type: 'leaf', tagName, html: m[0] });
            continue;
        }

        // Find matching close tag (stack-based for same-name nesting)
        let depth = 1;
        const closeRe = new RegExp(`<(${tagName})(\\s[^>]*)?>|</${tagName}>`, 'g');
        closeRe.lastIndex = m.index + m[0].length;
        let cm: RegExpExecArray | null;
        while ((cm = closeRe.exec(cleaned)) !== null) {
            if (cm[0].startsWith('</')) {
                depth--;
                if (depth === 0) {
                    elements.push({
                        type: 'leaf',
                        tagName,
                        html: cleaned.substring(m.index, cm.index + cm[0].length),
                    });
                    re.lastIndex = cm.index + cm[0].length;
                    break;
                }
            } else {
                depth++;
            }
        }
        if (depth > 0) return elements; // Incomplete — stop here, wait for more data
    }

    return elements;
}

/**
 * Append a stream element to the DOM, maintaining a stack for nested containers.
 *
 * @param root - The root container element
 * @param stack - Stack of open container elements (mutated)
 * @param element - The stream element to append
 * @param safeAttrs - Set of allowed attribute names
 * @param sanitize - Optional sanitizer function for leaf HTML
 */
export function appendStreamElement(
    root: Element,
    stack: Element[],
    element: StreamElement,
    safeAttrs?: Set<string>,
    sanitize?: (html: string) => string,
): void {
    const parent = stack.length > 0 ? stack[stack.length - 1] : root;

    if (element.type === 'open') {
        const el = document.createElement(element.tagName);
        // Parse attributes from the opening tag
        const attrRe = /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?/g;
        let am: RegExpExecArray | null;
        while ((am = attrRe.exec(element.html)) !== null) {
            const name = am[1].toLowerCase();
            if (name === element.tagName) continue;
            if (safeAttrs && !safeAttrs.has(name)) continue;
            const value = am[2] ?? am[3] ?? am[4] ?? '';
            el.setAttribute(name, value);
        }
        parent.appendChild(el);
        stack.push(el);
    } else if (element.type === 'close') {
        if (stack.length > 0) stack.pop();
    } else {
        // Leaf element — sanitize and append
        const clean = sanitize ? sanitize(element.html) : element.html;
        const temp = document.createElement('template');
        temp.innerHTML = clean;
        parent.appendChild(temp.content);
    }
}

/**
 * Extract the renderable HTML portion of an LLM response.
 * Strips MCP tool call XML and separates preamble text from component HTML.
 *
 * When no Burnish component tags are found, attempts to convert common
 * markdown structures (tables, key-value pairs, header+list) into
 * Burnish components via the markdown fallback converter.
 */
export function extractHtmlContent(
    text: string,
    prefix = DEFAULT_PREFIX,
    _renderMarkdown?: (text: string) => string,
    fallbackOptions?: FallbackOptions,
): string {
    let cleaned = stripMcpToolCalls(text);
    const tagRe = new RegExp(`<${prefix}[a-z]`);
    const htmlStart = cleaned.search(tagRe);

    if (htmlStart === -1) {
        // No Burnish tags found — try markdown fallback conversion
        if (containsMarkdownStructures(cleaned)) {
            const converted = convertMarkdownToComponents(cleaned, {
                prefix,
                ...fallbackOptions,
            });
            // Check if conversion actually produced component tags
            if (tagRe.test(converted)) {
                return extractHtmlContent(converted, prefix);
            }
        }
        return cleaned.trim();
    }

    // When components are present, strip all surrounding prose text.
    // Only keep the component HTML — the components ARE the UI.
    const closingRe = new RegExp(`</${prefix}[a-z][a-z-]*>`, 'g');
    let lastClose = htmlStart;
    let m: RegExpExecArray | null;
    while ((m = closingRe.exec(cleaned)) !== null) {
        lastClose = m.index + m[0].length;
    }
    return cleaned.substring(htmlStart, lastClose).trim();
}
