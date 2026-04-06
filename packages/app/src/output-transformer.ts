/**
 * Deterministic output transformation.
 * Runs AFTER DOMPurify sanitization, BEFORE DOM injection.
 * Enforces rules the LLM might ignore from the system prompt.
 */

export interface TransformOutputOptions {
    /** Custom DOMParser instance (for testability / SSR) */
    domParser?: { parseFromString(str: string, type: string): Document };
}

/**
 * Repair malformed JSON in burnish-* component attributes.
 * LLMs sometimes produce trailing commas, single-quoted strings,
 * or unquoted keys. We fix these before DOM parsing so components
 * receive valid JSON and don't have to degrade.
 */
function repairJsonAttributes(html: string): string {
    const jsonAttrs = ['items', 'meta', 'columns', 'rows', 'fields', 'actions', 'config'];
    // Match single-quoted attributes: attr='...'
    const singleQuotePattern = new RegExp(
        `((?:${jsonAttrs.join('|')})\\s*=\\s*')((?:[^'\\\\]|\\\\.)*)(')`,'g'
    );
    // Match double-quoted attributes: attr="..."
    const doubleQuotePattern = new RegExp(
        `((?:${jsonAttrs.join('|')})\\s*=\\s*")((?:[^"\\\\]|\\\\.)*)(")`, 'g'
    );

    function tryRepair(match: string, prefix: string, json: string, suffix: string): string {
        // Unescape HTML entities that the LLM may have emitted.
        // Decode &amp; last to avoid double-decoding (e.g. &amp;quot; → &quot; → ")
        let decoded = json
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');

        try {
            JSON.parse(decoded);
            // Already valid — re-encode for the attribute context to avoid double escaping
            return prefix + encodeForAttr(decoded, prefix) + suffix;
        } catch {
            let repaired = decoded;
            // Fix trailing commas before ] or }
            repaired = repaired.replace(/,\s*([}\]])/g, '$1');
            // Fix single-quoted values inside JSON → double quotes
            repaired = repaired.replace(/'/g, '"');
            // Fix unquoted keys
            repaired = repaired.replace(/(\{|,)\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
            try {
                JSON.parse(repaired);
                // Re-encode for the attribute context
                return prefix + encodeForAttr(repaired, prefix) + suffix;
            } catch {
                return match; // Can't fix, leave as-is
            }
        }
    }

    /**
     * Re-encode a decoded JSON string for safe embedding in an HTML attribute.
     * The prefix tells us whether the attribute uses single or double quotes.
     */
    function encodeForAttr(value: string, prefix: string): string {
        // Always encode & first to prevent double-encoding
        let encoded = value.replace(/&/g, '&amp;');
        if (prefix.endsWith('"')) {
            // Double-quoted attribute: encode double quotes
            encoded = encoded.replace(/"/g, '&quot;');
        } else if (prefix.endsWith("'")) {
            // Single-quoted attribute: encode single quotes
            encoded = encoded.replace(/'/g, '&#39;');
        }
        return encoded;
    }

    html = html.replace(singleQuotePattern, tryRepair);
    html = html.replace(doubleQuotePattern, tryRepair);
    return html;
}

const STATUS_COLOR_MAP: Record<string, string> = {
    success: 'var(--burnish-success, #16a34a)',
    healthy: 'var(--burnish-success, #16a34a)',
    warning: 'var(--burnish-warning, #ca8a04)',
    error: 'var(--burnish-error, #dc2626)',
    failing: 'var(--burnish-error, #dc2626)',
    info: 'var(--burnish-info, #6366f1)',
    muted: 'var(--burnish-muted, #9ca3af)',
};

/** Maximum HTML input size for transformation (2 MB) */
const MAX_HTML_INPUT_SIZE = 2 * 1024 * 1024;

export function transformOutput(html: string, options?: TransformOutputOptions): string {
    // Validate input
    if (!html || typeof html !== 'string') return '';
    if (html.length > MAX_HTML_INPUT_SIZE) {
        console.warn('transformOutput: input exceeds maximum size, truncating');
        html = html.slice(0, MAX_HTML_INPUT_SIZE);
    }

    // Reject script tags and event handlers as a defense-in-depth measure.
    // Callers MUST sanitize with DOMPurify before calling transformOutput.
    if (/<script[\s>]/i.test(html) || /\bon\w+\s*=/i.test(html)) {
        console.warn('transformOutput: input contains unsanitized script content — rejected');
        return '';
    }

    // Repair malformed JSON attributes before DOM parsing
    html = repairJsonAttributes(html);

    if (!options?.domParser && typeof DOMParser === 'undefined') {
        // No DOMParser available (Node.js) and none injected — return html unchanged
        return html;
    }
    const parser = options?.domParser ?? new DOMParser();
    // SAFETY: input is expected to be pre-sanitized by DOMPurify before reaching
    // this function. The script/event-handler check above is defense-in-depth.
    // DOMParser.parseFromString with 'text/html' does not execute scripts.
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return html;

    // Rule 1: Normalize card statuses
    root.querySelectorAll('burnish-card').forEach(card => {
        const status = card.getAttribute('status');
        const itemId = card.getAttribute('item-id') || '';

        // Tool cards always get info
        if (itemId.includes('__')) {
            card.setAttribute('status', 'info');
            return;
        }

        // Preserve risk-based status set by tool listing renderer
        if (itemId && !itemId.includes('__')) {
            return;
        }

        // Cards in listing context: only override "success" → "info"
        if (status === 'success') {
            const parentSection = card.closest('burnish-section');
            if (parentSection) {
                card.setAttribute('status', 'info');
            }
        }
    });

    // Rule 1b: Sections in informational context should use "info" status
    root.querySelectorAll('burnish-section').forEach(section => {
        const hasCards = section.querySelector('burnish-card');
        if (hasCards) {
            section.setAttribute('status', 'info');
        }
    });

    // Rule 1c: Stat-bar chips should use "info" when sibling content is informational
    // Skip for tool listing stat-bars (where sibling cards have item-id without __)
    root.querySelectorAll('burnish-stat-bar').forEach(bar => {
        const parent = bar.parentElement;
        const hasSections = parent?.querySelector('burnish-section');
        if (hasSections) {
            // Check if this is a tool listing context (cards with simple item-id)
            const toolListingCard = parent?.querySelector('burnish-card[item-id]');
            const isToolListing = toolListingCard && !toolListingCard.getAttribute('item-id')?.includes('__');
            if (isToolListing) return; // Preserve risk-based stat-bar colors

            try {
                const items = JSON.parse(bar.getAttribute('items') || '[]');
                const hasGreen = items.some((i: any) => i.color === 'success' || i.color === 'healthy');
                if (hasGreen) {
                    const updated = items.map((item: any) =>
                        (item.color === 'success' || item.color === 'healthy')
                            ? { ...item, color: 'info' }
                            : item
                    );
                    bar.setAttribute('items', JSON.stringify(updated));
                }
            } catch { /* ignore */ }
        }
    });

    // Rule 1d: Propagate stat-bar pill colors to matching section dots
    root.querySelectorAll('burnish-stat-bar').forEach(bar => {
        try {
            const items = JSON.parse(bar.getAttribute('items') || '[]');
            const parent = bar.parentElement;
            if (!parent) return;
            const sections = parent.querySelectorAll('burnish-section');
            for (const section of sections) {
                const sectionLabel = (section.getAttribute('label') || '').toLowerCase();
                if (!sectionLabel) continue;
                const sectionWords = new Set(sectionLabel.split(/\s+/));
                const stopwords = new Set(['operations', 'items', 'total', 'all', 'other', 'the', 'and', 'or']);
                const match = items.find((item: any) => {
                    const itemWords = (item.label || '').toLowerCase().split(/\s+/);
                    return itemWords.some((w: string) => w && !stopwords.has(w) && sectionWords.has(w));
                });
                if (match) {
                    const resolvedColor = STATUS_COLOR_MAP[(match.color || '').toLowerCase()] || match.color || '';
                    if (resolvedColor) {
                        section.setAttribute('color', resolvedColor);
                    }
                }
            }
        } catch { /* ignore */ }
    });

    // Rule 2: Sanitize lookup prompts — strip specific tool/server name references
    root.querySelectorAll('burnish-form').forEach(form => {
        const fieldsAttr = form.getAttribute('fields');
        if (!fieldsAttr) return;
        try {
            const fields = JSON.parse(fieldsAttr);
            let changed = false;
            for (const field of fields) {
                if (field.lookup?.prompt) {
                    const cleaned = field.lookup.prompt.replace(/mcp__\w+__\w+/g, '').replace(/\s{2,}/g, ' ').trim();
                    if (cleaned !== field.lookup.prompt) {
                        field.lookup.prompt = cleaned || `Find valid values for ${field.label || field.key}`;
                        changed = true;
                    }
                }
            }
            if (changed) form.setAttribute('fields', JSON.stringify(fields));
        } catch { /* ignore parse errors */ }
    });

    return root.innerHTML;
}
