/**
 * Burnish Demo App — deterministic MCP navigator.
 * Browse tools, fill forms, execute tools, render results, chain to next action.
 */

// Version-based cache clearing: if the server restarted with new code, clear stale IndexedDB
(() => {
    const versionMeta = document.querySelector('meta[name="burnish-version"]');
    const buildVersion = versionMeta?.getAttribute('content') || '';
    const storedVersion = localStorage.getItem('burnish:buildVersion');
    if (buildVersion && storedVersion && storedVersion !== buildVersion) {
        console.log('[burnish] Build version changed, clearing stale sessions');
        indexedDB.deleteDatabase('burnish-sessions');
        indexedDB.deleteDatabase('burnish-nodes');
    }
    if (buildVersion) localStorage.setItem('burnish:buildVersion', buildVersion);
})();

import {
    getNodeById, getChildren, getRootNodes, getAncestryPath, getActivePath, getDescendantIds,
    SessionStore,
    transformOutput,
    isWriteTool, generateFallbackForm,
    generateSummary, formatTimeAgo,
} from '@burnish/app';

// ── Persistence ──
const persistence = new SessionStore();

// ── DOMPurify Config ──
const PURIFY_CONFIG = {
    ADD_TAGS: ['burnish-card', 'burnish-stat-bar', 'burnish-table', 'burnish-chart',
               'burnish-section', 'burnish-metric', 'burnish-message', 'burnish-form', 'burnish-actions'],
    ADD_ATTR: ['items', 'title', 'status', 'body', 'meta', 'columns', 'rows',
               'status-field', 'type', 'config', 'role', 'content', 'class',
               'label', 'count', 'collapsed', 'item-id', 'value', 'unit', 'trend',
               'streaming', 'tool-id', 'fields', 'actions', 'color'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

const ICON_FOCUS = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,1 1,1 1,4"/><polyline points="12,1 15,1 15,4"/><polyline points="4,15 1,15 1,12"/><polyline points="12,15 15,15 15,12"/></svg>`;
const ICON_RESTORE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,4 4,4 4,1"/><polyline points="12,1 12,4 15,4"/><polyline points="1,12 4,12 4,15"/><polyline points="12,15 12,12 15,12"/></svg>`;
const ICON_REFRESH = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8a7 7 0 0 1 13-3.5M15 8a7 7 0 0 1-13 3.5"/><polyline points="1,1 1,5 5,5"/><polyline points="15,15 15,11 11,11"/></svg>`;

// ── State ──
let searchQuery = '';
let searchDebounceTimer = null;
let dashboardMode = localStorage.getItem('burnish:dashboardMode') === 'true';

// Multi-session state
let sessions = [];
let activeSessionId = null;

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId);
}

// Track which node to branch from (set when user clicks "Branch" button)
let branchFromNodeId = null;

// Curated starter prompts per MCP server type
// Each entry can have `tool`+`args` (deterministic path)
const STARTER_PROMPTS = {
    filesystem: [
        { label: 'List my files', tool: 'list_directory', args: { path: '.' } },
        { label: 'Find large files', tool: 'search_files', args: { path: '.', pattern: '*' } },
    ],
    github: [
        { label: 'Search repos', tool: 'search_repositories', args: { query: 'stars:>100' } },
    ],
    _default: [
        { label: 'Available tools', action: 'list-servers' },
    ],
};

// Cache of tool schemas keyed by tool name (populated from /api/servers)
const toolSchemaCache = {};

// Cache of server data from /api/servers (for deterministic rendering)
let cachedServers = null;

// ── Persistence (delegated to SessionStore) ──

async function saveState() {
    await persistence.save(sessions, activeSessionId);
}

async function loadState() {
    return persistence.load();
}

// ─�� Session CRUD ──
async function createSession() {
    const session = {
        id: generateId(),
        title: 'New session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: null,
        nodes: [],
    };
    sessions.unshift(session);
    activeSessionId = session.id;
    persistence.markLoaded(session.id);
    renderSessionList();
    renderMainContent();
    updateBreadcrumb();
    await saveState();
}

async function switchSession(sessionId) {
    if (sessionId === activeSessionId) return;
    searchQuery = '';
    const searchInput = document.getElementById('session-search');
    if (searchInput) searchInput.value = '';
    activeSessionId = sessionId;

    // Lazy-load nodes if not yet loaded
    const session = getActiveSession();
    if (session && !persistence.isLoaded(session.id) && session._nodeIds) {
        await persistence.loadNodes(session, session._nodeIds);
        delete session._nodeIds;
        persistence.markLoaded(session.id);
    }

    renderMainContent();
    renderSessionList();
    await saveState();
}

async function deleteSession(sessionId) {
    const session = sessions.find(s => s.id === sessionId);
    const name = session?.title || 'this session';
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    let nodeIds = session?.nodes?.length ? session.nodes.map(n => n.id) : (session?._nodeIds || []);

    if (nodeIds.length === 0 && session) {
        try {
            const meta = await persistence.getSessionNodeIds(session.id);
            if (meta?.length) nodeIds = meta;
        } catch { /* fall through */ }
    }

    sessions = sessions.filter(s => s.id !== sessionId);
    persistence.markUnloaded(sessionId);

    if (activeSessionId === sessionId) {
        activeSessionId = sessions[0]?.id || null;
        if (!activeSessionId) await createSession();
        else { renderMainContent(); }
    }
    renderSessionList();

    if (nodeIds.length > 0) {
        await persistence.deleteNodes(nodeIds);
    }
    await saveState();
}

// ── Helpers ──
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;
    breadcrumb.setAttribute('role', 'navigation');
    breadcrumb.setAttribute('aria-label', 'Breadcrumb');
    const session = getActiveSession();
    if (!session) { breadcrumb.textContent = 'Dashboard'; return; }

    const truncate = (s, max = 25) => s.length > max ? s.substring(0, max) + '\u2026' : s;

    let pathNodes = [];
    if (session.activeNodeId) {
        pathNodes = getAncestryPath(session, session.activeNodeId);
    }

    const segments = [];
    segments.push({ label: truncate(session.title || 'Dashboard'), nodeId: null });
    for (const node of pathNodes) {
        const raw = node.promptDisplay || node.prompt || 'Untitled';
        segments.push({ label: truncate(raw), nodeId: node.id });
    }

    let displaySegments = segments;
    if (segments.length > 4) {
        displaySegments = [
            segments[0],
            { label: '\u2026', nodeId: null, ellipsis: true },
            segments[segments.length - 2],
            segments[segments.length - 1],
        ];
    }

    breadcrumb.innerHTML = displaySegments.map((seg, i) => {
        const sep = i > 0 ? ' <span class="burnish-crumb-sep">\u203A</span> ' : '';
        if (seg.ellipsis) return sep + '<span class="burnish-crumb burnish-crumb-ellipsis">\u2026</span>';
        const isActive = i === displaySegments.length - 1 && seg.nodeId;
        if (isActive) {
            return sep + `<span class="burnish-crumb burnish-crumb-active" aria-current="location">${escapeHtml(seg.label)}</span>`;
        }
        const attrs = seg.nodeId ? ` data-node-id="${escapeHtml(seg.nodeId)}"` : ' data-scroll-top="true"';
        return sep + `<span class="burnish-crumb"${attrs}>${escapeHtml(seg.label)}</span>`;
    }).join('');
}

