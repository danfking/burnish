/**
 * Summary and time-formatting utilities.
 */

/**
 * Generate a summary from a container element's burnish components.
 * Returns component tags and a key-values string from stat-bar data.
 */
export function generateSummary(element: Element): { tags: string[]; summary: string } {
    const tagEls = element.querySelectorAll(
        'burnish-stat-bar, burnish-table, burnish-card, burnish-chart, burnish-metric, burnish-section'
    );
    const tags = [...new Set([...tagEls].map(el => el.tagName.toLowerCase().replace('burnish-', '')))];

    const statBar = element.querySelector('burnish-stat-bar');
    let keyValues = '';
    if (statBar) {
        try {
            const items = JSON.parse(statBar.getAttribute('items') || '[]');
            keyValues = items.slice(0, 3).map((i: any) => `${i.value} ${i.label}`).join(', ');
        } catch { /* ignore */ }
    }

    if (tags.length === 0) {
        const text = element.textContent?.trim() || '';
        return { tags: ['text'], summary: text.substring(0, 60) + (text.length > 60 ? '...' : '') };
    }
    return { tags, summary: keyValues || tags.join(' + ') };
}

/**
 * Format a timestamp as a human-readable relative time string.
 */
export function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
