/**
 * Burnish Demo App — main orchestration.
 * Multi-session management with inline conversation and infinite scroll navigation.
 */

import { get, set, del, keys, createStore } from 'idb-keyval';

// ── IndexedDB Stores ──
// Each store uses a separate database — idb-keyval's createStore only supports
// one object store per database. Using the same DB name for both would cause
// the second store to fail (the DB already exists with only the first store).
const sessionStore = createStore('burnish-sessions', 'sessions');
const nodeStore = createStore('burnish-nodes', 'nodes');

// ── DOMPurify Config ──
const PURIFY_CONFIG = {
    ADD_TAGS: ['burnish-card', 'burnish-stat-bar', 'burnish-table', 'burnish-chart',
               'burnish-section', 'burnish-metric', 'burnish-message', 'burnish-form', 'burnish-actions'],
    ADD_ATTR: ['items', 'title', 'status', 'body', 'meta', 'columns', 'rows',
               'status-field', 'type', 'config', 'role', 'content', 'class',
               'label', 'count', 'collapsed', 'item-id', 'value', 'unit', 'trend',
               'streaming', 'tool-id', 'fields', 'actions', 'color'],
};

const CONTAINER_TAGS = new Set(['burnish-section']);

const ICON_SEND = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l7-7v4h9v6H9v4z" transform="rotate(-90 10 10)"/></svg>`;
const ICON_STOP = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`;
const ICON_FOCUS = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,1 1,1 1,4"/><polyline points="12,1 15,1 15,4"/><polyline points="4,15 1,15 1,12"/><polyline points="12,15 15,15 15,12"/></svg>`;
const ICON_RESTORE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,4 4,4 4,1"/><polyline points="12,1 12,4 15,4"/><polyline points="1,12 4,12 4,15"/><polyline points="12,15 12,12 15,12"/></svg>`;
const ICON_REFRESH = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8a7 7 0 0 1 13-3.5M15 8a7 7 0 0 1-13 3.5"/><polyline points="1,1 1,5 5,5"/><polyline points="15,15 15,11 11,11"/></svg>`;

// ── State ──
let activeSource = null;
let cancelGeneration = 0;
let fastMode = localStorage.getItem('burnish:fastMode') === 'true';
let searchQuery = '';
let searchDebounceTimer = null;

// Multi-session state
let sessions = [];
let activeSessionId = null;

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId);
}

// ── Tree Utilities ──
function getNodeById(session, id) { return session.nodes.find(n => n.id === id); }
function getChildren(session, nodeId) { return session.nodes.filter(n => n.parentId === nodeId); }
function getRootNodes(session) { return session.nodes.filter(n => !n.parentId); }

function getAncestryPath(session, nodeId) {
    const path = [];
    let current = getNodeById(session, nodeId);
    while (current) {
        path.unshift(current);
        current = current.parentId ? getNodeById(session, current.parentId) : null;
    }
    return path;
}

function getActivePath(session) {
    if (!session.activeNodeId) return new Set();
    return new Set(getAncestryPath(session, session.activeNodeId).map(n => n.id));
}

// Track which node to branch from (set when user clicks "Branch" button)
let branchFromNodeId = null;

// Track which node is currently streaming (for spinner)
let streamingNodeId = null;

// Track tool hint for drill-down fallback form generation
let drillDownToolHint = null;

// Cache of tool schemas keyed by tool name (populated from /api/servers)
const toolSchemaCache = {};

// ── Persistence (IndexedDB via idb-keyval) ──

// Track which sessions have had their nodes loaded from IndexedDB
const _loadedSessionIds = new Set();

async function saveState() {
    try {
        // Save session metadata (with nodeIds instead of full nodes)
        // For unloaded sessions, preserve their existing _nodeIds to avoid orphaning nodes
        const sessionMeta = sessions.map(s => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            conversationId: s.conversationId,
            activeNodeId: s.activeNodeId,
            nodeIds: _loadedSessionIds.has(s.id) ? s.nodes.map(n => n.id) : (s._nodeIds || []),
        }));
        await set('sessions', { activeSessionId, sessions: sessionMeta }, sessionStore);

        // Save individual nodes for all loaded sessions
        const nodePromises = [];
        for (const s of sessions) {
            if (!_loadedSessionIds.has(s.id)) continue;
            for (const node of s.nodes) {
                nodePromises.push(set(`node:${node.id}`, node, nodeStore));
            }
        }
        await Promise.all(nodePromises);
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

async function loadState() {
    try {
        // Try migration from localStorage first
        await migrateFromLocalStorage();

        const data = await get('sessions', sessionStore);
        if (!data?.sessions?.length) return null;

        // Load nodes for the active session only (lazy-load others on switch)
        const activeId = data.activeSessionId || data.sessions[0].id;
        const fullSessions = [];
        for (const meta of data.sessions) {
            const session = {
                id: meta.id,
                title: meta.title,
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                conversationId: meta.conversationId,
                activeNodeId: meta.activeNodeId,
                nodes: [],
            };

            if (meta.id === activeId) {
                await loadSessionNodes(session, meta.nodeIds || []);
                _loadedSessionIds.add(meta.id);
            } else {
                // Store nodeIds for lazy loading later
                session._nodeIds = meta.nodeIds || [];
            }

            fullSessions.push(session);
        }

        return { activeSessionId: activeId, sessions: fullSessions };
    } catch (e) {
        console.error('Failed to load state:', e);
        return null;
    }
}

async function loadSessionNodes(session, nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return;
    const nodes = await Promise.all(
        nodeIds.map(id => get(`node:${id}`, nodeStore))
    );
    session.nodes = nodes.filter(Boolean);
}

async function clearState() {
    const allKeys = await keys(nodeStore);
    await Promise.all(allKeys.map(k => del(k, nodeStore)));
    await del('sessions', sessionStore);
    _loadedSessionIds.clear();
}

async function migrateFromLocalStorage() {
    try {
        // Check if already migrated (IndexedDB has data)
        const existing = await get('sessions', sessionStore);
        if (existing) return;

        // Try new multi-session format from localStorage
        const raw = localStorage.getItem('burnish:sessions');
        if (raw) {
            const data = JSON.parse(raw);
            if (data?.sessions?.length > 0) {
                // Save session metadata
                const sessionMeta = data.sessions.map(s => ({
                    id: s.id,
                    title: s.title,
                    createdAt: s.createdAt,
                    updatedAt: s.updatedAt,
                    conversationId: s.conversationId,
                    activeNodeId: s.activeNodeId,
                    nodeIds: (s.nodes || []).map(n => n.id),
                }));
                await set('sessions', { activeSessionId: data.activeSessionId, sessions: sessionMeta }, sessionStore);

                // Save individual nodes
                const nodePromises = [];
                for (const s of data.sessions) {
                    for (const node of (s.nodes || [])) {
                        nodePromises.push(set(`node:${node.id}`, node, nodeStore));
                    }
                }
                await Promise.all(nodePromises);

                localStorage.removeItem('burnish:sessions');
                return;
            }
        }

        // Try old single-session format
        const oldRaw = localStorage.getItem('burnish:state');
        if (oldRaw) {
            const old = JSON.parse(oldRaw);
            if (old.nodes?.length > 0) {
                const sessionId = generateId();
                const sessionMeta = [{
                    id: sessionId,
                    title: old.nodes[0]?.promptDisplay || 'Previous session',
                    createdAt: old.nodes[0]?.timestamp || Date.now(),
                    updatedAt: old.nodes[old.nodes.length - 1]?.timestamp || Date.now(),
                    conversationId: old.conversationId,
                    activeNodeId: old.nodes[old.nodes.length - 1]?.id,
                    nodeIds: old.nodes.map(n => n.id),
                }];
                await set('sessions', { activeSessionId: sessionId, sessions: sessionMeta }, sessionStore);

                const nodePromises = old.nodes.map(n => set(`node:${n.id}`, n, nodeStore));
                await Promise.all(nodePromises);
            }
            localStorage.removeItem('burnish:state');
        }
    } catch (e) {
        console.error('Migration from localStorage failed:', e);
    }
}

