import { LitElement, html, css } from 'lit';

export class BurnishTable extends LitElement {
    static properties = {
        title: { type: String },
        columns: { type: String },
        rows: { type: String },
        'status-field': { type: String, attribute: 'status-field' },
    };

    static styles = css`
        :host { display: block; width: 100%; min-width: 0; }
        .table-container {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 8px);
            box-shadow: var(--burnish-shadow-sm);
            overflow: hidden;
        }
        .table-title {
            padding: var(--burnish-space-md, 12px) var(--burnish-space-lg, 16px);
            font-size: var(--burnish-font-size-md, 14px); font-weight: 600;
            border-bottom: 1px solid var(--burnish-border-light, #f3f4f6);
        }
        table { width: 100%; border-collapse: collapse; font-size: var(--burnish-font-size-base, 13px); }
        th {
            text-align: left; padding: 10px var(--burnish-space-lg, 16px);
            background: var(--burnish-surface-alt, #f5f6f8);
            color: var(--burnish-text-secondary); font-weight: 600;
            font-size: var(--burnish-font-size-sm, 12px); text-transform: uppercase;
            letter-spacing: 0.5px; border-bottom: 1px solid var(--burnish-border-light);
        }
        td {
            padding: 10px var(--burnish-space-lg, 16px);
            border-bottom: 1px solid var(--burnish-border-light, #f3f4f6);
            color: var(--burnish-text, #1f2937);
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--burnish-surface-hover, #f9fafb); }
        .status-success, .status-healthy { color: var(--burnish-success); }
        .status-warning { color: var(--burnish-warning); }
        .status-error, .status-failing { color: var(--burnish-error); font-weight: 600; }
        .status-muted, .status-no-data { color: var(--burnish-text-muted); }
    `;

    declare title: string;
    declare columns: string;
    declare rows: string;
    declare 'status-field': string;

    render() {
        let cols: Array<{ key: string; label: string }> = [];
        let data: Array<Record<string, unknown>> = [];
        try { cols = JSON.parse(this.columns || '[]'); } catch { /* graceful */ }
        // Normalize string array to object array
        if (cols.length > 0 && typeof cols[0] === 'string') {
            cols = (cols as unknown as string[]).map(c => ({ key: c, label: c }));
        }
        try { data = JSON.parse(this.rows || '[]'); } catch { /* graceful */ }

        const statusField = this['status-field'] || this.getAttribute('status-field');

        return html`
            <div class="table-container">
                ${this.title ? html`<div class="table-title">${this.title}</div>` : ''}
                <table>
                    <thead><tr>${cols.map(c => html`<th>${c.label}</th>`)}</tr></thead>
                    <tbody>
                        ${data.map(row => html`
                            <tr>
                                ${cols.map(c => {
                                    const val = row[c.key];
                                    const isStatus = statusField && c.key === statusField;
                                    return html`<td class="${isStatus ? `status-${val}` : ''}">${val}</td>`;
                                })}
                            </tr>
                        `)}
                    </tbody>
                </table>
            </div>
        `;
    }
}

customElements.define('burnish-table', BurnishTable);
