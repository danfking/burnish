/**
 * Contextual action generation for result data and individual items.
 */

import { WRITE_TOOL_RE } from './shared.js';

// Cache of server data — set via setCachedServers()
let cachedServers = null;

export function setCachedServers(servers) {
    cachedServers = servers;
}

export function getCachedServers() {
    return cachedServers;
}

export function generateContextualActions(resultData, sourceToolName) {
    if (!sourceToolName) return [];
    if (!cachedServers) return [];

    const items = Array.isArray(resultData) ? resultData :
        (resultData?.items || resultData?.results || resultData?.data || []);
    if (items.length === 0 || typeof items[0] !== 'object') return [];

    const firstItem = items[0];
    const actions = [];

    let serverName = sourceToolName.replace(/^mcp__/, '').split('__')[0];
    let server = cachedServers?.find(s => s.name === serverName);
    if (!server && cachedServers) {
        const shortName = sourceToolName.replace(/^mcp__\w+__/, '');
        for (const s of cachedServers) {
            if (s.tools.some(t => t.name === shortName || t.name === sourceToolName)) {
                server = s;
                serverName = s.name;
                break;
            }
        }
    }
    if (!server) return actions;

    if (firstItem.full_name && firstItem.full_name.includes('/')) {
        const [owner, repo] = firstItem.full_name.split('/');
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            if (props.owner && props.repo && !sourceToolName.includes(tool.name)) {
                const toolId = tool.name;
                const shortName = tool.name.replace(/_/g, ' ');
                const isWrite = WRITE_TOOL_RE.test(tool.name);
                actions.push({
                    label: shortName,
                    action: isWrite ? 'write' : 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: toolId, args: { owner, repo } }),
                    icon: isWrite ? 'edit' : 'search',
                });
            }
        }
    }

    if (firstItem.path || firstItem.name) {
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            if (props.path && !sourceToolName.includes(tool.name) && /^(list|read|get|directory)/.test(tool.name)) {
                actions.push({
                    label: tool.name.replace(/_/g, ' '),
                    action: 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args: {} }),
                    icon: 'list',
                });
            }
        }
    }

    actions.sort((a, b) => {
        if (a.action === 'read' && b.action !== 'read') return -1;
        if (a.action !== 'read' && b.action === 'read') return 1;
        return 0;
    });
    return actions.slice(0, 6);
}

export function generateContextualActionsForItem(item) {
    if (!cachedServers) return [];

    const actions = [];

    for (const server of cachedServers) {
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            const args = {};
            let matchCount = 0;

            if (props.owner && item.full_name && item.full_name.includes('/')) {
                args.owner = item.full_name.split('/')[0];
                matchCount++;
            }
            if (props.repo && item.full_name && item.full_name.includes('/')) {
                args.repo = item.full_name.split('/')[1];
                matchCount++;
            }
            if (props.path && item.path) {
                args.path = item.path;
                matchCount++;
            }
            if (props.issue_number && item.number) {
                args.issue_number = item.number;
                matchCount++;
            }

            if (matchCount >= 1) {
                const isWrite = WRITE_TOOL_RE.test(tool.name);
                actions.push({
                    label: tool.name.replace(/_/g, ' '),
                    action: isWrite ? 'write' : 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args }),
                    icon: isWrite ? 'edit' : 'search',
                });
            }
        }
    }

    actions.sort((a, b) => (a.action === 'read' ? -1 : 1) - (b.action === 'read' ? -1 : 1));
    return actions.slice(0, 6);
}
