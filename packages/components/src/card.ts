import { LitElement, html, css } from 'lit';

export class BurnishCard extends LitElement {
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
            max-width: 100%;
            flex: 1 1 340px;
            min-width: 200px;
            box-sizing: border-box;
        }
        .card {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 4px);
            border: 1px solid var(--burnish-border-muted, #e5e7eb);
            overflow: hidden;
            box-shadow: var(--burnish-shadow-sm);
            transition: transform var(--burnish-transition-fast), box-shadow var(--burnish-transition-fast);
            position: relative;
        }
        .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 3px;
            background: var(--burnish-border-muted, #e5e7eb);
        }
        .card:hover, .card:focus {
            transform: translateY(-1px);
            box-shadow: var(--burnish-shadow-md);
        }
        .card:focus { outline: 2px solid var(--burnish-accent, #4f6df5); outline-offset: 2px; }
        .card[data-status="success"]::before,
        .card[data-status="healthy"]::before { background: var(--burnish-success, #16a34a); }
        .card[data-status="warning"]::before { background: var(--burnish-warning, #ca8a04); }
        .card[data-status="error"]::before,
        .card[data-status="failing"]::before { background: var(--burnish-error, #dc2626); }
        .card[data-status="info"]::before { background: var(--burnish-info, #6366f1); }
        .card-header {
            padding: var(--burnish-space-md, 12px) var(--burnish-space-lg, 16px) var(--burnish-space-sm, 8px);
            display: flex; align-items: center; justify-content: space-between;
        }
        .card-title { font-size: var(--burnish-font-size-md, 14px); font-weight: 600; color: var(--burnish-text, #1f2937); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .card-badge {
            font-size: var(--burnish-font-size-xs, 11px); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.5px;
            padding: 2px var(--burnish-space-sm, 8px); border-radius: 10px;
            flex-shrink: 0;
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
        .card-badge[data-status="info"] {
            color: var(--burnish-info, #6366f1); background: var(--burnish-border-info, #c7d2fe);
        }
        .card-body {
            padding: 0 var(--burnish-space-lg, 16px) var(--burnish-space-md, 12px);
            font-size: var(--burnish-font-size-base, 13px); color: var(--burnish-text-secondary);
            line-height: 1.4;
            overflow-wrap: anywhere; word-break: break-word;
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
            cursor: pointer;
        }
        .card-action:hover { background: rgba(59, 130, 246, 0.04); }
        .card:hover .card-action { opacity: 1; }
        .card-link {
            color: var(--burnish-link, #3b82f6);
            text-decoration: none;
            font-weight: 500;
        }
        .card-link:hover { text-decoration: underline; }
        .error-state {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 60px; padding: var(--burnish-space-lg);
            color: var(--burnish-text-muted); font-size: var(--burnish-font-size-base);
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

    private _handleClick(e: MouseEvent) {
        // Don't trigger drill-down if clicking a link or the explore button area
        const target = e.target as HTMLElement;
        if (target.closest('a') || target.closest('.card-link')) return;
        // Only trigger drill-down from the explore button
        if (!target.closest('.card-action')) return;
        this.dispatchEvent(new CustomEvent('burnish-card-action', {
            detail: { title: this.title, status: this.status, itemId: this['item-id'] },
            bubbles: true,
            composed: true,
        }));
    }

    private _handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.dispatchEvent(new CustomEvent('burnish-card-action', {
                detail: { title: this.title, status: this.status, itemId: this['item-id'] },
                bubbles: true,
                composed: true,
            }));
        }
    }

    private _isUrl(text: string): boolean {
        return /^https?:\/\//.test(text) || /^[\w.-]+\.\w+\//.test(text);
    }

    render() {
        // Layer 3: Component-level validation — normalize status to valid values
        // Map custom status values to color groups for styling
        // Known RAG: success, warning, error + aliases
        // Everything else gets "info" coloring but keeps its badge text
        const STATUS_COLOR_MAP: Record<string, string> = {
            success: 'success', healthy: 'success', merged: 'success', resolved: 'success',
            warning: 'warning', draft: 'warning', pending: 'warning',
            error: 'error', failing: 'error', failed: 'error',
            muted: 'muted', 'no-data': 'muted', locked: 'muted', archived: 'muted',
            info: 'info',
        };
        const statusColor = STATUS_COLOR_MAP[(this.status || '').toLowerCase()] || 'info';

        if (this._parseError) {
            return html`<div class="card" data-status="muted"><div class="error-state" role="alert">Unable to display data</div></div>`;
        }

        let metaData: Array<{ label: string; value: string }> = [];
        try { metaData = JSON.parse(this.meta || '[]'); }
        catch { this._parseError = true; return; }

        const s = this.status || 'muted';
        const badgeText = s.toUpperCase();
        return html`
            <div class="card" data-status="${statusColor}" role="article" aria-label="${this.title || ''}"
                 @click=${this._handleClick} @keydown=${this._handleKeydown}>
                <div class="card-header">
                    <span class="card-title">${this.title}</span>
                    <span class="card-badge" data-status="${statusColor}">${badgeText}</span>
                </div>
                ${this.body ? html`<div class="card-body">${this.body}</div>` : ''}
                ${metaData.length > 0 ? html`
                    <div class="card-meta">
                        ${metaData.map(m => html`
                            <span class="meta-item">
                                <span class="meta-label">${m.label}:</span>
                                ${this._isUrl(m.value)
                                    ? html`<a class="card-link" href="${m.value.startsWith('http') ? m.value : 'https://' + m.value}" target="_blank" rel="noopener">${m.value}</a>`
                                    : html`<span class="meta-value">${m.value}</span>`
                                }
                            </span>
                        `)}
                    </div>
                ` : ''}
                <div class="card-action" role="button" tabindex="0">Explore \u2192</div>
            </div>
        `;
    }
}

customElements.define('burnish-card', BurnishCard);
