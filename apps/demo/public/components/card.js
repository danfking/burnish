import { LitElement, html, css } from 'lit';
export class BurnishCard extends LitElement {
    static { this.properties = {
        title: { type: String },
        status: { type: String },
        body: { type: String },
        meta: { type: String },
        'item-id': { type: String },
        _parseError: { state: true },
    }; }
    static { this.styles = css `
        :host {
            display: block;
            width: 340px;
            flex: 0 0 340px;
        }
        .card {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 8px);
            border: 1px solid var(--burnish-border-muted, #e5e7eb);
            border-top: 3px solid var(--burnish-border-muted, #e5e7eb);
            overflow: hidden;
            box-shadow: var(--burnish-shadow-sm);
            transition: transform var(--burnish-transition-fast), box-shadow var(--burnish-transition-fast);
            cursor: pointer;
        }
        .card:hover, .card:focus {
            transform: translateY(-1px);
            box-shadow: var(--burnish-shadow-md);
        }
        .card:focus { outline: 2px solid var(--burnish-accent, #4f6df5); outline-offset: 2px; }
        .card[data-status="success"] { border-top-color: var(--burnish-border-success, #dcfce7); }
        .card[data-status="healthy"] { border-top-color: var(--burnish-border-success, #dcfce7); }
        .card[data-status="warning"] { border-top-color: var(--burnish-border-warning, #fef9c3); }
        .card[data-status="error"] { border-top-color: var(--burnish-border-error, #fee2e2); }
        .card[data-status="failing"] { border-top-color: var(--burnish-border-error, #fee2e2); }
        .card-header {
            padding: var(--burnish-space-md, 12px) var(--burnish-space-lg, 16px) var(--burnish-space-sm, 8px);
            display: flex; align-items: center; justify-content: space-between;
        }
        .card-title { font-size: var(--burnish-font-size-md, 14px); font-weight: 600; color: var(--burnish-text, #1f2937); }
        .card-badge {
            font-size: var(--burnish-font-size-xs, 11px); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.5px;
            padding: 2px var(--burnish-space-sm, 8px); border-radius: 10px;
        }
        .card-badge[data-status="success"], .card-badge[data-status="healthy"] {
            color: var(--burnish-success); background: var(--burnish-border-success);
        }
        .card-badge[data-status="warning"] { color: var(--burnish-warning); background: var(--burnish-border-warning); }
        .card-badge[data-status="error"], .card-badge[data-status="failing"] {
            color: var(--burnish-error); background: var(--burnish-border-error);
        }
        .card-badge[data-status="muted"], .card-badge[data-status="no-data"] {
            color: var(--burnish-text-muted); background: var(--burnish-border-muted);
        }
        .card-body {
            padding: 0 var(--burnish-space-lg, 16px) var(--burnish-space-md, 12px);
            font-size: var(--burnish-font-size-base, 13px); color: var(--burnish-text-secondary);
            line-height: 1.4;
        }
        .card-meta {
            padding: var(--burnish-space-sm, 8px) var(--burnish-space-lg, 16px);
            border-top: 1px solid var(--burnish-border-light, #f3f4f6);
            display: flex; gap: var(--burnish-space-lg, 16px); flex-wrap: wrap;
        }
        .meta-item { font-size: var(--burnish-font-size-sm, 12px); }
        .meta-label { color: var(--burnish-text-muted); margin-right: var(--burnish-space-xs, 4px); }
        .meta-value { color: var(--burnish-text); font-weight: 500; }
        .card-action {
            padding: var(--burnish-space-sm, 8px) var(--burnish-space-lg, 16px);
            border-top: 1px solid var(--burnish-border-light);
            font-size: var(--burnish-font-size-sm, 12px); color: var(--burnish-link, #3b82f6);
            opacity: 0; transition: opacity var(--burnish-transition-fast);
        }
        .card:hover .card-action { opacity: 1; }
        .error-state {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 60px; padding: var(--burnish-space-lg);
            color: var(--burnish-text-muted); font-size: var(--burnish-font-size-base);
        }
    `; }
    constructor() {
        super();
        this._parseError = false;
    }
    _handleClick() {
        this.dispatchEvent(new CustomEvent('burnish-card-action', {
            detail: { title: this.title, status: this.status, itemId: this['item-id'] },
            bubbles: true,
            composed: true,
        }));
    }
    _handleKeydown(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._handleClick();
        }
    }
    render() {
        if (this._parseError) {
            return html `<div class="card" data-status="muted"><div class="error-state" role="alert">Unable to display data</div></div>`;
        }
        let metaData = [];
        try {
            metaData = JSON.parse(this.meta || '[]');
        }
        catch {
            this._parseError = true;
            return;
        }
        const s = this.status || 'muted';
        return html `
            <div class="card" data-status="${s}" role="article" aria-label="${this.title || ''}"
                 tabindex="0" @click=${this._handleClick} @keydown=${this._handleKeydown}>
                <div class="card-header">
                    <span class="card-title">${this.title}</span>
                    <span class="card-badge" data-status="${s}">${s}</span>
                </div>
                ${this.body ? html `<div class="card-body">${this.body}</div>` : ''}
                ${metaData.length > 0 ? html `
                    <div class="card-meta">
                        ${metaData.map(m => html `
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
customElements.define('burnish-card', BurnishCard);
//# sourceMappingURL=card.js.map