// ── Session List Rendering ──
function stripHtml(text) {
    return text.replace(/<[^>]*>/g, '').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ');
}

function sessionMatchesSearch(session, query) {
    const q = query.toLowerCase();
    if ((session.title || '').toLowerCase().includes(q)) return true;
    if (session.nodes) {
        for (const node of session.nodes) {
            if ((node.prompt || '').toLowerCase().includes(q)) return true;
            if (stripHtml(node.response || '').toLowerCase().includes(q)) return true;
        }
    }
    return false;
}

function getSearchSnippet(session, query) {
    const q = query.toLowerCase();
    if ((session.title || '').toLowerCase().includes(q)) return '';
    if (session.nodes) {
        for (const node of session.nodes) {
            for (const rawText of [node.prompt, node.response]) {
                if (!rawText) continue;
                const text = stripHtml(rawText);
                const idx = text.toLowerCase().indexOf(q);
                if (idx === -1) continue;
                const start = Math.max(0, idx - 30);
                const end = Math.min(text.length, idx + query.length + 30);
                const prefix = start > 0 ? '...' : '';
                const suffix = end < text.length ? '...' : '';
                const snippet = text.slice(start, end);
                const escaped = escapeHtml(snippet);
                const re = new RegExp(`(${escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                return prefix + escaped.replace(re, '<mark>$1</mark>') + suffix;
            }
        }
    }
    return '';
}

async function ensureAllSessionsLoaded() {
    const unloaded = sessions.filter(s => s._nodeIds && !persistence.isLoaded(s.id));
    if (unloaded.length === 0) return;
    await Promise.all(unloaded.map(async s => {
        await persistence.loadNodes(s, s._nodeIds);
        delete s._nodeIds;
        persistence.markLoaded(s.id);
    }));
}

function renderSessionList() {
    const listEl = document.getElementById('session-list');
    if (!listEl) return;

    if (searchQuery && sessions.some(s => s._nodeIds && !persistence.isLoaded(s.id))) {
        ensureAllSessionsLoaded().then(() => renderSessionList());
        return;
    }

    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const groups = { today: [], yesterday: [], week: [], older: [] };

    const filteredSessions = searchQuery
        ? sessions.filter(s => sessionMatchesSearch(s, searchQuery))
        : sessions;

    for (const s of filteredSessions) {
        const t = s.updatedAt || s.createdAt;
        if (t >= todayStart) groups.today.push(s);
        else if (t >= todayStart - dayMs) groups.yesterday.push(s);
        else if (t >= todayStart - 7 * dayMs) groups.week.push(s);
        else groups.older.push(s);
    }

    let html = '';
    const renderGroup = (label, items) => {
        if (items.length === 0) return;
        html += `<div class="burnish-session-group-label">${label}</div>`;
        for (const s of items) {
            const active = s.id === activeSessionId ? ' active' : '';
            const stepCount = s.nodes?.length || s._nodeIds?.length || 0;
            const matchSnippet = searchQuery ? getSearchSnippet(s, searchQuery) : '';
            html += `
                <div class="burnish-session-item${active}" data-session-id="${s.id}">
                    <div class="burnish-session-title">${escapeHtml(s.title)}</div>
                    <div class="burnish-session-meta">${stepCount} result${stepCount !== 1 ? 's' : ''} \u2022 ${formatTimeAgo(s.updatedAt || s.createdAt)}</div>
                    ${matchSnippet ? `<div class="burnish-session-match">${matchSnippet}</div>` : ''}
                    <button class="burnish-session-delete" data-delete-id="${s.id}" title="Delete">\u00d7</button>
                </div>
            `;
        }
    };

    renderGroup('Today', groups.today);
    renderGroup('Yesterday', groups.yesterday);
    renderGroup('Previous 7 days', groups.week);
    renderGroup('Older', groups.older);

    if (filteredSessions.length === 0 && searchQuery) {
        html = '<div style="padding: 16px; color: var(--burnish-text-muted); font-size: 13px; text-align: center;">No matching sessions</div>';
    } else if (sessions.length === 0) {
        html = '<div style="padding: 16px; color: var(--burnish-text-muted); font-size: 13px; text-align: center;">No sessions yet</div>';
    }

    listEl.innerHTML = html;
}

// ── Node DOM Creation ──
function createNodeEl(node) {
    const div = document.createElement('div');
    div.className = 'burnish-node';
    div.dataset.nodeId = node.id;
    div.dataset.collapsed = String(node.collapsed);

    const statsParts = [];
    if (node.summary) statsParts.push(node.summary);
    const statsTooltip = statsParts.join(' \u2022 ');

    div.innerHTML = `
        <div class="burnish-node-header" role="button" tabindex="0">
            <span class="burnish-node-chevron">\u25bc</span>
            <span class="burnish-node-prompt">${escapeHtml(node.promptDisplay || node.prompt)}</span>
            <span class="burnish-node-time">${formatTimeAgo(node.timestamp)}</span>
            ${statsTooltip ? `<button class="burnish-node-info" title="${escapeAttr(statsTooltip)}">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="8" y="12" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor">i</text></svg>
            </button>` : ''}
            <button class="burnish-node-maximize" title="Focus">
                ${ICON_FOCUS}
            </button>
            <button class="burnish-node-refresh" title="Regenerate">${ICON_REFRESH}</button>
            <button class="burnish-node-delete" data-delete-node="${node.id}" title="Delete this step">\u00d7</button>
        </div>
        <div class="burnish-node-content"></div>
    `;

    const header = div.querySelector('.burnish-node-header');
    header.addEventListener('click', (e) => {
        if (e.target.closest('.burnish-node-delete') || e.target.closest('.burnish-node-maximize') || e.target.closest('.burnish-node-info') || e.target.closest('.burnish-node-refresh')) return;
        toggleNode(node.id);
    });
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(node.id); }
    });
    header.querySelector('.burnish-node-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    });
    header.querySelector('.burnish-node-maximize')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isMaximized = div.classList.toggle('burnish-node-maximized');
        const btn = header.querySelector('.burnish-node-maximize');
        if (btn) {
            btn.title = isMaximized ? 'Restore' : 'Focus';
            btn.innerHTML = isMaximized ? ICON_RESTORE : ICON_FOCUS;
        }
    });
    header.querySelector('.burnish-node-refresh')?.addEventListener('click', (e) => {
        e.stopPropagation();
        regenerateNode(node.id);
    });
    header.querySelector('.burnish-node-info')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDiagnosticPanel(node.id);
    });
    return div;
}

async function regenerateNode(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Deterministic regeneration — re-execute the same tool call
    if (node._executionMode === 'deterministic' && node._toolCall) {
        if (node._toolCall.toolName === '__listing__') {
            const serverData = cachedServers?.find(s => s.name === node._toolCall.args.serverName);
            if (serverData) {
                node.response = '';
                const html = generateToolListingHtml(node._toolCall.args.serverName, serverData.tools);
                node.response = html;
                node.type = 'components';
                const contentEl = document.querySelector(`[data-node-id="${nodeId}"] .burnish-node-content`);
                if (contentEl) contentEl.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
                await saveState();
                return;
            }
        } else {
            try {
                const res = await fetch('/api/tools/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toolName: node._toolCall.toolName, args: node._toolCall.args }),
                });
                const data = await res.json();
                if (res.ok) {
                    const resultHtml = buildResultHtml(data.result, node.promptDisplay, node._toolCall.toolName);
                    node.response = resultHtml;
                    node.type = 'components';
                    const contentEl = document.querySelector(`[data-node-id="${nodeId}"] .burnish-node-content`);
                    if (contentEl) contentEl.innerHTML = DOMPurify.sanitize(resultHtml, PURIFY_CONFIG);
                    node.timestamp = Date.now();
                    updateNodeSummary(nodeId);
                    updateBreadcrumb();
                    renderSessionList();
                    await saveState();
                    return;
                }
            } catch (err) {
                console.error('Deterministic regeneration failed:', err);
            }
        }
    }

    // Try to infer tool from node prompt for legacy nodes without metadata
    if (!node._toolCall && node.prompt) {
        const promptLower = node.prompt.toLowerCase();
        for (const [toolName, schema] of Object.entries(toolSchemaCache)) {
            const shortName = toolName.replace(/^mcp__\w+__/, '');
            const words = shortName.split(/[_\-]+/).filter(w => w.length > 2);
            if (words.every(w => promptLower.includes(w))) {
                const argsText = node.prompt.includes(':') ? node.prompt.split(':').slice(1).join(':').trim() : '';
                const inferredArgs = {};
                if (argsText && schema.properties) {
                    const queryKeys = ['query', 'search', 'q', 'name', 'pattern'];
                    const pathKeys = ['path', 'dir', 'directory'];
                    for (const key of Object.keys(schema.properties)) {
                        if (queryKeys.includes(key) && argsText) inferredArgs[key] = argsText;
                        if (pathKeys.includes(key) && argsText) inferredArgs[key] = argsText;
                    }
                }
                node._executionMode = 'deterministic';
                node._toolCall = { toolName, args: inferredArgs, label: node.promptDisplay };
                return regenerateNode(nodeId);
            }
        }
    }

    // Cannot regenerate without tool metadata
    const contentEl = document.querySelector(`[data-node-id="${nodeId}"] .burnish-node-content`);
    if (contentEl) {
        contentEl.innerHTML = DOMPurify.sanitize(
            '<burnish-card title="Cannot regenerate" status="warning" body="Close this node and re-run the tool from its form."></burnish-card>',
            PURIFY_CONFIG
        );
    }
}

async function toggleNode(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    node.collapsed = !node.collapsed;

    if (!node.collapsed) {
        session.activeNodeId = nodeId;
        renderMainContent();
    } else {
        const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
        if (el) el.dataset.collapsed = 'true';
    }

    await saveState();
}

async function scrollToNode(nodeId, highlight = true) {
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const session = getActiveSession();
    const node = session?.nodes.find(n => n.id === nodeId);
    if (node?.collapsed) { node.collapsed = false; el.dataset.collapsed = 'false'; }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (highlight) {
        el.classList.remove('burnish-node-highlight');
        void el.offsetWidth;
        el.classList.add('burnish-node-highlight');
    }
    await saveState();
}

async function deleteNode(nodeId) {
    const session = getActiveSession();
    if (!session) return;

    const node = getNodeById(session, nodeId);
    if (!node) return;

    const removeIds = new Set(getDescendantIds(session, nodeId));
    const count = removeIds.size;
    const noun = count === 1 ? 'this step' : `this step and ${count - 1} descendant${count > 2 ? 's' : ''}`;

    if (!confirm(`Delete ${noun}? This cannot be undone.`)) return;

    if (node.parentId) {
        const parent = getNodeById(session, node.parentId);
        if (parent?.children) {
            parent.children = parent.children.filter(id => id !== nodeId);
        }
    }

    session.nodes = session.nodes.filter(n => !removeIds.has(n.id));

    if (removeIds.has(session.activeNodeId)) {
        session.activeNodeId = node.parentId || (session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null);
    }

    session.updatedAt = Date.now();
    renderMainContent();
    renderSessionList();

    await persistence.deleteNodes([...removeIds]);
    await saveState();
}

function collapseAllExcept(exceptNodeId) {
    const session = getActiveSession();
    if (!session) return;
    for (const node of session.nodes) {
        if (node.id !== exceptNodeId && !node.collapsed) {
            node.collapsed = true;
            const el = document.querySelector(`.burnish-node[data-node-id="${node.id}"]`);
            if (el) el.dataset.collapsed = 'true';
        }
    }
}

function updateNodeSummary(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.burnish-node-content');
    const { tags, summary } = generateSummary(contentEl);
    node.tags = tags;
    node.summary = summary;
    updateNodeHeader(nodeId);
}

function updateNodeHeader(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;

    const parts = [];
    if (node.summary) parts.push(node.summary);

    const infoBtn = el.querySelector('.burnish-node-info');
    if (infoBtn) {
        infoBtn.title = parts.join(' \u2022 ');
    } else if (parts.length > 0) {
        const deleteBtn = el.querySelector('.burnish-node-delete');
        if (deleteBtn) {
            const btn = document.createElement('button');
            btn.className = 'burnish-node-info';
            btn.title = parts.join(' \u2022 ');
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="8" y="12" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor">i</text></svg>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDiagnosticPanel(node.id);
            });
            deleteBtn.parentNode.insertBefore(btn, deleteBtn);
        }
    }
}

function toggleDiagnosticPanel(nodeId) {
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.burnish-node-content');
    if (!contentEl) return;

    const existing = contentEl.querySelector('.burnish-diagnostic-panel');
    if (existing) { existing.remove(); return; }

    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const panel = document.createElement('div');
    panel.className = 'burnish-diagnostic-panel';

    const metrics = [];
    if (node._toolCall) {
        metrics.push(`<span class="burnish-diag-metric"><strong>Tool</strong> ${escapeHtml(node._toolCall.toolName)}</span>`);
        const argStr = JSON.stringify(node._toolCall.args || {});
        if (argStr !== '{}') {
            metrics.push(`<span class="burnish-diag-metric"><strong>Args</strong> ${escapeHtml(argStr.substring(0, 100))}</span>`);
        }
    }
    if (node._executionMode) {
        metrics.push(`<span class="burnish-diag-metric"><strong>Mode</strong> ${escapeHtml(node._executionMode)}</span>`);
    }

    panel.innerHTML = metrics.length > 0
        ? `<div class="burnish-diag-metrics">${metrics.join('')}</div>`
        : '<div class="burnish-diag-metrics"><span class="burnish-diag-metric">No diagnostic data</span></div>';

    contentEl.insertBefore(panel, contentEl.firstChild);
}

// ── Main Content Rendering (Tree) ──
function renderMainContent() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;
    const session = getActiveSession();

    if (!session || session.nodes.length === 0) {
        container.innerHTML = getEmptyState();
        loadDynamicSuggestions(container);
        return;
    }

    container.innerHTML = '';
    const activePath = getActivePath(session);
    const roots = getRootNodes(session);

    const treeWrapper = document.createElement('div');
    treeWrapper.className = 'burnish-tree';
    container.appendChild(treeWrapper);

    for (const root of roots) {
        renderTreeNode(treeWrapper, session, root, activePath);
    }

    if (session.activeNodeId) {
        setTimeout(() => scrollToNode(session.activeNodeId, false), 100);
    }
}

function renderTreeNode(container, session, node, activePath) {
    const isActive = activePath.has(node.id);

    const isActiveLeaf = node.id === getActiveSession()?.activeNodeId;
    node.collapsed = !isActiveLeaf;

    const nodeEl = createNodeEl(node);
    if (!isActive) nodeEl.classList.add('burnish-node-dimmed');
    container.appendChild(nodeEl);

    if (node.response) {
        const contentEl = nodeEl.querySelector('.burnish-node-content');
        if (node.type === 'components') {
            const clean = transformOutput(DOMPurify.sanitize(node.response, PURIFY_CONFIG));
            const temp = document.createElement('template');
            temp.innerHTML = clean;
            contentEl.appendChild(temp.content);
        } else {
            contentEl.innerHTML = `<div class="burnish-text-response">${renderMarkdown(node.response)}</div>`;
        }
    }

    const children = getChildren(session, node.id);
    if (children.length === 0) return;

    if (children.length === 1) {
        const connector = document.createElement('div');
        connector.className = 'burnish-tree-connector';
        container.appendChild(connector);
        renderTreeNode(container, session, children[0], activePath);
    } else {
        const branchContainer = document.createElement('div');
        branchContainer.className = 'burnish-tree-branches';
        container.appendChild(branchContainer);

        for (const child of children) {
            const branchCol = document.createElement('div');
            branchCol.className = 'burnish-tree-branch-col';
            if (activePath.has(child.id)) branchCol.classList.add('active');
            branchContainer.appendChild(branchCol);

            const branchConnector = document.createElement('div');
            branchConnector.className = 'burnish-tree-connector';
            branchCol.appendChild(branchConnector);

            renderTreeNode(branchCol, session, child, activePath);
        }
    }
}

// ── Main ──
document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('dashboard-container');
    const breadcrumb = document.getElementById('breadcrumb');

    // ── Dashboard mode toggle ──
    if (dashboardMode) {
        document.body.dataset.dashboard = 'true';
        document.getElementById('btn-dashboard-toggle')?.classList.add('active');
    }

    document.getElementById('btn-dashboard-toggle')?.addEventListener('click', () => {
        dashboardMode = !dashboardMode;
        localStorage.setItem('burnish:dashboardMode', String(dashboardMode));
        document.body.dataset.dashboard = dashboardMode ? 'true' : 'false';
        document.getElementById('btn-dashboard-toggle')?.classList.toggle('active', dashboardMode);
    });

    // ── Session panel events ──
    document.getElementById('btn-new-session')?.addEventListener('click', () => createSession());

    const searchInput = document.getElementById('session-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                searchQuery = searchInput.value.trim();
                renderSessionList();
            }, 200);
        });
    }

    document.getElementById('session-list')?.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.burnish-session-delete');
        if (deleteBtn) {
            e.stopPropagation();
            deleteSession(deleteBtn.dataset.deleteId);
            return;
        }
        const item = e.target.closest('.burnish-session-item');
        if (item) switchSession(item.dataset.sessionId);
    });

    // Mobile toggle for session panel
    document.getElementById('btn-toggle-sessions')?.addEventListener('click', () => {
        document.getElementById('session-panel')?.classList.toggle('open');
    });

    // ── Restore from IndexedDB ──
    const state = await loadState();
    if (state?.sessions?.length > 0) {
        sessions = state.sessions;
        activeSessionId = state.activeSessionId || sessions[0].id;
        renderSessionList();
        renderMainContent();
    } else {
        await createSession();
    }

    updateBreadcrumb();

    // Suggestion buttons
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.burnish-suggestion');
        if (!btn) return;

        // Handle action-based buttons (e.g., list-servers)
        if (btn.dataset.action === 'list-servers') {
            if (cachedServers && cachedServers.length > 0) {
                const first = cachedServers[0];
                renderDeterministicToolListing(first.name, first.tools);
            }
            return;
        }

        // Deterministic tool execution for starter prompts with data-tool
        const starterTool = btn.dataset.tool;
        if (starterTool) {
            const args = JSON.parse(btn.dataset.args || '{}');
            executeToolDirect(starterTool, args, btn.dataset.label || starterTool);
            return;
        }

        // Deterministic server button — render tool listing
        if (btn.classList.contains('burnish-suggestion-server')) {
            const serverName = btn.dataset.label;
            const serverData = cachedServers?.find(s => s.name === serverName);
            if (serverData && serverData.tools.length > 0) {
                renderDeterministicToolListing(serverName, serverData.tools);
                return;
            }
        }

        // For any other suggestion, show available servers
        if (btn.dataset.prompt) {
            if (cachedServers && cachedServers.length > 0) {
                const first = cachedServers[0];
                renderDeterministicToolListing(first.name, first.tools);
            }
        }
    });

    // ── Breadcrumb navigation ──
    document.addEventListener('click', (e) => {
        const crumb = e.target.closest('.burnish-crumb');
        if (!crumb) return;
        const nodeId = crumb.dataset.nodeId;
        if (nodeId) {
            const session = getActiveSession();
            if (session) {
                session.activeNodeId = nodeId;
                scrollToNode(nodeId, true);
                updateBreadcrumb();
            }
        } else if (crumb.dataset.scrollTop === 'true') {
            const mainContent = document.getElementById('main-content');
            if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // ── Global keyboard shortcuts ──
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
        // Ctrl/Cmd+K: focus session search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('session-search')?.focus();
            return;
        }
    });

    // ── Stat-bar filter ──
    container.addEventListener('burnish-filter', (e) => {
        const { filter } = e.detail || {};
        const nodeContent = e.target.closest('.burnish-node-content');
        if (!nodeContent) return;

        const sections = nodeContent.querySelectorAll('burnish-section');
        const cards = nodeContent.querySelectorAll('burnish-card');
        const tables = nodeContent.querySelectorAll('burnish-table');

        if (!filter) {
            sections.forEach(el => el.style.display = '');
            cards.forEach(el => el.style.display = '');
            tables.forEach(el => el.style.display = '');
        } else {
            const filterLower = filter.toLowerCase();
            const filterWords = filterLower.split(/\s+/);

            let anyMatch = false;
            sections.forEach(el => {
                const label = (el.getAttribute('label') || '').toLowerCase();
                const matches = filterWords.some(w => label.includes(w)) || label.split(/\s+/).some(w => filterLower.includes(w));
                el.style.display = matches ? '' : 'none';
                if (matches) anyMatch = true;
            });

            if (!anyMatch && sections.length > 0) {
                sections.forEach(el => el.style.display = '');
                cards.forEach(el => {
                    const text = el.textContent?.toLowerCase() || '';
                    const matches = filterWords.some(w => text.includes(w));
                    el.style.display = matches ? '' : 'none';
                });
                anyMatch = [...cards].some(el => el.style.display !== 'none');
            }

            if (!anyMatch) {
                sections.forEach(el => el.style.display = '');
                cards.forEach(el => el.style.display = '');
                tables.forEach(el => el.style.display = '');
            }
        }
    });

    // ── Card drill-down ──
    container.addEventListener('burnish-card-action', (e) => {
        const { title, status, itemId } = e.detail || {};
        if (!title) return;

        // Branch from the node containing this card
        const nodeEl = e.target.closest('.burnish-node');
        if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;

        // Deterministic path: if itemId matches a known tool, render form or execute directly
        const schema = toolSchemaCache[itemId];
        if (schema) {
            const hasAnyParams = schema.properties && Object.keys(schema.properties).length > 0;

            if (hasAnyParams) {
                const formHtml = generateFallbackForm(itemId, schema);
                if (formHtml) {
                    renderDeterministicNode(title, formHtml);
                    return;
                }
            } else {
                executeToolDirect(itemId, {}, title);
                return;
            }
        }

        // Check for card view item reference (viewId:index format)
        const cardRef = itemId?.match(/^(cv-\d+):(\d+)$/);
        if (cardRef) {
            const item = window._cardItems?.[cardRef[1]]?.[parseInt(cardRef[2])];
            if (item && typeof item === 'object') {
                const meta = Object.entries(item)
                    .filter(([, v]) => typeof v !== 'object' && v != null && String(v).length < 200)
                    .slice(0, 8)
                    .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) }));
                const itemTitle = item.full_name || item.name || item.title || title;
                let detailHtml = `<burnish-card title="${escapeAttr(itemTitle)}" status="info" body="${escapeAttr(item.description || item.body || '')}" meta='${escapeAttr(JSON.stringify(meta))}'></burnish-card>`;
                const actions = generateContextualActionsForItem(item);
                if (actions.length > 0) {
                    detailHtml += `<burnish-actions actions='${escapeAttr(JSON.stringify(actions))}'></burnish-actions>`;
                }
                renderDeterministicNode(itemTitle, detailHtml);
                return;
            }
        }

        // Try parsing itemId as JSON (legacy data items)
        try {
            const item = itemId ? JSON.parse(itemId) : null;
            if (item && typeof item === 'object') {
                // Render detail card with contextual actions for this item
                const meta = Object.entries(item)
                    .filter(([, v]) => typeof v !== 'object' && v != null && String(v).length < 200)
                    .slice(0, 8)
                    .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) }));
                const itemTitle = item.full_name || item.name || item.title || title;
                let detailHtml = `<burnish-card title="${escapeAttr(itemTitle)}" status="info" body="${escapeAttr(item.description || item.body || '')}" meta='${escapeAttr(JSON.stringify(meta))}'></burnish-card>`;
                const actions = generateContextualActionsForItem(item);
                if (actions.length > 0) {
                    detailHtml += `<burnish-actions actions='${escapeAttr(JSON.stringify(actions))}'></burnish-actions>`;
                }
                renderDeterministicNode(itemTitle, detailHtml);
                return;
            }
        } catch { /* not JSON */ }

        // Fallback for non-tool, non-data cards
        renderDeterministicNode(title,
            '<burnish-card title="Use the tools above" status="info" body="Select a server, browse its tools, and fill forms to execute them directly."></burnish-card>'
        );
    });

    // ── View mode switcher (Table / Cards / JSON) ──
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.burnish-view-btn');
        if (!btn) return;
        const viewType = btn.dataset.view;
        const dataId = btn.dataset.target;
        const data = window._viewData?.[dataId];
        if (!data) return;

        btn.closest('.burnish-view-switcher').querySelectorAll('.burnish-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const contentEl = document.querySelector(`.burnish-view-content[data-view-id="${dataId}"]`);
        if (!contentEl) return;

        let html;
        if (viewType === 'cards') html = renderCardsView(data.parsed, data.sourceToolName);
        else if (viewType === 'json') html = renderJsonView(data.parsed);
        else html = renderTableView(data.parsed, data.label);

        contentEl.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
    });

    // ── Table row explore click ──
    container.addEventListener('burnish-table-row-click', (e) => {
        const { row } = e.detail || {};
        if (!row) return;

        const title = row.full_name || row.name || row.title || row.login || 'Details';

        const meta = Object.entries(row)
            .filter(([k, v]) => v != null && typeof v !== 'object'
                && !/node_id|_id$|avatar|gravatar/.test(k)
                && String(v).length < 300 && k !== '__itemIndex')
            .slice(0, 12)
            .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) }));

        const body = String(row.description || row.body || '').substring(0, 500);
        let html = `<burnish-card title="${escapeAttr(title)}" status="info" body="${escapeAttr(body)}" meta='${escapeAttr(JSON.stringify(meta))}'></burnish-card>`;

        const actions = generateContextualActionsForItem(row);
        if (actions.length > 0) {
            html += `<burnish-actions actions='${escapeAttr(JSON.stringify(actions))}'></burnish-actions>`;
        }

        const nodeEl = e.target.closest('.burnish-node');
        if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;

        renderDeterministicNode(title, html);
    });

    // ── Form submission (direct execution) ──
    container.addEventListener('burnish-form-submit', async (e) => {
        const { toolId, values } = e.detail || {};
        if (!toolId) return;

        const nodeEl = e.target.closest('.burnish-node');
        if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;

        const bareToolName = toolId.replace(/^mcp__\w+__/, '');
        const isWrite = /^(create|update|delete|remove|push|write|edit|move|fork|merge|add|set|close|lock|assign)/i.test(bareToolName);

        if (isWrite) {
            const toolShortName = (toolId.split('__').pop() || toolId).replace(/_/g, ' ');
            if (!confirm(`Execute write operation: ${toolShortName}?`)) return;

            try {
                const res = await fetch('/api/tools/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toolName: toolId, args: values, confirmed: true }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Execution failed');

                const keyValues = Object.entries(values)
                    .filter(([, v]) => v && String(v).trim())
                    .slice(0, 3)
                    .map(([, v]) => v)
                    .join(', ');
                const displayLabel = keyValues ? `${toolShortName}: ${keyValues}` : toolShortName;
                const resultHtml = buildResultHtml(data.result, displayLabel, toolId);
                const writeNode = renderDeterministicNode(displayLabel, resultHtml);
                if (writeNode) {
                    writeNode._executionMode = 'deterministic';
                    writeNode._toolCall = { toolName: toolId, args: { ...values }, label: displayLabel };
                }
                return;
            } catch (err) {
                console.error('Write tool execution failed:', err.message);
                renderDeterministicNode(toolShortName, `<burnish-card title="Error" status="error" body="${escapeAttr(err.message)}"></burnish-card>`);
                return;
            }
        }

        // Read tools — execute directly
        try {
            const res = await fetch('/api/tools/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: toolId, args: values }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Execution failed');

            const toolShortName = (toolId.split('__').pop() || toolId).replace(/_/g, ' ');
            const keyValues = Object.entries(values)
                .filter(([, v]) => v && String(v).trim())
                .slice(0, 3)
                .map(([, v]) => v)
                .join(', ');
            const displayLabel = keyValues ? `${toolShortName}: ${keyValues}` : toolShortName;

            const nodeId = generateId();
            const session = getActiveSession();
            if (!session) return;

            const parentId = branchFromNodeId || session.activeNodeId || (session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null);

            const node = {
                id: nodeId,
                prompt: `${toolShortName}: ${keyValues}`,
                promptDisplay: displayLabel,
                response: '',
                type: 'components',
                timestamp: Date.now(),
                parentId,
                children: [],
                collapsed: false,
                tags: [],
                summary: displayLabel,
            };
            node._executionMode = 'deterministic';
            node._toolCall = { toolName: toolId, args: { ...values }, label: displayLabel };

            if (parentId) {
                const parent = session.nodes.find(n => n.id === parentId);
                if (parent) parent.children.push(nodeId);
            }
            session.nodes.push(node);
            session.activeNodeId = nodeId;

            renderMainContent();

            const resultHtml = buildResultHtml(data.result, displayLabel, toolId);
            node.response = resultHtml;
            const contentEl = document.querySelector(`[data-node-id="${nodeId}"] .burnish-node-content`);
            if (contentEl) {
                const clean = DOMPurify.sanitize(resultHtml, PURIFY_CONFIG);
                contentEl.innerHTML = clean;
            }

            updateBreadcrumb();
            renderSessionList();
            await saveState();
            branchFromNodeId = null;
            return;
        } catch (err) {
            console.error('Direct execution failed:', err.message);
            const toolShortName = (toolId.split('__').pop() || toolId).replace(/_/g, ' ');
            renderDeterministicNode(toolShortName, `<burnish-card title="Error" status="error" body="${escapeAttr(err.message)}"></burnish-card>`);
        }
    });

    // ── Action bar clicks ──
    container.addEventListener('burnish-action', (e) => {
        const { label, action, prompt } = e.detail || {};
        if (!prompt) return;

        // Check for deterministic direct execution marker
        try {
            const parsed = JSON.parse(prompt);
            if (parsed._directExec) {
                const nodeEl = e.target.closest('.burnish-node');
                if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;

                const schema = toolSchemaCache[parsed.toolName] || toolSchemaCache[`mcp__${parsed.toolName}`];
                const hasRequiredUnfilled = schema?.required?.some(k => !parsed.args[k]);

                if (hasRequiredUnfilled && schema) {
                    const formHtml = generateFallbackForm(parsed.toolName, schema);
                    renderDeterministicNode(label, formHtml);
                } else {
                    executeToolDirect(parsed.toolName, parsed.args, label);
                }
                return;
            }
        } catch { /* not JSON, fall through */ }

        // Non-deterministic action — show hint
        renderDeterministicNode(label,
            '<burnish-card title="Use the tools above" status="info" body="Select a server, browse its tools, and fill forms to execute them directly."></burnish-card>'
        );
    });

    // ── Browser history ──
    window.addEventListener('popstate', (e) => {
        if (e.state?.nodeId) scrollToNode(e.state.nodeId);
    });

});

// ── Helpers ──
function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        const html = marked.parse(text);
        return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html, PURIFY_CONFIG) : html;
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getEmptyState() {
    return `
        <div class="burnish-empty-state">
            <h2>Burnish</h2>
            <p>Explore your data visually through connected services</p>
            <div class="burnish-server-buttons" id="server-buttons">
                <div class="burnish-suggestion-skeleton-pill"></div>
                <div class="burnish-suggestion-skeleton-pill"></div>
            </div>
            <div class="burnish-tool-shortcuts" id="tool-shortcuts"></div>
            <div class="burnish-starter-prompts" id="starter-prompts"></div>
            <div class="burnish-empty-hint" id="empty-hint"></div>
        </div>
    `;
}

// ── Deterministic Rendering Helpers ──

function generateToolListingHtml(serverName, tools) {
    const groups = {};
    for (const tool of tools) {
        const verb = tool.name.split(/[_\-]/)[0] || 'other';
        if (!groups[verb]) groups[verb] = [];
        groups[verb].push(tool);
    }

    const statItems = Object.entries(groups).map(([verb, items]) => ({
        label: verb.charAt(0).toUpperCase() + verb.slice(1),
        value: String(items.length),
        color: items.some(t => /^(create|update|delete|push|write|edit|move)/.test(t.name)) ? 'warning' : 'info',
    }));
    let html = `<burnish-stat-bar items='${escapeAttr(JSON.stringify(statItems))}'></burnish-stat-bar>`;

    for (const [verb, items] of Object.entries(groups)) {
        const label = verb.charAt(0).toUpperCase() + verb.slice(1) + ' Operations';
        html += `<burnish-section label="${escapeAttr(label)}" count="${items.length}" status="info">`;
        for (const tool of items) {
            const toolIsWrite = /^(create|update|delete|push|write|edit|move|fork|merge|add|set|close|lock|assign)/.test(tool.name);
            html += `<burnish-card title="${escapeAttr(tool.name)}" status="${toolIsWrite ? 'warning' : 'success'}" body="${escapeAttr(tool.description || '')}" item-id="${escapeAttr(tool.name)}"></burnish-card>`;
        }
        html += `</burnish-section>`;
    }

    return html;
}

function renderDeterministicToolListing(serverName, tools) {
    const nodeId = generateId();
    const session = getActiveSession();
    if (!session) return;

    const html = generateToolListingHtml(serverName, tools);

    const parentId = session.activeNodeId || (session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null);
    const node = {
        id: nodeId,
        prompt: serverName,
        promptDisplay: serverName,
        response: html,
        type: 'components',
        timestamp: Date.now(),
        parentId,
        children: [],
        collapsed: false,
        tags: tools.map(t => (t.name.split(/[_-]/)[0] || 'other')).filter((v, i, a) => a.indexOf(v) === i),
        summary: `${serverName}: ${tools.length} tools`,
    };

    node._executionMode = 'deterministic';
    node._toolCall = { toolName: '__listing__', args: { serverName }, label: serverName };

    if (parentId) {
        const parent = session.nodes.find(n => n.id === parentId);
        if (parent) parent.children.push(nodeId);
    }
    session.nodes.push(node);
    session.activeNodeId = nodeId;
    session.updatedAt = Date.now();

    if (!session.title || session.title === 'New session') {
        session.title = `${serverName} tools`;
    }

    const emptyState = document.getElementById('main-content')?.querySelector('.burnish-empty-state');
    if (emptyState) emptyState.remove();

    renderMainContent();
    updateBreadcrumb();
    renderSessionList();
    saveState();
}

function renderDeterministicNode(label, html) {
    const nodeId = generateId();
    const session = getActiveSession();
    if (!session) return;

    const parentId = branchFromNodeId || session.activeNodeId || (session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null);
    const node = {
        id: nodeId,
        prompt: label,
        promptDisplay: label,
        response: html,
        type: 'components',
        timestamp: Date.now(),
        parentId,
        children: [],
        collapsed: false,
        tags: [],
        summary: label,
    };

    node._executionMode = 'deterministic';

    if (parentId) {
        const parent = session.nodes.find(n => n.id === parentId);
        if (parent) parent.children.push(nodeId);
    }
    session.nodes.push(node);
    session.activeNodeId = nodeId;
    session.updatedAt = Date.now();

    if (!session.title || session.title === 'New session') {
        session.title = label.substring(0, 60);
    }

    const container = document.getElementById('main-content');
    const emptyState = container?.querySelector('.burnish-empty-state');
    if (emptyState) emptyState.remove();

    renderMainContent();
    updateBreadcrumb();
    renderSessionList();
    saveState();
    branchFromNodeId = null;
    return node;
}

async function executeToolDirect(toolName, args, label) {
    try {
        const res = await fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolName, args }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Execution failed');

        const resultHtml = buildResultHtml(data.result, label, toolName);
        const node = renderDeterministicNode(label, resultHtml);
        if (node) {
            node._executionMode = 'deterministic';
            node._toolCall = { toolName, args: { ...args }, label };
        }
    } catch (err) {
        renderDeterministicNode(label, `<burnish-card title="Error" status="error" body="${escapeAttr(err.message)}"></burnish-card>`);
    }
}

function buildResultHtml(result, label, sourceToolName) {
    try {
        const parsed = JSON.parse(result);
        return renderParsedResult(parsed, label, sourceToolName);
    } catch {
        return `<burnish-card title="${escapeAttr(label)}" status="success" body="${escapeAttr(result.substring(0, 1000))}"></burnish-card>`;
    }
}

function generateContextualActions(resultData, sourceToolName) {
    if (!sourceToolName) return [];
    if (!cachedServers) {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/servers', false);
            xhr.send();
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                cachedServers = data.servers;
            }
        } catch { /* ignore */ }
    }
    if (!cachedServers) return [];

    const items = Array.isArray(resultData) ? resultData :
        (resultData?.items || resultData?.results || resultData?.data || []);
    if (items.length === 0 || typeof items[0] !== 'object') return [];

    const firstItem = items[0];
    const actions = [];

    let serverName = sourceToolName.replace(/^mcp__/, '').split('__')[0];
    let server = cachedServers?.find(s => s.name === serverName);
    if (!server && cachedServers) {
        const shortName = sourceToolName.replace(/^mcp__\w+__/, '');
        for (const s of cachedServers) {
            if (s.tools.some(t => t.name === shortName || t.name === sourceToolName)) {
                server = s;
                serverName = s.name;
                break;
            }
        }
    }
    if (!server) return actions;

    if (firstItem.full_name && firstItem.full_name.includes('/')) {
        const [owner, repo] = firstItem.full_name.split('/');
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            if (props.owner && props.repo && !sourceToolName.includes(tool.name)) {
                const toolId = tool.name;
                const shortName = tool.name.replace(/_/g, ' ');
                const isWrite = /^(create|update|delete|push|write|edit|move|fork|merge|add)/.test(tool.name);
                actions.push({
                    label: shortName,
                    action: isWrite ? 'write' : 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: toolId, args: { owner, repo } }),
                    icon: isWrite ? 'edit' : 'search',
                });
            }
        }
    }

    if (firstItem.path || firstItem.name) {
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            if (props.path && !sourceToolName.includes(tool.name) && /^(list|read|get|directory)/.test(tool.name)) {
                actions.push({
                    label: tool.name.replace(/_/g, ' '),
                    action: 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args: {} }),
                    icon: 'list',
                });
            }
        }
    }

    actions.sort((a, b) => {
        if (a.action === 'read' && b.action !== 'read') return -1;
        if (a.action !== 'read' && b.action === 'read') return 1;
        return 0;
    });
    return actions.slice(0, 6);
}

function generateContextualActionsForItem(item) {
    if (!cachedServers) {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/servers', false);
            xhr.send();
            if (xhr.status === 200) cachedServers = JSON.parse(xhr.responseText).servers;
        } catch { /* ignore */ }
    }
    if (!cachedServers) return [];

    const actions = [];

    for (const server of cachedServers) {
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            const args = {};
            let matchCount = 0;

            if (props.owner && item.full_name && item.full_name.includes('/')) {
                args.owner = item.full_name.split('/')[0];
                matchCount++;
            }
            if (props.repo && item.full_name && item.full_name.includes('/')) {
                args.repo = item.full_name.split('/')[1];
                matchCount++;
            }
            if (props.path && item.path) {
                args.path = item.path;
                matchCount++;
            }
            if (props.issue_number && item.number) {
                args.issue_number = item.number;
                matchCount++;
            }

            if (matchCount >= 1) {
                const isWrite = /^(create|update|delete|push|write|edit|move|fork|merge|add)/.test(tool.name);
                actions.push({
                    label: tool.name.replace(/_/g, ' '),
                    action: isWrite ? 'write' : 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args }),
                    icon: isWrite ? 'edit' : 'search',
                });
            }
        }
    }

    actions.sort((a, b) => (a.action === 'read' ? -1 : 1) - (b.action === 'read' ? -1 : 1));
    return actions.slice(0, 6);
}

// ── View switching data store ──
window._viewData = window._viewData || {};

function renderViewSwitcher(dataId, activeView, count) {
    return `<div class="burnish-view-switcher" data-view-id="${dataId}">
        <button class="burnish-view-btn ${activeView === 'cards' ? 'active' : ''}" data-view="cards" data-target="${dataId}">Cards</button>
        <button class="burnish-view-btn ${activeView === 'table' ? 'active' : ''}" data-view="table" data-target="${dataId}">Table</button>
        <button class="burnish-view-btn ${activeView === 'json' ? 'active' : ''}" data-view="json" data-target="${dataId}">JSON</button>
        <span class="burnish-view-count">${count} items</span>
    </div>`;
}

function stripMarkdown(text) {
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

function inferCardStatus(item, sourceToolName) {
    // Infer from data state fields
    if (item.state === 'closed' || item.state === 'merged') return 'success';
    if (item.state === 'open') return 'info';
    if (item.draft === true) return 'muted';
    // Infer from source tool
    if (sourceToolName) {
        const base = sourceToolName.replace(/^mcp__\w+__/, '');
        if (/^(create|update|delete|push|write|edit|move|fork|merge|add|set|close)/.test(base)) return 'warning';
    }
    return 'success';
}

function renderCardsView(items, sourceToolName) {
    const viewId = 'cv-' + Date.now();
    window._cardItems = window._cardItems || {};
    window._cardItems[viewId] = items;

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
            item-id="${escapeAttr(viewId + ':' + i)}"></burnish-card>`;
    }
    html += '</div>';
    return html;
}

function renderTableView(items, label) {
    const allKeys = Object.keys(items[0]);

    // Priority columns — show these first if they exist
    const priority = ['title','name','full_name','number','state','status',
        'login','description','language','created_at','updated_at',
        'stargazers_count','path','size','type','message','body'];

    // Exclude URL/API fields and internal IDs
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

function renderJsonView(items) {
    return `<pre class="burnish-json-view">${escapeHtml(JSON.stringify(items, null, 2).substring(0, 50000))}</pre>`;
}

function renderParsedResult(parsed, label, sourceToolName) {
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            return `<burnish-card title="${escapeAttr(label)}" status="muted" body="No results"></burnish-card>`;
        }
        if (typeof parsed[0] === 'object') {
            // Store data for view switching
            const dataId = 'vd-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            window._viewData[dataId] = { parsed, label, sourceToolName };

            // Default: cards view (always visible, drillable)
            const defaultView = 'cards';
            let html = `<burnish-stat-bar items='${escapeAttr(JSON.stringify([{label:"Results",value:String(parsed.length),color:"info"}]))}'></burnish-stat-bar>`;
            html += renderViewSwitcher(dataId, defaultView, parsed.length);
            html += `<div class="burnish-view-content" data-view-id="${dataId}">`;
            html += renderCardsView(parsed, sourceToolName);
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

async function loadDynamicSuggestions(container) {
    try {
        const res = await fetch('/api/servers');
        const { servers } = await res.json();

        cachedServers = servers;

        for (const s of servers) {
            for (const tool of s.tools) {
                if (tool.inputSchema) {
                    toolSchemaCache[tool.name] = tool.inputSchema;
                    toolSchemaCache[`mcp__${s.name}__${tool.name}`] = tool.inputSchema;
                }
            }
        }

        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) {
            if (servers.length === 0) {
                serverBtns.innerHTML = '<span class="burnish-no-servers">No servers connected</span>';
            } else {
                serverBtns.innerHTML = servers.map(s => `
                    <button class="burnish-suggestion burnish-suggestion-server" data-label="${escapeAttr(s.name)}">
                        <span class="burnish-server-status ${s.status === 'connected' ? 'connected' : 'disconnected'}"></span>
                        ${escapeHtml(s.name)}
                        <span class="burnish-suggestion-sub">${s.toolCount} tools</span>
                    </button>
                `).join('');
            }
        }

        // Generate tool shortcuts
        const readPattern = /^(list|search|get|find|query|browse|fetch|describe|directory)/;
        const shortcuts = [];
        for (const s of servers) {
            let countForServer = 0;
            const usedVerbs = new Set();
            for (const tool of s.tools) {
                if (countForServer >= 2 || shortcuts.length >= 6) break;
                const verb = (tool.name.match(/^(\w+?)_/) || [])[1] || tool.name;
                if (!readPattern.test(tool.name) || usedVerbs.has(verb)) continue;
                usedVerbs.add(verb);
                const firstSentence = tool.description ? tool.description.split(/[.!]/)[0] : '';
                const label = firstSentence
                    ? firstSentence.substring(0, 40) + (firstSentence.length > 40 ? '...' : '')
                    : tool.name.replace(/_/g, ' ');

                // Determine if tool has required params
                const schema = tool.inputSchema;
                const hasRequired = schema?.required?.length > 0;
                const hasParams = schema?.properties && Object.keys(schema.properties).length > 0;

                if (hasRequired || hasParams) {
                    // Show form for tools with parameters
                    shortcuts.push({
                        label,
                        tool: tool.name,
                        args: {},
                    });
                } else {
                    // Execute directly for parameterless tools
                    shortcuts.push({
                        label,
                        tool: tool.name,
                        args: {},
                    });
                }
                countForServer++;
            }
        }

        const toolSection = container.querySelector('#tool-shortcuts');
        if (toolSection) {
            if (shortcuts.length === 0) {
                toolSection.innerHTML = '';
            } else {
                toolSection.innerHTML = shortcuts.map(s => `
                    <button class="burnish-suggestion" data-tool="${escapeAttr(s.tool)}" data-args="${escapeAttr(JSON.stringify(s.args))}" data-label="${escapeAttr(s.label)}">
                        ${escapeHtml(s.label)}
                    </button>
                `).join('');
            }
        }

        // Render curated starter prompt chips
        const starterSection = container.querySelector('#starter-prompts');
        if (starterSection && servers.length > 0) {
            const starters = [];
            for (const s of servers) {
                const serverPrompts = STARTER_PROMPTS[s.name] || STARTER_PROMPTS._default;
                starters.push(...serverPrompts.slice(0, 2));
            }
            const limited = starters.slice(0, 6);
            if (limited.length > 0) {
                starterSection.innerHTML = limited.map(s => {
                    let toolAttr = '';
                    let argsAttr = '';
                    if (s.tool) {
                        const fullToolName = Object.keys(toolSchemaCache).find(k => k.endsWith(s.tool)) || s.tool;
                        toolAttr = ` data-tool="${escapeAttr(fullToolName)}"`;
                        argsAttr = ` data-args="${escapeAttr(JSON.stringify(s.args || {}))}"`;
                    }
                    const promptAttr = s.prompt ? ` data-prompt="${escapeAttr(s.prompt)}"` : '';
                    const actionAttr = s.action ? ` data-action="${escapeAttr(s.action)}"` : '';
                    return `
                        <button class="burnish-suggestion"${promptAttr}${toolAttr}${argsAttr}${actionAttr} data-label="${escapeAttr(s.label)}">
                            ${escapeHtml(s.label)}
                        </button>
                    `;
                }).join('');
            }
        }

        const hintEl = container.querySelector('#empty-hint');
        if (hintEl && servers.length > 0) {
            hintEl.innerHTML = '<span class="burnish-hint-text">Click a server to browse its tools, or use the shortcuts above</span>';
        }
    } catch {
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) serverBtns.innerHTML = '';
        const toolSection = container.querySelector('#tool-shortcuts');
        if (toolSection) toolSection.innerHTML = '';
        const starterSection = container.querySelector('#starter-prompts');
        if (starterSection) starterSection.innerHTML = '';
    }
}
