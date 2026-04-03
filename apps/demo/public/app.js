/**
 * Burnish Demo App — main orchestration.
 * Multi-session management with inline conversation and infinite scroll navigation.
 */

import {
    getNodeById, getChildren, getRootNodes, getAncestryPath, getActivePath, getDescendantIds,
    SessionStore,
    transformOutput,
    isWriteTool, getDrillDownPrompt, generateFallbackForm,
    StreamOrchestrator,
    generateSummary, formatTimeAgo,
} from '@burnish/app';
import {
    findStreamElements, appendStreamElement, extractHtmlContent, containsTags as containsBurnishTags,
} from '@burnish/renderer';

// ── Persistence ──
const persistence = new SessionStore();
const streamOrchestrator = new StreamOrchestrator();

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


const ICON_SEND = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l7-7v4h9v6H9v4z" transform="rotate(-90 10 10)"/></svg>`;
const ICON_STOP = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`;
const ICON_FOCUS = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,1 1,1 1,4"/><polyline points="12,1 15,1 15,4"/><polyline points="4,15 1,15 1,12"/><polyline points="12,15 15,15 15,12"/></svg>`;
const ICON_RESTORE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,4 4,4 4,1"/><polyline points="12,1 12,4 15,4"/><polyline points="1,12 4,12 4,15"/><polyline points="12,15 12,12 15,12"/></svg>`;
const ICON_REFRESH = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8a7 7 0 0 1 13-3.5M15 8a7 7 0 0 1-13 3.5"/><polyline points="1,1 1,5 5,5"/><polyline points="15,15 15,11 11,11"/></svg>`;

const SAFE_ATTRS = new Set(PURIFY_CONFIG.ADD_ATTR);

// ── State ──
let selectedModel = localStorage.getItem('burnish:selectedModel') || '';
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

// Track which node is currently streaming (for spinner)
let streamingNodeId = null;

// Track tool hint for drill-down fallback form generation
let drillDownToolHint = null;

// Cache of tool schemas keyed by tool name (populated from /api/servers)
const toolSchemaCache = {};

// ── Persistence (delegated to SessionStore) ──

async function saveState() {
    await persistence.save(sessions, activeSessionId);
}