// ── Session CRUD ──
async function createSession() {
    const session = {
        id: generateId(),
        title: 'New conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: null,
        nodes: [],
    };
    sessions.unshift(session);
    activeSessionId = session.id;
    _loadedSessionIds.add(session.id);
    renderSessionList();
    renderMainContent();
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
    if (session && !_loadedSessionIds.has(session.id) && session._nodeIds) {
        await loadSessionNodes(session, session._nodeIds);
        delete session._nodeIds;
        _loadedSessionIds.add(session.id);
    }

    renderMainContent();
    renderSessionList();
    await saveState();
}

async function deleteSession(sessionId) {
    const session = sessions.find(s => s.id === sessionId);
    const name = session?.title || 'this session';
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    // Collect node IDs to delete from IndexedDB
    let nodeIds = session?.nodes?.length ? session.nodes.map(n => n.id) : (session?._nodeIds || []);
    // Fallback: read from IndexedDB metadata if session wasn't loaded
    if (nodeIds.length === 0 && session) {
        const meta = await get('sessions', sessionStore);
        const saved = meta?.sessions?.find(s => s.id === sessionId);
        if (saved?.nodeIds?.length) nodeIds = saved.nodeIds;
    }

    sessions = sessions.filter(s => s.id !== sessionId);
    _loadedSessionIds.delete(sessionId);

    if (activeSessionId === sessionId) {
        activeSessionId = sessions[0]?.id || null;
        if (!activeSessionId) await createSession();
        else { renderMainContent(); }
    }
    renderSessionList();

    // Delete orphaned nodes from IndexedDB
    if (nodeIds.length > 0) {
        await Promise.all(nodeIds.map(id => del(`node:${id}`, nodeStore)));
    }
    await saveState();
}

// ── Summary & Helpers ──
function generateSummary(contentEl) {
    const tagEls = contentEl.querySelectorAll(
        'burnish-stat-bar, burnish-table, burnish-card, burnish-chart, burnish-metric, burnish-section'
    );
    const tags = [...new Set([...tagEls].map(el => el.tagName.toLowerCase().replace('burnish-', '')))];

    const statBar = contentEl.querySelector('burnish-stat-bar');
    let keyValues = '';
    if (statBar) {
        try {
            const items = JSON.parse(statBar.getAttribute('items') || '[]');
            keyValues = items.slice(0, 3).map(i => `${i.value} ${i.label}`).join(', ');
        } catch { /* ignore */ }
    }

    if (tags.length === 0) {
        const text = contentEl.textContent?.trim() || '';
        return { tags: ['text'], summary: text.substring(0, 60) + (text.length > 60 ? '...' : '') };
    }
    return { tags, summary: keyValues || tags.join(' + ') };
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    if (!breadcrumb) return;
    const session = getActiveSession();
    if (!session) { breadcrumb.textContent = 'Dashboard'; return; }
    const trail = [session.title || 'Dashboard'];
    const lastNode = session.nodes[session.nodes.length - 1];
    if (lastNode) {
        const label = lastNode.promptDisplay || lastNode.prompt;
        trail.push(label.length > 30 ? label.substring(0, 30) + '...' : label);
    }
    breadcrumb.textContent = trail.join(' > ');
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
    const unloaded = sessions.filter(s => s._nodeIds && !_loadedSessionIds.has(s.id));
    if (unloaded.length === 0) return;
    await Promise.all(unloaded.map(async s => {
        await loadSessionNodes(s, s._nodeIds);
        delete s._nodeIds;
        _loadedSessionIds.add(s.id);
    }));
}

function renderSessionList() {
    const listEl = document.getElementById('session-list');
    if (!listEl) return;

    // If searching and there are unloaded sessions, load them first then re-render
    if (searchQuery && sessions.some(s => s._nodeIds && !_loadedSessionIds.has(s.id))) {
        ensureAllSessionsLoaded().then(() => renderSessionList());
        return;
    }

    // Group by time
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
                    <div class="burnish-session-meta">${stepCount} step${stepCount !== 1 ? 's' : ''} \u2022 ${formatTimeAgo(s.updatedAt || s.createdAt)}</div>
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

    // Build stats tooltip content
    const statsParts = [];
    if (node.stats) {
        const dur = (node.stats.durationMs / 1000).toFixed(1);
        const tokens = (node.stats.inputTokens || 0) + (node.stats.outputTokens || 0);
        statsParts.push(`${dur}s`);
        if (tokens > 0) statsParts.push(`${tokens.toLocaleString()} tokens`);
        if (node.stats.costUsd) statsParts.push(`$${node.stats.costUsd.toFixed(4)}`);
    }
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
    if (!node || streamingNodeId) return;

    // Clear existing response and re-submit
    node.response = null;
    node.type = null;
    node.tags = null;
    node.summary = null;
    node.stats = null;
    node._progressLog = [];
    session.activeNodeId = nodeId;

    // Re-render and simulate a new submission for this node's prompt
    renderMainContent();
    const nodeEl = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    const contentEl = nodeEl?.querySelector('.burnish-node-content');
    if (contentEl) contentEl.innerHTML = getProgressHtml();

    addNodeSpinner(nodeId);
    updateNodeStatus(nodeId, 'Submitting…');

    const promptInput = document.getElementById('prompt-input');
    const submitBtn = document.getElementById('btn-submit');
    submitBtn.classList.add('cancel');
    submitBtn.innerHTML = ICON_STOP;
    promptInput.disabled = true;

    let renderedCount = 0;
    let streamingStarted = false;
    const containerStack = [];

    // Build contextual prompt (same logic as handleSubmit)
    let contextualPrompt = node.prompt;
    if (node.parentId) {
        const ancestry = getAncestryPath(session, node.parentId);
        const contextParts = ancestry
            .filter(n => n.response)
            .slice(-3)
            .map(n => `Previous step "${n.promptDisplay}": ${(n.response || '').substring(0, 200)}`)
            .join('\n');
        if (contextParts) {
            contextualPrompt = `Context from previous steps:\n${contextParts}\n\nCurrent request: ${node.prompt}`;
        }
    }

    submitPrompt(
        contextualPrompt,
        session.conversationId,
        (chunk, fullText) => {
            const trimmed = fullText.trim();
            if (containsBurnishTags(trimmed)) {
                if (!streamingStarted) {
                    streamingStarted = true;
                    stopProgressTimer();
                    contentEl.innerHTML = '';
                    node.type = 'components';
                }
                const elements = findStreamElements(trimmed);
                while (renderedCount < elements.length) {
                    appendStreamElement(contentEl, containerStack, elements[renderedCount]);
                    renderedCount++;
                }
            } else {
                contentEl.innerHTML = `<div class="burnish-text-response burnish-streaming">${renderMarkdown(trimmed)}</div>`;
            }
        },
        async (fullText, newConversationId) => {
            stopProgressTimer();
            removeNodeSpinner(nodeId);
            removeNodeStatus(nodeId);
            submitBtn.classList.remove('cancel');
            submitBtn.innerHTML = ICON_SEND;
            promptInput.disabled = false;

            session.conversationId = newConversationId;
            const trimmed = fullText.trim();
            node.response = trimmed;
            node.type = containsBurnishTags(trimmed) ? 'components' : 'text';

            if (containsBurnishTags(trimmed)) {
                // Always apply transformOutput on completion to ensure
                // color normalization rules run (streaming bypasses them)
                contentEl.innerHTML = '';
                const clean = transformOutput(DOMPurify.sanitize(extractHtmlContent(trimmed), PURIFY_CONFIG));
                const temp = document.createElement('template');
                temp.innerHTML = clean;
                contentEl.appendChild(temp.content);
            } else {
                contentEl.innerHTML = `<div class="burnish-text-response">${renderMarkdown(trimmed)}</div>`;
            }

            updateNodeSummary(nodeId);
            updateBreadcrumb();
            renderSessionList();
            await saveState();
        },
        async (error) => {
            stopProgressTimer();
            removeNodeSpinner(nodeId);
            removeNodeStatus(nodeId);
            submitBtn.classList.remove('cancel');
            submitBtn.innerHTML = ICON_SEND;
            promptInput.disabled = false;
            contentEl.innerHTML = `<div class="burnish-text-response">Error: ${escapeHtml(error)}</div>`;
            node.response = error;
            node.type = 'text';
            node.summary = 'Error';
            node.tags = ['error'];
            updateNodeSummary(nodeId);
            await saveState();
        },
        (stage, detail, meta) => {
            updateProgress(contentEl, stage, detail);
            let statusText = detail || stage;
            if (meta?.server) statusText += ` (${meta.server})`;
            else if (meta?.model) statusText += ` (${meta.model})`;
            updateNodeStatus(nodeId, statusText);
            node._progressLog.push({ stage, detail, meta, timestamp: Date.now() });
        },
        async (stats) => {
            node.stats = stats;
            updateNodeHeader(nodeId);
            await saveState();
        }
    );
}

