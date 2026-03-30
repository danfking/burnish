import { LitElement, html, css } from 'lit';
export class BurnishSection extends LitElement {
    static { this.properties = {
        label: { type: String },
        count: { type: Number },
        status: { type: String },
        collapsed: { type: Boolean, reflect: true },
    }; }
    static { this.styles = css `
        :host { display: block; margin: var(--burnish-space-xl, 20px) 0 var(--burnish-space-md, 12px); }
        :host(:first-child) { margin-top: 0; }
        .header {
            display: flex; align-items: center; gap: var(--burnish-space-sm, 8px);
            cursor: pointer; user-select: none; padding: var(--burnish-space-sm, 8px) 0;
        }
        .chevron {
            width: 16px; height: 16px; color: var(--burnish-text-muted);
            transition: transform var(--burnish-transition-fast); flex-shrink: 0;
        }
        :host([collapsed]) .chevron { transform: rotate(-90deg); }
        .status-dot {
            width: 12px; height: 12px; border-radius: var(--burnish-radius-round, 50%); flex-shrink: 0;
        }
        .label { font-size: var(--burnish-font-size-lg, 16px); font-weight: 600; color: var(--burnish-text); }
        .label[data-status="error"], .label[data-status="failing"] { color: var(--burnish-error); }
        .label[data-status="warning"] { color: var(--burnish-warning); }
        .label[data-status="success"], .label[data-status="healthy"] { color: var(--burnish-success); }
        .label[data-status="muted"], .label[data-status="no-data"] { color: var(--burnish-text-muted); }
        .count { font-size: var(--burnish-font-size-md, 14px); font-weight: 600; color: var(--burnish-text-muted); }
        .content { overflow: hidden; transition: max-height var(--burnish-transition-normal); }
        .grid {
            display: grid; grid-template-columns: repeat(auto-fill, 340px);
            gap: var(--burnish-space-md, 12px);
        }
        :host([collapsed]) .content { max-height: 0 !important; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    `; }
    constructor() {
        super();
        this.collapsed = false;
    }
    _toggle() { this.collapsed = !this.collapsed; }
    _getStatusColor() {
        const s = (this.status || '').toLowerCase();
        if (s === 'error' || s === 'failing')
            return 'var(--burnish-error, #ef4444)';
        if (s === 'warning')
            return 'var(--burnish-warning, #eab308)';
        if (s === 'success' || s === 'healthy')
            return 'var(--burnish-success, #22c55e)';
        return 'var(--burnish-muted, #9ca3af)';
    }
    render() {
        const countText = this.count != null ? `(${this.count})` : '';
        return html `
            <div class="header" @click=${this._toggle}>
                <svg class="chevron" viewBox="0 0 16 16" fill="none">
                    <path d="M5 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="status-dot" style="background:${this._getStatusColor()}"></span>
                <span class="label" data-status="${this.status || ''}">${this.label}</span>
                ${countText ? html `<span class="count">${countText}</span>` : ''}
            </div>
            <div class="content" style="max-height: 2000px">
                <div class="grid"><slot></slot></div>
            </div>
        `;
    }
}
customElements.define('burnish-section', BurnishSection);
//# sourceMappingURL=section.js.map