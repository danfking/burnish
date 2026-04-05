/**
 * Copilot UI — dual-mode toggle, AI insight streaming, prompt bar.
 * Only active when the server reports available LLM models.
 */

import { escapeAttr } from './shared.js';

let currentMode = localStorage.getItem('burnish:mode') || 'explorer';
let copilotAvailable = false;

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
            if (promptBar) promptBar.style.display = currentMode === 'copilot' ? '' : 'none';
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
 * Stream an AI insight into the given slot element.
 * Calls /api/chat to get a stream URL, then connects via EventSource.
 */
export async function streamInsight(slot, toolName, resultSummary, PURIFY_CONFIG) {
    slot.style.display = 'block';
    slot.style.opacity = '1';
    slot.setAttribute('aria-busy', 'true');
    slot.innerHTML = '<div class="burnish-insight-loading"><div class="burnish-spinner"></div> Analyzing results...</div>';

    try {
        const chatRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: 'Analyze this ' + toolName + ' result and provide brief insights. Use burnish-stat-bar for key metrics and burnish-card for recommendations:\n' + resultSummary,
                noTools: true
            })
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
