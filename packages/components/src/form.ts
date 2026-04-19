import { LitElement, html, css, nothing } from 'lit';

interface FormField {
    key: string;
    label: string;
    type?: 'text' | 'textarea' | 'number' | 'select';
    required?: boolean;
    placeholder?: string;
    value?: string;
    options?: Array<{ value: string; label: string }>;
    lookup?: { prompt: string; placeholder?: string };
    array?: boolean;
}

interface LookupResult {
    value: string;
    label: string;
}

export class BurnishForm extends LitElement {
    static properties = {
        title: { type: String },
        'tool-id': { type: String, attribute: 'tool-id' },
        fields: { type: String },
        _status: { state: true },
        _statusMsg: { state: true },
        _lookupResults: { state: true },
        _lookupField: { state: true },
        _lookupLoading: { state: true },
        _lookupStatus: { state: true },
    };

    static styles = css`
        :host { display: block; width: 100%; min-width: 0; }
        .form-container {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 8px);
            box-shadow: var(--burnish-shadow-sm);
            overflow: hidden;
        }
        .form-header {
            padding: var(--burnish-space-md, 12px) var(--burnish-space-lg, 16px);
            font-size: var(--burnish-font-size-md, 14px);
            font-weight: 600;
            border-bottom: 1px solid var(--burnish-border-light, #F0EAEA);
            display: flex; align-items: center; gap: 8px;
        }
        .form-icon { width: 18px; height: 18px; color: var(--burnish-accent, #8B3A3A); }
        .form-body { padding: var(--burnish-space-lg, 16px); }
        .form-field { margin-bottom: var(--burnish-space-md, 12px); }
        .form-field:last-of-type { margin-bottom: var(--burnish-space-lg, 16px); }
        .form-label {
            display: block; font-size: var(--burnish-font-size-sm, 12px);
            font-weight: 500; color: var(--burnish-text-secondary, #6B5A5A);
            margin-bottom: var(--burnish-space-xs, 4px);
        }
        .form-required { color: var(--burnish-error, #ef4444); margin-left: 2px; }
        .form-input, .form-textarea, .form-select {
            width: 100%; padding: 8px 12px;
            border: 1px solid var(--burnish-input-border, var(--burnish-border, #E5DDDD)); border-radius: 6px;
            font-size: var(--burnish-font-size-base, 13px); font-family: inherit;
            color: var(--burnish-text, #2D1F1F); background: var(--burnish-input-bg, var(--burnish-surface, #fff));
            box-sizing: border-box; transition: border-color 0.15s ease;
        }
        .form-input:focus, .form-textarea:focus, .form-select:focus {
            outline: none; border-color: var(--burnish-accent, #8B3A3A);
            box-shadow: 0 0 0 3px rgba(139, 58, 58, 0.1);
        }
        .form-textarea { min-height: 80px; resize: vertical; }

        /* Lookup styles */
        .form-input-row { display: flex; gap: 4px; }
        .form-input-row .form-input { flex: 1; }
        .form-lookup-btn {
            padding: 6px 12px; border: 1px solid var(--burnish-border, #E5DDDD); border-radius: 6px;
            background: var(--burnish-surface-alt, #F3EDED); cursor: pointer;
            color: var(--burnish-text-muted, #6B5A5A); font-size: 14px;
            display: flex; align-items: center; transition: all 0.15s ease;
            flex-shrink: 0; min-height: 32px;
        }
        .form-lookup-btn:hover {
            background: var(--burnish-border-light, #F0EAEA);
            border-color: var(--burnish-accent, #8B3A3A); color: var(--burnish-accent, #8B3A3A);
        }
        .form-lookup-btn.loading { opacity: 0.5; pointer-events: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .form-lookup-btn.loading svg { animation: spin 1s linear infinite; }
        .form-lookup-results {
            border: 1px solid var(--burnish-input-border, var(--burnish-border, #E5DDDD)); border-radius: 6px;
            margin-top: 4px; max-height: 200px; overflow-y: auto;
            background: var(--burnish-input-bg, var(--burnish-surface, #fff)); box-shadow: var(--burnish-shadow-md);
        }
        .form-lookup-item {
            padding: 8px 12px; cursor: pointer; font-size: 13px;
            border-bottom: 1px solid var(--burnish-border-light, #F0EAEA);
            transition: background 0.1s ease;
        }
        .form-lookup-item:hover { background: rgba(139, 58, 58, 0.06); }
        .form-lookup-item:last-child { border-bottom: none; }
        .form-lookup-item-value { font-weight: 500; color: var(--burnish-text, #2D1F1F); }
        .form-lookup-item-label { font-size: 11px; color: var(--burnish-text-muted, #9C8F8F); margin-left: 6px; }
        .form-lookup-empty {
            padding: 12px; text-align: center; font-size: 12px;
            color: var(--burnish-text-muted, #9C8F8F);
        }
        .form-lookup-loading {
            padding: 12px; text-align: center; font-size: 12px;
            color: var(--burnish-accent, #8B3A3A);
        }

        /* Actions */
        .form-actions {
            display: flex; gap: 8px; justify-content: flex-end;
            padding-top: var(--burnish-space-sm, 8px);
            border-top: 1px solid var(--burnish-border-light, #F0EAEA);
        }
        .form-btn {
            padding: 8px 20px; border-radius: 6px;
            font-size: var(--burnish-font-size-base, 13px); font-weight: 500;
            cursor: pointer; border: none; transition: all 0.15s ease;
        }
        .form-btn-submit { background: var(--burnish-accent, #8B3A3A); color: white; }
        .form-btn-submit:hover { filter: brightness(1.1); }
        .form-btn-reset {
            background: var(--burnish-surface-alt, #F8F5F5);
            color: var(--burnish-text-secondary, #6B5A5A);
        }
        .form-btn-reset:hover { background: var(--burnish-border, #E5DDDD); }
        .form-status { font-size: var(--burnish-font-size-sm, 12px); padding: 6px 0; text-align: center; }
        .form-status.error { color: var(--burnish-error, #ef4444); }
        .form-status.success { color: var(--burnish-success, #22c55e); }
    `;