async function loadState() {
    return persistence.load();
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
    persistence.markLoaded(session.id);
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

    // Collect node IDs to delete from IndexedDB
    let nodeIds = session?.nodes?.length ? session.nodes.map(n => n.id) : (session?._nodeIds || []);

    // Fallback: read from IndexedDB metadata if session wasn't loaded and has no _nodeIds
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

    // Delete orphaned nodes from IndexedDB
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

    // Build full ancestry path from root to active node
    let pathNodes = [];
    if (session.activeNodeId) {
        pathNodes = getAncestryPath(session, session.activeNodeId);
    }

    // Build crumb segments: session title first, then each node in path
    const segments = [];
    segments.push({ label: truncate(session.title || 'Dashboard'), nodeId: null });
    for (const node of pathNodes) {
        const raw = node.promptDisplay || node.prompt || 'Untitled';
        segments.push({ label: truncate(raw), nodeId: node.id });
    }

    // If path is longer than 4 segments, collapse middle: Title > ... > Parent > Active
    let displaySegments = segments;
    if (segments.length > 4) {
        displaySegments = [
            segments[0],
            { label: '\u2026', nodeId: null, ellipsis: true },
            segments[segments.length - 2],
            segments[segments.length - 1],
        ];
    }

    // Render as clickable spans
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

    // If searching and there are unloaded sessions, load them first then re-render
    if (searchQuery && sessions.some(s => s._nodeIds && !persistence.isLoaded(s.id))) {
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
    node._componentLog = [];
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
                // Strip any preamble text before the first burnish tag
                const componentStart = trimmed.indexOf('<burnish-');
                const componentHtml = componentStart > 0 ? trimmed.substring(componentStart) : trimmed;
                const elements = findStreamElements(componentHtml);
                while (renderedCount < elements.length) {
                    const el = elements[renderedCount];
                    appendElement(contentEl, containerStack, el);
                    if (el.tagName && el.tagName.startsWith('burnish-') && el.type === 'leaf') {
                        node._componentLog.push({ tag: el.tagName, timestamp: Date.now() });
                        updateNodeStatus(nodeId, `Rendering ${el.tagName}…`);
                    }
                    renderedCount++;
                }
            }
            // Don't render plain text during streaming — buffer it.
            // If the stream ends without burnish tags, onDone renders it as text.
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

            if (!trimmed) {
                contentEl.innerHTML = '<div class="burnish-text-response" style="color: var(--burnish-text-muted, #9ca3af); font-style: italic;">No response received. Try regenerating.</div>';
                node.type = 'text';
                updateNodeSummary(nodeId);
                updateBreadcrumb();
                renderSessionList();
                await saveState();
                return;
            }

            if (containsBurnishTags(trimmed)) {
                // Always apply transformOutput on completion to ensure
                // color normalization rules run (streaming bypasses them)
                contentEl.innerHTML = '';
                const clean = transformOutput(DOMPurify.sanitize(extractContent(trimmed), PURIFY_CONFIG));
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
        },
        (steps) => {
            updateWorkflowTrace(contentEl, steps);
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
        stepsHtml = '<div class="burnish-diag-section-title">Steps</div>'
            + '<div class="burnish-diag-steps">';
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

    // Component breakdown
    let componentsHtml = '';
    const componentLog = node._componentLog || [];
    if (componentLog.length > 0) {
        const modelName = modelEntry ? modelEntry.meta.model : '';
        const streamStart = progressLog.length > 0 ? progressLog[progressLog.length - 1].timestamp : componentLog[0].timestamp;
        componentsHtml = '<div class="burnish-diag-section-title">Components</div>'
            + '<div class="burnish-diag-steps">';
        for (let i = 0; i < componentLog.length; i++) {
            const comp = componentLog[i];
            const prev = i === 0 ? streamStart : componentLog[i - 1].timestamp;
            const dur = ((comp.timestamp - prev) / 1000).toFixed(1) + 's';
            const modelSuffix = modelName ? ` (${escapeHtml(modelName)})` : '';
            componentsHtml += `<div class="burnish-diag-step">`
                + `<span class="burnish-diag-check">\u2713</span>`
                + `<span class="burnish-diag-label">${escapeHtml(comp.tag)}${modelSuffix}</span>`
                + `<span class="burnish-diag-time">${dur}</span>`
                + `</div>`;
        }
        componentsHtml += '</div>';
    }

    panel.innerHTML = (metrics.length > 0
        ? `<div class="burnish-diag-metrics">${metrics.join('')}</div>` : '')
        + stepsHtml
        + componentsHtml;

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
            const clean = transformOutput(DOMPurify.sanitize(extractContent(node.response), PURIFY_CONFIG));
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

    // ── Model selector ──
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
        fetch('/api/models')
            .then(r => r.json())
            .then(({ models, current }) => {
                if (models.length === 0) {
                    modelSelect.innerHTML = '<option value="">No models</option>';
                    return;
                }
                const activeModel = selectedModel || current;
                modelSelect.innerHTML = models.map(m =>
                    `<option value="${escapeAttr(m.id)}"${m.id === activeModel ? ' selected' : ''}>${escapeHtml(m.name)}</option>`
                ).join('');
                if (!selectedModel) selectedModel = current;
            })
            .catch(() => {
                modelSelect.innerHTML = '<option value="">Default</option>';
            });

        modelSelect.addEventListener('change', () => {
            selectedModel = modelSelect.value;
            localStorage.setItem('burnish:selectedModel', selectedModel);
        });
    }

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
        if (streamOrchestrator.isStreaming) {
            streamOrchestrator.cancel();
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
        // Escape: cancel streaming
        if (e.key === 'Escape' && streamOrchestrator.isStreaming) {
            streamOrchestrator.cancel();
            submitBtn.classList.remove('cancel');
            submitBtn.innerHTML = ICON_SEND;
            return;
        }
        // Don't trigger shortcuts when typing in an input/textarea/select/contenteditable
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
        // Ctrl/Cmd+K: focus session search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('session-search')?.focus();
            return;
        }
        // /: focus prompt input
        if (e.key === '/') {
            e.preventDefault();
            promptInput.focus();
            return;
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
            if (streamOrchestrator.isStreaming) {
                streamOrchestrator.cancel();
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
        if (!prompt) {
            promptInput.classList.add('burnish-prompt-shake');
            promptInput.setAttribute('placeholder', 'Type a message first...');
            promptInput.addEventListener('animationend', () => {
                promptInput.classList.remove('burnish-prompt-shake');
                promptInput.setAttribute('placeholder', 'Ask about your data...');
            }, { once: true });
            return;
        }
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
            _componentLog: [],
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
                    // Strip any preamble text before the first burnish tag
                    const componentStart = trimmed.indexOf('<burnish-');
                    const componentHtml = componentStart > 0 ? trimmed.substring(componentStart) : trimmed;
                    const elements = findStreamElements(componentHtml);
                    while (renderedCount < elements.length) {
                        const el = elements[renderedCount];
                        appendElement(contentEl, containerStack, el);
                        if (el.tagName && el.tagName.startsWith('burnish-') && el.type === 'leaf') {
                            node._componentLog.push({ tag: el.tagName, timestamp: Date.now() });
                            updateNodeStatus(nodeId, `Rendering ${el.tagName}…`);
                        }
                        renderedCount++;
                    }
                }
                // Don't render plain text during streaming — buffer it.
                // If the stream ends without burnish tags, onDone renders it as text.
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

                if (!trimmed) {
                    contentEl.innerHTML = '<div class="burnish-text-response" style="color: var(--burnish-text-muted, #9ca3af); font-style: italic;">No response received. Try regenerating.</div>';
                    node.type = 'text';
                    updateNodeSummary(nodeId);
                    updateBreadcrumb();
                    renderSessionList();
                    await saveState();
                    return;
                }

                if (containsBurnishTags(trimmed)) {
                    // Always apply transformOutput on completion to ensure
                    // color normalization rules run (streaming bypasses them)
                    contentEl.innerHTML = '';
                    const clean = transformOutput(DOMPurify.sanitize(extractContent(trimmed), PURIFY_CONFIG));
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
                    // Second fallback: for suggestion buttons (no _toolHint),
                    // scan toolSchemaCache for a tool whose name matches the prompt
                    if (!fallbackHtml && !node._toolHint && Object.keys(toolSchemaCache).length > 0) {
                        const promptLower = node.prompt.toLowerCase();
                        let bestMatch = null;
                        let bestScore = 0;
                        for (const [toolName, schema] of Object.entries(toolSchemaCache)) {
                            if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) continue;
                            // Score by how many words from the tool name appear in the prompt
                            const words = toolName.replace(/^mcp__\w+__/, '').split(/[_\s-]+/).filter(w => w.length > 2);
                            const score = words.filter(w => promptLower.includes(w.toLowerCase())).length;
                            if (score > bestScore) {
                                bestScore = score;
                                bestMatch = { toolName, schema };
                            }
                        }
                        if (bestMatch && bestScore >= 1) {
                            fallbackHtml = generateFallbackForm(bestMatch.toolName, bestMatch.schema);
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
            },
            // onWorkflowTrace
            (steps) => {
                updateWorkflowTrace(contentEl, steps);
            }
        );

        promptInput.disabled = true;
        updateBreadcrumb();
    }
});

