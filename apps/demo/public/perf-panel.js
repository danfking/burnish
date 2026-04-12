/**
 * Tool Performance Panel — shows aggregated tool execution metrics.
 * Accessible via the chart icon in the header toolbar.
 */

import { PerfStore } from '@burnishdev/app';
import { escapeHtml } from './shared.js';

const perfStore = new PerfStore();

/** @type {boolean} */
let panelOpen = false;

/**
 * Record a performance entry for a direct tool execution.
 * @param {{toolName: string, latencyMs: number, responseHtml: string}} data
 */
export function recordToolPerf(data) {
    const componentCount = countBurnishComponents(data.responseHtml || '');
    perfStore.add({
        model: 'direct',
        toolName: data.toolName || 'none',
        latencyMs: data.latencyMs || 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        componentSuccess: componentCount > 0,
        componentCount,
    });
}

/** Count burnish-* component tags in HTML. */
function countBurnishComponents(html) {
    const matches = html.match(/<burnish-\w+[\s>]/g);
    return matches ? matches.length : 0;
}

/** Get the PerfStore instance for external use. */
export function getPerfStore() {
    return perfStore;
}

/** Toggle the performance panel. */
export function togglePerfPanel() {
    panelOpen = !panelOpen;
    if (panelOpen) {
        showPerfPanel();
    } else {
        hidePerfPanel();
    }
}

/** Whether the panel is currently open. */
export function isPerfPanelOpen() {
    return panelOpen;
}

function showPerfPanel() {
    let panel = document.getElementById('burnish-perf-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'burnish-perf-panel';
        panel.className = 'burnish-perf-panel';
        document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
    panelOpen = true;
    renderPerfContent(panel);

    // Update the header button state
    document.getElementById('btn-perf-toggle')?.classList.add('active');
}

function hidePerfPanel() {
    const panel = document.getElementById('burnish-perf-panel');
    if (panel) panel.style.display = 'none';
    panelOpen = false;
    document.getElementById('btn-perf-toggle')?.classList.remove('active');
}

function renderPerfContent(panel) {
    const toolStats = perfStore.getToolStats();
    const allRecords = perfStore.getAll();
    const totalCount = perfStore.count;

    // Summary stats
    const totalLatency = allRecords.reduce((a, r) => a + r.latencyMs, 0);
    const avgLatency = totalCount > 0 ? Math.round(totalLatency / totalCount) : 0;
    const successCount = allRecords.filter(r => r.componentSuccess).length;
    const successRate = totalCount > 0 ? Math.round(successCount / totalCount * 100) : 0;

    let html = `
        <div class="burnish-perf-header">
            <h3 class="burnish-perf-title">Tool Performance</h3>
            <button class="burnish-perf-close" title="Close">&times;</button>
        </div>
        <div class="burnish-perf-body">
    `;

    // Summary bar
    html += `
        <div class="burnish-perf-summary">
            <div class="burnish-perf-stat">
                <span class="burnish-perf-stat-value">${totalCount}</span>
                <span class="burnish-perf-stat-label">Executions</span>
            </div>
            <div class="burnish-perf-stat">
                <span class="burnish-perf-stat-value">${formatMs(avgLatency)}</span>
                <span class="burnish-perf-stat-label">Avg Latency</span>
            </div>
            <div class="burnish-perf-stat">
                <span class="burnish-perf-stat-value">${successRate}%</span>
                <span class="burnish-perf-stat-label">Component Rate</span>
            </div>
        </div>
    `;

    // Per-tool breakdown
    if (toolStats.length > 0) {
        html += `<h4 class="burnish-perf-section-title">Per Tool</h4>`;
        html += `<div class="burnish-perf-table-wrap"><table class="burnish-perf-table">
            <thead>
                <tr>
                    <th>Tool</th>
                    <th>Requests</th>
                    <th>Avg Latency</th>
                    <th>Component Rate</th>
                </tr>
            </thead>
            <tbody>`;
        for (const s of toolStats.slice(0, 15)) {
            const rate = Math.round(s.componentSuccessRate * 100);
            const rateClass = rate >= 80 ? 'success' : rate >= 50 ? 'warning' : 'error';
            const shortName = s.toolName.replace(/^mcp__\w+__/, '');
            html += `<tr>
                <td class="burnish-perf-tool-name" title="${escapeHtml(s.toolName)}">${escapeHtml(shortName)}</td>
                <td>${s.requestCount}</td>
                <td>${formatMs(s.avgLatencyMs)}</td>
                <td><span class="burnish-perf-rate burnish-perf-rate--${rateClass}">${rate}%</span></td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    // Recent executions
    if (allRecords.length > 0) {
        html += `<h4 class="burnish-perf-section-title">Recent Executions</h4>`;
        html += `<div class="burnish-perf-table-wrap"><table class="burnish-perf-table burnish-perf-table--recent">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Tool</th>
                    <th>Latency</th>
                    <th>Components</th>
                </tr>
            </thead>
            <tbody>`;
        for (const r of allRecords.slice(0, 20)) {
            const shortTool = (r.toolName || 'none').replace(/^mcp__\w+__/, '');
            const statusIcon = r.componentSuccess ? '\u2713' : '\u2717';
            const statusClass = r.componentSuccess ? 'success' : 'error';
            html += `<tr>
                <td class="burnish-perf-time">${formatTime(r.timestamp)}</td>
                <td class="burnish-perf-tool-name" title="${escapeHtml(r.toolName)}">${escapeHtml(shortTool)}</td>
                <td>${formatMs(r.latencyMs)}</td>
                <td><span class="burnish-perf-status burnish-perf-status--${statusClass}">${statusIcon} ${r.componentCount}</span></td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    // Empty state
    if (totalCount === 0) {
        html += `
            <div class="burnish-perf-empty">
                <p>No tool executions yet.</p>
                <p>Run a tool to start tracking latency and component rendering metrics.</p>
            </div>
        `;
    }

    // Clear button
    if (totalCount > 0) {
        html += `<div class="burnish-perf-actions">
            <button class="burnish-perf-clear-btn">Clear Performance Data</button>
        </div>`;
    }

    html += `</div>`;
    panel.innerHTML = html;

    // Wire up close button
    panel.querySelector('.burnish-perf-close')?.addEventListener('click', () => {
        hidePerfPanel();
    });

    // Wire up clear button
    panel.querySelector('.burnish-perf-clear-btn')?.addEventListener('click', () => {
        if (confirm('Clear all performance tracking data?')) {
            perfStore.clear();
            renderPerfContent(panel);
        }
    });
}

/** Refresh the panel content if it is currently open. */
export function refreshPerfPanel() {
    if (!panelOpen) return;
    const panel = document.getElementById('burnish-perf-panel');
    if (panel) renderPerfContent(panel);
}

// ── Formatting helpers ──

function formatMs(ms) {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
