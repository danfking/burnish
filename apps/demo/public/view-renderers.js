/**
 * View rendering functions — cards, table, JSON, view switcher, and result parsing.
 */

import { PURIFY_CONFIG, WRITE_TOOL_RE, escapeHtml, escapeAttr, boundCache } from './shared.js';
import { generateContextualActions } from './contextual-actions.js';

// ── View switching data store ──
window._viewData = window._viewData || {};
window._cardItems = window._cardItems || {};

// ── Per-tool display preferences (localStorage) ──
const TOOL_VIEW_PREFS_KEY = 'burnish:toolViewPrefs';

export function getToolViewPreference(toolName) {
    if (!toolName) return null;
    try {
        const prefs = JSON.parse(localStorage.getItem(TOOL_VIEW_PREFS_KEY) || '{}');
        return prefs[toolName] || null;
    } catch {
        return null;
    }
}

export function setToolViewPreference(toolName, viewType) {
    if (!toolName || !viewType) return;
    try {
        const prefs = JSON.parse(localStorage.getItem(TOOL_VIEW_PREFS_KEY) || '{}');
        prefs[toolName] = viewType;
        localStorage.setItem(TOOL_VIEW_PREFS_KEY, JSON.stringify(prefs));
    } catch { /* ignore storage errors */ }
}

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

