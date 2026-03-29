/**
 * MCPUI Demo App — main orchestration.
 * Infinite scroll navigation: each response appends as a collapsible section.
 * Supports browser back/forward, sidebar linking, and localStorage persistence.
 */

// ── DOMPurify Config ──
const PURIFY_CONFIG = {
    ADD_TAGS: ['mcpui-card', 'mcpui-stat-bar', 'mcpui-table', 'mcpui-chart',
               'mcpui-section', 'mcpui-metric', 'mcpui-message'],
    ADD_ATTR: ['items', 'title', 'status', 'body', 'meta', 'columns', 'rows',
               'status-field', 'type', 'config', 'role', 'content', 'class',
               'label', 'count', 'collapsed', 'item-id', 'value', 'unit', 'trend',
               'streaming'],
};

const CONTAINER_TAGS = new Set(['mcpui-section']);

const ICON_SEND = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l7-7v4h9v6H9v4z" transform="rotate(-90 10 10)"/></svg>`;
const ICON_STOP = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`;

// ── State ──
let conversationId = null;
let activeSource = null;
let cancelGeneration = 0;

// Node tree — each prompt/response pair is a node
let nodes = [];
let activeNodeId = null;

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Persistence ──
function saveState() {
    try {
        const data = JSON.stringify({ conversationId, nodes });
        if (data.length > 4_000_000) {
            // Prune oldest nodes if approaching localStorage limit
            while (nodes.length > 2 && JSON.stringify(nodes).length > 3_500_000) {
                nodes.shift();
            }
        }
        localStorage.setItem('mcpui:state', JSON.stringify({ conversationId, nodes }));
    } catch { /* storage full — silently fail */ }
}

function loadState() {
    try {
        const raw = localStorage.getItem('mcpui:state');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

function clearState() {
    localStorage.removeItem('mcpui:state');
}

// ── Summary Generation ──
function generateSummary(contentEl) {
    const tagEls = contentEl.querySelectorAll(
        'mcpui-stat-bar, mcpui-table, mcpui-card, mcpui-chart, mcpui-metric, mcpui-section'
    );
    const tags = [...new Set([...tagEls].map(el => el.tagName.toLowerCase().replace('mcpui-', '')))];

    // Try to extract key values from first stat-bar
    const statBar = contentEl.querySelector('mcpui-stat-bar');
    let keyValues = '';
    if (statBar) {
        try {
            const items = JSON.parse(statBar.getAttribute('items') || '[]');
            keyValues = items.slice(0, 3).map(i => `${i.value} ${i.label}`).join(', ');
        } catch { /* ignore */ }
    }

    // For text responses, use first 60 chars
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

// ── DOM Helpers ──
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
            <span class="mcpui-node-chevron">▼</span>
            <span class="mcpui-node-prompt">${escapeHtml(node.promptDisplay || node.prompt)}</span>
            <span class="mcpui-node-summary">
                <span class="mcpui-node-tags">${tagsHtml}</span>
                ${node.summary ? ' • ' + escapeHtml(node.summary) : ''}
            </span>
            <span class="mcpui-node-time">${formatTimeAgo(node.timestamp)}</span>
        </div>
        <div class="mcpui-node-content"></div>
    `;

    // Click header to toggle collapse
    const header = div.querySelector('.mcpui-node-header');
    header.addEventListener('click', () => toggleNode(node.id));
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(node.id); }
    });

    return div;
}

function toggleNode(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    node.collapsed = !node.collapsed;
    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (el) el.dataset.collapsed = String(node.collapsed);
    saveState();
}

