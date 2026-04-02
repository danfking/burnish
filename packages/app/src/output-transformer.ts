/**
 * Deterministic output transformation.
 * Runs AFTER DOMPurify sanitization, BEFORE DOM injection.
 * Enforces rules the LLM might ignore from the system prompt.
 */

export interface TransformOutputOptions {
    /** Custom DOMParser instance (for testability / SSR) */
    domParser?: { parseFromString(str: string, type: string): Document };
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

export function transformOutput(html: string, options?: TransformOutputOptions): string {
    if (!options?.domParser && typeof DOMParser === 'undefined') {
        // No DOMParser available (Node.js) and none injected — return html unchanged
        return html;
    }
    const parser = options?.domParser ?? new DOMParser();
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
    root.querySelectorAll('burnish-stat-bar').forEach(bar => {
        const parent = bar.parentElement;
        const hasSections = parent?.querySelector('burnish-section');
        if (hasSections) {
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
