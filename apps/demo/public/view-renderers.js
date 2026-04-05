/**
 * View rendering functions — cards, table, JSON, view switcher, and result parsing.
 */

import { PURIFY_CONFIG, WRITE_TOOL_RE, escapeHtml, escapeAttr, boundCache } from './shared.js';
import { generateContextualActions } from './contextual-actions.js';

// ── View switching data store ──
window._viewData = window._viewData || {};
window._cardItems = window._cardItems || {};

export function renderViewSwitcher(dataId, activeView, count) {
    return `<div class="burnish-view-switcher" data-view-id="${dataId}">
        <button class="burnish-view-btn ${activeView === 'cards' ? 'active' : ''}" data-view="cards" data-target="${dataId}">Cards</button>
        <button class="burnish-view-btn ${activeView === 'table' ? 'active' : ''}" data-view="table" data-target="${dataId}">Table</button>
        <button class="burnish-view-btn ${activeView === 'json' ? 'active' : ''}" data-view="json" data-target="${dataId}">JSON</button>
        <span class="burnish-view-count">${count} items</span>
    </div>`;
}

export function stripMarkdown(text) {
    return text
        .replace(/#{1,6}\s*/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\n{2,}/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
}

export function inferCardStatus(item, sourceToolName) {
    if (item.state === 'closed' || item.state === 'merged') return 'success';
    if (item.state === 'open') return 'info';
    if (item.draft === true) return 'muted';
    if (sourceToolName) {
        const base = sourceToolName.replace(/^mcp__\w+__/, '');
        if (WRITE_TOOL_RE.test(base)) return 'warning';
    }
    return 'success';
}

export function renderCardsView(items, sourceToolName, dataId) {
    const viewId = dataId || ('cv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    window._cardItems = window._cardItems || {};
    window._cardItems[viewId] = items;
    boundCache(window._cardItems);

    let html = '<div class="burnish-cards-grid">';
    for (let i = 0; i < Math.min(items.length, 50); i++) {
        const item = items[i];
        const title = item.full_name || item.name || item.title || item.login || 'Item';
        const rawBody = item.description || item.body || item.message || '';
        const body = stripMarkdown(rawBody).substring(0, 150);
        const status = inferCardStatus(item, sourceToolName);
        const meta = Object.entries(item)
            .filter(([k, v]) => typeof v !== 'object' && v != null
                && !['description','body','message','name','full_name','title','login'].includes(k)
                && !/_url$|^url$|node_id|_id$|avatar|gravatar/.test(k)
                && !(typeof v === 'string' && v.startsWith('http'))
                && String(v).length < 80)
            .slice(0, 4)
            .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) }));
        html += `<burnish-card title="${escapeAttr(title)}" status="${status}"
            body="${escapeAttr(body)}"
            meta='${escapeAttr(JSON.stringify(meta))}'
            item-id="${escapeAttr((dataId || viewId) + ':' + i)}"></burnish-card>`;
    }
    if (items.length > 50) {
        html += '<div class="burnish-truncation-notice">Showing 50 of ' + items.length + ' results</div>';
    }
    html += '</div>';
    return html;
}

export function renderTableView(items, label) {
    if (!items || items.length === 0) {
        return '<burnish-card title="No data" status="muted" body="No results to display"></burnish-card>';
    }
    const allKeys = Object.keys(items[0]);

    const priority = ['title','name','full_name','number','state','status',
        'login','description','language','created_at','updated_at',
        'stargazers_count','path','size','type','message','body'];

    const excludePattern = /_url$|_id$|node_id|gravatar|avatar|_at$/i;
    const isUrl = (v) => typeof v === 'string' && (v.startsWith('http') || v.startsWith('git://'));

    const priorityCols = priority.filter(k => allKeys.includes(k));
    const otherCols = allKeys.filter(k => {
        if (priorityCols.includes(k)) return false;
        if (excludePattern.test(k)) return false;
        const sample = items[0][k];
        if (typeof sample === 'object' && sample !== null) return false;
        if (isUrl(sample)) return false;
        return true;
    });

    const selectedKeys = [...priorityCols, ...otherCols].slice(0, 10);
    const cols = selectedKeys.map(k => ({ key: k, label: k.replace(/_/g, ' ') }));

    const rows = items.slice(0, 50).map(item => {
        const row = {};
        for (const col of cols) {
            let val = item[col.key];
            if (val == null) { row[col.key] = ''; continue; }
            if (typeof val === 'object') {
                val = val.login || val.name || val.label || val.title || '';
            }
            val = String(val);
            if (val.length > 80) val = val.substring(0, 77) + '...';
            row[col.key] = val;
        }
        return row;
    });
    return `<burnish-table title="${escapeAttr(label)}" columns='${escapeAttr(JSON.stringify(cols))}' rows='${escapeAttr(JSON.stringify(rows))}'></burnish-table>`;
}