async function toggleNode(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    node.collapsed = !node.collapsed;

    // When expanding a node, make it the active node so its branch highlights
    if (!node.collapsed) {
        session.activeNodeId = nodeId;
        renderMainContent();  // Re-render to update active path dimming
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

function getDescendantIds(session, nodeId) {
    const ids = [nodeId];
    const children = getChildren(session, nodeId);
    for (const child of children) {
        ids.push(...getDescendantIds(session, child.id));
    }
    return ids;
}

async function deleteNode(nodeId) {
    const session = getActiveSession();
    if (!session) return;

    const node = getNodeById(session, nodeId);
    if (!node) return;

    // Count all descendants
    const removeIds = new Set(getDescendantIds(session, nodeId));
    const count = removeIds.size;
    const noun = count === 1 ? 'this step' : `this step and ${count - 1} descendant${count > 2 ? 's' : ''}`;

    if (!confirm(`Delete ${noun}? This cannot be undone.`)) return;

    // Remove from parent's children array
    if (node.parentId) {
        const parent = getNodeById(session, node.parentId);
        if (parent?.children) {
            parent.children = parent.children.filter(id => id !== nodeId);
        }
    }

    // Remove all descendants from nodes array
    session.nodes = session.nodes.filter(n => !removeIds.has(n.id));

    // Update active node if it was deleted
    if (removeIds.has(session.activeNodeId)) {
        session.activeNodeId = node.parentId || (session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null);
    }

    session.updatedAt = Date.now();
    renderMainContent();
    renderSessionList();

    // Remove deleted nodes from IndexedDB
    await Promise.all([...removeIds].map(id => del(`node:${id}`, nodeStore)));
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
    if (node.stats) {
        const dur = (node.stats.durationMs / 1000).toFixed(1);
        const tokens = (node.stats.inputTokens || 0) + (node.stats.outputTokens || 0);
        parts.push(`${dur}s`);
        if (tokens > 0) parts.push(`${tokens.toLocaleString()} tokens`);
        if (node.stats.costUsd) parts.push(`$${node.stats.costUsd.toFixed(4)}`);
    }
    if (node.summary) parts.push(node.summary);

    const infoBtn = el.querySelector('.burnish-node-info');
    if (infoBtn) {
        infoBtn.title = parts.join(' \u2022 ');
    } else if (parts.length > 0) {
        // Insert info button if it doesn't exist yet
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

function addNodeSpinner(nodeId) {
    streamingNodeId = nodeId;
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const header = el.querySelector('.burnish-node-header');
    if (!header || header.querySelector('.burnish-node-spinner')) return;
    const spinner = document.createElement('span');
    spinner.className = 'burnish-node-spinner';
    // Insert before the action buttons (info/maximize/delete) — after the time element
    const timeEl = header.querySelector('.burnish-node-time');
    if (timeEl) {
        timeEl.after(spinner);
    } else {
        header.appendChild(spinner);
    }
}

function removeNodeSpinner(nodeId) {
    streamingNodeId = null;
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    el.querySelector('.burnish-node-spinner')?.remove();
}

function updateNodeStatus(nodeId, text) {
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const header = el.querySelector('.burnish-node-header');
    if (!header) return;
    let statusEl = header.querySelector('.burnish-node-status');
    if (!statusEl) {
        statusEl = document.createElement('span');
        statusEl.className = 'burnish-node-status';
        // Insert before the time element
        const timeEl = header.querySelector('.burnish-node-time');
        if (timeEl) {
            timeEl.before(statusEl);
        } else {
            header.appendChild(statusEl);
        }
    }
    statusEl.textContent = text;
}

function removeNodeStatus(nodeId) {
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    el.querySelector('.burnish-node-status')?.remove();
}

function toggleDiagnosticPanel(nodeId) {
    const el = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.burnish-node-content');
    if (!contentEl) return;

    // Toggle existing panel
    const existing = contentEl.querySelector('.burnish-diagnostic-panel');
    if (existing) { existing.remove(); return; }

    // Find node data
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const panel = document.createElement('div');
    panel.className = 'burnish-diagnostic-panel';

    // Summary metrics
    const metrics = [];
    if (node.stats) {
        const dur = (node.stats.durationMs / 1000).toFixed(1);
        metrics.push(`<span class="burnish-diag-metric"><strong>Duration</strong> ${dur}s</span>`);
        if (node.stats.inputTokens || node.stats.outputTokens) {
            metrics.push(`<span class="burnish-diag-metric"><strong>Tokens</strong> ${(node.stats.inputTokens || 0).toLocaleString()} in / ${(node.stats.outputTokens || 0).toLocaleString()} out</span>`);
        }
        if (node.stats.costUsd) {
            metrics.push(`<span class="burnish-diag-metric"><strong>Cost</strong> $${node.stats.costUsd.toFixed(4)}</span>`);
        }
    }

    // Extract model from progress log
    const progressLog = node._progressLog || [];
    const modelEntry = progressLog.find(e => e.meta?.model);
    if (modelEntry) {
        metrics.unshift(`<span class="burnish-diag-metric"><strong>Model</strong> ${escapeHtml(modelEntry.meta.model)}</span>`);
    }

    // Step timeline
    let stepsHtml = '';
    if (progressLog.length > 0) {
        const baseTime = progressLog[0].timestamp;
        stepsHtml = '<div class="burnish-diag-steps">';
        for (let i = 0; i < progressLog.length; i++) {
            const step = progressLog[i];
            const elapsed = ((step.timestamp - baseTime) / 1000).toFixed(1);
            let label = escapeHtml(step.detail || step.stage);
            if (step.meta?.server) label += ` (${escapeHtml(step.meta.server)})`;
            else if (step.meta?.model) label += ` (${escapeHtml(step.meta.model)})`;

            // Duration for this step = time until next step (or until end)
            let stepDur = '';
            if (i < progressLog.length - 1) {
                stepDur = ((progressLog[i + 1].timestamp - step.timestamp) / 1000).toFixed(1) + 's';
            } else if (node.stats) {
                // Last step: compute from total duration
                const totalEnd = progressLog[0].timestamp + node.stats.durationMs;
                stepDur = ((totalEnd - step.timestamp) / 1000).toFixed(1) + 's';
            }

            stepsHtml += `<div class="burnish-diag-step">`
                + `<span class="burnish-diag-check">\u2713</span>`
                + `<span class="burnish-diag-label">${label}</span>`
                + `<span class="burnish-diag-time">${stepDur}</span>`
                + `</div>`;
        }
        stepsHtml += '</div>';
    }

    panel.innerHTML = (metrics.length > 0
        ? `<div class="burnish-diag-metrics">${metrics.join('')}</div>` : '')
        + stepsHtml;

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

    // Scroll to active node
    if (session.activeNodeId) {
        setTimeout(() => scrollToNode(session.activeNodeId, false), 100);
    }
}

function renderTreeNode(container, session, node, activePath) {
    const isActive = activePath.has(node.id);

    // Collapse non-active nodes (except the active leaf)
    const isActiveLeaf = node.id === getActiveSession()?.activeNodeId;
    node.collapsed = !isActiveLeaf;

    const nodeEl = createNodeEl(node);
    if (!isActive) nodeEl.classList.add('burnish-node-dimmed');
    container.appendChild(nodeEl);

    // Populate content
    if (node.response) {
        const contentEl = nodeEl.querySelector('.burnish-node-content');
        if (node.type === 'components') {
            const clean = transformOutput(DOMPurify.sanitize(extractHtmlContent(node.response), PURIFY_CONFIG));
            const temp = document.createElement('template');
            temp.innerHTML = clean;
            contentEl.appendChild(temp.content);
        } else {
            contentEl.innerHTML = `<div class="burnish-text-response">${renderMarkdown(node.response)}</div>`;
        }
    } else if (isActiveLeaf && !node.collapsed) {
        // Show progress indicator for active nodes with no response yet
        const contentEl = nodeEl.querySelector('.burnish-node-content');
        if (contentEl) contentEl.innerHTML = getProgressHtml();
    }

    const children = getChildren(session, node.id);
    if (children.length === 0) return;

    if (children.length === 1) {
        // Single child — continue vertically
        const connector = document.createElement('div');
        connector.className = 'burnish-tree-connector';
        container.appendChild(connector);
        renderTreeNode(container, session, children[0], activePath);
    } else {
        // Multiple children — branch horizontally, each with its own connector
        const branchContainer = document.createElement('div');
        branchContainer.className = 'burnish-tree-branches';
        container.appendChild(branchContainer);

        for (const child of children) {
            const branchCol = document.createElement('div');
            branchCol.className = 'burnish-tree-branch-col';
            if (activePath.has(child.id)) branchCol.classList.add('active');
            branchContainer.appendChild(branchCol);

            // Each branch gets its own connector line
            const branchConnector = document.createElement('div');
            branchConnector.className = 'burnish-tree-connector';
            branchCol.appendChild(branchConnector);

            renderTreeNode(branchCol, session, child, activePath);
        }
    }
}

// ── Progress Indicator (audit trail) ──
let _progressTimer = null;

function getProgressHtml() {
    return `
        <div class="burnish-progress" data-start="${Date.now()}">
            <div class="burnish-progress-trail"></div>
        </div>
    `;
}

function stopProgressTimer() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
}

function updateProgress(contentEl, stage, detail) {
    const progressEl = contentEl.querySelector('.burnish-progress');
    if (!progressEl) return;
    const trail = progressEl.querySelector('.burnish-progress-trail');
    if (!trail) return;
    const now = Date.now();

    // Finalize the previous active entry (freeze its timer)
    const prevActive = trail.querySelector('.burnish-progress-entry.active');
    if (prevActive) {
        prevActive.classList.remove('active');
        prevActive.classList.add('done');
        const timeEl = prevActive.querySelector('.burnish-progress-time');
        if (timeEl && prevActive.dataset.started) {
            const elapsed = ((now - Number(prevActive.dataset.started)) / 1000).toFixed(1);
            timeEl.textContent = elapsed + 's';
        }
    }

    // Append a new entry
    const label = detail || stage;
    const entry = document.createElement('div');
    entry.className = 'burnish-progress-entry active';
    entry.dataset.started = String(now);
    entry.innerHTML = `<span class="burnish-progress-dot"></span><span class="burnish-progress-label">${escapeHtml(label)}</span><span class="burnish-progress-time"></span>`;
    trail.appendChild(entry);

    // Scroll trail to bottom if overflow
    trail.scrollTop = trail.scrollHeight;

    // Start tick timer for the new active entry
    stopProgressTimer();
    _progressTimer = setInterval(() => {
        const active = trail.querySelector('.burnish-progress-entry.active');
        if (!active) { stopProgressTimer(); return; }
        const timeEl = active.querySelector('.burnish-progress-time');
        if (timeEl && active.dataset.started) {
            const elapsed = ((Date.now() - Number(active.dataset.started)) / 1000).toFixed(1);
            timeEl.textContent = elapsed + 's';
        }
    }, 100);
}

// ── Main ──
document.addEventListener('DOMContentLoaded', async () => {
    const promptInput = document.getElementById('prompt-input');
    const submitBtn = document.getElementById('btn-submit');
    const container = document.getElementById('dashboard-container');
    const breadcrumb = document.getElementById('breadcrumb');

    // ── Fast mode toggle ──
    const fastToggle = document.getElementById('fast-toggle');
    if (fastToggle) {
        if (fastMode) fastToggle.classList.add('active');
        fastToggle.addEventListener('click', () => {
            fastMode = !fastMode;
            fastToggle.classList.toggle('active', fastMode);
            localStorage.setItem('burnish:fastMode', String(fastMode));
        });
    }

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
        // Delete button
        const deleteBtn = e.target.closest('.burnish-session-delete');
        if (deleteBtn) {
            e.stopPropagation();
            deleteSession(deleteBtn.dataset.deleteId);
            return;
        }
        // Session item click
        const item = e.target.closest('.burnish-session-item');
        if (item) switchSession(item.dataset.sessionId);
    });

    // Mobile toggle for session panel
    document.getElementById('btn-toggle-sessions')?.addEventListener('click', () => {
        document.getElementById('session-panel')?.classList.toggle('open');
    });

    // ── Server modal ──
    document.getElementById('btn-servers')?.addEventListener('click', () => openServerModal());
    document.getElementById('btn-close-modal')?.addEventListener('click', () => closeServerModal());
    document.querySelector('.burnish-modal-backdrop')?.addEventListener('click', () => closeServerModal());

    document.getElementById('catalog-grid')?.addEventListener('click', (e) => {
        const item = e.target.closest('.burnish-catalog-item');
        if (item && !item.classList.contains('connected')) showSetupForm(item.dataset.presetId);
    });

    document.getElementById('connected-server-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.burnish-connected-server-disconnect');
        if (btn) disconnectServer(btn.dataset.server);
    });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeServerModal(); });

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

    // ── Submit on Enter or button click ──
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !promptInput.disabled) {
            e.preventDefault();
            handleSubmit();
        }
    });

    submitBtn.addEventListener('click', () => {
        if (activeSource) {
            cancelGeneration++;
            activeSource.close();
            activeSource = null;
            submitBtn.classList.remove('cancel');
            submitBtn.innerHTML = ICON_SEND;
        } else {
            handleSubmit();
        }
    });

    promptInput.addEventListener('input', () => {
        promptInput.style.height = '';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + 'px';
    });

    // Suggestion buttons
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.burnish-suggestion');
        if (btn?.dataset.prompt) {
            promptInput.value = btn.dataset.prompt;
            handleSubmit(btn.dataset.label || undefined);
        }
    });

    // ── Card drill-down ──
    // ── Stat-bar filter — click chip to show/hide sections ──
    container.addEventListener('burnish-filter', (e) => {
        const { filter } = e.detail || {};
        // Find the node content area containing this stat-bar
        const nodeContent = e.target.closest('.burnish-node-content');
        if (!nodeContent) return;

        // Show/hide sibling sections and cards based on filter
        const sections = nodeContent.querySelectorAll('burnish-section');
        const cards = nodeContent.querySelectorAll('burnish-card');
        const tables = nodeContent.querySelectorAll('burnish-table');

        if (!filter) {
            // No filter — show everything
            sections.forEach(el => el.style.display = '');
            cards.forEach(el => el.style.display = '');
            tables.forEach(el => el.style.display = '');
        } else {
            const filterLower = filter.toLowerCase();
            const filterWords = filterLower.split(/\s+/);

            // Try matching sections by label (fuzzy: any word matches)
            let anyMatch = false;
            sections.forEach(el => {
                const label = (el.getAttribute('label') || '').toLowerCase();
                const matches = filterWords.some(w => label.includes(w)) || label.split(/\s+/).some(w => filterLower.includes(w));
                el.style.display = matches ? '' : 'none';
                if (matches) anyMatch = true;
            });

            // If no sections matched, try filtering cards by text content
            if (!anyMatch && sections.length > 0) {
                // Show all sections but filter cards within them
                sections.forEach(el => el.style.display = '');
                cards.forEach(el => {
                    const text = el.textContent?.toLowerCase() || '';
                    const matches = filterWords.some(w => text.includes(w));
                    el.style.display = matches ? '' : 'none';
                });
                anyMatch = [...cards].some(el => el.style.display !== 'none');
            }

            // If still nothing matched, show everything (filter doesn't apply)
            if (!anyMatch) {
                sections.forEach(el => el.style.display = '');
                cards.forEach(el => el.style.display = '');
                tables.forEach(el => el.style.display = '');
            }
        }
    });

    container.addEventListener('burnish-card-action', (e) => {
        const { title, status, itemId } = e.detail || {};
        if (title) {
            if (activeSource) {
                cancelGeneration++;
                activeSource.close();
                activeSource = null;
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
            }
            // Branch from the node containing this card
            const nodeEl = e.target.closest('.burnish-node');
            if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;
            // Track tool hint for fallback form generation
            const looksLikeTool = itemId && (itemId.includes('__') || itemId.includes('mcp_'));
            drillDownToolHint = looksLikeTool ? { toolName: itemId, title } : null;
            promptInput.value = getDrillDownPrompt(title, status, itemId);
            handleSubmit(title);
        }
    });

    // ── Form submission (write tools) ──
    container.addEventListener('burnish-form-submit', (e) => {
        const { toolId, values } = e.detail || {};
        if (!toolId) return;
        // Branch from the node containing this form
        const nodeEl = e.target.closest('.burnish-node');
        if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;
        const params = Object.entries(values)
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
        promptInput.value = `Call the tool ${toolId} with these exact parameters: ${params}. Show the result using burnish-* components.`;
        // Build a readable display label from the submitted values
        const keyValues = Object.entries(values)
            .filter(([, v]) => v && String(v).trim())
            .slice(0, 3)
            .map(([, v]) => v)
            .join(', ');
        const toolName = (toolId.split('__').pop() || toolId).replace(/_/g, ' ');
        const displayLabel = keyValues ? `${toolName}: ${keyValues}` : toolName;
        handleSubmit(displayLabel);
    });

    // ── Action bar clicks ──
    container.addEventListener('burnish-action', (e) => {
        const { label, action, prompt } = e.detail || {};
        if (!prompt) return;
        promptInput.value = prompt + '. Use ONLY burnish-* web components.';
        const contextSummary = prompt.split(/[.!]/)[0].substring(0, 60);
        const displayLabel = contextSummary.length > label.length ? contextSummary : label;

        // Set branch point to the node containing this action bar
        const nodeEl = e.target.closest('.burnish-node');
        if (nodeEl?.dataset?.nodeId) {
            branchFromNodeId = nodeEl.dataset.nodeId;
        }

        handleSubmit(displayLabel);
    });

    // ── Form field lookups ──
    container.addEventListener('burnish-form-lookup', async (e) => {
        const { fieldKey, prompt, query, context } = e.detail || {};
        const formEl = e.target;
        if (!formEl || !fieldKey) return;

        // Build contextual prompt with other field values
        const queryClause = query ? ` matching "${query}"` : '';
        let contextClause = '';
        if (context && Object.keys(context).length > 0) {
            const parts = Object.entries(context).map(([k, v]) => `${k}="${v}"`);
            contextClause = `. Other fields already filled: ${parts.join(', ')}. Use these to narrow the search where relevant`;
        }

        formEl.setLookupStatus(`Searching${query ? ` for "${query}"` : ''}...`);

        try {
            const res = await fetch('/api/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: `${prompt}${queryClause}${contextClause}. Call the appropriate tool to get real results. Return ONLY a JSON array of objects with "value" and "label" string fields. No markdown, no code fences, no explanation — just the raw JSON array. Example: [{"value":"item1","label":"item1 (Description)"}]. Limit to 10 results.`,
                }),
            });
            const data = await res.json();
            formEl.setLookupResults(fieldKey, data.results || []);
        } catch (err) {
            formEl.setLookupResults(fieldKey, []);
        }
    });

    // ── Browser history ──
    window.addEventListener('popstate', (e) => {
        if (e.state?.nodeId) scrollToNode(e.state.nodeId);
    });

    // ── Submit handler ──
    async function handleSubmit(displayLabel) {
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        promptInput.value = '';
        promptInput.style.height = '';

        let session = getActiveSession();
        if (!session) { await createSession(); session = getActiveSession(); }

        // Remove empty state
        const emptyState = container.querySelector('.burnish-empty-state');
        if (emptyState) emptyState.remove();

        // Create new node — attach to branch point or last leaf
        const nodeId = generateId();
        let parentId = null;
        if (branchFromNodeId) {
            parentId = branchFromNodeId;
            branchFromNodeId = null; // consume
        } else if (session.activeNodeId) {
            parentId = session.activeNodeId;
        } else if (session.nodes.length > 0) {
            parentId = session.nodes[session.nodes.length - 1].id;
        }

        // Store the user's original input for display (before context augmentation)
        const userPrompt = prompt;

        const node = {
            id: nodeId,
            parentId,
            children: [],
            prompt: userPrompt,
            promptDisplay: displayLabel || (userPrompt.length > 60 ? userPrompt.substring(0, 60) + '...' : userPrompt),
            _hasExplicitLabel: !!displayLabel,
            response: '',
            type: 'text',
            summary: '',
            tags: [],
            stats: null,
            timestamp: Date.now(),
            collapsed: false,
            _toolHint: drillDownToolHint,
            _progressLog: [],
        };
        drillDownToolHint = null; // consume

        // Update parent's children array
        if (parentId) {
            const parent = getNodeById(session, parentId);
            if (parent) {
                if (!parent.children) parent.children = [];
                if (!parent.children.includes(nodeId)) parent.children.push(nodeId);
            }
        }

        session.nodes.push(node);
        session.activeNodeId = nodeId;
        session.updatedAt = Date.now();

        // Auto-title session from first prompt
        if (session.nodes.length === 1) {
            session.title = node.promptDisplay;
            renderSessionList();
        }

        // Re-render the full tree (handles branching layout)
        renderMainContent();

        // Get the newly created node's content area
        const nodeEl = document.querySelector(`.burnish-node[data-node-id="${nodeId}"]`);
        const contentEl = nodeEl?.querySelector('.burnish-node-content');
        if (contentEl) contentEl.innerHTML = getProgressHtml();
        if (nodeEl) nodeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        addNodeSpinner(nodeId);
        updateNodeStatus(nodeId, 'Submitting…');

        submitBtn.classList.add('cancel');
        submitBtn.innerHTML = ICON_STOP;

        let renderedCount = 0;
        let streamingStarted = false;
        const containerStack = [];

        history.pushState({ nodeId }, '');

        // Build ancestry context so the LLM knows the path that led here
        let contextualPrompt = prompt;
        if (node.parentId) {
            const ancestry = getAncestryPath(session, node.parentId);
            const contextParts = ancestry
                .filter(n => n.response)
                .slice(-3)  // last 3 ancestors max to avoid huge prompts
                .map(n => `Previous step "${n.promptDisplay}": ${(n.response || '').substring(0, 200)}`)
                .join('\n');
            if (contextParts) {
                contextualPrompt = `Context from previous steps:\n${contextParts}\n\nCurrent request: ${prompt}`;
            }
        }

        submitPrompt(
            contextualPrompt,
            session.conversationId,
            // onChunk
            (chunk, fullText) => {
                const trimmed = fullText.trim();
                if (containsBurnishTags(trimmed)) {
                    if (!streamingStarted) {
                        streamingStarted = true;
                        stopProgressTimer();
                        contentEl.innerHTML = '';
                        node.type = 'components';
                    }
                    const elements = findStreamElements(trimmed);
                    while (renderedCount < elements.length) {
                        appendStreamElement(contentEl, containerStack, elements[renderedCount]);
                        renderedCount++;
                    }
                } else {
                    contentEl.innerHTML = `<div class="burnish-text-response burnish-streaming">${renderMarkdown(trimmed)}</div>`;
                }
            },
            // onDone
            async (fullText, newConversationId) => {
                stopProgressTimer();
                removeNodeSpinner(nodeId);
                removeNodeStatus(nodeId);
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                promptInput.focus();

                session.conversationId = newConversationId;

                const trimmed = fullText.trim();
                node.response = trimmed;
                node.type = containsBurnishTags(trimmed) ? 'components' : 'text';

                if (containsBurnishTags(trimmed)) {
                    // Always apply transformOutput on completion to ensure
                    // color normalization rules run (streaming bypasses them)
                    contentEl.innerHTML = '';
                    const clean = transformOutput(DOMPurify.sanitize(extractHtmlContent(trimmed), PURIFY_CONFIG));
                    const temp = document.createElement('template');
                    temp.innerHTML = clean;
                    contentEl.appendChild(temp.content);
                } else {
                    // Fallback: if the LLM returned plain text but this was a tool
                    // drill-down with required params, auto-generate a form from the schema
                    let fallbackHtml = null;
                    if (node._toolHint) {
                        const schema = toolSchemaCache[node._toolHint.toolName];
                        if (schema && schema.properties && Object.keys(schema.properties).length > 0) {
                            fallbackHtml = generateFallbackForm(node._toolHint.toolName, schema);
                        }
                    }
                    if (fallbackHtml) {
                        contentEl.innerHTML = '';
                        const clean = transformOutput(DOMPurify.sanitize(fallbackHtml, PURIFY_CONFIG));
                        const temp = document.createElement('template');
                        temp.innerHTML = clean;
                        contentEl.appendChild(temp.content);
                        node.response = fallbackHtml;
                        node.type = 'components';
                    } else {
                        contentEl.innerHTML = `<div class="burnish-text-response">${renderMarkdown(trimmed)}</div>`;
                    }
                }

                updateNodeSummary(nodeId);
                updateBreadcrumb();
                renderSessionList();
                await saveState();

                // Auto-title: after first node completes, request an LLM-generated title
                if (session.nodes.length === 1) {
                    fetch('/api/title', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: node.promptDisplay,
                            response: (trimmed || '').slice(0, 500),
                        }),
                    })
                        .then(r => r.json())
                        .then(async (data) => {
                            if (data.title) {
                                session.title = data.title;
                                renderSessionList();
                                await saveState();
                            }
                        })
                        .catch(() => { /* keep truncated title as fallback */ });
                }
            },
            // onError
            async (error) => {
                stopProgressTimer();
                removeNodeSpinner(nodeId);
                removeNodeStatus(nodeId);
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                contentEl.innerHTML = `<div class="burnish-text-response">Error: ${escapeHtml(error)}</div>`;
                node.response = error;
                node.type = 'text';
                node.summary = 'Error';
                node.tags = ['error'];
                updateNodeSummary(nodeId);
                await saveState();
            },
            // onProgress
            (stage, detail, meta) => {
                updateProgress(contentEl, stage, detail);
                let statusText = detail || stage;
                if (meta?.server) statusText += ` (${meta.server})`;
                else if (meta?.model) statusText += ` (${meta.model})`;
                updateNodeStatus(nodeId, statusText);
                node._progressLog.push({ stage, detail, meta, timestamp: Date.now() });
            },
            // onStats
            async (stats) => {
                node.stats = stats;
                updateNodeHeader(nodeId);
                await saveState();
            }
        );

        promptInput.disabled = true;
        updateBreadcrumb();
    }
});

