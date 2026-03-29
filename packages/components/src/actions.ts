import { LitElement, html, css } from 'lit';

interface Action {
    label: string;
    action: 'read' | 'write';
    prompt: string;
    icon?: string;
}

export class McpuiActions extends LitElement {
    static properties = {
        actions: { type: String },
    };

    static styles = css`
        :host { display: block; width: 100%; min-width: 0; }
        .actions-bar {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            padding: 12px 0 4px;
        }
        .action-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            font-family: inherit;
            line-height: 1;
        }
        .action-btn[data-action="read"] {
            background: var(--mcpui-surface, #fff);
            border: 1px solid var(--mcpui-border, #e5e7eb);
            color: var(--mcpui-text, #1f2937);
        }
        .action-btn[data-action="read"]:hover {
            border-color: var(--mcpui-accent, #4f6df5);
            color: var(--mcpui-accent, #4f6df5);
            background: rgba(79, 109, 245, 0.04);
        }
        .action-btn[data-action="write"] {
            background: var(--mcpui-surface, #fff);
            border: 1px solid var(--mcpui-border-warning, #fef9c3);
            color: var(--mcpui-text, #1f2937);
        }
        .action-btn[data-action="write"]:hover {
            border-color: var(--mcpui-warning, #eab308);
            background: rgba(234, 179, 8, 0.04);
        }
        .action-icon {
            font-size: 14px;
            line-height: 1;
        }
    `;

    declare actions: string;

    private _getActions(): Action[] {
        try { return JSON.parse(this.actions || '[]'); }
        catch { return []; }
    }

    private _handleClick(action: Action) {
        this.dispatchEvent(new CustomEvent('mcpui-action', {
            detail: {
                label: action.label,
                action: action.action,
                prompt: action.prompt,
            },
            bubbles: true,
            composed: true,
        }));
    }

    private _getIcon(icon?: string): string {
        const icons: Record<string, string> = {
            comment: '\uD83D\uDCAC',
            edit: '\u270F\uFE0F',
            delete: '\uD83D\uDDD1\uFE0F',
            refresh: '\uD83D\uDD04',
            tag: '\uD83C\uDFF7\uFE0F',
            assign: '\uD83D\uDC64',
            close: '\u2716',
            open: '\u2714',
            list: '\uD83D\uDCCB',
            view: '\uD83D\uDC41\uFE0F',
            add: '\u2795',
            search: '\uD83D\uDD0D',
            download: '\u2B07\uFE0F',
            copy: '\uD83D\uDCCB',
            move: '\u27A1\uFE0F',
            info: '\u2139\uFE0F',
        };
        return icons[icon || ''] || '';
    }

    render() {
        const actions = this._getActions();
        if (actions.length === 0) return html``;

        return html`
            <div class="actions-bar">
                ${actions.map(a => html`
                    <button class="action-btn" data-action="${a.action}"
                            @click=${() => this._handleClick(a)}
                            title="${a.prompt}">
                        ${a.icon ? html`<span class="action-icon">${this._getIcon(a.icon)}</span>` : ''}
                        ${a.label}
                    </button>
                `)}
            </div>
        `;
    }
}

customElements.define('mcpui-actions', McpuiActions);
