/**
 * MCPUI Demo App — main orchestration.
 * Multi-session management with inline conversation and infinite scroll navigation.
 */

// ── DOMPurify Config ──
const PURIFY_CONFIG = {
    ADD_TAGS: ['mcpui-card', 'mcpui-stat-bar', 'mcpui-table', 'mcpui-chart',
               'mcpui-section', 'mcpui-metric', 'mcpui-message', 'mcpui-form'],
    ADD_ATTR: ['items', 'title', 'status', 'body', 'meta', 'columns', 'rows',
               'status-field', 'type', 'config', 'role', 'content', 'class',
               'label', 'count', 'collapsed', 'item-id', 'value', 'unit', 'trend',
               'streaming', 'tool-id', 'fields'],
};

const CONTAINER_TAGS = new Set(['mcpui-section']);

const ICON_SEND = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l7-7v4h9v6H9v4z" transform="rotate(-90 10 10)"/></svg>`;
const ICON_STOP = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`;

// ── State ──
let activeSource = null;
let cancelGeneration = 0;
let fastMode = false;

// Multi-session state
let sessions = [];
let activeSessionId = null;

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId);
}

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

    const tagsHtml = (node.tags || [])
        .map(t => `<span class="mcpui-node-tag">${t}</span>`)
        .join('');

    div.innerHTML = `
        <div class="mcpui-node-header" role="button" tabindex="0">
            <span class="mcpui-node-chevron">\u25bc</span>
            <span class="mcpui-node-prompt">${escapeHtml(node.promptDisplay || node.prompt)}</span>
            <span class="mcpui-node-summary">
                <span class="mcpui-node-tags">${tagsHtml}</span>
                ${node.summary ? ' \u2022 ' + escapeHtml(node.summary) : ''}
            </span>
            <span class="mcpui-node-time">${formatTimeAgo(node.timestamp)}</span>
        </div>
        <div class="mcpui-node-prompt-bubble">
            <div class="mcpui-prompt-avatar">You</div>
            <div class="mcpui-prompt-text">${escapeHtml(node.promptDisplay || node.prompt)}</div>
        </div>
        <div class="mcpui-node-content"></div>
    `;

    const header = div.querySelector('.mcpui-node-header');
    header.addEventListener('click', () => toggleNode(node.id));
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(node.id); }
    });

    return div;
}

function toggleNode(nodeId) {
    const session = getActiveSession();
    if (!session) return;
    const node = session.nodes.find(n => n.id === nodeId);
    if (!node) return;
    node.collapsed = !node.collapsed;
    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (el) el.dataset.collapsed = String(node.collapsed);
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
    const tagsHtml = tags.map(t => `<span class="mcpui-node-tag">${t}</span>`).join('');
    const summaryEl = el.querySelector('.mcpui-node-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `<span class="mcpui-node-tags">${tagsHtml}</span>${summary ? ' \u2022 ' + escapeHtml(summary) : ''}`;
    }
}

// ── Main Content Rendering ──
function renderMainContent() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;
    const session = getActiveSession();

    if (!session || session.nodes.length === 0) {
        container.innerHTML = getEmptyState();
        return;
    }

    container.innerHTML = '';
    for (let i = 0; i < session.nodes.length; i++) {
        const node = session.nodes[i];
        if (i < session.nodes.length - 1) node.collapsed = true;
        else node.collapsed = false;

        const nodeEl = createNodeEl(node);
        container.appendChild(nodeEl);

        if (node.response) {
            const contentEl = nodeEl.querySelector('.mcpui-node-content');
            if (node.type === 'components') {
                const clean = DOMPurify.sanitize(extractHtmlContent(node.response), PURIFY_CONFIG);
                const temp = document.createElement('template');
                temp.innerHTML = clean;
                contentEl.appendChild(temp.content);
            } else {
                contentEl.innerHTML = `<div class="mcpui-text-response">${renderMarkdown(node.response)}</div>`;
            }
        }
    }

    const lastNode = session.nodes[session.nodes.length - 1];
    if (lastNode) {
        setTimeout(() => scrollToNode(lastNode.id, false), 100);
    }
}

// ── Progress Indicator ──
const PROGRESS_STAGES = ['connecting', 'thinking', 'tool_call', 'tool_result', 'generating'];
const STAGE_LABELS = {
    connecting: 'Connecting to data sources',
    thinking: 'Analyzing request',
    tool_call: 'Fetching data',
    tool_result: 'Processing results',
    generating: 'Generating view',
};

let _progressTimer = null;
let _progressStageStart = null;

function getProgressHtml() {
    return `
        <div class="mcpui-progress" data-start="${Date.now()}">
            <div class="mcpui-progress-stages">
                ${PROGRESS_STAGES.map(s => `
                    <div class="mcpui-progress-stage pending" data-stage="${s}" data-started="">
                        <span class="mcpui-progress-dot"></span>
                        <span class="mcpui-progress-label">${STAGE_LABELS[s]}</span>
                        <span class="mcpui-progress-time"></span>
                    </div>
                `).join('')}
            </div>
            <div class="mcpui-progress-bar">
                <div class="mcpui-progress-fill" style="width: 5%"></div>
            </div>
        </div>
    `;
}

function stopProgressTimer() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
}

function updateProgress(contentEl, stage, detail) {
    const progressEl = contentEl.querySelector('.mcpui-progress');
    if (!progressEl) return;
    const stageIdx = PROGRESS_STAGES.indexOf(stage);
    if (stageIdx === -1) return;
    const now = Date.now();

    const stageEls = progressEl.querySelectorAll('.mcpui-progress-stage');
    stageEls.forEach((el, i) => {
        const timeEl = el.querySelector('.mcpui-progress-time');
        if (i < stageIdx) {
            // Done — freeze the elapsed time
            el.classList.remove('active', 'pending');
            el.classList.add('done');
            if (timeEl && el.dataset.started && !el.dataset.finished) {
                const elapsed = ((now - Number(el.dataset.started)) / 1000).toFixed(1);
                timeEl.textContent = `${elapsed}s`;
                el.dataset.finished = now;
            }
        } else if (i === stageIdx) {
            // Active — start ticking
            el.classList.remove('done', 'pending');
            el.classList.add('active');
            if (!el.dataset.started || el.dataset.started === '') {
                el.dataset.started = now;
            }
            _progressStageStart = Number(el.dataset.started);
        } else {
            el.classList.remove('done', 'active');
            el.classList.add('pending');
        }
    });

    if (detail) {
        const activeLabel = progressEl.querySelector(`.mcpui-progress-stage[data-stage="${stage}"] .mcpui-progress-label`);
        if (activeLabel) activeLabel.textContent = detail;
    }

    const fill = progressEl.querySelector('.mcpui-progress-fill');
    if (fill) fill.style.width = `${Math.min(95, ((stageIdx + 1) / PROGRESS_STAGES.length) * 100)}%`;

    // Start/restart the tick timer for the active stage
    stopProgressTimer();
    _progressTimer = setInterval(() => {
        const activeEl = progressEl.querySelector('.mcpui-progress-stage.active');
        if (!activeEl) { stopProgressTimer(); return; }
        const timeEl = activeEl.querySelector('.mcpui-progress-time');
        if (timeEl && activeEl.dataset.started) {
            const elapsed = ((Date.now() - Number(activeEl.dataset.started)) / 1000).toFixed(1);
            timeEl.textContent = `${elapsed}s`;
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
        fastToggle.addEventListener('click', () => {
            fastMode = !fastMode;
            fastToggle.classList.toggle('active', fastMode);
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
            handleSubmit();
        }
    });

    // ── Card drill-down ──
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
            promptInput.value = getDrillDownPrompt(title, status, itemId);
            handleSubmit(title);
        }
    });

    // ── Form submission (write tools) ──
    container.addEventListener('mcpui-form-submit', (e) => {
        const { toolId, values } = e.detail || {};
        if (!toolId) return;
        const params = Object.entries(values)
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
        promptInput.value = `Call the tool ${toolId} with these exact parameters: ${params}. Show the result using mcpui-* components.`;
        const toolName = toolId.split('__').pop() || toolId;
        handleSubmit(toolName);
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

        // Create new node
        const nodeId = generateId();
        const node = {
            id: nodeId,
            parentId: session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null,
            prompt,
            promptDisplay: displayLabel || (prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt),
            response: '',
            type: 'text',
            summary: '',
            tags: [],
            timestamp: Date.now(),
            collapsed: false,
        };
        session.nodes.push(node);
        session.updatedAt = Date.now();

        // Auto-title session from first prompt
        if (session.nodes.length === 1) {
            session.title = node.promptDisplay;
            renderSessionList();
        }

        // Auto-collapse previous nodes
        collapseAllExcept(nodeId);

        const nodeEl = createNodeEl(node);
        container.appendChild(nodeEl);
        const contentEl = nodeEl.querySelector('.mcpui-node-content');
        contentEl.innerHTML = getProgressHtml();
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        submitBtn.classList.add('cancel');
        submitBtn.innerHTML = ICON_STOP;

        let renderedCount = 0;
        let streamingStarted = false;
        const containerStack = [];

        history.pushState({ nodeId }, '');

        submitPrompt(
            prompt,
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
                        const clean = DOMPurify.sanitize(extractHtmlContent(trimmed), PURIFY_CONFIG);
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
            }
        );

        promptInput.disabled = true;
        updateBreadcrumb();
    }
});

// ── SSE Streaming ──

async function submitPrompt(prompt, existingConversationId, onChunk, onDone, onError, onProgress) {
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, conversationId: existingConversationId, model: fastMode ? 'haiku' : undefined }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        const conversationId = data.conversationId;
        await streamResponse(data.streamUrl, onChunk, (fullText) => onDone(fullText, conversationId), onError, onProgress);
    } catch (err) {
        onError(err.message);
    }
}

function streamResponse(streamUrl, onChunk, onDone, onError, onProgress) {
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

// ── Drill-Down ──
// Write/mutate tool patterns — these should NOT be auto-invoked
const WRITE_TOOL_PATTERNS = /^(create|update|delete|remove|push|write|edit|move|fork|merge|add|set|close|lock|assign)/i;

function getDrillDownPrompt(title, status, itemId) {
    const idClause = itemId ? ` (tool: ${itemId})` : '';
    const looksLikeTool = itemId && (itemId.includes('__') || itemId.includes('mcp_'));

    if (looksLikeTool) {
        // Check if this is a write/mutate tool
        const toolName = title || '';
        if (WRITE_TOOL_PATTERNS.test(toolName)) {
            return `The user wants to use the "${title}" tool${idClause}. This is a write/mutate operation — do NOT call it automatically. Instead, show a mcpui-form component with the tool's required and optional input parameters as form fields. Use field types appropriate to each parameter (text for strings, number for integers). Mark required fields. Include a submit button. Use ONLY mcpui-* web components.`;
        }
        // Read-only tool — safe to auto-invoke
        return `Call the "${title}" tool${idClause} with sensible default parameters and show the results using mcpui-* components (tables, cards, stat-bars, charts). If the tool requires a query or search term, use a reasonable example. Actually execute the tool — do NOT just describe its parameters. Use ONLY mcpui-* web components.`;
    }
    return `Explore "${title}"${idClause} in more detail. If this is a file, read it. If this is a resource, fetch its data. If this is an item in a list, get its details. Call the appropriate tools to get real data and show the results using mcpui-* web components — no markdown.`;
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

function getEmptyState() {
    return `
        <div class="mcpui-empty-state">
            <div class="mcpui-empty-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="20" stroke="#d1d5db" stroke-width="2" fill="none"/>
                    <path d="M16 24h16M24 16v16" stroke="#d1d5db" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
            <h2>Welcome to MCPUI</h2>
            <p>Connect to any MCP server and explore your data visually.</p>
            <div class="mcpui-suggestions">
                <button class="mcpui-suggestion" data-prompt="What tools are available?">Available tools</button>
                <button class="mcpui-suggestion" data-prompt="Show me an overview of the data">Data overview</button>
                <button class="mcpui-suggestion" data-prompt="List everything you can access">List resources</button>
            </div>
        </div>
    `;
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