// ── SSE Streaming ──

async function submitPrompt(prompt, existingConversationId, onChunk, onDone, onError, onProgress, onStats) {
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, conversationId: existingConversationId, model: fastMode ? 'haiku' : undefined }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        const conversationId = data.conversationId;
        await streamResponse(data.streamUrl, onChunk, (fullText) => onDone(fullText, conversationId), onError, onProgress, onStats);
    } catch (err) {
        onError(err.message);
    }
}

function streamResponse(streamUrl, onChunk, onDone, onError, onProgress, onStats) {
    let fullText = '';
    const myGeneration = cancelGeneration;

    return new Promise((resolve) => {
        const source = new EventSource(streamUrl);
        activeSource = source;

        source.onmessage = (event) => {
            if (cancelGeneration > myGeneration) return;
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'error') {
                    source.close(); activeSource = null;
                    onError(data.message || 'Unknown error');
                    resolve();
                } else if (data.type === 'progress') {
                    if (onProgress) onProgress(data.stage, data.detail, data.meta);
                } else if (data.type === 'content') {
                    fullText += data.text;
                    onChunk(data.text, fullText);
                } else if (data.type === 'stats') {
                    if (onStats) onStats(data);
                } else if (data.type === 'done') {
                    source.close(); activeSource = null;
                    onDone(fullText);
                    resolve();
                }
            } catch (e) { console.error('SSE parse error:', e); }
        };

        source.onerror = () => {
            source.close(); activeSource = null;
            if (cancelGeneration > myGeneration) { resolve(); }
            else if (fullText) { onDone(fullText); resolve(); }
            else { onError('Connection lost'); resolve(); }
        };
    });
}