function scrollToNode(nodeId, highlight = true) {
    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (!el) return;

    // Expand if collapsed
    const node = nodes.find(n => n.id === nodeId);
    if (node?.collapsed) {
        node.collapsed = false;
        el.dataset.collapsed = 'false';
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (highlight) {
        el.classList.remove('mcpui-node-highlight');
        void el.offsetWidth; // force reflow
        el.classList.add('mcpui-node-highlight');
    }

    saveState();
}

function collapseAllExcept(exceptNodeId) {
    for (const node of nodes) {
        if (node.id !== exceptNodeId && !node.collapsed) {
            node.collapsed = true;
            const el = document.querySelector(`.mcpui-node[data-node-id="${node.id}"]`);
            if (el) el.dataset.collapsed = 'true';
        }
    }
}

function updateNodeSummary(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const el = document.querySelector(`.mcpui-node[data-node-id="${nodeId}"]`);
    if (!el) return;

    const contentEl = el.querySelector('.mcpui-node-content');
    const { tags, summary } = generateSummary(contentEl);
    node.tags = tags;
    node.summary = summary;

    // Update header display
    const tagsHtml = tags.map(t => `<span class="mcpui-node-tag">${t}</span>`).join('');
    const summaryEl = el.querySelector('.mcpui-node-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `<span class="mcpui-node-tags">${tagsHtml}</span>${summary ? ' • ' + escapeHtml(summary) : ''}`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ── Restore from persistence ──
function restoreFromStorage(container) {
    const state = loadState();
    if (!state || !state.nodes || state.nodes.length === 0) return false;

    conversationId = state.conversationId;
    nodes = state.nodes;

    // Render all nodes as collapsed sections, expand the last one
    container.innerHTML = '';
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (i < nodes.length - 1) node.collapsed = true;
        else node.collapsed = false;

        const nodeEl = createNodeEl(node);
        container.appendChild(nodeEl);

        // Re-render content from stored response
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

    // Restore chat sidebar messages
    const messagesEl = document.getElementById('chat-messages');
    if (messagesEl) {
        messagesEl.innerHTML = '';
        for (const node of nodes) {
            addChatMessage('user', node.promptDisplay || node.prompt, false, node.id);
            const assistantLabel = node.type === 'components' ? 'Dashboard view generated' : (node.summary || 'Response');
            addChatMessage('assistant', assistantLabel, false, node.id);
        }
    }

    // Scroll to last node
    const lastNode = nodes[nodes.length - 1];
    if (lastNode) {
        activeNodeId = lastNode.id;
        setTimeout(() => scrollToNode(lastNode.id, false), 100);
    }

    return true;
}

// ── Main ──
document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('prompt-input');
    const submitBtn = document.getElementById('btn-submit');
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    const newChatBtn = document.getElementById('btn-new-chat');
    const sidebar = document.getElementById('sidebar');
    const contentArea = document.getElementById('content-area');
    const container = document.getElementById('dashboard-container');
    const breadcrumb = document.getElementById('breadcrumb');

    // ── Try to restore from localStorage ──
    const restored = restoreFromStorage(container);
    if (restored) {
        updateBreadcrumb();
    }

    function updateBreadcrumb() {
        const trail = ['Dashboard'];
        // Build trail from node prompts
        for (const node of nodes) {
            const label = node.promptDisplay || node.prompt;
            trail.push(label.length > 30 ? label.substring(0, 30) + '...' : label);
        }
        // Show last 3 items
        const visible = trail.length > 3 ? ['...', ...trail.slice(-2)] : trail;
        breadcrumb.textContent = visible.join(' > ');
    }

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

    // Auto-resize textarea
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

    // Sidebar toggle
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        contentArea.classList.toggle('sidebar-open');
    });

    // New conversation
    newChatBtn.addEventListener('click', () => {
        conversationId = null;
        nodes = [];
        activeNodeId = null;
        clearState();
        updateBreadcrumb();
        container.innerHTML = getEmptyState();
        document.getElementById('chat-messages').innerHTML = '';
    });

    // ── Sidebar message click → scroll to node ──
    document.getElementById('chat-messages')?.addEventListener('click', (e) => {
        const msg = e.target.closest('mcpui-message');
        if (!msg) return;
        const nodeId = msg.dataset.nodeId;
        if (nodeId) scrollToNode(nodeId);
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

    // ── Browser history (back/forward) ──
    window.addEventListener('popstate', (e) => {
        if (e.state?.nodeId) {
            scrollToNode(e.state.nodeId);
        }
    });

    // ── Submit handler ──
    function handleSubmit(displayLabel) {
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        promptInput.value = '';
        promptInput.style.height = '';

        // Remove empty state if present
        const emptyState = container.querySelector('.mcpui-empty-state');
        if (emptyState) emptyState.remove();

        // Create new node
        const nodeId = generateId();
        const node = {
            id: nodeId,
            parentId: activeNodeId,
            prompt,
            promptDisplay: displayLabel || (prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt),
            response: '',
            type: 'text',
            summary: '',
            tags: [],
            timestamp: Date.now(),
            collapsed: false,
        };
        nodes.push(node);
        activeNodeId = nodeId;

        // Auto-collapse previous nodes
        collapseAllExcept(nodeId);

        // Create the section DOM element
        const nodeEl = createNodeEl(node);
        container.appendChild(nodeEl);

        // Get the content area for this node
        const contentEl = nodeEl.querySelector('.mcpui-node-content');

        // Show skeleton in the content area
        contentEl.innerHTML = getSkeletonState();

        // Scroll to new node
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        submitBtn.classList.add('cancel');
        submitBtn.innerHTML = ICON_STOP;

        let renderedCount = 0;
        let streamingStarted = false;
        const containerStack = [];

        addChatMessage('user', displayLabel || prompt, false, nodeId);
        const streamingMsg = addChatMessage('assistant', 'Thinking...', true, nodeId);

        // Push browser history
        history.pushState({ nodeId }, '');

        submitPrompt(
            prompt,
            // onChunk
            (chunk, fullText) => {
                const trimmed = fullText.trim();
                if (containsMcpuiTags(trimmed)) {
                    if (!streamingStarted) {
                        streamingStarted = true;
                        contentEl.innerHTML = '';
                        node.type = 'components';
                    }
                    const elements = findStreamElements(trimmed);
                    while (renderedCount < elements.length) {
                        appendStreamElement(contentEl, containerStack, elements[renderedCount]);
                        renderedCount++;
                    }
                    updateChatMessage(streamingMsg, 'Building dashboard...');
                } else {
                    contentEl.innerHTML = `<div class="mcpui-text-response mcpui-streaming">${renderMarkdown(trimmed)}</div>`;
                    updateChatMessage(streamingMsg, trimmed.substring(0, 120));
                }
            },
            // onDone
            (fullText) => {
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                promptInput.focus();

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
                    finalizeChatMessage(streamingMsg, 'Dashboard view generated');
                } else {
                    contentEl.innerHTML = `<div class="mcpui-text-response">${renderMarkdown(trimmed)}</div>`;
                    finalizeChatMessage(streamingMsg, trimmed.substring(0, 120));
                }

                // Generate summary and update header
                updateNodeSummary(nodeId);
                updateBreadcrumb();
                saveState();
            },
            // onError
            (error) => {
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                contentEl.innerHTML = `<div class="mcpui-text-response">Error: ${escapeHtml(error)}</div>`;
                node.response = error;
                node.type = 'text';
                node.summary = 'Error';
                node.tags = ['error'];
                updateNodeSummary(nodeId);
                finalizeChatMessage(streamingMsg, `Error: ${error}`);
                saveState();
            }
        );

        promptInput.disabled = true;
        updateBreadcrumb();
    }
});

