/**
 * Progressive streaming HTML parser for Burnish components.
 *
 * Parses streamed text into a flat list of elements for progressive rendering.
 * Container tags (like burnish-section) emit separate open/close entries so their
 * children can render individually as they arrive.
 */

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
    const cleaned = text.replace(/<use_mcp_tool[\s\S]*?<\/use_mcp_tool>/g, '');

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
 */
export function extractHtmlContent(
    text: string,
    prefix = DEFAULT_PREFIX,
    renderMarkdown?: (text: string) => string,
): string {
    let cleaned = text.replace(/<use_mcp_tool[\s\S]*?<\/use_mcp_tool>/g, '');
    const htmlStart = cleaned.search(new RegExp(`<(?:${prefix}[a-z]|div)`));
    if (htmlStart === -1) return cleaned.trim();

    const preamble = cleaned.substring(0, htmlStart).trim();
    const htmlContent = cleaned.substring(htmlStart).trim();

    let result = '';
    if (preamble && renderMarkdown) {
        result += `<div class="burnish-text-preamble">${renderMarkdown(preamble)}</div>`;
    } else if (preamble) {
        result += `<div class="burnish-text-preamble">${preamble}</div>`;
    }
    result += htmlContent;
    return result;
}
