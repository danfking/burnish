/**
 * Copilot UI — dual-mode toggle, AI insight streaming, prompt bar.
 * Only active when the server reports available LLM models.
 *
 * Supports conversational pivot tables: when the user types transformation
 * commands like "group by assignee" or "show as chart", the prompt is sent
 * to the LLM with full conversation context for data re-derivation.
 */

import { escapeAttr } from './shared.js';
import { transformOutput } from '@burnish/app';

let currentMode = localStorage.getItem('burnish:mode') || 'explorer';
let copilotAvailable = false;

/** Active conversation ID for multi-turn pivot interactions */
let activeConversationId = null;

/** Whether a streaming response is in progress */
let isStreaming = false;

export function getCurrentMode() { return currentMode; }
export function isCopilotAvailable() { return copilotAvailable; }

/**
 * Probe /api/models to detect whether copilot mode is available.
 * Returns 'copilot-available' or 'explorer-only'.
 */
export async function detectMode() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        copilotAvailable = data.models && data.models.length > 0;
        if (!copilotAvailable) currentMode = 'explorer';
        return copilotAvailable ? 'copilot-available' : 'explorer-only';
    } catch {
        copilotAvailable = false;
        currentMode = 'explorer';
        return 'explorer-only';
    }
}

/**
 * Render the Explorer/Copilot mode toggle into the given container.
 * Hidden when copilot is not available.
 */
export function renderModeToggle(container) {
    if (!copilotAvailable) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    container.innerHTML = `
        <div class="burnish-mode-toggle">
            <button class="burnish-mode-btn ${currentMode === 'explorer' ? 'active' : ''}" data-mode="explorer">Explorer</button>
            <button class="burnish-mode-btn ${currentMode === 'copilot' ? 'active' : ''}" data-mode="copilot">Copilot</button>
        </div>
    `;
    container.querySelectorAll('.burnish-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentMode = btn.dataset.mode;
            localStorage.setItem('burnish:mode', currentMode);
            container.querySelectorAll('.burnish-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Toggle prompt bar visibility
            const promptBar = document.getElementById('copilot-prompt-bar');
            if (promptBar) promptBar.style.display = currentMode === 'copilot' ? 'flex' : 'none';
        });
    });
}

/**
 * Create an AI insight slot element appended to the given parent node.
 */
export function createInsightSlot(parentNode) {
    const slot = document.createElement('div');
    slot.className = 'burnish-ai-insight';
    slot.setAttribute('aria-live', 'polite');
    slot.setAttribute('aria-busy', 'false');
    parentNode.appendChild(slot);
    return slot;
}

/**
 * Client-side pivot command patterns for UX feedback.
 * These mirror the server-side patterns in pivot-detector.ts.
 */
const PIVOT_PATTERNS = [
    /\b(?:group|cluster|categorize|bucket)\s+(?:by|on|into)\s+\w+/i,
    /\b(?:sort|order|rank|arrange)\s+(?:by|on)\s+\w+/i,
    /\b(?:filter|where|only\s+show|show\s+only)\s+/i,
    /\b(?:show|display|visualize|render|make|convert)\s+(?:as\s+|into\s+)?(?:a\s+)?(?:\w+\s+)?(?:chart|graph|plot|table|visualization)/i,
    /\bas\s+(?:a\s+)?(?:\w+\s+)?(?:chart|graph|plot|table)/i,
    /\b(?:summarize|summary|overview|recap|aggregate)\b/i,
    /\bpivot\s+(?:by|on|around)\s+\w+/i,
    /\b(?:count|tally|total)\s+(?:by|per|for\s+each)\s+\w+/i,
];

/**
 * Detect if a prompt is a pivot/transformation command (client-side).
 */
export function isPivotCommand(prompt) {
    if (!prompt || prompt.length > 200) return false;
    return PIVOT_PATTERNS.some(p => p.test(prompt.trim()));
}

/** Get the active conversation ID for multi-turn interactions. */
export function getConversationId() { return activeConversationId; }

/** Reset the conversation (e.g., on new session). */
export function resetConversation() { activeConversationId = null; }

/** Check if a response is currently streaming. */
export function getIsStreaming() { return isStreaming; }

/**
 * Initialize the copilot prompt bar — wire up Enter key to submit prompts.
 * @param {object} PURIFY_CONFIG — DOMPurify config for sanitizing responses
 * @param {object} sessionHelpers — { generateId, getActiveSession, createNodeEl, renderMainContent, saveState, renderSessionList, updateBreadcrumb }
 */
