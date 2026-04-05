import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

export class BurnishCard extends LitElement {
    static properties = {
        title: { type: String },
        status: { type: String },
        'status-label': { type: String, attribute: 'status-label' },
        body: { type: String },
        meta: { type: String },
        'item-id': { type: String, attribute: 'item-id' },
        _parseError: { state: true },
        _expanded: { state: true },
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
        :host([expanded]) {
            width: 100%;
            flex: 1 1 100%;
            grid-column: 1 / -1;
        }
        :host([expanded]) .card-body {
            max-height: none;
            -webkit-line-clamp: unset;
        }
        .expand-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 2px;
            color: var(--burnish-text-muted, #9C8F8F);
            display: none; align-items: center; flex-shrink: 0;
            border-radius: 3px; transition: all 0.15s ease;
            font-size: 10px; line-height: 1;
        }
        .card:hover .expand-btn { display: flex; }
        .expand-btn:hover { color: var(--burnish-accent, #8B3A3A); }
        .card {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 4px);
            border: 1px solid var(--burnish-border-muted, #E5DDDD);
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
            background: var(--burnish-border-muted, #E5DDDD);
        }
        .card:hover, .card:focus {
            transform: translateY(-1px);
            box-shadow: var(--burnish-shadow-md);
        }
        .card:focus { outline: 2px solid var(--burnish-accent, #8B3A3A); outline-offset: 2px; }
        .card[data-status="success"]::before,
        .card[data-status="healthy"]::before { background: var(--burnish-success, #16a34a); }
        .card[data-status="warning"]::before { background: var(--burnish-warning, #ca8a04); }
        .card[data-status="error"]::before,
        .card[data-status="failing"]::before { background: var(--burnish-error, #dc2626); }
        .card[data-status="info"]::before { background: var(--burnish-info, #6366f1); }
        .card-header {
            padding: var(--burnish-space-md, 12px) var(--burnish-space-lg, 16px) var(--burnish-space-sm, 8px);
            display: flex; align-items: center; gap: 8px;
        }
        .card-title { font-size: var(--burnish-font-size-md, 14px); font-weight: 600; color: var(--burnish-text, #2D1F1F); flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .card-badge {
            font-size: var(--burnish-font-size-xs, 11px); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.5px;
            padding: 2px var(--burnish-space-sm, 8px); border-radius: 10px;
            flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
            line-height: 1.5;
            overflow-wrap: anywhere; word-break: break-word;
            max-height: 120px;
            overflow-y: auto;
        }
        .card-body h1, .card-body h2, .card-body h3, .card-body h4 {
            font-size: 13px; font-weight: 600; margin: 8px 0 4px; color: var(--burnish-text, #2D1F1F);
        }
        .card-body p { margin: 0 0 6px; }
        .card-body code {
            background: var(--burnish-surface-alt, #F8F5F5); padding: 1px 4px;
            border-radius: 3px; font-size: 12px;
        }
        .card-body ul, .card-body ol { margin: 4px 0; padding-left: 18px; }
        .card-body a { color: var(--burnish-link, #7C3030); }
        .card-meta {
            padding: var(--burnish-space-sm, 8px) var(--burnish-space-lg, 16px);
            border-top: 1px solid var(--burnish-border-light, #F0EAEA);
            display: flex; gap: var(--burnish-space-lg, 16px); flex-wrap: wrap;
        }
        .meta-item { font-size: var(--burnish-font-size-sm, 12px); }
        .meta-label { color: var(--burnish-text-muted); margin-right: var(--burnish-space-xs, 4px); }
        .meta-value { color: var(--burnish-text); font-weight: 500; }
        .card-action {
            padding: var(--burnish-space-sm, 8px) var(--burnish-space-lg, 16px);
            border-top: 1px solid var(--burnish-border-light);
            font-size: var(--burnish-font-size-sm, 12px); color: var(--burnish-link, #7C3030);
            opacity: 0.6; transition: opacity var(--burnish-transition-fast);
            cursor: pointer;
        }
        .card-action:hover { background: rgba(139, 58, 58, 0.04); }
        .card:hover .card-action { opacity: 1; }
        .card-link {
            color: var(--burnish-link, #7C3030);
            text-decoration: none;
            font-weight: 500;
        }
        .card-link:hover { text-decoration: underline; }
        .card-links {
            padding: var(--burnish-space-xs, 4px) var(--burnish-space-lg, 16px) var(--burnish-space-sm, 8px);
            display: flex; gap: 6px; flex-wrap: wrap;
        }
        .link-btn {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 2px 8px; border: 1px solid var(--burnish-border, #E5DDDD);
            border-radius: 3px; font-size: 11px; text-decoration: none;
            color: var(--burnish-link, #7C3030); background: none;
            cursor: pointer; transition: all 0.15s ease;
        }
        .link-btn:hover {
            background: rgba(139, 58, 58, 0.06);
            border-color: var(--burnish-link, #7C3030);
        }
        .link-icon { font-size: 10px; }
        .error-state {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 60px; padding: var(--burnish-space-lg);
            color: var(--burnish-text-muted); font-size: var(--burnish-font-size-base);
        }
    `;

    declare title: string;
    declare status: string;
    declare 'status-label': string;
    declare body: string;
    declare meta: string;
    declare 'item-id': string;
    declare _parseError: boolean;
    declare _expanded: boolean;

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

    private _toggleExpand(e: Event) {
        e.stopPropagation();
        this._expanded = !this._expanded;
        if (this._expanded) {
            this.setAttribute('expanded', '');
        } else {
            this.removeAttribute('expanded');
        }
    }

    private _renderMarkdown(text: string): string {
        // Simple markdown → HTML (no external library needed)
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // escape HTML
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_: string, text: string, url: string) => {
                if (/^https?:\/\//i.test(url)) {
                    return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
                }
                return text;
            })
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>')
            .replace(/\n{2,}/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>').replace(/$/, '</p>')
            .replace(/<p><\/p>/g, '');
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
        try {
            const parsed = JSON.parse(this.meta || '[]');
            if (Array.isArray(parsed)) {
                metaData = parsed;
            } else if (parsed && typeof parsed === 'object') {
                metaData = Object.entries(parsed).map(([label, value]) => ({ label, value: String(value) }));
            }
        } catch { this._parseError = true; return; }

        const s = this.status || 'muted';
        const badgeText = (this['status-label'] || s).toUpperCase();
        return html`
            <div class="card" data-status="${statusColor}" role="article" aria-label="${this.title || ''}"
                 @click=${this._handleClick} @keydown=${this._handleKeydown}>
                <div class="card-header">
                    <span class="card-title">${this.title}</span>
                    <span class="card-badge" data-status="${statusColor}">${badgeText}</span>
                    <button class="expand-btn" @click=${this._toggleExpand} title="${this._expanded ? 'Collapse' : 'Expand'}">
                        ${this._expanded ? '↙' : '↗'}
                    </button>
                </div>
                ${this.body ? html`<div class="card-body">${unsafeHTML(this._renderMarkdown(this.body))}</div>` : ''}
                ${(() => {
                    const regularMeta = metaData.filter(m => !this._isUrl(m.value));
                    const linkMeta = metaData.filter(m => this._isUrl(m.value));
                    return html`
                        ${regularMeta.length > 0 ? html`
                            <div class="card-meta">
                                ${regularMeta.map(m => html`
                                    <span class="meta-item">
                                        <span class="meta-label">${m.label}:</span>
                                        <span class="meta-value">${m.value}</span>
                                    </span>
                                `)}
                            </div>
                        ` : ''}
                        ${linkMeta.length > 0 ? html`
                            <div class="card-links">
                                ${linkMeta.map(m => html`
                                    <a class="link-btn" href="${m.value.startsWith('http') ? m.value : 'https://' + m.value}"
                                       target="_blank" rel="noopener" title="${m.value}">
                                        <span class="link-icon">🔗</span> ${m.label}
                                    </a>
                                `)}
                            </div>
                        ` : ''}
                    `;
                })()}
                ${this['item-id'] ? html`<div class="card-action" role="button" tabindex="0">Explore \u2192</div>` : ''}
            </div>
        `;
    }
}

customElements.define('burnish-card', BurnishCard);
