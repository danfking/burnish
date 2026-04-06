/**
 * Shared constants and utilities used across multiple modules.
 */

// ── DOMPurify Config ──
export const PURIFY_CONFIG = {
    ADD_TAGS: ['burnish-card', 'burnish-stat-bar', 'burnish-table', 'burnish-chart',
               'burnish-section', 'burnish-metric', 'burnish-message', 'burnish-form', 'burnish-actions'],
    ADD_ATTR: ['items', 'title', 'status', 'body', 'meta', 'columns', 'rows',
               'status-field', 'type', 'config', 'role', 'content', 'class',
               'label', 'count', 'collapsed', 'item-id', 'value', 'unit', 'trend',
               'streaming', 'tool-id', 'fields', 'actions', 'color', 'status-label', 'variant'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

export const WRITE_TOOL_RE = /^(create|update|delete|remove|push|write|edit|move|fork|merge|add|set|close|lock|assign)/i;

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function boundCache(cache, maxSize = 50) {
    const keys = Object.keys(cache);
    if (keys.length > maxSize) {
        for (let i = 0; i < keys.length - maxSize; i++) delete cache[keys[i]];
    }
}