export function initPromptBar(PURIFY_CONFIG, sessionHelpers) {
    const input = document.getElementById('copilot-input');
    const promptBar = document.getElementById('copilot-prompt-bar');
    if (!input || !promptBar) return;

    // Show/hide based on mode
    promptBar.style.display = currentMode === 'copilot' ? 'flex' : 'none';

    input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' || isStreaming) return;

        const prompt = input.value.trim();
        if (!prompt) return;

        input.value = '';
        const pivot = isPivotCommand(prompt);

        await submitCopilotPrompt(prompt, PURIFY_CONFIG, sessionHelpers, pivot);
    });
}

/**
 * Submit a prompt to the copilot chat API and stream the response.
 * Creates a proper session node so event handlers work automatically.
 */
export async function submitCopilotPrompt(prompt, PURIFY_CONFIG, sessionHelpers, isPivot = false) {
    if (isStreaming) return;
    isStreaming = true;

    const container = document.getElementById('dashboard-container');
    if (!container) { isStreaming = false; return; }

    const { generateId, getActiveSession, createNodeEl, saveState, renderSessionList, updateBreadcrumb } = sessionHelpers;
    const session = getActiveSession();
    if (!session) { isStreaming = false; return; }

    // Build a first-class session node
    const node = {
        id: generateId(),
        prompt,
        promptDisplay: prompt,
        response: '',
        type: 'components',
        _executionMode: 'copilot',
        parentId: session.activeNodeId || null,
        children: [],
        collapsed: false,
        timestamp: Date.now(),
    };

    // Wire into session tree
    if (node.parentId) {
        const parent = session.nodes.find(n => n.id === node.parentId);
        if (parent) parent.children.push(node.id);
    }
    session.nodes.push(node);
    session.activeNodeId = node.id;

    // Create proper .burnish-node[data-node-id] wrapper
    const nodeEl = createNodeEl(node);
    const nodeContentEl = nodeEl.querySelector('.burnish-node-content');

    // Ensure a .burnish-tree wrapper exists
    let treeWrapper = container.querySelector('.burnish-tree');
    if (!treeWrapper) {
        container.innerHTML = '';
        treeWrapper = document.createElement('div');
        treeWrapper.className = 'burnish-tree';
        container.appendChild(treeWrapper);
    }
    treeWrapper.appendChild(nodeEl);

    // Add status, pipeline, and streaming content inside the node
    const statusEl = document.createElement('div');
    statusEl.className = 'burnish-copilot-status';
    statusEl.textContent = isPivot ? 'Reshaping data...' : 'Thinking...';
    nodeContentEl.appendChild(statusEl);

    const pipelineEl = document.createElement('burnish-pipeline');
    pipelineEl.setAttribute('steps', '[]');
    pipelineEl.style.display = 'none';
    nodeContentEl.appendChild(pipelineEl);

    const streamContentEl = document.createElement('div');
    streamContentEl.className = 'burnish-copilot-response-content';
    nodeContentEl.appendChild(streamContentEl);

    nodeEl.setAttribute('aria-busy', 'true');
    nodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const chatRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                conversationId: activeConversationId,
            }),
        });

        if (!chatRes.ok) {
            const err = await chatRes.json().catch(() => ({ error: 'Request failed' }));
            statusEl.textContent = '';
            streamContentEl.innerHTML = `<burnish-card title="Error" status="error" body="${escapeAttr(err.error || 'Request failed')}"></burnish-card>`;
            isStreaming = false;
            return;
        }

        const { conversationId, streamUrl } = await chatRes.json();
        activeConversationId = conversationId;

        const es = new EventSource(streamUrl);
        let html = '';

        es.onmessage = (e) => {
            try {
                const chunk = JSON.parse(e.data);
                if (chunk.type === 'progress') {
                    statusEl.textContent = chunk.detail || chunk.stage || '';
                } else if (chunk.type === 'content') {
                    html += chunk.text;
                    const transformed = transformOutput(html);
                    streamContentEl.innerHTML = DOMPurify.sanitize(transformed, PURIFY_CONFIG);
                } else if (chunk.type === 'workflow_trace') {
                    if (chunk.steps && chunk.steps.length > 0) {
                        pipelineEl.style.display = '';
                        pipelineEl.setAttribute('steps', JSON.stringify(chunk.steps));
                    }
                } else if (chunk.type === 'stats') {
                    const sec = (chunk.durationMs / 1000).toFixed(1);
                    statusEl.textContent = `${sec}s`;
                    statusEl.classList.add('burnish-copilot-status-done');
                } else if (chunk.type === 'done') {
                    es.close();
                    nodeEl.setAttribute('aria-busy', 'false');
                    if (!statusEl.classList.contains('burnish-copilot-status-done')) {
                        statusEl.textContent = '';
                    }

                    // Persist response into session node
                    node.response = html;
                    if (session.nodes.length === 1) {
                        session.title = prompt.slice(0, 60);
                    }
                    saveState();
                    renderSessionList();
                    updateBreadcrumb();

                    // Add pivot suggestion chips if this was a data response
                    if (html && /<burnish-/.test(html)) {
                        appendPivotSuggestions(streamContentEl, PURIFY_CONFIG, sessionHelpers);
                    }

                    isStreaming = false;
                } else if (chunk.type === 'error') {
                    es.close();
                    statusEl.textContent = '';
                    streamContentEl.innerHTML = `<burnish-card title="Error" status="error" body="${escapeAttr(chunk.message || 'Unknown error')}"></burnish-card>`;
                    isStreaming = false;
                }
            } catch { /* ignore parse errors */ }
        };

        es.onerror = () => {
            es.close();
            if (html) {
                nodeEl.setAttribute('aria-busy', 'false');
                statusEl.textContent = '';
            } else {
                statusEl.textContent = '';
                streamContentEl.innerHTML = '<burnish-card title="Connection Lost" status="error" body="Lost connection to the server."></burnish-card>';
            }
            isStreaming = false;
        };
    } catch (err) {
        statusEl.textContent = '';
        streamContentEl.innerHTML = `<burnish-card title="Error" status="error" body="${escapeAttr(err.message || 'Failed to connect')}"></burnish-card>`;
        isStreaming = false;
    }
}

