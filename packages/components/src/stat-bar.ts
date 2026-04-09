import { LitElement, html, css } from 'lit';
import { resolveStatusColor } from './status-colors.js';

export class BurnishStatBar extends LitElement {
    static properties = {
        items: { type: String },
        variant: { type: String },
        _activeFilter: { state: true },
    };

    static styles = css`
        :host { display: inline-flex; min-width: 0; }
        .stat-bar { display: flex; flex-direction: row; align-items: center; gap: var(--burnish-space-md, 12px); flex-wrap: nowrap; }
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

    constructor() {
        super();
        this._activeFilter = null;
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