export function renderCardsView(items, sourceToolName, dataId, sourceName) {
    const viewId = dataId || ('cv-' + crypto.randomUUID());
    window._cardItems = window._cardItems || {};
    window._cardItems[viewId] = items;
    boundCache(window._cardItems);

    const sourceAttr = sourceName ? ` source="${escapeAttr(sourceName)}"` : '';
    let html = '<div class="burnish-cards-grid">';
    for (let i = 0; i < Math.min(items.length, 50); i++) {
        const item = items[i];
        // #313: Include message/sha/commit.message for commit objects
        const title = item.full_name || item.name || item.title || item.message
            || (item.commit && item.commit.message) || item.sha || item.login || 'Item';
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
            item-id="${escapeAttr((dataId || viewId) + ':' + i)}"${sourceAttr}></burnish-card>`;
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

export function renderParsedResult(parsed, label, sourceToolName, sourceName) {
    const sourceAttr = sourceName ? ` source="${escapeAttr(sourceName)}"` : '';
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            return `<burnish-card title="${escapeAttr(label)}" status="muted" body="No results"${sourceAttr}></burnish-card>`;
        }
        // Stat-bar: array of {label, value} objects
        if (typeof parsed[0] === 'object' && 'label' in parsed[0] && 'value' in parsed[0]
            && Object.keys(parsed[0]).length <= 3 && parsed.every(i => 'label' in i && 'value' in i)) {
            return `<burnish-stat-bar items='${escapeAttr(JSON.stringify(parsed))}'${sourceAttr}></burnish-stat-bar>`;
        }
        if (typeof parsed[0] === 'object') {
            const dataId = 'vd-' + crypto.randomUUID();
            window._viewData[dataId] = { parsed, label, sourceToolName, sourceName };
            boundCache(window._viewData);

            const defaultView = getToolViewPreference(sourceToolName) || 'cards';
            let html = `<burnish-stat-bar items='${escapeAttr(JSON.stringify([{label:"Results",value:String(parsed.length),color:"info"}]))}'></burnish-stat-bar>`;
            html += renderViewSwitcher(dataId, defaultView, parsed.length);
            html += `<div class="burnish-view-content" data-view-id="${dataId}">`;
            let defaultContent;
            if (defaultView === 'table') defaultContent = renderTableView(parsed, label);
            else if (defaultView === 'json') defaultContent = renderJsonView(parsed);
            else defaultContent = renderCardsView(parsed, sourceToolName, dataId, sourceName);
            html += defaultContent;
            html += '</div>';

            const actions = generateContextualActions(parsed, sourceToolName);
            if (actions.length > 0) {
                html += `<burnish-actions actions='${escapeAttr(JSON.stringify(actions))}'></burnish-actions>`;
            }
            return html;
        }
        // #336: Render primitive arrays (e.g. directory paths) as a list card
        const listBody = parsed.slice(0, 50).map(item => `- ${String(item)}`).join('\n');
        return `<burnish-card title="${escapeAttr(label)}" status="info" body="${escapeAttr(listBody)}"${sourceAttr}></burnish-card>`;
    }

    // #314: Plain string content — render directly as a card body
    if (typeof parsed === 'string') {
        const body = parsed.substring(0, 2000) || '(empty)';
        return `<burnish-card title="${escapeAttr(label)}" status="success" body="${escapeAttr(body)}"${sourceAttr}></burnish-card>`;
    }

    if (typeof parsed === 'object' && parsed !== null) {
        // Chart: object with labels + datasets arrays
        if (Array.isArray(parsed.labels) && Array.isArray(parsed.datasets)) {
            const chartType = parsed.datasets.length === 1 && parsed.labels.length <= 8 ? 'doughnut' : 'line';
            const title = parsed.title || label;
            return `<burnish-chart type="${chartType}" config='${escapeAttr(JSON.stringify({ data: parsed }))}'${sourceAttr}></burnish-chart>`;
        }

        const arrayKeys = ['items','results','data','entries','records','rows','nodes',
            'repositories','issues','files','commits','pull_requests','comments',
            'sections','articles','categories','groups','tasks','events','messages'];
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
            html += renderParsedResult(parsed[nestedKey], nestedKey, sourceToolName, sourceName);
            return html;
        }

        // #335: Infer a meaningful title from the object, and show ALL scalar fields
        const titleFields = ['name', 'path', 'filename', 'title', 'full_name', 'login', 'label'];
        const inferredTitle = titleFields.reduce((acc, k) => acc || (parsed[k] ? String(parsed[k]) : ''), '') || label;
        const meta = Object.entries(parsed)
            .filter(([, v]) => (typeof v !== 'object' || v === null) && typeof v !== 'boolean')
            .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v ?? '') }));
        return `<burnish-card title="${escapeAttr(inferredTitle)}" status="success" meta='${escapeAttr(JSON.stringify(meta))}'${sourceAttr}></burnish-card>`;
    }

    return `<burnish-card title="${escapeAttr(label)}" status="success" body="${escapeAttr(String(parsed))}"${sourceAttr}></burnish-card>`;
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

/**
 * Detect plain-text directory listings (e.g. from list_directory) and render
 * them as a structured burnish-table instead of a truncated text card.
 * Lines must match the pattern: [DIR] name  or  [FILE] name
 */
function tryParseDirectoryListing(result, label) {
    if (!result.includes('[DIR]') && !result.includes('[FILE]')) return null;

    const entries = result.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const match = line.match(/^\[(DIR|FILE)\]\s+(.+)$/);
            return match ? { type: match[1] === 'DIR' ? 'Directory' : 'File', name: match[2].trim() } : null;
        })
        .filter(Boolean);

    // Only treat as a directory listing if most lines matched the pattern
    const totalNonEmpty = result.split('\n').filter(l => l.trim()).length;
    if (entries.length === 0 || entries.length < totalNonEmpty * 0.5) return null;

    const cols = [
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
    ];

    // Sort: directories first, then files, alphabetical within each group
    entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'Directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const dirCount = entries.filter(e => e.type === 'Directory').length;
    const fileCount = entries.length - dirCount;
    const stats = [
        { label: 'Directories', value: String(dirCount), color: 'info' },
        { label: 'Files', value: String(fileCount), color: 'success' },
    ];

    let html = `<burnish-stat-bar items='${escapeAttr(JSON.stringify(stats))}'></burnish-stat-bar>`;
    html += `<burnish-table title="${escapeAttr(label)}" columns='${escapeAttr(JSON.stringify(cols))}' rows='${escapeAttr(JSON.stringify(entries))}'></burnish-table>`;
    return html;
}

export function buildResultHtml(result, label, sourceToolName, sourceName, isError) {
    // #329: If MCP flagged this as an error, render an error card
    if (isError) {
        const sourceAttr = sourceName ? ` source="${escapeAttr(sourceName)}"` : '';
        return `<burnish-card title="Error" status="error" body="${escapeAttr(String(result).substring(0, 2000))}"${sourceAttr}></burnish-card>`;
    }

    try {
        const parsed = JSON.parse(result);
        const inner = renderParsedResult(parsed, label, sourceToolName, sourceName);
        return `<div class="burnish-result-wrapper" data-raw-result="${escapeAttr(result.substring(0, 50000))}">${inner}</div>`;
    } catch {
        // Multi-content: newline-separated JSON objects (from tools returning multiple content items)
        const lines = result.split('\n');
        if (lines.length > 1) {
            const parts = [];
            let buf = '';
            for (const line of lines) {
                buf += (buf ? '\n' : '') + line;
                try { parts.push(JSON.parse(buf)); buf = ''; } catch { /* accumulate */ }
            }
            if (parts.length > 1 && buf === '') {
                let html = '';
                for (const part of parts) {
                    html += renderParsedResult(part, label, sourceToolName, sourceName);
                }
                return `<div class="burnish-result-wrapper" data-raw-result="${escapeAttr(result.substring(0, 50000))}">${html}</div>`;
            }
        }

        // Try to parse as a directory listing before falling back to plain text
        const dirHtml = tryParseDirectoryListing(result, label);
        if (dirHtml) return dirHtml;

        const sourceAttr = sourceName ? ` source="${escapeAttr(sourceName)}"` : '';
        // Render markdown files through marked if available
        const isMarkdown = /\.md$/i.test(label);
        if (isMarkdown && typeof window.marked !== 'undefined') {
            const rendered = DOMPurify.sanitize(window.marked.parse(result.substring(0, 5000)), PURIFY_CONFIG);
            return `<div class="burnish-result-wrapper"><div class="burnish-markdown-content">${rendered}</div></div>`;
        }
        return `<burnish-card title="${escapeAttr(label)}" status="success" body="${escapeAttr(result.substring(0, 1000))}"${sourceAttr}></burnish-card>`;
    }
}
