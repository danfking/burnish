import { LitElement, html, css } from 'lit';
import { resolveStatusColor } from './status-colors.js';

export class BurnishStatBar extends LitElement {
    static properties = {
        items: { type: String },
        variant: { type: String },
        _activeFilter: { state: true },
    };

    static styles = css`
        :host { display: inline-flex; min-width: 0; max-width: 100%; position: relative; }
        :host::after {
            content: '';
            position: absolute;
            right: 0; top: 0; bottom: 0;
            width: 32px;
            background: linear-gradient(to right, transparent, var(--burnish-surface-alt, #F8F5F5));
            pointer-events: none;
            opacity: 0;
            transition: opacity var(--burnish-transition-fast, 150ms);
        }
        :host([overflowing])::after { opacity: 1; }
        .stat-bar { display: flex; flex-direction: row; align-items: center; gap: var(--burnish-space-md, 12px); flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
        .stat-chip {
            display: flex; align-items: center; gap: var(--burnish-space-sm, 8px);
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-pill, 20px);
            padding: var(--burnish-space-xs, 4px) var(--burnish-space-md, 12px);
            box-shadow: var(--burnish-shadow-sm);
            font-size: var(--burnish-font-size-md, 14px);
            transition: all var(--burnish-transition-fast);
            cursor: pointer;
            user-select: none;
            border: 2px solid transparent;
        }
        .stat-chip:hover { transform: translateY(-1px); box-shadow: var(--burnish-shadow-md); }
        .stat-chip.active {
            border-color: var(--burnish-accent, #8B3A3A);
            box-shadow: var(--burnish-shadow-md);
        }
        .stat-chip.dimmed { opacity: 0.4; }
        .stat-dot { width: 10px; height: 10px; border-radius: var(--burnish-radius-round, 50%); }
        .stat-value { font-weight: 700; font-size: var(--burnish-font-size-xl, 18px); margin-right: var(--burnish-space-xs, 4px); }
        .stat-label { color: var(--burnish-text-secondary, #6B5A5A); }
        :host([variant="compact"]) .stat-dot { display: none; }
    `;

    declare items: string;
    declare variant: string;
    declare _activeFilter: string | null;

    private _resizeObserver: ResizeObserver | null = null;

    constructor() {
        super();
        this._activeFilter = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._resizeObserver = new ResizeObserver(() => this._checkOverflow());
        this._resizeObserver.observe(this);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
    }

    private _scrollBound = false;

    protected updated() {
        this._checkOverflow();
        if (!this._scrollBound) {
            const bar = this.shadowRoot?.querySelector('.stat-bar');
            if (bar) {
                bar.addEventListener('scroll', () => this._checkOverflow(), { passive: true });
                this._scrollBound = true;
            }
        }
    }

    private _checkOverflow() {
        requestAnimationFrame(() => {
            const bar = this.shadowRoot?.querySelector('.stat-bar');
            if (!bar) return;
            const hasMore = bar.scrollWidth > bar.clientWidth + bar.scrollLeft + 1;
            this.toggleAttribute('overflowing', hasMore);
        });
    }

    private _handleClick(label: string) {
        // Toggle: click same chip to deselect
        this._activeFilter = this._activeFilter === label ? null : label;

        this.dispatchEvent(new CustomEvent('burnish-filter', {
            detail: { filter: this._activeFilter },
            bubbles: true,
            composed: true,
        }));
    }

    render() {
        let data: Array<{ label: string; value: string | number; color?: string }> = [];
        try { data = JSON.parse(this.items || '[]'); } catch { /* graceful */ }

        return html`
            <div class="stat-bar">
                ${data.map(item => {
                    const isActive = this._activeFilter === item.label;
                    const isDimmed = this._activeFilter && !isActive;
                    return html`
                        <div class="stat-chip ${isActive ? 'active' : ''} ${isDimmed ? 'dimmed' : ''}"
                             @click=${() => this._handleClick(item.label)}>
                            <span class="stat-dot" style="background:${resolveStatusColor(item.color)}"></span>
                            <span class="stat-value">${item.value}</span>
                            <span class="stat-label">${item.label}</span>
                        </div>
                    `;
                })}
            </div>
        `;
    }
}

customElements.define('burnish-stat-bar', BurnishStatBar);