    declare title: string;
    declare 'tool-id': string;
    declare fields: string;
    declare _status: string;
    declare _statusMsg: string;
    declare _lookupResults: LookupResult[];
    declare _lookupField: string;
    declare _lookupLoading: boolean;
    declare _lookupStatus: string;

    constructor() {
        super();
        this._status = '';
        this._statusMsg = '';
        this._lookupResults = [];
        this._lookupField = '';
        this._lookupLoading = false;
        this._lookupStatus = 'Searching...';
    }

    private _getFields(): FormField[] {
        try { return JSON.parse(this.fields || '[]'); }
        catch { return []; }
    }

    /** Called externally to populate lookup results for a field */
    setLookupResults(fieldKey: string, results: LookupResult[]) {
        this._lookupField = fieldKey;
        this._lookupResults = results || [];
        this._lookupLoading = false;
    }

    private _handleLookup(field: FormField) {
        if (!field.lookup) return;
        this._lookupField = field.key;
        this._lookupResults = [];
        this._lookupLoading = true;
        this._lookupStatus = 'Searching...';

        // Get current input value to use as search query
        const input = this.shadowRoot?.querySelector(`[data-key="${field.key}"]`) as HTMLInputElement | null;
        const query = input?.value?.trim() || '';

        // Gather all other field values as context for contextual lookups
        const fields = this._getFields();
        const context: Record<string, string> = {};
        for (const f of fields) {
            if (f.key === field.key) continue;
            const el = this.shadowRoot?.querySelector(`[data-key="${f.key}"]`) as HTMLInputElement | null;
            if (el?.value?.trim()) context[f.key] = el.value.trim();
        }

        this.dispatchEvent(new CustomEvent('burnish-form-lookup', {
            detail: {
                fieldKey: field.key,
                prompt: field.lookup.prompt,
                query,
                context,
                toolId: this['tool-id'],
            },
            bubbles: true,
            composed: true,
        }));
    }

    /** Update the loading status text (called externally for transparency) */
    setLookupStatus(status: string) {
        this._lookupStatus = status;
    }

    private _selectLookupResult(fieldKey: string, value: string) {
        const input = this.shadowRoot?.querySelector(`[data-key="${fieldKey}"]`) as HTMLInputElement | null;
        if (input) input.value = value;
        this._lookupField = '';
        this._lookupResults = [];
    }

    private _closeLookup() {
        this._lookupField = '';
        this._lookupResults = [];
        this._lookupLoading = false;
    }

