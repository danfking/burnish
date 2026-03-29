/**
 * MCPUI Demo App — main orchestration.
 * Wires up prompt submission, SSE streaming, progressive rendering, and drill-down.
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

// ── Container tags that nest children ──
const CONTAINER_TAGS = new Set(['mcpui-section']);

const ICON_SEND = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l7-7v4h9v6H9v4z" transform="rotate(-90 10 10)"/></svg>`;
const ICON_STOP = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`;

// ── State ──
let conversationId = null;
let activeSource = null;
let cancelGeneration = 0;

document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('prompt-input');
    const submitBtn = document.getElementById('btn-submit');
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    const newChatBtn = document.getElementById('btn-new-chat');
    const sidebar = document.getElementById('sidebar');
    const contentArea = document.getElementById('content-area');
    const container = document.getElementById('dashboard-container');
    const breadcrumb = document.getElementById('breadcrumb');

    // ── Breadcrumb trail for drill-down ──
    const breadcrumbTrail = ['Dashboard'];

    function updateBreadcrumb() {
        breadcrumb.textContent = breadcrumbTrail.join(' > ');
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
        breadcrumbTrail.length = 0;
        breadcrumbTrail.push('Dashboard');
        updateBreadcrumb();
        container.innerHTML = getEmptyState();
        document.getElementById('chat-messages').innerHTML = '';
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
            breadcrumbTrail.push(title);
            updateBreadcrumb();
            promptInput.value = getDrillDownPrompt(title, status, itemId);
            handleSubmit(title);
        }
    });

    // ── Submit handler ──
    function handleSubmit(displayLabel) {
        const prompt = promptInput.value.trim();
        if (!prompt) return;
        promptInput.value = '';
        promptInput.style.height = '';

        container.innerHTML = getSkeletonState();
        submitBtn.classList.add('cancel');
        submitBtn.innerHTML = ICON_STOP;

        let renderedCount = 0;
        let streamingStarted = false;
        const containerStack = [];

        addChatMessage('user', displayLabel || prompt);
        const streamingMsg = addChatMessage('assistant', 'Thinking...', true);

        submitPrompt(
            prompt,
            // onChunk
            (chunk, fullText) => {
                const trimmed = fullText.trim();
                if (containsMcpuiTags(trimmed)) {
                    if (!streamingStarted) {
                        streamingStarted = true;
                        container.innerHTML = '';
                    }
                    const elements = findStreamElements(trimmed);
                    while (renderedCount < elements.length) {
                        appendStreamElement(container, containerStack, elements[renderedCount]);
                        renderedCount++;
                    }
                    updateChatMessage(streamingMsg, 'Building dashboard...');
                } else {
                    container.innerHTML = `<div class="mcpui-text-response mcpui-streaming">${renderMarkdown(trimmed)}</div>`;
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
                if (containsMcpuiTags(trimmed)) {
                    const totalElements = findStreamElements(trimmed).length;
                    if (streamingStarted && renderedCount > 0 && renderedCount >= totalElements) {
                        finalizeChatMessage(streamingMsg, 'Dashboard view generated');
                        return;
                    }
                    container.innerHTML = '';
                    const clean = DOMPurify.sanitize(extractHtmlContent(trimmed), PURIFY_CONFIG);
                    const temp = document.createElement('template');
                    temp.innerHTML = clean;
                    container.appendChild(temp.content);
                    finalizeChatMessage(streamingMsg, 'Dashboard view generated');
                } else {
                    container.innerHTML = `<div class="mcpui-text-response">${renderMarkdown(trimmed)}</div>`;
                    finalizeChatMessage(streamingMsg, trimmed.substring(0, 120));
                }
            },
            // onError
            (error) => {
                submitBtn.classList.remove('cancel');
                submitBtn.innerHTML = ICON_SEND;
                promptInput.disabled = false;
                container.innerHTML = `<div class="mcpui-text-response">Error: ${error}</div>`;
                finalizeChatMessage(streamingMsg, `Error: ${error}`);
            }
        );

        promptInput.disabled = true;
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

// ── Stream Parser (inline — same logic as @mcpui/renderer) ──

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

function addChatMessage(role, content, isStreaming = false) {
    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl) return null;
    const msg = document.createElement('mcpui-message');
    msg.setAttribute('role', role);
    msg.setAttribute('content', content);
    if (isStreaming) msg.setAttribute('streaming', '');
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