/**
 * Append pivot/transformation suggestion chips after a data response.
 * Allows users to quickly reshape the data without typing.
 */
function appendPivotSuggestions(contentEl, PURIFY_CONFIG, sessionHelpers) {
    const suggestions = [
        { label: 'Group by status', prompt: 'group by status' },
        { label: 'Show as chart', prompt: 'show as bar chart' },
        { label: 'Show as table', prompt: 'show as table' },
        { label: 'Summarize', prompt: 'summarize' },
    ];

    const chipsEl = document.createElement('div');
    chipsEl.className = 'burnish-pivot-suggestions';
    chipsEl.innerHTML = suggestions.map(s =>
        `<button class="burnish-pivot-chip" data-prompt="${escapeAttr(s.prompt)}">${escapeAttr(s.label)}</button>`
    ).join('');

    chipsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.burnish-pivot-chip');
        if (!btn || isStreaming) return;
        const prompt = btn.dataset.prompt;
        if (prompt) {
            chipsEl.remove();
            submitCopilotPrompt(prompt, PURIFY_CONFIG, sessionHelpers, true);
        }
    });

    contentEl.appendChild(chipsEl);
}

/**
 * Stream an AI insight into the given slot element.
 * Calls /api/chat to get a stream URL, then connects via EventSource.
 */
export async function streamInsight(slot, toolName, resultSummary, PURIFY_CONFIG, extraInstructions) {
    slot.style.display = 'block';
    slot.style.opacity = '1';
    slot.setAttribute('aria-busy', 'true');
    slot.innerHTML = '<div class="burnish-insight-loading"><div class="burnish-spinner"></div> Analyzing results...</div>';

    try {
        const body = {
            prompt: 'Analyze this ' + toolName + ' result and provide brief insights. Use burnish-stat-bar for key metrics and burnish-card for recommendations:\n' + resultSummary,
            noTools: true
        };
        if (extraInstructions) body.extraInstructions = extraInstructions;

        const chatRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!chatRes.ok) {
            slot.style.display = 'none';
            return;
        }

        const { streamUrl } = await chatRes.json();
        const es = new EventSource(streamUrl);
        let html = '';

        es.onmessage = (e) => {
            try {
                const chunk = JSON.parse(e.data);
                if (chunk.type === 'content') {
                    html += chunk.text;
                    slot.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
                }
                if (chunk.type === 'done') {
                    es.close();
                    slot.setAttribute('aria-busy', 'false');
                    slot.classList.add('loaded');
                }
                if (chunk.type === 'error') {
                    es.close();
                    slot.style.display = 'none';
                }
            } catch { /* ignore parse errors in stream */ }
        };

        es.onerror = () => {
            es.close();
            slot.style.display = 'none';
        };
    } catch {
        slot.style.display = 'none';
    }
}
