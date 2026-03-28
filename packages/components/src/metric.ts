import { LitElement, html, css } from 'lit';

export class McpuiMetric extends LitElement {
    static properties = {
        label: { type: String },
        value: { type: String },
        unit: { type: String },
        trend: { type: String },
    };

    static styles = css`
        :host { display: block; }
        .metric {
            background: var(--mcpui-surface, #fff);
            border-radius: var(--mcpui-radius-md, 8px);
            box-shadow: var(--mcpui-shadow-sm);
            padding: var(--mcpui-space-lg, 16px) var(--mcpui-space-xl, 20px);
            display: flex; align-items: center; gap: var(--mcpui-space-lg, 16px);
        }
        .metric-body { flex: 1; }
        .metric-label {
            font-size: var(--mcpui-font-size-sm, 12px); color: var(--mcpui-text-secondary);
            text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: var(--mcpui-space-xs, 4px);
        }
        .metric-value {
            font-size: var(--mcpui-font-size-2xl, 24px); font-weight: 700; color: var(--mcpui-text);
        }
        .metric-unit {
            font-size: var(--mcpui-font-size-md, 14px); font-weight: 400;
            color: var(--mcpui-text-secondary); margin-left: var(--mcpui-space-xs, 4px);
        }
        .metric-trend {
            font-size: var(--mcpui-font-size-lg, 16px); font-weight: 600;
            display: flex; align-items: center;
        }
        .metric-trend[data-trend="up"] { color: var(--mcpui-success); }
        .metric-trend[data-trend="down"] { color: var(--mcpui-error); }
        .metric-trend[data-trend="flat"] { color: var(--mcpui-text-muted); }
    `;

    declare label: string;
    declare value: string;
    declare unit: string;
    declare trend: string;

    private _trendIcon() {
        if (this.trend === 'up') return '\u2191';
        if (this.trend === 'down') return '\u2193';
        if (this.trend === 'flat') return '\u2192';
        return '';
    }

    render() {
        return html`
            <div class="metric">
                <div class="metric-body">
                    ${this.label ? html`<div class="metric-label">${this.label}</div>` : ''}
                    <div>
                        <span class="metric-value">${this.value}</span>
                        ${this.unit ? html`<span class="metric-unit">${this.unit}</span>` : ''}
                    </div>
                </div>
                ${this.trend ? html`<span class="metric-trend" data-trend="${this.trend}">${this._trendIcon()}</span>` : ''}
            </div>
        `;
    }
}

customElements.define('mcpui-metric', McpuiMetric);