// ── Stream Parser ──

function containsBurnishTags(text) { return /<burnish-[a-z]/.test(text); }

function findStreamElements(text) {
    const elements = [];
    const cleaned = text.replace(/<use_mcp_tool[\s\S]*?<\/use_mcp_tool>/g, '');
    const re = /<(\/?)((burnish-[a-z-]+)|div|h[1-6]|p|section|ul|ol|table)(\s[^>]*)?>/g;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
        const isClose = m[1] === '/';
        const tagName = m[2];
        if (isClose) { if (CONTAINER_TAGS.has(tagName)) elements.push({ type: 'close', tagName, html: m[0] }); continue; }
        if (CONTAINER_TAGS.has(tagName)) { elements.push({ type: 'open', tagName, html: m[0] }); continue; }
        if (cleaned[m.index + m[0].length - 2] === '/') { elements.push({ type: 'leaf', tagName, html: m[0] }); continue; }
        let depth = 1;
        const closeRe = new RegExp(`<(${tagName})(\\s[^>]*)?>|</${tagName}>`, 'g');
        closeRe.lastIndex = m.index + m[0].length;
        let cm;
        while ((cm = closeRe.exec(cleaned)) !== null) {
            if (cm[0].startsWith('</')) { depth--; if (depth === 0) { elements.push({ type: 'leaf', tagName, html: cleaned.substring(m.index, cm.index + cm[0].length) }); re.lastIndex = cm.index + cm[0].length; break; } } else { depth++; }
        }
        if (depth > 0) return elements;
    }
    return elements;
}