// ── SSE Streaming ──

async function submitPrompt(prompt, onChunk, onDone, onError) {
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, conversationId }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        conversationId = data.conversationId;
        await streamResponse(data.streamUrl, onChunk, onDone, onError);
    } catch (err) {
        onError(err.message);
    }
}

function streamResponse(streamUrl, onChunk, onDone, onError) {
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
                    source.close();
                    activeSource = null;
                    onError(data.message || 'Unknown error');
                    resolve();
                } else if (data.type === 'content') {
                    fullText += data.text;
                    onChunk(data.text, fullText);
                } else if (data.type === 'done') {
                    source.close();
                    activeSource = null;
                    onDone(fullText);
                    resolve();
                }
            } catch (e) {
                console.error('SSE parse error:', e);
            }
        };

        source.onerror = () => {
            source.close();
            activeSource = null;
            if (cancelGeneration > myGeneration) {
                resolve();
            } else if (fullText) {
                onDone(fullText);
                resolve();
            } else {
                onError('Connection lost');
                resolve();
            }
        };
    });
}

// ── Stream Parser ──

function containsMcpuiTags(text) {
    return /<mcpui-[a-z]/.test(text);
}

function findStreamElements(text) {
    const elements = [];
    const cleaned = text.replace(/<use_mcp_tool[\s\S]*?<\/use_mcp_tool>/g, '');
    const re = /<(\/?)((mcpui-[a-z-]+)|div|h[1-6]|p|section|ul|ol|table)(\s[^>]*)?>/g;
    let m;

    while ((m = re.exec(cleaned)) !== null) {
        const isClose = m[1] === '/';
        const tagName = m[2];

        if (isClose) {
            if (CONTAINER_TAGS.has(tagName)) {
                elements.push({ type: 'close', tagName, html: m[0] });
            }
            continue;
        }

        if (CONTAINER_TAGS.has(tagName)) {
            elements.push({ type: 'open', tagName, html: m[0] });
            continue;
        }

        if (cleaned[m.index + m[0].length - 2] === '/') {
            elements.push({ type: 'leaf', tagName, html: m[0] });
            continue;
        }

        let depth = 1;
        const closeRe = new RegExp(`<(${tagName})(\\s[^>]*)?>|</${tagName}>`, 'g');
        closeRe.lastIndex = m.index + m[0].length;
        let cm;
        while ((cm = closeRe.exec(cleaned)) !== null) {
            if (cm[0].startsWith('</')) {
                depth--;
                if (depth === 0) {
                    elements.push({
                        type: 'leaf', tagName,
                        html: cleaned.substring(m.index, cm.index + cm[0].length),
                    });
                    re.lastIndex = cm.index + cm[0].length;
                    break;
                }
            } else { depth++; }
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
        parent.appendChild(el);
        stack.push(el);
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

function getDrillDownPrompt(title, status, itemId) {
    const idClause = itemId ? ` (id: ${itemId})` : '';
    return `Show me detailed information about "${title}"${idClause}. Include a summary card, any available data table, and relevant charts or metrics. Use ONLY mcpui-* web components — no markdown.`;
}

// ── Chat Sidebar ──

function addChatMessage(role, content, isStreaming = false, nodeId = null) {
    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl) return null;
    const msg = document.createElement('mcpui-message');
    msg.setAttribute('role', role);
    msg.setAttribute('content', content);
    if (isStreaming) msg.setAttribute('streaming', '');
    if (nodeId) msg.dataset.nodeId = nodeId;
    msg.style.cursor = 'pointer';
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Auto-open sidebar
    const sidebar = document.getElementById('sidebar');
    const contentArea = document.getElementById('content-area');
    if (sidebar && !sidebar.classList.contains('open')) {
        sidebar.classList.add('open');
        contentArea.classList.add('sidebar-open');
    }
    return msg;
}

function updateChatMessage(el, content) {
    if (el) el.setAttribute('content', content);
}

function finalizeChatMessage(el, content) {
    if (!el) return;
    if (content) el.setAttribute('content', content);
    el.removeAttribute('streaming');
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

function getSkeletonState() {
    return `
        <div class="mcpui-skeleton">
            <div class="mcpui-skeleton-stat-bar">
                <div class="mcpui-skeleton-pill"></div>
                <div class="mcpui-skeleton-pill"></div>
                <div class="mcpui-skeleton-pill"></div>
            </div>
            <div class="mcpui-skeleton-grid">
                <div class="mcpui-skeleton-card"></div>
                <div class="mcpui-skeleton-card"></div>
                <div class="mcpui-skeleton-card"></div>
            </div>
            <div class="mcpui-progress-indicator">Generating response...</div>
        </div>
    `;
}
