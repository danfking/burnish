import { LitElement, html, css } from 'lit';

export class McpuiSection extends LitElement {
    static properties = {
        label: { type: String },
        count: { type: Number },
        status: { type: String },
        collapsed: { type: Boolean, reflect: true },
    };

    static styles = css`
        :host { display: block; margin: var(--mcpui-space-xl, 20px) 0 var(--mcpui-space-md, 12px); }
        :host(:first-child) { margin-top: 0; }
        .header {
            display: flex; align-items: center; gap: var(--mcpui-space-sm, 8px);
            cursor: pointer; user-select: none; padding: var(--mcpui-space-sm, 8px) 0;
        }
        .chevron {
            width: 16px; height: 16px; color: var(--mcpui-text-muted);
            transition: transform var(--mcpui-transition-fast); flex-shrink: 0;
        }
        :host([collapsed]) .chevron { transform: rotate(-90deg); }
        .status-dot {
            width: 12px; height: 12px; border-radius: var(--mcpui-radius-round, 50%); flex-shrink: 0;
        }
        .label { font-size: var(--mcpui-font-size-lg, 16px); font-weight: 600; color: var(--mcpui-text); }
        .label[data-status="error"], .label[data-status="failing"] { color: var(--mcpui-error); }
        .label[data-status="warning"] { color: var(--mcpui-warning); }
        .label[data-status="success"], .label[data-status="healthy"] { color: var(--mcpui-success); }
        .label[data-status="muted"], .label[data-status="no-data"] { color: var(--mcpui-text-muted); }
        .count { font-size: var(--mcpui-font-size-md, 14px); font-weight: 600; color: var(--mcpui-text-muted); }
        .content { overflow: hidden; transition: max-height var(--mcpui-transition-normal); }
        .grid {
            display: grid; grid-template-columns: repeat(auto-fill, 340px);
            gap: var(--mcpui-space-md, 12px);
        }
        :host([collapsed]) .content { max-height: 0 !important; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    `;

    declare label: string;
    declare count: number;
    declare status: string;
    declare collapsed: boolean;

    constructor() {
        super();
        this.collapsed = false;
    }

    private _toggle() { this.collapsed = !this.collapsed; }

    private _getStatusColor(): string {
        const s = (this.status || '').toLowerCase();
        if (s === 'error' || s === 'failing') return 'var(--mcpui-error, #ef4444)';
        if (s === 'warning') return 'var(--mcpui-warning, #eab308)';
        if (s === 'success' || s === 'healthy') return 'var(--mcpui-success, #22c55e)';
        return 'var(--mcpui-muted, #9ca3af)';
    }

    render() {
        const countText = this.count != null ? `(${this.count})` : '';
        return html`
            <div class="header" @click=${this._toggle}>
                <svg class="chevron" viewBox="0 0 16 16" fill="none">
                    <path d="M5 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="status-dot" style="background:${this._getStatusColor()}"></span>
                <span class="label" data-status="${this.status || ''}">${this.label}</span>
                ${countText ? html`<span class="count">${countText}</span>` : ''}
            </div>
            <div class="content" style="max-height: 2000px">
                <div class="grid"><slot></slot></div>
            </div>
        `;
    }
}

customElements.define('mcpui-section', McpuiSection);