export function renderJsonView(items) {
    const json = JSON.stringify(items, null, 2).substring(0, 50000);
    return `<div class="burnish-json-wrapper">
        <button class="burnish-copy-btn" data-copy-target="json" title="Copy JSON">Copy</button>
        <pre class="burnish-json-view">${escapeHtml(json)}</pre>
    </div>`;
}

export function renderParsedResult(parsed, label, sourceToolName) {
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            return `<burnish-card title="${escapeAttr(label)}" status="muted" body="No results"></burnish-card>`;
        }
        if (typeof parsed[0] === 'object') {
            const dataId = 'vd-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            window._viewData[dataId] = { parsed, label, sourceToolName };
            boundCache(window._viewData);

            const defaultView = 'cards';
            let html = `<burnish-stat-bar items='${escapeAttr(JSON.stringify([{label:"Results",value:String(parsed.length),color:"info"}]))}'></burnish-stat-bar>`;
            html += renderViewSwitcher(dataId, defaultView, parsed.length);
            html += `<div class="burnish-view-content" data-view-id="${dataId}">`;
            html += renderCardsView(parsed, sourceToolName, dataId);
            html += '</div>';

            const actions = generateContextualActions(parsed, sourceToolName);
            if (actions.length > 0) {
                html += `<burnish-actions actions='${escapeAttr(JSON.stringify(actions))}'></burnish-actions>`;
            }
            return html;
        }
        return parsed.slice(0, 20).map(item =>
            `<burnish-card title="${escapeAttr(String(item))}" status="info"></burnish-card>`
        ).join('');
    }

    if (typeof parsed === 'object' && parsed !== null) {
        const arrayKeys = ['items','results','data','entries','records','rows','nodes',
            'repositories','issues','files','commits','pull_requests','comments'];
        const nestedKey = arrayKeys.find(k => Array.isArray(parsed[k]) && parsed[k].length > 0);

        if (nestedKey && typeof parsed[nestedKey][0] === 'object') {
            const scalarFields = Object.entries(parsed)
                .filter(([k, v]) => k !== nestedKey && typeof v !== 'object' && typeof v !== 'boolean')
                .slice(0, 5);
            let html = '';
            if (scalarFields.length > 0) {
                const statItems = scalarFields.map(([k, v]) => ({
                    label: k.replace(/_/g, ' '), value: String(v), color: 'info'
                }));
                html += `<burnish-stat-bar items='${escapeAttr(JSON.stringify(statItems))}'></burnish-stat-bar>`;
            }
            html += renderParsedResult(parsed[nestedKey], nestedKey, sourceToolName);
            return html;
        }

        const meta = Object.entries(parsed)
            .filter(([, v]) => typeof v !== 'object' || v === null)
            .slice(0, 10)
            .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v ?? '') }));
        return `<burnish-card title="${escapeAttr(label)}" status="success" meta='${escapeAttr(JSON.stringify(meta))}'></burnish-card>`;
    }

    return `<burnish-card title="${escapeAttr(label)}" status="success" body="${escapeAttr(String(parsed))}"></burnish-card>`;
}

// ── Schema Tree Renderer ──

export function renderSchemaTree(schema, toolName) {
    if (!schema || !schema.properties) {
        return '<div class="burnish-schema-empty">No input schema defined</div>';
    }

    const required = new Set(schema.required || []);
    let html = '<details class="burnish-schema-tree-wrapper" open>';
    html += '<summary class="burnish-schema-header">' + escapeHtml(toolName || 'Parameters') + ' <span class="burnish-schema-type">object</span></summary>';
    html += '<div class="burnish-schema-tree">';

    const props = Object.entries(schema.properties);
    props.forEach(([name, prop], i) => {
        const isLast = i === props.length - 1;
        html += renderSchemaProp(name, prop, required.has(name), isLast, 0);
    });

    html += '</div></details>';
    return html;
}