    private _handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
            this._handleSubmit(e);
        }
    }

    private _handleSubmit(e: Event) {
        e.preventDefault();
        const fields = this._getFields();
        const values: Record<string, string | string[]> = {};
        for (const field of fields) {
            const input = this.shadowRoot?.querySelector(`[data-key="${field.key}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
            if (input) {
                if (field.array) {
                    values[field.key] = input.value
                        .split(',')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);
                } else {
                    values[field.key] = input.value;
                }
            }
        }
        for (const field of fields) {
            const v = values[field.key];
            const isEmpty = Array.isArray(v) ? v.length === 0 : !v?.trim();
            if (field.required && isEmpty) {
                this._status = 'error';
                this._statusMsg = `${field.label} is required`;
                return;
            }
        }
        this._status = '';
        this._statusMsg = '';
        this.dispatchEvent(new CustomEvent('burnish-form-submit', {
            detail: { toolId: this['tool-id'], values },
            bubbles: true, composed: true,
        }));
    }

    private _handleReset() {
        const inputs = this.shadowRoot?.querySelectorAll('input, textarea, select');
        inputs?.forEach((el: Element) => { (el as HTMLInputElement).value = ''; });
        this._status = '';
        this._statusMsg = '';
        this._closeLookup();
    }

    private _renderField(f: FormField) {
        const hasLookup = !!f.lookup;
        const isLookupActive = this._lookupField === f.key;

        const searchIcon = html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/>
            <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;

        const loadingIcon = html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5a6.5 6.5 0 105.196 2.597" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;

        if (f.type === 'textarea') {
            return html`<textarea class="form-textarea" data-key="${f.key}"
                placeholder="${f.placeholder || ''}" ?required=${f.required}>${f.value || ''}</textarea>`;
        }

        if (f.type === 'select' && f.options) {
            return html`<select class="form-select" data-key="${f.key}" ?required=${f.required}>
                <option value="">Select...</option>
                ${f.options.map(o => html`<option value="${o.value}">${o.label}</option>`)}
            </select>`;
        }

        const input = html`<input class="form-input" type="${f.type === 'number' ? 'number' : 'text'}"
            data-key="${f.key}" placeholder="${f.placeholder || ''}" .value=${f.value || ''} ?required=${f.required} />`;

        if (!hasLookup) return input;

        // For lookup fields, use an input with Enter key support
        const lookupInput = html`<input class="form-input" type="${f.type === 'number' ? 'number' : 'text'}"
            data-key="${f.key}" placeholder="${f.placeholder || ''}" .value=${f.value || ''} ?required=${f.required}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this._handleLookup(f); } }} />`;

        return html`
            <div class="form-input-row">
                ${lookupInput}
                <button class="form-lookup-btn ${this._lookupLoading && isLookupActive ? 'loading' : ''}"
                        @click=${() => this._handleLookup(f)}
                        title="${f.lookup!.placeholder || 'Search'}" type="button">
                    ${this._lookupLoading && isLookupActive ? loadingIcon : searchIcon}
                </button>
            </div>
            ${isLookupActive ? this._renderLookupDropdown(f.key) : nothing}
        `;
    }

    private _renderLookupDropdown(fieldKey: string) {
        if (this._lookupLoading) {
            return html`<div class="form-lookup-results"><div class="form-lookup-loading">${this._lookupStatus || 'Searching...'}</div></div>`;
        }
        if (this._lookupResults.length === 0) {
            return html`<div class="form-lookup-results"><div class="form-lookup-empty">No results found</div></div>`;
        }
        return html`
            <div class="form-lookup-results">
                ${this._lookupResults.map(r => html`
                    <div class="form-lookup-item" @click=${() => this._selectLookupResult(fieldKey, r.value)}>
                        <span class="form-lookup-item-value">${r.value}</span>
                        ${r.label !== r.value ? html`<span class="form-lookup-item-label">${r.label}</span>` : nothing}
                    </div>
                `)}
            </div>
        `;
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
                <div class="form-body" @keydown=${this._handleKeydown}>
                    ${fields.map(f => html`
                        <div class="form-field">
                            <label class="form-label">
                                ${f.label}
                                ${f.required ? html`<span class="form-required">*</span>` : ''}
                                ${f.lookup ? html`<span style="font-weight:400; color: var(--burnish-text-muted)"> — searchable</span>` : nothing}
                            </label>
                            ${this._renderField(f)}
                        </div>
                    `)}
                    ${this._statusMsg ? html`<div class="form-status ${this._status}">${this._statusMsg}</div>` : nothing}
                    <div class="form-actions">
                        <button class="form-btn form-btn-reset" @click=${this._handleReset} type="button">Clear</button>
                        <button class="form-btn form-btn-submit" @click=${this._handleSubmit} type="button">Submit</button>
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('burnish-form', BurnishForm);
