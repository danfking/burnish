import { LitElement, html, css } from 'lit';
export class BurnishStatBar extends LitElement {
    static { this.properties = {
        items: { type: String },
    }; }
    static { this.styles = css `
        :host { display: block; margin-bottom: var(--burnish-space-lg, 16px); }
        .stat-bar { display: flex; gap: var(--burnish-space-md, 12px); flex-wrap: wrap; }
        .stat-chip {
            display: flex; align-items: center; gap: var(--burnish-space-sm, 8px);
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-pill, 20px);
            padding: var(--burnish-space-sm, 8px) var(--burnish-space-lg, 16px);
            box-shadow: var(--burnish-shadow-sm);
            font-size: var(--burnish-font-size-md, 14px);
            transition: transform var(--burnish-transition-fast), box-shadow var(--burnish-transition-fast);
        }
        .stat-chip:hover { transform: translateY(-1px); box-shadow: var(--burnish-shadow-md); }
        .stat-dot { width: 10px; height: 10px; border-radius: var(--burnish-radius-round, 50%); }
        .stat-value { font-weight: 700; font-size: var(--burnish-font-size-xl, 18px); margin-right: var(--burnish-space-xs, 4px); }
        .stat-label { color: var(--burnish-text-secondary, #6b7280); }
    `; }
    _getColor(color) {
        const map = {
            success: 'var(--burnish-success, #22c55e)', healthy: 'var(--burnish-success, #22c55e)',
            warning: 'var(--burnish-warning, #eab308)',
            error: 'var(--burnish-error, #ef4444)', failing: 'var(--burnish-error, #ef4444)',
            muted: 'var(--burnish-muted, #9ca3af)', 'no-data': 'var(--burnish-muted, #9ca3af)',
        };
        return map[color || ''] || color || 'var(--burnish-muted, #9ca3af)';
    }
    render() {
        let data = [];
        try {
            data = JSON.parse(this.items || '[]');
        }
        catch { /* graceful */ }
        return html `
            <div class="stat-bar">
                ${data.map(item => html `
                    <div class="stat-chip">
                        <span class="stat-dot" style="background:${this._getColor(item.color)}"></span>
                        <span class="stat-value">${item.value}</span>
                        <span class="stat-label">${item.label}</span>
                    </div>
                `)}
            </div>
        `;
    }
}
customElements.define('burnish-stat-bar', BurnishStatBar);
//# sourceMappingURL=stat-bar.js.map