/**
 * Deterministic UI rendering — tool listings, direct execution, empty state.
 */

import { PURIFY_CONFIG, WRITE_TOOL_RE, escapeHtml, escapeAttr } from './shared.js';
import { buildResultHtml } from './view-renderers.js';
import { getCurrentMode, createInsightSlot, streamInsight } from './copilot-ui.js';
import { recordToolPerf, refreshPerfPanel } from './perf-panel.js';
import { getTemplateInstructions } from './template-learning.js';
import { appendAmbientSuggestions } from './ambient-suggestions.js';

// ── Inline risk assessment (mirrors @burnish/app risk-indicators.ts) ──

const HIGH_RISK_RE = /^(delete|drop|remove|destroy|push|force)[_-]/i;
const MEDIUM_RISK_RE = /^(create|update|write|set|modify|send)[_-]/i;
const LOW_RISK_RE = /^(list|get|read|search|describe|show)[_-]/i;

/**
 * Classify a tool's risk level based on its name pattern.
 * @param {{ name: string }} tool
 * @returns {{ level: 'low'|'medium'|'high' }}
 */
function assessToolRisk(tool) {
    const parts = tool.name.split('__');
    const name = parts[parts.length - 1] || tool.name;

    if (HIGH_RISK_RE.test(name)) return { level: 'high' };
    if (MEDIUM_RISK_RE.test(name)) return { level: 'medium' };
    if (LOW_RISK_RE.test(name)) return { level: 'low' };
    return { level: 'medium' };
}

/**
 * Generate HTML for a tool listing (server tools grouped by verb).
 */
export function generateToolListingHtml(serverName, tools) {
    const groups = {};
    for (const tool of tools) {
        const verb = tool.name.split(/[_\-]/)[0] || 'other';
        if (!groups[verb]) groups[verb] = [];
        groups[verb].push(tool);
    }

    const statItems = Object.entries(groups).map(([verb, items]) => {
        return {
            label: verb.charAt(0).toUpperCase() + verb.slice(1),
            value: String(items.length),
            color: 'info',
        };
    });
    let html = `<burnish-stat-bar variant="compact" items='${escapeAttr(JSON.stringify(statItems))}'></burnish-stat-bar>`;

    html += `<div class="burnish-tool-filter-container">
    <input type="text" class="burnish-tool-filter" placeholder="Filter tools..." autocomplete="off">
</div>`;

    for (const [verb, items] of Object.entries(groups)) {
        const label = verb.charAt(0).toUpperCase() + verb.slice(1) + ' Operations';
        html += `<burnish-section variant="compact" label="${escapeAttr(label)}" count="${items.length}" status="info">`;
        for (const tool of items) {
            const risk = assessToolRisk(tool);
            const riskStatus = risk.level === 'high' ? 'error' : risk.level === 'medium' ? 'warning' : 'success';
            html += `<burnish-card title="${escapeAttr(tool.name)}" status="${riskStatus}" status-label="${risk.level}" body="${escapeAttr(tool.description || '')}" item-id="${escapeAttr(tool.name)}"></burnish-card>`;
        }
        html += `</burnish-section>`;
    }

    return html;
}

/**
 * Render a deterministic tool listing as a new node.
 * Requires session helpers injected via setSessionHelpers().
 */
let _sessionHelpers = null;

export function setSessionHelpers(helpers) {
    _sessionHelpers = helpers;
}

export function renderDeterministicToolListing(serverName, tools) {
    const h = _sessionHelpers;
    if (!h) return;

    const nodeId = h.generateId();
    const session = h.getActiveSession();
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

    h.renderMainContent();
    h.updateBreadcrumb();
    h.renderSessionList();
    h.saveState();
}

/**
 * Render an arbitrary deterministic node (label + html content).
 */
export function renderDeterministicNode(label, html) {
    const h = _sessionHelpers;
    if (!h) return;

    const nodeId = h.generateId();
    const session = h.getActiveSession();
    if (!session) return;

    const parentId = h.getBranchFromNodeId() || session.activeNodeId || (session.nodes.length > 0 ? session.nodes[session.nodes.length - 1].id : null);
    h.clearBranchFromNodeId();
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

    h.renderMainContent();
    h.updateBreadcrumb();
    h.renderSessionList();
    h.saveState();
    h.clearBranchFromNodeId();
    return node;
}

/**
 * Execute a tool directly and render the result as a new node.
 */
export async function executeToolDirect(toolName, args, label) {
    var loadingHtml = '<div class="burnish-loading"><div class="burnish-spinner"></div> Direct execution: ' + escapeAttr(label) + '...</div>';
    var node = renderDeterministicNode(label, loadingHtml);
    try {
        var res = await fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolName: toolName, args: args }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Execution failed');
        var resultHtml = buildResultHtml(data.result, label, toolName);
        var contentEl = node ? document.querySelector('[data-node-id="' + node.id + '"] .burnish-node-content') : null;
        if (contentEl) {
            contentEl.innerHTML = DOMPurify.sanitize(resultHtml, PURIFY_CONFIG);
        }
        if (node) {
            node._executionMode = 'deterministic';
            node._toolCall = { toolName: toolName, args: Object.assign({}, args), label: label };
            node.response = resultHtml;
        }
        // Generate tool call command
        const toolCallJson = JSON.stringify({ name: toolName, arguments: args }, null, 2);
        const toolCallHtml = `
            <details class="burnish-tool-call">
                <summary>Tool Call</summary>
                <div class="burnish-tool-call-content">
                    <button class="burnish-copy-btn" title="Copy tool call">Copy</button>
                    <pre class="burnish-json-view">${escapeHtml(toolCallJson)}</pre>
                </div>
            </details>
        `;
        if (contentEl) {
            contentEl.insertAdjacentHTML('beforeend', DOMPurify.sanitize(toolCallHtml, PURIFY_CONFIG));
        }
        // Record performance metrics for direct execution
        recordToolPerf({
            toolName: toolName,
            latencyMs: data.durationMs || 0,
            responseHtml: resultHtml,
        });
        refreshPerfPanel();
        // Display execution timing badge
        if (data.durationMs != null && node) {
            const timingEl = document.createElement('span');
            timingEl.className = 'burnish-timing';
            timingEl.textContent = data.durationMs + 'ms';
            const headerEl = document.querySelector('[data-node-id="' + node.id + '"] .burnish-node-header');
            if (headerEl) headerEl.appendChild(timingEl);
        }
        // Append ambient suggestions based on result data
        if (contentEl) {
            appendAmbientSuggestions(contentEl, data.result, toolName, args, PURIFY_CONFIG);
        }
        // Stream AI insights in copilot mode (with learned templates)
        if (getCurrentMode() === 'copilot' && contentEl) {
            const insightSlot = createInsightSlot(contentEl);
            const summary = JSON.stringify(data.result).substring(0, 2000);
            getTemplateInstructions(toolName).then(extra => {
                streamInsight(insightSlot, toolName, summary, PURIFY_CONFIG, extra || undefined);
            });
        }
    } catch (err) {
        var errorHtml = '<burnish-card title="Error" status="error" body="' + escapeAttr(err.message) + '"></burnish-card>';
        var contentEl2 = node ? document.querySelector('[data-node-id="' + node.id + '"] .burnish-node-content') : null;
        if (contentEl2) {
            contentEl2.innerHTML = DOMPurify.sanitize(errorHtml, PURIFY_CONFIG);
        }
        if (node) {
            node.response = errorHtml;
        }
    }
}

/**
 * Get the empty state HTML for the dashboard.
 */
export function getEmptyState() {
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
