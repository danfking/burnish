import { LitElement, html, css, nothing } from 'lit';

export class BurnishTable extends LitElement {
    static properties = {
        title: { type: String },
        columns: { type: String },
        rows: { type: String },
        'status-field': { type: String, attribute: 'status-field' },
        _page: { state: true },
        _pageSize: { state: true },
        _sortKey: { state: true },
        _sortDir: { state: true },
        _filter: { state: true },
    };

    static styles = css`
        :host { display: block; width: 100%; min-width: 0; }
        .table-container {
            background: var(--burnish-surface, #fff);
            border-radius: var(--burnish-radius-md, 8px);
            box-shadow: var(--burnish-shadow-sm);
            overflow-x: auto;
        }
        .table-header {
            padding: var(--burnish-space-md, 12px) var(--burnish-space-lg, 16px);
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            border-bottom: 1px solid var(--burnish-border-light, #F0EAEA);
        }
        .table-title {
            font-size: var(--burnish-font-size-md, 14px); font-weight: 600;
        }
        .table-search {
            padding: 5px 10px; border: 1px solid var(--burnish-border, #E5DDDD);
            border-radius: 4px; font-size: 12px; min-width: 150px; outline: none;
        }
        .table-search:focus { border-color: var(--burnish-accent, #8B3A3A); }
        table { width: 100%; border-collapse: collapse; font-size: var(--burnish-font-size-base, 13px); }
        th {
            text-align: left; padding: 10px var(--burnish-space-lg, 16px);
            background: var(--burnish-surface-alt, #F8F5F5);
            color: var(--burnish-text-secondary); font-weight: 600;
            font-size: var(--burnish-font-size-sm, 12px); text-transform: uppercase;
            letter-spacing: 0.5px; border-bottom: 1px solid var(--burnish-border-light);
            cursor: pointer; user-select: none; white-space: nowrap;
        }
        th:hover { color: var(--burnish-text, #2D1F1F); }
        th .sort-arrow { font-size: 10px; margin-left: 4px; opacity: 0.4; }
        th .sort-arrow.active { opacity: 1; color: var(--burnish-accent, #8B3A3A); }
        th:last-child { cursor: default; }
        td {
            padding: 10px var(--burnish-space-lg, 16px);
            border-bottom: 1px solid var(--burnish-border-light, #F0EAEA);
            color: var(--burnish-text, #2D1F1F);
            max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--burnish-surface-hover, #F3EDED); }
        .status-success, .status-healthy { color: var(--burnish-success); }
        .status-warning { color: var(--burnish-warning); }
        .status-error, .status-failing { color: var(--burnish-error); font-weight: 600; }
        .status-muted, .status-no-data { color: var(--burnish-text-muted); }
        .explore-link {
            color: var(--burnish-accent, #8B3A3A); cursor: pointer;
            font-size: 12px; white-space: nowrap; text-decoration: none;
        }
        .explore-link:hover { text-decoration: underline; }
        .table-footer {
            padding: 8px 16px; display: flex; align-items: center;
            justify-content: space-between; gap: 12px;
            border-top: 1px solid var(--burnish-border-light, #F0EAEA);
            font-size: 12px; color: var(--burnish-text-muted, #9C8F8F);
        }
        .table-pagination { display: flex; align-items: center; gap: 6px; }
        .page-btn {
            padding: 3px 8px; border: 1px solid var(--burnish-border, #E5DDDD);
            border-radius: 3px; background: none; cursor: pointer; font-size: 12px;
        }
        .page-btn:hover:not(:disabled) { background: var(--burnish-surface-alt, #F8F5F5); }
        .page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .page-size-select {
            padding: 2px 4px; border: 1px solid var(--burnish-border, #E5DDDD);
            border-radius: 3px; font-size: 11px; background: none;
        }
        .no-results {
            padding: 24px 16px; text-align: center;
            color: var(--burnish-text-muted, #9C8F8F); font-style: italic;
        }
    `;

    declare title: string;
    declare columns: string;
    declare rows: string;
    declare 'status-field': string;
    declare _page: number;
    declare _pageSize: number;
    declare _sortKey: string;
    declare _sortDir: 'asc' | 'desc';
    declare _filter: string;

    constructor() {
        super();
        this._page = 0;
        this._pageSize = 10;
        this._sortKey = '';
        this._sortDir = 'asc';
        this._filter = '';
    }

    private _onSort(key: string) {
        if (this._sortKey === key) {
            this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this._sortKey = key;
            this._sortDir = 'asc';
        }
        this._page = 0;
    }

