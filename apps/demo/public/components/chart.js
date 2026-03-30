import { LitElement, html, css } from 'lit';
export class BurnishChart extends LitElement {
    constructor() {
        super(...arguments);
        this._chart = null;
    }
    static { this.properties = {
        type: { type: String },
        config: { type: String },
    }; }
    static { this.styles = css `
        :host { display: block; margin: var(--burnish-space-lg, 16px) 0; }
        .chart-container {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 8px);
            box-shadow: var(--burnish-shadow-sm);
            padding: var(--burnish-space-lg, 16px);
            position: relative;
            height: var(--burnish-chart-height, 300px);
        }
        canvas { width: 100% !important; height: 100% !important; }
    `; }
    firstUpdated() { this._renderChart(); }
    updated(changed) {
        if (changed.has('config') || changed.has('type'))
            this._renderChart();
    }
    _renderChart() {
        const canvas = this.shadowRoot?.querySelector('canvas');
        if (!canvas || typeof Chart === 'undefined')
            return;
        if (this._chart)
            this._chart.destroy();
        let chartConfig;
        try {
            chartConfig = JSON.parse(this.config || '{}');
        }
        catch {
            return;
        }
        if (!chartConfig.type && this.type)
            chartConfig.type = this.type;
        chartConfig.options = {
            responsive: true,
            maintainAspectRatio: false,
            ...chartConfig.options,
        };
        try {
            this._chart = new Chart(canvas.getContext('2d'), chartConfig);
        }
        catch (e) {
            console.error('burnish-chart: render error', e);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
    render() {
        return html `<div class="chart-container"><canvas></canvas></div>`;
    }
}
customElements.define('burnish-chart', BurnishChart);
//# sourceMappingURL=chart.js.map