// ── Workflow Trace (cross-server pipeline indicator) ──

function updateWorkflowTrace(contentEl, steps) {
    if (!steps || steps.length === 0) return;
    // Only show trace when tools span multiple servers
    const servers = new Set(steps.map(s => s.server));
    if (servers.size < 2) return;

    let traceEl = contentEl.querySelector('.burnish-workflow-trace');
    if (!traceEl) {
        traceEl = document.createElement('div');
        traceEl.className = 'burnish-workflow-trace';
        // Insert before the progress trail
        const progressEl = contentEl.querySelector('.burnish-progress');
        if (progressEl) {
            progressEl.parentNode.insertBefore(traceEl, progressEl);
        } else {
            contentEl.prepend(traceEl);
        }
    }

    traceEl.innerHTML = steps.map((step, i) => {
        const statusClass = step.status === 'running' ? 'running'
            : step.status === 'success' ? 'success'
            : step.status === 'error' ? 'error'
            : 'pending';
        const arrow = i < steps.length - 1 ? '<span class="burnish-trace-arrow">\u2192</span>' : '';
        return `<span class="burnish-trace-step ${statusClass}">` +
            `<span class="burnish-trace-dot"></span>` +
            `<span class="burnish-trace-server">${escapeHtml(step.server)}</span>` +
            `<span class="burnish-trace-tool">${escapeHtml(step.tool)}</span>` +
            `</span>${arrow}`;
    }).join('');
}