const SAFE_ATTRS = new Set(PURIFY_CONFIG.ADD_ATTR);

function appendStreamElement(root, stack, element) {
    const parent = stack.length > 0 ? stack[stack.length - 1] : root;
    if (element.type === 'open') {
        const el = document.createElement(element.tagName);
        const attrRe = /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?/g;
        let am;
        while ((am = attrRe.exec(element.html)) !== null) {
            const name = am[1].toLowerCase();
            if (name === element.tagName || !SAFE_ATTRS.has(name)) continue;
            el.setAttribute(name, am[2] ?? am[3] ?? am[4] ?? '');
        }
        parent.appendChild(el); stack.push(el);
    } else if (element.type === 'close') {
        if (stack.length > 0) stack.pop();
    } else {
        const clean = DOMPurify.sanitize(element.html, PURIFY_CONFIG);
        const temp = document.createElement('template');
        temp.innerHTML = clean;
        parent.appendChild(temp.content);
    }
}

function extractHtmlContent(text) {
    let cleaned = text.replace(/<use_mcp_tool[\s\S]*?<\/use_mcp_tool>/g, '');
    const htmlStart = cleaned.search(/<(?:burnish-[a-z]|div)/);
    if (htmlStart === -1) return cleaned.trim();
    const preamble = cleaned.substring(0, htmlStart).trim();
    const htmlContent = cleaned.substring(htmlStart).trim();
    let result = '';
    if (preamble) result += `<div class="burnish-text-preamble">${renderMarkdown(preamble)}</div>`;
    result += htmlContent;
    return result;
}

