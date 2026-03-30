import { LitElement, html, css } from 'lit';
export class BurnishMetric extends LitElement {
    static { this.properties = {
        label: { type: String },
        value: { type: String },
        unit: { type: String },
        trend: { type: String },
    }; }
    static { this.styles = css `
        :host { display: block; }
        .metric {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 8px);
            box-shadow: var(--burnish-shadow-sm);
            padding: var(--burnish-space-lg, 16px) var(--burnish-space-xl, 20px);
            display: flex; align-items: center; gap: var(--burnish-space-lg, 16px);
        }
        .metric-body { flex: 1; }
        .metric-label {
            font-size: var(--burnish-font-size-sm, 12px); color: var(--burnish-text-secondary);
            text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: var(--burnish-space-xs, 4px);
        }
        .metric-value {
            font-size: var(--burnish-font-size-2xl, 24px); font-weight: 700; color: var(--burnish-text);
        }
        .metric-unit {
            font-size: var(--burnish-font-size-md, 14px); font-weight: 400;
            color: var(--burnish-text-secondary); margin-left: var(--burnish-space-xs, 4px);
        }
        .metric-trend {
            font-size: var(--burnish-font-size-lg, 16px); font-weight: 600;
            display: flex; align-items: center;
        }
        .metric-trend[data-trend="up"] { color: var(--burnish-success); }
        .metric-trend[data-trend="down"] { color: var(--burnish-error); }
        .metric-trend[data-trend="flat"] { color: var(--burnish-text-muted); }
    `; }
    _trendIcon() {
        if (this.trend === 'up')
            return '\u2191';
        if (this.trend === 'down')
            return '\u2193';
        if (this.trend === 'flat')
            return '\u2192';
        return '';
    }
    render() {
        return html `
            <div class="metric">
                <div class="metric-body">
                    ${this.label ? html `<div class="metric-label">${this.label}</div>` : ''}
                    <div>
                        <span class="metric-value">${this.value}</span>
                        ${this.unit ? html `<span class="metric-unit">${this.unit}</span>` : ''}
                    </div>
                </div>
                ${this.trend ? html `<span class="metric-trend" data-trend="${this.trend}">${this._trendIcon()}</span>` : ''}
            </div>
        `;
    }
}
customElements.define('burnish-metric', BurnishMetric);
//# sourceMappingURL=metric.js.map