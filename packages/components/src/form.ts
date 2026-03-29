import { LitElement, html, css } from 'lit';

interface FormField {
    key: string;
    label: string;
    type?: 'text' | 'textarea' | 'number' | 'select';
    required?: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
}

export class McpuiForm extends LitElement {
    static properties = {
        title: { type: String },
        'tool-id': { type: String, attribute: 'tool-id' },
        fields: { type: String },
        _status: { state: true },
        _statusMsg: { state: true },
    };

    static styles = css`
        :host { display: block; width: 100%; min-width: 0; }
        .form-container {
            background: var(--mcpui-surface, #fff);
            border-radius: var(--mcpui-radius-md, 8px);
            box-shadow: var(--mcpui-shadow-sm);
            overflow: hidden;
        }
        .form-header {
            padding: var(--mcpui-space-md, 12px) var(--mcpui-space-lg, 16px);
            font-size: var(--mcpui-font-size-md, 14px);
            font-weight: 600;
            border-bottom: 1px solid var(--mcpui-border-light, #f3f4f6);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .form-icon {
            width: 18px; height: 18px; color: var(--mcpui-accent, #4f6df5);
        }
        .form-body {
            padding: var(--mcpui-space-lg, 16px);
        }
        .form-field {
            margin-bottom: var(--mcpui-space-md, 12px);
        }
        .form-field:last-of-type { margin-bottom: var(--mcpui-space-lg, 16px); }
        .form-label {
            display: block;
            font-size: var(--mcpui-font-size-sm, 12px);
            font-weight: 500;
            color: var(--mcpui-text-secondary, #6b7280);
            margin-bottom: var(--mcpui-space-xs, 4px);
        }
        .form-required {
            color: var(--mcpui-error, #ef4444);
            margin-left: 2px;
        }
        .form-input, .form-textarea, .form-select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--mcpui-border, #e5e7eb);
            border-radius: 6px;
            font-size: var(--mcpui-font-size-base, 13px);
            font-family: inherit;
            color: var(--mcpui-text, #1f2937);
            background: var(--mcpui-surface, #fff);
            box-sizing: border-box;
            transition: border-color 0.15s ease;
        }
        .form-input:focus, .form-textarea:focus, .form-select:focus {
            outline: none;
            border-color: var(--mcpui-accent, #4f6df5);
            box-shadow: 0 0 0 3px rgba(79, 109, 245, 0.1);
        }
        .form-textarea {
            min-height: 80px;
            resize: vertical;
        }
        .form-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            padding-top: var(--mcpui-space-sm, 8px);
            border-top: 1px solid var(--mcpui-border-light, #f3f4f6);
        }
        .form-btn {
            padding: 8px 20px;
            border-radius: 6px;
            font-size: var(--mcpui-font-size-base, 13px);
            font-weight: 500;
            cursor: pointer;
            border: none;
            transition: all 0.15s ease;
        }
        .form-btn-submit {
            background: var(--mcpui-accent, #4f6df5);
            color: white;
        }
        .form-btn-submit:hover { filter: brightness(1.1); }
        .form-btn-reset {
            background: var(--mcpui-surface-alt, #f5f6f8);
            color: var(--mcpui-text-secondary, #6b7280);
        }
        .form-btn-reset:hover { background: var(--mcpui-border, #e5e7eb); }
        .form-status {
            font-size: var(--mcpui-font-size-sm, 12px);
            padding: 6px 0;
            text-align: center;
        }
        .form-status.error { color: var(--mcpui-error, #ef4444); }
        .form-status.success { color: var(--mcpui-success, #22c55e); }
    `;

    declare title: string;
    declare 'tool-id': string;
    declare fields: string;
    declare _status: string;
    declare _statusMsg: string;

    constructor() {
        super();
        this._status = '';
        this._statusMsg = '';
    }

    private _getFields(): FormField[] {
        try { return JSON.parse(this.fields || '[]'); }
        catch { return []; }
    }

    private _handleSubmit(e: Event) {
        e.preventDefault();
        const fields = this._getFields();
        const values: Record<string, string> = {};
        for (const field of fields) {
            const input = this.shadowRoot?.querySelector(`[data-key="${field.key}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
            if (input) values[field.key] = input.value;
        }

        // Check required fields
        for (const field of fields) {
            if (field.required && !values[field.key]?.trim()) {
                this._status = 'error';
                this._statusMsg = `${field.label} is required`;
                return;
            }
        }

        this._status = '';
        this._statusMsg = '';

        this.dispatchEvent(new CustomEvent('mcpui-form-submit', {
            detail: { toolId: this['tool-id'], values },
            bubbles: true,
            composed: true,
        }));
    }

    private _handleReset() {
        const inputs = this.shadowRoot?.querySelectorAll('input, textarea, select');
        inputs?.forEach((el: Element) => { (el as HTMLInputElement).value = ''; });
        this._status = '';
        this._statusMsg = '';
    }

    render() {
        const fields = this._getFields();

        return html`
            <div class="form-container">
                <div class="form-header">
                    <svg class="form-icon" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M17 6V5a2 2 0 00-2-2H5a2 2 0 00-2 2v1h14zm0 2H3v7a2 2 0 002 2h10a2 2 0 002-2V8zM6 12h3v2H6v-2z"/>
                    </svg>
                    ${this.title || 'Form'}
                </div>
                <div class="form-body">
                    ${fields.map(f => html`
                        <div class="form-field">
                            <label class="form-label">
                                ${f.label}
                                ${f.required ? html`<span class="form-required">*</span>` : ''}
                            </label>
                            ${f.type === 'textarea'
                                ? html`<textarea class="form-textarea" data-key="${f.key}"
                                            placeholder="${f.placeholder || ''}"
                                            ?required=${f.required}></textarea>`
                                : f.type === 'select' && f.options
                                    ? html`<select class="form-select" data-key="${f.key}" ?required=${f.required}>
                                            <option value="">Select...</option>
                                            ${f.options.map(o => html`<option value="${o.value}">${o.label}</option>`)}
                                        </select>`
                                    : html`<input class="form-input" type="${f.type === 'number' ? 'number' : 'text'}"
                                            data-key="${f.key}"
                                            placeholder="${f.placeholder || ''}"
                                            ?required=${f.required} />`
                            }
                        </div>
                    `)}
                    ${this._statusMsg ? html`<div class="form-status ${this._status}">${this._statusMsg}</div>` : ''}
                    <div class="form-actions">
                        <button class="form-btn form-btn-reset" @click=${this._handleReset} type="button">Clear</button>
                        <button class="form-btn form-btn-submit" @click=${this._handleSubmit} type="button">Submit</button>
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('mcpui-form', McpuiForm);