    private _onFilter(e: Event) {
        this._filter = (e.target as HTMLInputElement).value;
        this._page = 0;
    }

    private _onPageSize(e: Event) {
        this._pageSize = parseInt((e.target as HTMLSelectElement).value) || 10;
        this._page = 0;
    }

    private _onRowExplore(e: Event, row: Record<string, unknown>, index: number) {
        e.preventDefault();
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('burnish-table-row-click', {
            detail: { row, index },
            bubbles: true, composed: true,
        }));
    }

    render() {
        let cols: Array<{ key: string; label: string }> = [];
        let data: Array<Record<string, unknown>> = [];
        try { cols = JSON.parse(this.columns || '[]'); } catch { /* graceful */ }
        if (cols.length > 0 && typeof cols[0] === 'string') {
            cols = (cols as unknown as string[]).map(c => ({ key: c, label: c }));
        }
        try { data = JSON.parse(this.rows || '[]'); } catch { /* graceful */ }
        if (data.length > 0 && Array.isArray(data[0])) {
            data = (data as unknown as unknown[][]).map(arr =>
                Object.fromEntries(cols.map((c, i) => [c.key, arr[i]]))
            );
        }

        const statusField = this['status-field'] || this.getAttribute('status-field');

        // Filter
        let filtered = data;
        if (this._filter) {
            const q = this._filter.toLowerCase();
            filtered = data.filter(row =>
                cols.some(c => String(row[c.key] ?? '').toLowerCase().includes(q))
            );
        }

        // Sort
        if (this._sortKey) {
            const key = this._sortKey;
            const dir = this._sortDir === 'asc' ? 1 : -1;
            filtered = [...filtered].sort((a, b) => {
                const va = String(a[key] ?? '');
                const vb = String(b[key] ?? '');
                return va.localeCompare(vb, undefined, { numeric: true }) * dir;
            });
        }

        // Paginate
        const totalFiltered = filtered.length;
        const totalPages = Math.ceil(totalFiltered / this._pageSize);
        const page = Math.min(this._page, totalPages - 1);
        const start = Math.max(0, page * this._pageSize);
        const pageData = filtered.slice(start, start + this._pageSize);

        return html`
            <div class="table-container">
                <div class="table-header">
                    <span class="table-title">${this.title || ''}</span>
                    <input class="table-search" type="text" placeholder="Filter..."
                        .value=${this._filter}
                        @input=${this._onFilter}>
                </div>
                ${pageData.length === 0 ? html`<div class="no-results">No matching rows</div>` : html`
                <table>
                    <thead><tr>
                        ${cols.map(c => html`
                            <th @click=${() => this._onSort(c.key)}>
                                ${c.label}
                                <span class="sort-arrow ${this._sortKey === c.key ? 'active' : ''}">
                                    ${this._sortKey === c.key ? (this._sortDir === 'asc' ? '▲' : '▼') : '▲'}
                                </span>
                            </th>
                        `)}
                        <th></th>
                    </tr></thead>
                    <tbody>
                        ${pageData.map((row, index) => html`
                            <tr>
                                ${cols.map(c => {
                                    const val = row[c.key];
                                    const isStatus = statusField && c.key === statusField;
                                    return html`<td class="${isStatus ? `status-${val}` : ''}">${val}</td>`;
                                })}
                                <td><a class="explore-link" @click=${(e: Event) => this._onRowExplore(e, row, start + index)}>Explore →</a></td>
                            </tr>
                        `)}
                    </tbody>
                </table>
                `}
                ${totalFiltered > 0 ? html`
                <div class="table-footer">
                    <span>${totalFiltered} row${totalFiltered !== 1 ? 's' : ''}${this._filter ? ' (filtered)' : ''}</span>
                    <div class="table-pagination">
                        <select class="page-size-select" @change=${this._onPageSize}>
                            ${[10, 25, 50].map(n => html`<option value="${n}" ?selected=${this._pageSize === n}>${n}/page</option>`)}
                        </select>
                        <button class="page-btn" ?disabled=${page <= 0} @click=${() => this._page = page - 1}>← Prev</button>
                        <span>${page + 1} / ${totalPages || 1}</span>
                        <button class="page-btn" ?disabled=${page >= totalPages - 1} @click=${() => this._page = page + 1}>Next →</button>
                    </div>
                </div>
                ` : nothing}
            </div>
        `;
    }
}

customElements.define('burnish-table', BurnishTable);
