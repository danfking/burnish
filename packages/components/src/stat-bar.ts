import { LitElement, html, css } from 'lit';

export class McpuiStatBar extends LitElement {
    static properties = {
        items: { type: String },
    };

    static styles = css`
        :host { display: block; margin-bottom: var(--mcpui-space-lg, 16px); }
        .stat-bar { display: flex; gap: var(--mcpui-space-md, 12px); flex-wrap: wrap; }
        .stat-chip {
            display: flex; align-items: center; gap: var(--mcpui-space-sm, 8px);
            background: var(--mcpui-surface, #fff);
            border-radius: var(--mcpui-radius-pill, 20px);
            padding: var(--mcpui-space-sm, 8px) var(--mcpui-space-lg, 16px);
            box-shadow: var(--mcpui-shadow-sm);
            font-size: var(--mcpui-font-size-md, 14px);
            transition: transform var(--mcpui-transition-fast), box-shadow var(--mcpui-transition-fast);
        }
        .stat-chip:hover { transform: translateY(-1px); box-shadow: var(--mcpui-shadow-md); }
        .stat-dot { width: 10px; height: 10px; border-radius: var(--mcpui-radius-round, 50%); }
        .stat-value { font-weight: 700; font-size: var(--mcpui-font-size-xl, 18px); margin-right: var(--mcpui-space-xs, 4px); }
        .stat-label { color: var(--mcpui-text-secondary, #6b7280); }
    `;

    declare items: string;

    private _getColor(color?: string): string {
        const map: Record<string, string> = {
            success: 'var(--mcpui-success, #22c55e)', healthy: 'var(--mcpui-success, #22c55e)',
            warning: 'var(--mcpui-warning, #eab308)',
            error: 'var(--mcpui-error, #ef4444)', failing: 'var(--mcpui-error, #ef4444)',
            muted: 'var(--mcpui-muted, #9ca3af)', 'no-data': 'var(--mcpui-muted, #9ca3af)',
        };
        return map[color || ''] || color || 'var(--mcpui-muted, #9ca3af)';
    }

    render() {
        let data: Array<{ label: string; value: string | number; color?: string }> = [];
        try { data = JSON.parse(this.items || '[]'); } catch { /* graceful */ }

        return html`
            <div class="stat-bar">
                ${data.map(item => html`
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

customElements.define('mcpui-stat-bar', McpuiStatBar);