function renderSchemaProp(name, prop, isRequired, isLast, depth) {
    const connector = isLast ? '└─ ' : '├─ ';
    const indent = depth > 0 ? '│  '.repeat(depth) : '';
    const typeStr = getSchemaTypeString(prop);
    const reqBadge = isRequired
        ? '<span class="burnish-schema-required">required</span>'
        : '<span class="burnish-schema-optional">optional</span>';

    let html = '';

    if (prop.type === 'object' && prop.properties) {
        // Nested object — make expandable
        html += '<details class="burnish-schema-prop" open>';
        html += '<summary class="burnish-schema-row">';
        html += '<span class="burnish-schema-indent">' + indent + connector + '</span>';
        html += '<span class="burnish-schema-name">' + escapeHtml(name) + '</span>';
        html += '<span class="burnish-schema-type">' + typeStr + '</span>';
        html += reqBadge;
        if (prop.description) html += '<span class="burnish-schema-desc">' + escapeHtml(prop.description) + '</span>';
        html += '</summary>';

        const childRequired = new Set(prop.required || []);
        const childProps = Object.entries(prop.properties);
        childProps.forEach(([childName, childProp], i) => {
            html += renderSchemaProp(childName, childProp, childRequired.has(childName), i === childProps.length - 1, depth + 1);
        });
        html += '</details>';
    } else if (prop.type === 'array' && prop.items) {
        // Array — show item type
        html += '<div class="burnish-schema-row">';
        html += '<span class="burnish-schema-indent">' + indent + connector + '</span>';
        html += '<span class="burnish-schema-name">' + escapeHtml(name) + '</span>';
        html += '<span class="burnish-schema-type">array of ' + getSchemaTypeString(prop.items) + '</span>';
        html += reqBadge;
        if (prop.description) html += '<span class="burnish-schema-desc">' + escapeHtml(prop.description) + '</span>';
        html += '</div>';

        // Show constraints
        html += renderSchemaConstraints(prop, indent + (isLast ? '   ' : '│  '));
    } else {
        // Leaf property
        html += '<div class="burnish-schema-row">';
        html += '<span class="burnish-schema-indent">' + indent + connector + '</span>';
        html += '<span class="burnish-schema-name">' + escapeHtml(name) + '</span>';
        html += '<span class="burnish-schema-type">' + typeStr + '</span>';
        html += reqBadge;
        if (prop.description) html += '<span class="burnish-schema-desc">' + escapeHtml(prop.description) + '</span>';
        html += '</div>';

        // Show constraints and defaults
        html += renderSchemaConstraints(prop, indent + (isLast ? '   ' : '│  '));
    }

    return html;
}

function getSchemaTypeString(prop) {
    if (!prop) return 'any';
    if (prop.enum) return (prop.type || 'string') + ' (enum)';
    if (prop.type === 'array' && prop.items) return 'array';
    return prop.type || 'any';
}

function renderSchemaConstraints(prop, indent) {
    const constraints = [];
    if (prop.default !== undefined) constraints.push('default: ' + JSON.stringify(prop.default));
    if (prop.enum) constraints.push('enum: ' + prop.enum.map(function(v) { return JSON.stringify(v); }).join(', '));
    if (prop.minLength !== undefined) constraints.push('minLength: ' + prop.minLength);
    if (prop.maxLength !== undefined) constraints.push('maxLength: ' + prop.maxLength);
    if (prop.minimum !== undefined) constraints.push('min: ' + prop.minimum);
    if (prop.maximum !== undefined) constraints.push('max: ' + prop.maximum);
    if (prop.pattern) constraints.push('pattern: ' + prop.pattern);

    if (constraints.length === 0) return '';
    return '<div class="burnish-schema-constraints"><span class="burnish-schema-indent">' + indent + '</span>' + constraints.join(' &middot; ') + '</div>';
}

export function buildResultHtml(result, label, sourceToolName) {
    try {
        const parsed = JSON.parse(result);
        const inner = renderParsedResult(parsed, label, sourceToolName);
        return `<div class="burnish-result-wrapper" data-raw-result="${escapeAttr(result.substring(0, 50000))}">${inner}</div>`;
    } catch {
        return `<burnish-card title="${escapeAttr(label)}" status="success" body="${escapeAttr(result.substring(0, 1000))}"></burnish-card>`;
    }
}