/**
 * Layer 2: Deterministic output transformation.
 * Runs AFTER DOMPurify sanitization, BEFORE DOM injection.
 * Enforces rules the LLM might ignore from the system prompt.
 */
function transformOutput(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return html;

    // Rule 1: Normalize card statuses
    // "success" should only appear on cards showing a completed action result
    // (e.g. "Issue created", "File written"). For data listing cards, use "info".
    root.querySelectorAll('burnish-card').forEach(card => {
        const status = card.getAttribute('status');
        const itemId = card.getAttribute('item-id') || '';
        const body = card.getAttribute('body') || '';

        // Tool cards always get info
        if (itemId.includes('__')) {
            card.setAttribute('status', 'info');
            return;
        }

        // Cards in listing context: only override "success" → "info"
        // Let meaningful statuses pass through (open, closed, bug, etc.)
        if (status === 'success') {
            const parentSection = card.closest('burnish-section');
            if (parentSection) {
                card.setAttribute('status', 'info');
            }
        }
    });

    // Rule 1b: Sections in informational context should use "info" status
    // (ensures consistent blue dots instead of random LLM-assigned colors)
    root.querySelectorAll('burnish-section').forEach(section => {
        const hasCards = section.querySelector('burnish-card');
        if (hasCards) {
            section.setAttribute('status', 'info');
        }
    });

    // Rule 1c: Stat-bar chips should use "info" when sibling content is informational
    root.querySelectorAll('burnish-stat-bar').forEach(bar => {
        const parent = bar.parentElement;
        const hasSections = parent?.querySelector('burnish-section');
        if (hasSections) {
            try {
                const items = JSON.parse(bar.getAttribute('items') || '[]');
                const hasGreen = items.some(i => i.color === 'success' || i.color === 'healthy');
                if (hasGreen) {
                    const updated = items.map(item =>
                        (item.color === 'success' || item.color === 'healthy')
                            ? { ...item, color: 'info' }
                            : item
                    );
                    bar.setAttribute('items', JSON.stringify(updated));
                }
            } catch { /* ignore */ }
        }
    });

    // Rule 1d: Propagate stat-bar pill colors to matching section dots
    const statusColorMap = {
        success: 'var(--burnish-success, #16a34a)',
        healthy: 'var(--burnish-success, #16a34a)',
        warning: 'var(--burnish-warning, #ca8a04)',
        error: 'var(--burnish-error, #dc2626)',
        failing: 'var(--burnish-error, #dc2626)',
        info: 'var(--burnish-info, #6366f1)',
        muted: 'var(--burnish-muted, #9ca3af)',
    };
    root.querySelectorAll('burnish-stat-bar').forEach(bar => {
        try {
            const items = JSON.parse(bar.getAttribute('items') || '[]');
            const parent = bar.parentElement;
            if (!parent) return;
            const sections = parent.querySelectorAll('burnish-section');
            for (const section of sections) {
                const sectionLabel = (section.getAttribute('label') || '').toLowerCase();
                if (!sectionLabel) continue;
                const sectionWords = new Set(sectionLabel.split(/\s+/));
                // Match: any non-stopword from stat-bar item label appears in section label
                const stopwords = new Set(['operations', 'items', 'total', 'all', 'other', 'the', 'and', 'or']);
                const match = items.find(item => {
                    const itemWords = (item.label || '').toLowerCase().split(/\s+/);
                    return itemWords.some(w => w && !stopwords.has(w) && sectionWords.has(w));
                });
                if (match) {
                    const resolvedColor = statusColorMap[(match.color || '').toLowerCase()] || match.color || '';
                    if (resolvedColor) {
                        section.setAttribute('color', resolvedColor);
                    }
                }
            }
        } catch { /* ignore */ }
    });

    // Rule 2: Sanitize lookup prompts — strip any specific tool/server name references
    root.querySelectorAll('burnish-form').forEach(form => {
        const fieldsAttr = form.getAttribute('fields');
        if (!fieldsAttr) return;
        try {
            const fields = JSON.parse(fieldsAttr);
            let changed = false;
            for (const field of fields) {
                if (field.lookup?.prompt) {
                    // Remove references to specific MCP tool names (mcp__xxx__yyy patterns)
                    const cleaned = field.lookup.prompt.replace(/mcp__\w+__\w+/g, '').replace(/\s{2,}/g, ' ').trim();
                    if (cleaned !== field.lookup.prompt) {
                        field.lookup.prompt = cleaned || `Find valid values for ${field.label || field.key}`;
                        changed = true;
                    }
                }
            }
            if (changed) form.setAttribute('fields', JSON.stringify(fields));
        } catch { /* ignore parse errors */ }
    });

    return root.innerHTML;
}

// ── Fallback Form Generator ──
function generateFallbackForm(toolName, schema) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const fields = Object.entries(props).map(([key, prop]) => {
        const field = {
            key,
            label: prop.title || key.replace(/_/g, ' '),
            type: prop.type === 'number' || prop.type === 'integer' ? 'number' : prop.enum ? 'select' : 'text',
            required: required.has(key),
        };
        if (prop.description) field.placeholder = prop.description;
        if (prop.default !== undefined) field.value = String(prop.default);
        if (prop.enum) field.options = prop.enum.map(String);
        return field;
    });
    if (fields.length === 0) return null;
    const displayName = (toolName.split('__').pop() || toolName).replace(/_/g, ' ');
    return `<burnish-form title="${escapeAttr(displayName)}" tool-id="${escapeAttr(toolName)}" fields='${JSON.stringify(fields).replace(/'/g, '&#39;')}'></burnish-form>`;
}

// ── Drill-Down ──
// Write/mutate tool patterns — these should NOT be auto-invoked
const WRITE_TOOL_PATTERNS = /^(create|update|delete|remove|push|write|edit|move|fork|merge|add|set|close|lock|assign)/i;

function getDrillDownPrompt(title, status, itemId) {
    const idClause = itemId ? ` (tool: ${itemId})` : '';
    const looksLikeTool = itemId && (itemId.includes('__') || itemId.includes('mcp_'));

    if (looksLikeTool) {
        const toolName = title || '';
        const isWrite = WRITE_TOOL_PATTERNS.test(toolName);

        // All tools: let the LLM decide based on required parameters
        // Write tools MUST show a form. Read tools with required params SHOULD show a form.
        return `The user wants to use the "${title}" tool${idClause}.

${isWrite ? 'This is a WRITE operation — do NOT call it. Show a form.' : 'Check if this tool has required parameters.'}

RULES:
- If the tool has required parameters that need user input → show a burnish-form with the parameters as fields. Add lookup to fields where values can be searched. Do NOT guess parameter values.
- If the tool can run with NO parameters or has obvious defaults (like listing the current directory) → call it and show results.
${isWrite ? '- This is a write tool — ALWAYS show a form, never auto-invoke.' : '- Only auto-invoke if truly no user input is needed.'}

EXAMPLE — a tool with required params MUST produce a form like this:
<burnish-form title="${title}" tool-id="${itemId || 'tool_name'}" fields='[{"key":"query","label":"Search query","type":"text","required":true,"placeholder":"enter value"}]'></burnish-form>

Use ONLY burnish-* web components. Include burnish-actions with next steps after results.`;
    }
    return `Explore "${title}"${idClause} in more detail. Call the appropriate tools to get real data and show the results using burnish-* web components. If a tool requires parameters, show a burnish-form instead of guessing. Include burnish-actions with next steps.`;
}

