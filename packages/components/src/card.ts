import { LitElement, html, css } from 'lit';

export class McpuiCard extends LitElement {
    static properties = {
        title: { type: String },
        status: { type: String },
        body: { type: String },
        meta: { type: String },
        'item-id': { type: String },
        _parseError: { state: true },
    };

    static styles = css`
        :host {
            display: block;
            width: 340px;
            flex: 0 0 340px;
        }
        .card {
            background: var(--mcpui-surface, #fff);
            border-radius: var(--mcpui-radius-md, 8px);
            border: 1px solid var(--mcpui-border-muted, #e5e7eb);
            border-top: 3px solid var(--mcpui-border-muted, #e5e7eb);
            overflow: hidden;
            box-shadow: var(--mcpui-shadow-sm);
            transition: transform var(--mcpui-transition-fast), box-shadow var(--mcpui-transition-fast);
            cursor: pointer;
        }
        .card:hover, .card:focus {
            transform: translateY(-1px);
            box-shadow: var(--mcpui-shadow-md);
        }
        .card:focus { outline: 2px solid var(--mcpui-accent, #4f6df5); outline-offset: 2px; }
        .card[data-status="success"] { border-top-color: var(--mcpui-border-success, #dcfce7); }
        .card[data-status="healthy"] { border-top-color: var(--mcpui-border-success, #dcfce7); }
        .card[data-status="warning"] { border-top-color: var(--mcpui-border-warning, #fef9c3); }
        .card[data-status="error"] { border-top-color: var(--mcpui-border-error, #fee2e2); }
        .card[data-status="failing"] { border-top-color: var(--mcpui-border-error, #fee2e2); }
        .card-header {
            padding: var(--mcpui-space-md, 12px) var(--mcpui-space-lg, 16px) var(--mcpui-space-sm, 8px);
            display: flex; align-items: center; justify-content: space-between;
        }
        .card-title { font-size: var(--mcpui-font-size-md, 14px); font-weight: 600; color: var(--mcpui-text, #1f2937); }
        .card-badge {
            font-size: var(--mcpui-font-size-xs, 11px); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.5px;
            padding: 2px var(--mcpui-space-sm, 8px); border-radius: 10px;
        }
        .card-badge[data-status="success"], .card-badge[data-status="healthy"] {
            color: var(--mcpui-success); background: var(--mcpui-border-success);
        }
        .card-badge[data-status="warning"] { color: var(--mcpui-warning); background: var(--mcpui-border-warning); }
        .card-badge[data-status="error"], .card-badge[data-status="failing"] {
            color: var(--mcpui-error); background: var(--mcpui-border-error);
        }
        .card-badge[data-status="muted"], .card-badge[data-status="no-data"] {
            color: var(--mcpui-text-muted); background: var(--mcpui-border-muted);
        }
        .card-body {
            padding: 0 var(--mcpui-space-lg, 16px) var(--mcpui-space-md, 12px);
            font-size: var(--mcpui-font-size-base, 13px); color: var(--mcpui-text-secondary);
            line-height: 1.4;
        }
        .card-meta {
            padding: var(--mcpui-space-sm, 8px) var(--mcpui-space-lg, 16px);
            border-top: 1px solid var(--mcpui-border-light, #f3f4f6);
            display: flex; gap: var(--mcpui-space-lg, 16px); flex-wrap: wrap;
        }
        .meta-item { font-size: var(--mcpui-font-size-sm, 12px); }
        .meta-label { color: var(--mcpui-text-muted); margin-right: var(--mcpui-space-xs, 4px); }
        .meta-value { color: var(--mcpui-text); font-weight: 500; }
        .card-action {
            padding: var(--mcpui-space-sm, 8px) var(--mcpui-space-lg, 16px);
            border-top: 1px solid var(--mcpui-border-light);
            font-size: var(--mcpui-font-size-sm, 12px); color: var(--mcpui-link, #3b82f6);
            opacity: 0; transition: opacity var(--mcpui-transition-fast);
        }
        .card:hover .card-action { opacity: 1; }
        .error-state {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 60px; padding: var(--mcpui-space-lg);
            color: var(--mcpui-text-muted); font-size: var(--mcpui-font-size-base);
        }
    `;

    declare title: string;
    declare status: string;
    declare body: string;
    declare meta: string;
    declare 'item-id': string;
    declare _parseError: boolean;

    constructor() {
        super();
        this._parseError = false;
    }

    private _handleClick() {
        this.dispatchEvent(new CustomEvent('mcpui-card-action', {
            detail: { title: this.title, status: this.status, itemId: this['item-id'] },
            bubbles: true,
            composed: true,
        }));
    }

    private _handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._handleClick(); }
    }

    render() {
        // Layer 3: Component-level validation — normalize status to valid values
        const VALID_STATUSES = new Set(['success', 'warning', 'error', 'muted', 'healthy', 'failing', 'no-data']);
        if (this.status && !VALID_STATUSES.has(this.status)) {
            this.status = 'muted';
        }

        if (this._parseError) {
            return html`<div class="card" data-status="muted"><div class="error-state" role="alert">Unable to display data</div></div>`;
        }

        let metaData: Array<{ label: string; value: string }> = [];
        try { metaData = JSON.parse(this.meta || '[]'); }
        catch { this._parseError = true; return; }

        const s = this.status || 'muted';
        return html`
            <div class="card" data-status="${s}" role="article" aria-label="${this.title || ''}"
                 tabindex="0" @click=${this._handleClick} @keydown=${this._handleKeydown}>
                <div class="card-header">
                    <span class="card-title">${this.title}</span>
                    <span class="card-badge" data-status="${s}">${s}</span>
                </div>
                ${this.body ? html`<div class="card-body">${this.body}</div>` : ''}
                ${metaData.length > 0 ? html`
                    <div class="card-meta">
                        ${metaData.map(m => html`
                            <span class="meta-item">
                                <span class="meta-label">${m.label}:</span>
                                <span class="meta-value">${m.value}</span>
                            </span>
                        `)}
                    </div>
                ` : ''}
                <div class="card-action">View details \u2192</div>
            </div>
        `;
    }
}

customElements.define('mcpui-card', McpuiCard);