// ── SSE Streaming (via StreamOrchestrator) ──

function submitPrompt(prompt, existingConversationId, onChunk, onDone, onError, onProgress, onStats, onWorkflowTrace) {
    streamOrchestrator.submitPrompt(
        '', // same origin
        prompt,
        existingConversationId,
        selectedModel || undefined,
        { onChunk, onDone, onError, onProgress, onStats, onWorkflowTrace },
    ).catch(onError);
}

// ── Stream Helpers (wrapping @burnish/renderer) ──

function sanitizeHtml(html) {
    return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

function appendElement(root, stack, element) {
    appendStreamElement(root, stack, element, SAFE_ATTRS, sanitizeHtml);
}

function extractContent(text) {
    return extractHtmlContent(text, 'burnish-', renderMarkdown);
}

// transformOutput is imported from @burnish/app

// generateFallbackForm is imported from @burnish/app

// getDrillDownPrompt and isWriteTool are imported from @burnish/app

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
            <div class="burnish-empty-hint" id="empty-hint"></div>
        </div>
    `;
}

async function loadDynamicSuggestions(container) {
    try {
        const res = await fetch('/api/servers');
        const { servers } = await res.json();

        // Populate tool schema cache for fallback form generation
        for (const s of servers) {
            for (const tool of s.tools) {
                if (tool.inputSchema) {
                    toolSchemaCache[tool.name] = tool.inputSchema;
                    toolSchemaCache[`mcp__${s.name}__${tool.name}`] = tool.inputSchema;
                }
            }
        }

        // Render connected server buttons
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) {
            if (servers.length === 0) {
                serverBtns.innerHTML = '<span class="burnish-no-servers">No servers connected</span>';
            } else {
                serverBtns.innerHTML = servers.map(s => {
                    const toolList = s.tools.slice(0, 15).map(t => t.name).join(', ');
                    const moreText = s.tools.length > 15 ? ` and ${s.tools.length - 15} more` : '';
                    const prompt = `Show me what I can do with the ${s.name} server. Available tools: ${toolList}${moreText}. List each tool as a burnish-card. Use ONLY the tools listed above.`;
                    return `
                    <button class="burnish-suggestion burnish-suggestion-server" data-prompt="${escapeAttr(prompt)}" data-label="${escapeAttr(s.name)}">
                        ${escapeHtml(s.name)}
                        <span class="burnish-suggestion-sub">${s.toolCount} tools</span>
                    </button>
                `;
                }).join('');
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

        const hintEl = container.querySelector('#empty-hint');
        if (hintEl && servers.length > 0) {
            hintEl.innerHTML = '<span class="burnish-hint-text">Try asking: "What tools do I have?" or "List my files"</span>';
        }
    } catch {
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) serverBtns.innerHTML = '';
        const toolSection = container.querySelector('#tool-shortcuts');
        if (toolSection) toolSection.innerHTML = '';
    }
}

