/**
 * MCPUI Demo App — main orchestration.
 * Multi-session management with inline conversation and infinite scroll navigation.
 */

// ── DOMPurify Config ──
const PURIFY_CONFIG = {
    ADD_TAGS: ['mcpui-card', 'mcpui-stat-bar', 'mcpui-table', 'mcpui-chart',
               'mcpui-section', 'mcpui-metric', 'mcpui-message', 'mcpui-form', 'mcpui-actions'],
    ADD_ATTR: ['items', 'title', 'status', 'body', 'meta', 'columns', 'rows',
               'status-field', 'type', 'config', 'role', 'content', 'class',
               'label', 'count', 'collapsed', 'item-id', 'value', 'unit', 'trend',
               'streaming', 'tool-id', 'fields', 'actions'],
};

const CONTAINER_TAGS = new Set(['mcpui-section']);

const ICON_SEND = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l7-7v4h9v6H9v4z" transform="rotate(-90 10 10)"/></svg>`;
const ICON_STOP = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`;

// ── State ──
let activeSource = null;
let cancelGeneration = 0;
let fastMode = localStorage.getItem('mcpui:fastMode') === 'true';

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

// ── Persistence ──
function saveState() {
    try {
        const data = JSON.stringify({ activeSessionId, sessions });
        if (data.length > 4_000_000) {
            // Prune nodes from oldest sessions
            const sorted = [...sessions].sort((a, b) => a.updatedAt - b.updatedAt);
            for (const s of sorted) {
                if (JSON.stringify({ activeSessionId, sessions }).length < 3_500_000) break;
                if (s.nodes.length > 2) s.nodes = s.nodes.slice(-2);
            }
        }
        localStorage.setItem('mcpui:sessions', JSON.stringify({ activeSessionId, sessions }));
    } catch { /* storage full */ }
}

function loadState() {
    try {
        // Try new multi-session format
        const raw = localStorage.getItem('mcpui:sessions');
        if (raw) return JSON.parse(raw);

        // Migrate old single-session format
        const oldRaw = localStorage.getItem('mcpui:state');
        if (oldRaw) {
            const old = JSON.parse(oldRaw);
            if (old.nodes?.length > 0) {
                const session = {
                    id: generateId(),
                    title: old.nodes[0]?.promptDisplay || 'Previous session',
                    createdAt: old.nodes[0]?.timestamp || Date.now(),
                    updatedAt: old.nodes[old.nodes.length - 1]?.timestamp || Date.now(),
                    conversationId: old.conversationId,
                    nodes: old.nodes,
                };
                localStorage.removeItem('mcpui:state');
                return { activeSessionId: session.id, sessions: [session] };
            }
            localStorage.removeItem('mcpui:state');
        }
        return null;
    } catch { return null; }
}

function clearState() {
    localStorage.removeItem('mcpui:sessions');
    localStorage.removeItem('mcpui:state');
}

// ── Session CRUD ──
function createSession() {
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
    renderSessionList();
    renderMainContent();
    saveState();
}

function switchSession(sessionId) {
    if (sessionId === activeSessionId) return;
    activeSessionId = sessionId;
    renderMainContent();
    renderSessionList();
    saveState();
}

function deleteSession(sessionId) {
    const session = sessions.find(s => s.id === sessionId);
    const name = session?.title || 'this session';
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    sessions = sessions.filter(s => s.id !== sessionId);
    if (activeSessionId === sessionId) {
        activeSessionId = sessions[0]?.id || null;
        if (!activeSessionId) createSession();
        else { renderMainContent(); }
    }
    renderSessionList();
    saveState();
}

// ── Summary & Helpers ──
function generateSummary(contentEl) {
    const tagEls = contentEl.querySelectorAll(
        'mcpui-stat-bar, mcpui-table, mcpui-card, mcpui-chart, mcpui-metric, mcpui-section'
    );
    const tags = [...new Set([...tagEls].map(el => el.tagName.toLowerCase().replace('mcpui-', '')))];

    const statBar = contentEl.querySelector('mcpui-stat-bar');
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

// ── Session List Rendering ──
function renderSessionList() {
    const listEl = document.getElementById('session-list');
    if (!listEl) return;

    // Group by time
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const groups = { today: [], yesterday: [], week: [], older: [] };

    for (const s of sessions) {
        const t = s.updatedAt || s.createdAt;
        if (t >= todayStart) groups.today.push(s);
        else if (t >= todayStart - dayMs) groups.yesterday.push(s);
        else if (t >= todayStart - 7 * dayMs) groups.week.push(s);
        else groups.older.push(s);
    }

    let html = '';
    const renderGroup = (label, items) => {
        if (items.length === 0) return;
        html += `<div class="mcpui-session-group-label">${label}</div>`;
        for (const s of items) {
            const active = s.id === activeSessionId ? ' active' : '';
            const stepCount = s.nodes?.length || 0;
            html += `
                <div class="mcpui-session-item${active}" data-session-id="${s.id}">
                    <div class="mcpui-session-title">${escapeHtml(s.title)}</div>
                    <div class="mcpui-session-meta">${stepCount} step${stepCount !== 1 ? 's' : ''} \u2022 ${formatTimeAgo(s.updatedAt || s.createdAt)}</div>
                    <button class="mcpui-session-delete" data-delete-id="${s.id}" title="Delete">\u00d7</button>
                </div>
            `;
        }
    };

    renderGroup('Today', groups.today);
    renderGroup('Yesterday', groups.yesterday);
    renderGroup('Previous 7 days', groups.week);
    renderGroup('Older', groups.older);

    if (sessions.length === 0) {
        html = '<div style="padding: 16px; color: var(--mcpui-text-muted); font-size: 13px; text-align: center;">No sessions yet</div>';
    }

    listEl.innerHTML = html;
}

// ── Node DOM Creation ──
function createNodeEl(node) {
    const div = document.createElement('div');
    div.className = 'mcpui-node';
    div.dataset.nodeId = node.id;
    div.dataset.collapsed = String(node.collapsed);

    // Build summary: stats (duration, tokens, cost) + content summary
    const summaryParts = [];
    if (node.stats) {
        const dur = (node.stats.durationMs / 1000).toFixed(1);
        const tokens = (node.stats.inputTokens || 0) + (node.stats.outputTokens || 0);
        summaryParts.push(`${dur}s`);
        if (tokens > 0) summaryParts.push(`${tokens.toLocaleString()} tokens`);
        if (node.stats.costUsd) summaryParts.push(`$${node.stats.costUsd.toFixed(4)}`);
    }
    if (node.summary) summaryParts.push(node.summary);
    const summaryText = summaryParts.join(' \u2022 ');

    div.innerHTML = `
        <div class="mcpui-node-header" role="button" tabindex="0">
            <span class="mcpui-node-chevron">\u25bc</span>
            <span class="mcpui-node-prompt">${escapeHtml(node.promptDisplay || node.prompt)}</span>
            <span class="mcpui-node-summary">${escapeHtml(summaryText)}</span>
            <span class="mcpui-node-time">${formatTimeAgo(node.timestamp)}</span>
            <button class="mcpui-node-delete" data-delete-node="${node.id}" title="Delete this step">\u00d7</button>
        </div>
        <div class="mcpui-node-content"></div>
    `;

    const header = div.querySelector('.mcpui-node-header');
    header.addEventListener('click', (e) => {
        if (e.target.closest('.mcpui-node-delete')) return;
        toggleNode(node.id);
    });
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(node.id); }
    });
    header.querySelector('.mcpui-node-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNode(node.id);
    });
    return div;
}

function toggleNode(nodeId) {
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
        const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
        if (el) el.dataset.collapsed = 'true';
    }

    saveState();
}

function scrollToNode(nodeId, highlight = true) {
    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const session = getActiveSession();
    const node = session?.nodes.find(n => n.id === nodeId);
    if (node?.collapsed) { node.collapsed = false; el.dataset.collapsed = 'false'; }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (highlight) {
        el.classList.remove('mcpui-node-highlight');
        void el.offsetWidth;
        el.classList.add('mcpui-node-highlight');
    }
    saveState();
}

function getDescendantIds(session, nodeId) {
    const ids = [nodeId];
    const children = getChildren(session, nodeId);
    for (const child of children) {
        ids.push(...getDescendantIds(session, child.id));
    }
    return ids;
}

function deleteNode(nodeId) {
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
    saveState();
}

function collapseAllExcept(exceptNodeId) {
    const session = getActiveSession();
    if (!session) return;
    for (const node of session.nodes) {
        if (node.id !== exceptNodeId && !node.collapsed) {
            node.collapsed = true;
            const el = document.querySelector(`.mcpui-node[data-node-id="${node.id}"]`);
            if (el) el.dataset.collapsed = 'true';
        }
    }
}

function updateNodeSummary(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const contentEl = el.querySelector('.mcpui-node-content');
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
    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (!el) return;
    const summaryEl = el.querySelector('.mcpui-node-summary');
    if (!summaryEl) return;

    const parts = [];
    if (node.stats) {
        const dur = (node.stats.durationMs / 1000).toFixed(1);
        const tokens = (node.stats.inputTokens || 0) + (node.stats.outputTokens || 0);
        parts.push(`${dur}s`);
        if (tokens > 0) parts.push(`${tokens.toLocaleString()} tokens`);
        if (node.stats.costUsd) parts.push(`$${node.stats.costUsd.toFixed(4)}`);
    }
    if (node.summary) parts.push(node.summary);

    summaryEl.textContent = parts.length > 0 ? parts.join(' \u2022 ') : '';
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
    treeWrapper.className = 'mcpui-tree';
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
    if (!isActive) nodeEl.classList.add('mcpui-node-dimmed');
    container.appendChild(nodeEl);

    // Populate content
    if (node.response) {
        const contentEl = nodeEl.querySelector('.mcpui-node-content');
        if (node.type === 'components') {
            const clean = transformOutput(DOMPurify.sanitize(extractHtmlContent(node.response), PURIFY_CONFIG));
            const temp = document.createElement('template');
            temp.innerHTML = clean;
            contentEl.appendChild(temp.content);
        } else {
            contentEl.innerHTML = `<div class="mcpui-text-response">${renderMarkdown(node.response)}</div>`;
        }
    } else if (isActiveLeaf && !node.collapsed) {
        // Show progress indicator for active nodes with no response yet
        const contentEl = nodeEl.querySelector('.mcpui-node-content');
        if (contentEl) contentEl.innerHTML = getProgressHtml();
    }

    const children = getChildren(session, node.id);
    if (children.length === 0) return;

    if (children.length === 1) {
        // Single child — continue vertically
        const connector = document.createElement('div');
        connector.className = 'mcpui-tree-connector';
        container.appendChild(connector);
        renderTreeNode(container, session, children[0], activePath);
    } else {
        // Multiple children — branch horizontally, each with its own connector
        const branchContainer = document.createElement('div');
        branchContainer.className = 'mcpui-tree-branches';
        container.appendChild(branchContainer);

        for (const child of children) {
            const branchCol = document.createElement('div');
            branchCol.className = 'mcpui-tree-branch-col';
            if (activePath.has(child.id)) branchCol.classList.add('active');
            branchContainer.appendChild(branchCol);

            // Each branch gets its own connector line
            const branchConnector = document.createElement('div');
            branchConnector.className = 'mcpui-tree-connector';
            branchCol.appendChild(branchConnector);

            renderTreeNode(branchCol, session, child, activePath);
        }
    }
}

// ── Progress Indicator (audit trail) ──
let _progressTimer = null;

function getProgressHtml() {
    return `
        <div class="mcpui-progress" data-start="${Date.now()}">
            <div class="mcpui-progress-trail"></div>
        </div>
    `;
}

function stopProgressTimer() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
}

function updateProgress(contentEl, stage, detail) {
    const progressEl = contentEl.querySelector('.mcpui-progress');
    if (!progressEl) return;
    const trail = progressEl.querySelector('.mcpui-progress-trail');
    if (!trail) return;
    const now = Date.now();

    // Finalize the previous active entry (freeze its timer)
    const prevActive = trail.querySelector('.mcpui-progress-entry.active');
    if (prevActive) {
        prevActive.classList.remove('active');
        prevActive.classList.add('done');
        const timeEl = prevActive.querySelector('.mcpui-progress-time');
        if (timeEl && prevActive.dataset.started) {
            const elapsed = ((now - Number(prevActive.dataset.started)) / 1000).toFixed(1);
            timeEl.textContent = elapsed + 's';
        }
    }

    // Append a new entry
    const label = detail || stage;
    const entry = document.createElement('div');
    entry.className = 'mcpui-progress-entry active';
    entry.dataset.started = String(now);
    entry.innerHTML = `<span class="mcpui-progress-dot"></span><span class="mcpui-progress-label">${escapeHtml(label)}</span><span class="mcpui-progress-time"></span>`;
    trail.appendChild(entry);

    // Scroll trail to bottom if overflow
    trail.scrollTop = trail.scrollHeight;

    // Start tick timer for the new active entry
    stopProgressTimer();
    _progressTimer = setInterval(() => {
        const active = trail.querySelector('.mcpui-progress-entry.active');
        if (!active) { stopProgressTimer(); return; }
        const timeEl = active.querySelector('.mcpui-progress-time');
        if (timeEl && active.dataset.started) {
            const elapsed = ((Date.now() - Number(active.dataset.started)) / 1000).toFixed(1);
            timeEl.textContent = elapsed + 's';
        }
    }, 100);
}

// ── Main ──
document.addEventListener('DOMContentLoaded', () => {
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
            localStorage.setItem('mcpui:fastMode', String(fastMode));
        });
    }

    // ── Session panel events ──
    document.getElementById('btn-new-session')?.addEventListener('click', () => createSession());

    document.getElementById('session-list')?.addEventListener('click', (e) => {
        // Delete button
        const deleteBtn = e.target.closest('.mcpui-session-delete');
        if (deleteBtn) {
            e.stopPropagation();
            deleteSession(deleteBtn.dataset.deleteId);
            return;
        }
        // Session item click
        const item = e.target.closest('.mcpui-session-item');
        if (item) switchSession(item.dataset.sessionId);
    });

    // Mobile toggle for session panel
    document.getElementById('btn-toggle-sessions')?.addEventListener('click', () => {
        document.getElementById('session-panel')?.classList.toggle('open');
    });

    // ── Server modal ──
    document.getElementById('btn-servers')?.addEventListener('click', () => openServerModal());
    document.getElementById('btn-close-modal')?.addEventListener('click', () => closeServerModal());
    document.querySelector('.mcpui-modal-backdrop')?.addEventListener('click', () => closeServerModal());

    document.getElementById('catalog-grid')?.addEventListener('click', (e) => {
        const item = e.target.closest('.mcpui-catalog-item');
        if (item && !item.classList.contains('connected')) showSetupForm(item.dataset.presetId);
    });

    document.getElementById('connected-server-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.mcpui-connected-server-disconnect');
        if (btn) disconnectServer(btn.dataset.server);
    });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeServerModal(); });

    // ── Restore from localStorage ──
    const state = loadState();
    if (state?.sessions?.length > 0) {
        sessions = state.sessions;
        activeSessionId = state.activeSessionId || sessions[0].id;
        renderSessionList();
        renderMainContent();
    } else {
        createSession();
    }

    function updateBreadcrumb() {
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
        const btn = e.target.closest('.mcpui-suggestion');
        if (btn?.dataset.prompt) {
            promptInput.value = btn.dataset.prompt;
            handleSubmit(btn.dataset.label || undefined);
        }
    });

    // ── Card drill-down ──
    // ── Stat-bar filter — click chip to show/hide sections ──
    container.addEventListener('mcpui-filter', (e) => {
        const { filter } = e.detail || {};
        // Find the node content area containing this stat-bar
        const nodeContent = e.target.closest('.mcpui-node-content');
        if (!nodeContent) return;

        // Show/hide sibling sections and cards based on filter
        const sections = nodeContent.querySelectorAll('mcpui-section');
        const cards = nodeContent.querySelectorAll('mcpui-card');
        const tables = nodeContent.querySelectorAll('mcpui-table');

        if (!filter) {
            // No filter — show everything
            sections.forEach(el => el.style.display = '');
            cards.forEach(el => el.style.display = '');
            tables.forEach(el => el.style.display = '');
        } else {
            // Filter by label text — check section labels and card content
            const filterLower = filter.toLowerCase();
            sections.forEach(el => {
                const label = (el.getAttribute('label') || '').toLowerCase();
                const matches = label.includes(filterLower) || filterLower.includes(label.replace(/\s*\(.*\)/, ''));
                el.style.display = matches ? '' : 'none';
            });
            // If no sections matched, try filtering cards directly
            const visibleSections = [...sections].filter(el => el.style.display !== 'none');
            if (visibleSections.length === 0) {
                cards.forEach(el => {
                    const text = el.textContent?.toLowerCase() || '';
                    el.style.display = text.includes(filterLower) ? '' : 'none';
                });
            }
        }
    });

    container.addEventListener('mcpui-card-action', (e) => {
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
            const nodeEl = e.target.closest('.mcpui-node');
            if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;
            promptInput.value = getDrillDownPrompt(title, status, itemId);
            handleSubmit(title);
        }
    });

    // ── Form submission (write tools) ──
    container.addEventListener('mcpui-form-submit', (e) => {
        const { toolId, values } = e.detail || {};
        if (!toolId) return;
        // Branch from the node containing this form
        const nodeEl = e.target.closest('.mcpui-node');
        if (nodeEl?.dataset?.nodeId) branchFromNodeId = nodeEl.dataset.nodeId;
        const params = Object.entries(values)
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
        promptInput.value = `Call the tool ${toolId} with these exact parameters: ${params}. Show the result using mcpui-* components.`;
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
    container.addEventListener('mcpui-action', (e) => {
        const { label, action, prompt } = e.detail || {};
        if (!prompt) return;
        promptInput.value = prompt + '. Use ONLY mcpui-* web components.';
        const contextSummary = prompt.split(/[.!]/)[0].substring(0, 60);
        const displayLabel = contextSummary.length > label.length ? contextSummary : label;

        // Set branch point to the node containing this action bar
        const nodeEl = e.target.closest('.mcpui-node');
        if (nodeEl?.dataset?.nodeId) {
            branchFromNodeId = nodeEl.dataset.nodeId;
        }

        handleSubmit(displayLabel);
    });

    // ── Form field lookups ──
    container.addEventListener('mcpui-form-lookup', async (e) => {
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
    function handleSubmit(displayLabel) {
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        promptInput.value = '';
        promptInput.style.height = '';

        let session = getActiveSession();
        if (!session) { createSession(); session = getActiveSession(); }

        // Remove empty state
        const emptyState = container.querySelector('.mcpui-empty-state');
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

        const node = {
            id: nodeId,
            parentId,
            children: [],
            prompt,
            promptDisplay: displayLabel || (prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt),
            _hasExplicitLabel: !!displayLabel,
            response: '',
            type: 'text',
            summary: '',
            tags: [],
            stats: null,
            timestamp: Date.now(),
            collapsed: false,
        };

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
        const nodeEl = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
        const contentEl = nodeEl?.querySelector('.mcpui-node-content');
        if (contentEl) contentEl.innerHTML = getProgressHtml();
        if (nodeEl) nodeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
                if (containsMcpuiTags(trimmed)) {
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
                    contentEl.innerHTML = `<div class="mcpui-text-response mcpui-streaming">${renderMarkdown(trimmed)}</div>`;
                }
            },
            // onDone
            (fullText, newConversationId) => {
                stopProgressTimer();
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                promptInput.focus();

                session.conversationId = newConversationId;

                const trimmed = fullText.trim();
                node.response = trimmed;
                node.type = containsMcpuiTags(trimmed) ? 'components' : 'text';

                if (containsMcpuiTags(trimmed)) {
                    const totalElements = findStreamElements(trimmed).length;
                    if (!(streamingStarted && renderedCount > 0 && renderedCount >= totalElements)) {
                        contentEl.innerHTML = '';
                        const clean = transformOutput(DOMPurify.sanitize(extractHtmlContent(trimmed), PURIFY_CONFIG));
                        const temp = document.createElement('template');
                        temp.innerHTML = clean;
                        contentEl.appendChild(temp.content);
                    }
                } else {
                    contentEl.innerHTML = `<div class="mcpui-text-response">${renderMarkdown(trimmed)}</div>`;
                }

                updateNodeSummary(nodeId);
                updateBreadcrumb();
                renderSessionList();
                saveState();
            },
            // onError
            (error) => {
                stopProgressTimer();
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                contentEl.innerHTML = `<div class="mcpui-text-response">Error: ${escapeHtml(error)}</div>`;
                node.response = error;
                node.type = 'text';
                node.summary = 'Error';
                node.tags = ['error'];
                updateNodeSummary(nodeId);
                saveState();
            },
            // onProgress
            (stage, detail) => {
                updateProgress(contentEl, stage, detail);
            },
            // onStats
            (stats) => {
                node.stats = stats;
                updateNodeHeader(nodeId);
                saveState();
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
                    if (onProgress) onProgress(data.stage, data.detail);
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

function containsMcpuiTags(text) { return /<mcpui-[a-z]/.test(text); }

function findStreamElements(text) {
    const elements = [];
    const cleaned = text.replace(/<use_mcp_tool[\s\S]*?<\/use_mcp_tool>/g, '');
    const re = /<(\/?)((mcpui-[a-z-]+)|div|h[1-6]|p|section|ul|ol|table)(\s[^>]*)?>/g;
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
    const htmlStart = cleaned.search(/<(?:mcpui-[a-z]|div)/);
    if (htmlStart === -1) return cleaned.trim();
    const preamble = cleaned.substring(0, htmlStart).trim();
    const htmlContent = cleaned.substring(htmlStart).trim();
    let result = '';
    if (preamble) result += `<div class="mcpui-text-preamble">${renderMarkdown(preamble)}</div>`;
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

    // Rule 1: Tool listing cards use "info" status (blue), not RAG colors
    // RAG (success/warning/error) should only be used for actual state/results
    root.querySelectorAll('mcpui-card').forEach(card => {
        const itemId = card.getAttribute('item-id') || '';
        if (itemId.includes('__')) {
            card.setAttribute('status', 'info');
        }
    });

    // Rule 2: Sanitize lookup prompts — strip any specific tool/server name references
    root.querySelectorAll('mcpui-form').forEach(form => {
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
- If the tool has required parameters that need user input → show a mcpui-form with the parameters as fields. Add lookup to fields where values can be searched. Do NOT guess parameter values.
- If the tool can run with NO parameters or has obvious defaults (like listing the current directory) → call it and show results.
${isWrite ? '- This is a write tool — ALWAYS show a form, never auto-invoke.' : '- Only auto-invoke if truly no user input is needed.'}

Use ONLY mcpui-* web components. Include mcpui-actions with next steps after results.`;
    }
    return `Explore "${title}"${idClause} in more detail. Call the appropriate tools to get real data and show the results using mcpui-* web components. If a tool requires parameters, show a mcpui-form instead of guessing. Include mcpui-actions with next steps.`;
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
        <div class="mcpui-empty-state">
            <h2>Welcome to MCPUI</h2>
            <p>Explore your connected data sources.</p>
            <div class="mcpui-server-buttons" id="server-buttons">
                <div class="mcpui-suggestion-skeleton-pill"></div>
                <div class="mcpui-suggestion-skeleton-pill"></div>
            </div>
            <div class="mcpui-tool-shortcuts" id="tool-shortcuts">
                <div class="mcpui-suggestion-skeleton-pill"></div>
                <div class="mcpui-suggestion-skeleton-pill"></div>
                <div class="mcpui-suggestion-skeleton-pill"></div>
            </div>
        </div>
    `;
}

async function loadDynamicSuggestions(container) {
    try {
        const res = await fetch('/api/servers');
        const { servers } = await res.json();

        // Render server buttons immediately
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) {
            if (servers.length === 0) {
                serverBtns.innerHTML = `<button class="mcpui-suggestion" data-prompt="What tools are available?" data-label="Available tools">Available tools</button>`;
            } else {
                serverBtns.innerHTML = servers.map(s => `
                    <button class="mcpui-suggestion mcpui-suggestion-server" data-prompt="${escapeAttr(`Show me what I can do with the connected ${s.name} tools. List the available operations as cards.`)}" data-label="${escapeAttr(s.name)}">
                        ${escapeHtml(s.name)}
                        <span class="mcpui-suggestion-sub">${s.toolCount} tools</span>
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
                    prompt: `${tool.description || tool.name}. Show results using mcpui-* components.`,
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
                    <button class="mcpui-suggestion" data-prompt="${escapeAttr(s.prompt)}" data-label="${escapeAttr(s.label)}">
                        ${escapeHtml(s.label)}
                    </button>
                `).join('');
            }
        }
    } catch {
        const serverBtns = container.querySelector('#server-buttons');
        if (serverBtns) {
            serverBtns.innerHTML = `<button class="mcpui-suggestion" data-prompt="What tools are available?" data-label="Available tools">Available tools</button>`;
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
    document.querySelector('.mcpui-setup-form')?.remove();
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
            connectedList.innerHTML = '<div class="mcpui-no-servers">No servers connected</div>';
        } else {
            connectedList.innerHTML = servers.map(s => `
                <div class="mcpui-connected-server">
                    <span class="mcpui-connected-server-dot"></span>
                    <div class="mcpui-connected-server-info">
                        <div class="mcpui-connected-server-name">${escapeHtml(s.name)}</div>
                        <div class="mcpui-connected-server-tools">${s.toolCount} tools</div>
                    </div>
                    <button class="mcpui-connected-server-disconnect" data-server="${escapeHtml(s.name)}">Disconnect</button>
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
            html += `<div class="mcpui-catalog-category">`;
            html += `<div class="mcpui-catalog-category-label">${label}</div>`;
            html += `<div class="mcpui-catalog-grid">`;
            for (const item of items) {
                const isConnected = connectedNames.has(item.id);
                html += `<div class="mcpui-catalog-item${isConnected ? ' connected' : ''}" data-preset-id="${item.id}">
                    <div class="mcpui-catalog-item-name">${escapeHtml(item.name)}</div>
                    <div class="mcpui-catalog-item-desc">${escapeHtml(item.description)}</div>
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

    document.querySelector('.mcpui-setup-form')?.remove();

    if (!preset.requiredFields || preset.requiredFields.length === 0) {
        await connectPresetServer(preset, {});
        return;
    }

    const form = document.createElement('div');
    form.className = 'mcpui-setup-form';
    form.innerHTML = `
        <h4>Configure ${escapeHtml(preset.name)}</h4>
        ${preset.requiredFields.map(f => `
            <div class="mcpui-setup-field">
                <label>${escapeHtml(f.label)}</label>
                <input type="${f.key.toLowerCase().includes('token') || f.key.toLowerCase().includes('key') ? 'password' : 'text'}"
                       data-field-key="${f.key}" placeholder="${escapeHtml(f.placeholder || '')}" />
            </div>
        `).join('')}
        <div class="mcpui-setup-status" id="setup-status"></div>
        <div class="mcpui-setup-actions">
            <button class="mcpui-setup-btn mcpui-setup-btn-cancel" id="btn-setup-cancel">Cancel</button>
            <button class="mcpui-setup-btn mcpui-setup-btn-primary" id="btn-setup-connect">Connect</button>
        </div>
    `;

    document.querySelector('.mcpui-modal-body')?.appendChild(form);
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

    if (statusEl) { statusEl.textContent = 'Connecting...'; statusEl.className = 'mcpui-setup-status'; }

    try {
        const res = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: preset.id, config }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to connect');
        if (statusEl) { statusEl.textContent = 'Connected!'; statusEl.className = 'mcpui-setup-status success'; }
        setTimeout(async () => { document.querySelector('.mcpui-setup-form')?.remove(); await refreshServerModal(); }, 1000);
    } catch (err) {
        if (statusEl) { statusEl.textContent = `Error: ${err.message}`; statusEl.className = 'mcpui-setup-status error'; }
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
