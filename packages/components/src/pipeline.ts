import { LitElement, html, css } from 'lit';

export interface PipelineStep {
    server: string;
    tool: string;
    status: 'pending' | 'running' | 'success' | 'error';
}

/**
 * <burnish-pipeline> — Real-time tool chain visualization.
 * Shows a horizontal pipeline of MCP tool call steps with live status indicators.
 *
 * Usage:
 *   <burnish-pipeline steps='[{"server":"fs","tool":"read_file","status":"success"},...]'></burnish-pipeline>
 */
export class BurnishPipeline extends LitElement {
    static properties = {
        steps: { type: String },
        _parsed: { state: true },
    };

    static styles = css`
        :host {
            display: block;
            width: 100%;
            min-width: 0;
        }
        .pipeline {
            display: flex;
            align-items: center;
            gap: 0;
            padding: 10px 14px;
            background: var(--burnish-surface-alt, #F8F5F5);
            border-radius: var(--burnish-radius-md, 8px);
            border: 1px solid var(--burnish-border, #E5DDDD);
            overflow-x: auto;
            scrollbar-width: thin;
        }
        .pipeline::-webkit-scrollbar {
            height: 4px;
        }
        .pipeline::-webkit-scrollbar-thumb {
            background: var(--burnish-border, #E5DDDD);
            border-radius: 2px;
        }
        .step {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: var(--burnish-radius-sm, 4px);
            background: var(--burnish-surface, #fff);
            border: 1px solid var(--burnish-border, #E5DDDD);
            min-width: 0;
            flex-shrink: 0;
            transition: border-color var(--burnish-transition-fast),
                        box-shadow var(--burnish-transition-fast);
        }
        .step[data-status="running"] {
            border-color: var(--burnish-accent, #8B3A3A);
            box-shadow: 0 0 0 1px var(--burnish-accent, #8B3A3A);
        }
        .step[data-status="success"] {
            border-color: var(--burnish-success, #22c55e);
        }
        .step[data-status="error"] {
            border-color: var(--burnish-error, #ef4444);
        }
        .step-indicator {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 10px;
            line-height: 1;
        }
        .step-indicator[data-status="pending"] {
            background: var(--burnish-border, #E5DDDD);
        }
        .step-indicator[data-status="running"] {
            background: var(--burnish-accent, #8B3A3A);
            animation: pulse-indicator 1.2s ease-in-out infinite;
        }
        .step-indicator[data-status="success"] {
            background: var(--burnish-success, #22c55e);
            color: #fff;
        }
        .step-indicator[data-status="error"] {
            background: var(--burnish-error, #ef4444);
            color: #fff;
        }
        @keyframes pulse-indicator {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(0.85); }
        }
        .step-info {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }
        .step-server {
            font-size: 10px;
            color: var(--burnish-text-muted, #9C8F8F);
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .step-tool {
            font-size: 12px;
            font-weight: 600;
            color: var(--burnish-text, #2D1F1F);
            line-height: 1.3;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-family: var(--burnish-font-mono, monospace);
        }
        .connector {
            display: flex;
            align-items: center;
            padding: 0 4px;
            flex-shrink: 0;
        }
        .connector svg {
            color: var(--burnish-border, #E5DDDD);
        }
        .connector[data-done] svg {
            color: var(--burnish-success, #22c55e);
        }
    `;

    declare steps: string;
    declare _parsed: PipelineStep[];

    constructor() {
        super();
        this.steps = '[]';
        this._parsed = [];
    }

    willUpdate(changed: Map<string, unknown>) {
        if (changed.has('steps')) {
            try {
                this._parsed = JSON.parse(this.steps || '[]');
            } catch {
                this._parsed = [];
            }
        }
    }

    private _statusIcon(status: string) {
        if (status === 'success') return html`<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        if (status === 'error') return html`<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
        return '';
    }

    render() {
        if (!this._parsed.length) return html``;

        return html`
            <div class="pipeline" role="list" aria-label="Tool chain pipeline">
                ${this._parsed.map((step, i) => html`
                    ${i > 0 ? html`
                        <div class="connector" ?data-done=${this._parsed[i - 1].status === 'success'}>
                            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                                <path d="M0 6h12M9 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                    ` : ''}
                    <div class="step" data-status="${step.status}" role="listitem"
                         aria-label="${step.tool} on ${step.server}: ${step.status}">
                        <div class="step-indicator" data-status="${step.status}">
                            ${this._statusIcon(step.status)}
                        </div>
                        <div class="step-info">
                            <span class="step-server">${step.server}</span>
                            <span class="step-tool">${step.tool}</span>
                        </div>
                    </div>
                `)}
            </div>
        `;
    }
}

customElements.define('burnish-pipeline', BurnishPipeline);