// ── Helpers ──
function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        const html = marked.parse(text);
        return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
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
            <h2>Welcome to Burnish</h2>
            <p>Explore your connected data sources.</p>
            <div class="burnish-server-buttons" id="server-buttons">
                <div class="burnish-suggestion-skeleton-pill"></div>
                <div class="burnish-suggestion-skeleton-pill"></div>
            </div>
            <div class="burnish-tool-shortcuts" id="tool-shortcuts">
                <div class="burnish-suggestion-skeleton-pill"></div>
                <div class="burnish-suggestion-skeleton-pill"></div>
                <div class="burnish-suggestion-skeleton-pill"></div>
            </div>
        </div>
    `;
}

async function loadDynamicSuggestions(container) {
    try {
        const res = await fetch('/api/servers');
        const { servers } = await res.json();

        // Populate tool schema cache for fallback form generation
        // Store under both plain name and MCP-prefixed name (mcp__server__tool)
        for (const s of servers) {
            for (const tool of s.tools) {
                if (tool.inputSchema) {
                    toolSchemaCache[tool.name] = tool.inputSchema;
                    toolSchemaCache[`mcp__${s.name}__${tool.name}`] = tool.inputSchema;
                }
            }
        }

        // Render server buttons immediately
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) {
            if (servers.length === 0) {
                serverBtns.innerHTML = `<button class="burnish-suggestion" data-prompt="What tools are available?" data-label="Available tools">Available tools</button>`;
            } else {
                serverBtns.innerHTML = servers.map(s => `
                    <button class="burnish-suggestion burnish-suggestion-server" data-prompt="${escapeAttr(`Show me what I can do with the connected ${s.name} tools. List the available operations as cards.`)}" data-label="${escapeAttr(s.name)}">
                        ${escapeHtml(s.name)}
                        <span class="burnish-suggestion-sub">${s.toolCount} tools</span>
                    </button>
                `).join('');
            }
        }

        // Generate tool shortcuts — max 2 per server, prefer diverse verbs
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
                const label = tool.description
                    ? tool.description.split(/[.!]/)[0].substring(0, 40)
                    : tool.name.replace(/_/g, ' ');
                shortcuts.push({
                    label,
                    prompt: `${tool.description || tool.name}. Show results using burnish-* components.`,
                });
                countForServer++;
            }
        }

        const toolSection = container.querySelector('#tool-shortcuts');
        if (toolSection) {
            if (shortcuts.length === 0) {
                toolSection.innerHTML = '';
            } else {
                toolSection.innerHTML = shortcuts.map(s => `
                    <button class="burnish-suggestion" data-prompt="${escapeAttr(s.prompt)}" data-label="${escapeAttr(s.label)}">
                        ${escapeHtml(s.label)}
                    </button>
                `).join('');
            }
        }
    } catch {
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) {
            serverBtns.innerHTML = `<button class="burnish-suggestion" data-prompt="What tools are available?" data-label="Available tools">Available tools</button>`;
        }
        const toolSection = container.querySelector('#tool-shortcuts');
        if (toolSection) toolSection.innerHTML = '';
    }
}

// ── Server Config Modal ──
async function openServerModal() {
    const modal = document.getElementById('server-modal');
    if (!modal) return;
    modal.hidden = false;
    await refreshServerModal();
}

function closeServerModal() {
    const modal = document.getElementById('server-modal');
    if (modal) modal.hidden = true;
    document.querySelector('.burnish-setup-form')?.remove();
}

async function refreshServerModal() {
    const [serversRes, catalogRes] = await Promise.all([
        fetch('/api/servers'),
        fetch('/api/servers/catalog'),
    ]);
    const { servers } = await serversRes.json();
    const { catalog } = await catalogRes.json();

    const connectedList = document.getElementById('connected-server-list');
    if (connectedList) {
        if (servers.length === 0) {
            connectedList.innerHTML = '<div class="burnish-no-servers">No servers connected</div>';
        } else {
            connectedList.innerHTML = servers.map(s => `
                <div class="burnish-connected-server">
                    <span class="burnish-connected-server-dot"></span>
                    <div class="burnish-connected-server-info">
                        <div class="burnish-connected-server-name">${escapeHtml(s.name)}</div>
                        <div class="burnish-connected-server-tools">${s.toolCount} tools</div>
                    </div>
                    <button class="burnish-connected-server-disconnect" data-server="${escapeHtml(s.name)}">Disconnect</button>
                </div>
            `).join('');
        }
    }

    const connectedNames = new Set(servers.map(s => s.name));
    const categories = { databases: 'Databases', devtools: 'Developer Tools', observability: 'Observability', saas: 'SaaS & APIs' };
    const catalogGrid = document.getElementById('catalog-grid');
    if (catalogGrid) {
        let html = '';
        for (const [cat, label] of Object.entries(categories)) {
            const items = catalog.filter(s => s.category === cat);
            if (items.length === 0) continue;
            html += `<div class="burnish-catalog-category">`;
            html += `<div class="burnish-catalog-category-label">${label}</div>`;
            html += `<div class="burnish-catalog-grid">`;
            for (const item of items) {
                const isConnected = connectedNames.has(item.id);
                html += `<div class="burnish-catalog-item${isConnected ? ' connected' : ''}" data-preset-id="${item.id}">
                    <div class="burnish-catalog-item-name">${escapeHtml(item.name)}</div>
                    <div class="burnish-catalog-item-desc">${escapeHtml(item.description)}</div>
                </div>`;
            }
            html += `</div></div>`;
        }
        catalogGrid.innerHTML = html;
    }
}

async function showSetupForm(presetId) {
    const catalogRes = await fetch('/api/servers/catalog');
    const { catalog } = await catalogRes.json();
    const preset = catalog.find(s => s.id === presetId);
    if (!preset) return;

    document.querySelector('.burnish-setup-form')?.remove();

    if (!preset.requiredFields || preset.requiredFields.length === 0) {
        await connectPresetServer(preset, {});
        return;
    }

    const form = document.createElement('div');
    form.className = 'burnish-setup-form';
    form.innerHTML = `
        <h4>Configure ${escapeHtml(preset.name)}</h4>
        ${preset.requiredFields.map(f => `
            <div class="burnish-setup-field">
                <label>${escapeHtml(f.label)}</label>
                <input type="${f.key.toLowerCase().includes('token') || f.key.toLowerCase().includes('key') ? 'password' : 'text'}"
                       data-field-key="${f.key}" placeholder="${escapeHtml(f.placeholder || '')}" />
            </div>
        `).join('')}
        <div class="burnish-setup-status" id="setup-status"></div>
        <div class="burnish-setup-actions">
            <button class="burnish-setup-btn burnish-setup-btn-cancel" id="btn-setup-cancel">Cancel</button>
            <button class="burnish-setup-btn burnish-setup-btn-primary" id="btn-setup-connect">Connect</button>
        </div>
    `;

    document.querySelector('.burnish-modal-body')?.appendChild(form);
    form.scrollIntoView({ behavior: 'smooth' });

    form.querySelector('#btn-setup-cancel')?.addEventListener('click', () => form.remove());
    form.querySelector('#btn-setup-connect')?.addEventListener('click', async () => {
        const fields = {};
        form.querySelectorAll('input[data-field-key]').forEach(input => {
            fields[input.dataset.fieldKey] = input.value;
        });
        await connectPresetServer(preset, fields);
    });
}

async function connectPresetServer(preset, fieldValues) {
    const statusEl = document.getElementById('setup-status');
    const config = JSON.parse(JSON.stringify(preset.config));
    config.args = config.args.map(a => {
        for (const [key, val] of Object.entries(fieldValues)) a = a.replace(`{${key}}`, val);
        return a;
    });
    if (config.env) {
        for (const envKey of Object.keys(config.env)) {
            for (const [key, val] of Object.entries(fieldValues)) config.env[envKey] = config.env[envKey].replace(`{${key}}`, val);
        }
    }

    if (statusEl) { statusEl.textContent = 'Connecting...'; statusEl.className = 'burnish-setup-status'; }

    try {
        const res = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: preset.id, config }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to connect');
        if (statusEl) { statusEl.textContent = 'Connected!'; statusEl.className = 'burnish-setup-status success'; }
        setTimeout(async () => { document.querySelector('.burnish-setup-form')?.remove(); await refreshServerModal(); }, 1000);
    } catch (err) {
        if (statusEl) { statusEl.textContent = `Error: ${err.message}`; statusEl.className = 'burnish-setup-status error'; }
    }
}

async function disconnectServer(name) {
    try {
        await fetch(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await refreshServerModal();
    } catch (err) {
        console.error('Failed to disconnect:', err);
    }
}
