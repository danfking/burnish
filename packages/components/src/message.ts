import { LitElement, html, css } from 'lit';

// Marked.js expected as global for markdown rendering
declare const marked: any;

export class McpuiMessage extends LitElement {
    static properties = {
        role: { type: String },
        content: { type: String },
        streaming: { type: Boolean, reflect: true },
    };

    static styles = css`
        :host { display: block; margin-bottom: var(--mcpui-space-md, 12px); }
        .message {
            padding: var(--mcpui-space-sm, 8px) var(--mcpui-space-md, 12px);
            border-radius: var(--mcpui-radius-md, 8px);
            font-size: var(--mcpui-font-size-base, 13px);
            line-height: 1.5;
            max-width: 85%;
            word-wrap: break-word;
        }
        .message[data-role="user"] {
            background: var(--mcpui-accent, #4f6df5); color: white;
            margin-left: auto; border-bottom-right-radius: 2px;
        }
        .message[data-role="assistant"] {
            background: var(--mcpui-surface-alt, #f5f6f8); color: var(--mcpui-text);
            border-bottom-left-radius: 2px;
        }
        :host([streaming]) .message[data-role="assistant"] {
            background: var(--mcpui-surface-alt); opacity: 0.8;
        }
        .role-label {
            font-size: var(--mcpui-font-size-xs, 11px); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.5px;
            margin-bottom: var(--mcpui-space-xs, 4px);
            color: var(--mcpui-text-muted);
        }
        .message[data-role="user"] .role-label { color: rgba(255,255,255,0.7); }
        .content { overflow-wrap: break-word; }
        .content p { margin: 0 0 0.5em; }
        .content p:last-child { margin-bottom: 0; }
        .content code {
            background: rgba(0,0,0,0.06); padding: 1px 4px;
            border-radius: 3px; font-family: var(--mcpui-font-mono);
            font-size: 0.9em;
        }
        .message[data-role="user"] .content code { background: rgba(255,255,255,0.15); }
    `;

    declare role: string;
    declare content: string;
    declare streaming: boolean;

    private _renderContent(): string {
        const text = this.content || '';
        if (this.role === 'assistant' && typeof marked !== 'undefined') {
            try { return marked.parse(text); } catch { /* fall through */ }
        }
        // Escape HTML for safety
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    render() {
        const r = this.role || 'user';
        return html`
            <div class="message" data-role="${r}">
                <div class="role-label">${r}</div>
                <div class="content" .innerHTML=${this._renderContent()}></div>
            </div>
        `;
    }
}

customElements.define('mcpui-message', McpuiMessage);
