/**
 * Contextual action generation for result data and individual items.
 *
 * The schema-key-generic resolver matches item fields (like `projectId`,
 * `clientId`, `assigneeId`) to MCP tool input schemas, enabling deep
 * drill-down across any entity graph without hard-coded key lists.
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

    // GitHub-specific fallbacks (preserved from original)
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

// ── Schema-key-generic helpers ──

/**
 * Derive a natural label from a tool name.
 * "get-project" -> "View project", "list-tasks" -> "View tasks",
 * "search-clients" -> "Search clients"
 */
function deriveActionLabel(toolName) {
    const base = toolName.replace(/^mcp__\w+__/, '').replace(/[-_]/g, ' ');
    if (/^get\s/.test(base)) return 'View ' + base.replace(/^get\s+/, '');
    if (/^list\s/.test(base)) return 'View ' + base.replace(/^list\s+/, '');
    if (/^search\s/.test(base)) return 'Search ' + base.replace(/^search\s+/, '');
    return base;
}

/**
 * Score a tool for specificity ranking. Lower = more specific = preferred.
 * get- tools are most specific, then list-, then search-, then write tools last.
 */
function toolSpecificity(toolName) {
    const base = toolName.replace(/^mcp__\w+__/, '');
    if (/^get[-_]/.test(base)) return 0;
    if (/^list[-_]/.test(base)) return 1;
    if (/^search[-_]/.test(base)) return 2;
    if (WRITE_TOOL_RE.test(base)) return 4;
    return 3;
}

/**
 * Extract the entity prefix from an id value like "project-1" -> "project",
 * "member-42" -> "member", "incident-log-3" -> "incident-log".
 */
function extractIdPrefix(idValue) {
    if (typeof idValue !== 'string') return null;
    const match = idValue.match(/^(.+?)-\d+$/);
    return match ? match[1] : null;
}

/**
 * Check whether a tool param name (e.g. "projectId") corresponds to an
 * entity prefix (e.g. "project"). Handles camelCase param names.
 */
function paramMatchesPrefix(paramName, prefix) {
    if (!prefix || !paramName) return false;
    // "projectId" -> "project", "memberId" -> "member"
    const paramBase = paramName.replace(/Id$/, '').toLowerCase();
    return paramBase === prefix.replace(/-/g, '');
}

/**
 * Build a flat index of all tools across all servers for fast lookup.
 * Returns: Map<paramName, Array<{tool, server, required: boolean}>>
 */
function buildToolIndex() {
    const index = { byParam: new Map(), all: [] };
    if (!cachedServers) return index;

    for (const server of cachedServers) {
        for (const tool of server.tools) {
            const props = tool.inputSchema?.properties || {};
            const required = new Set(tool.inputSchema?.required || []);
            const entry = { tool, server, requiredParams: required };
            index.all.push(entry);

            for (const paramName of Object.keys(props)) {
                if (!index.byParam.has(paramName)) {
                    index.byParam.set(paramName, []);
                }
                index.byParam.get(paramName).push(entry);
            }
        }
    }
    return index;
}

/**
 * For an array-valued field name like "teamMemberIds" or "commentIds",
 * derive the singular entity name for label generation.
 * "teamMemberIds" -> "team members", "commentIds" -> "comments"
 */
function deriveArrayLabel(fieldName) {
    // Strip trailing "Ids" or "ids"
    let base = fieldName.replace(/Ids?$/, '');
    // camelCase to words: "teamMember" -> "team member"
    base = base.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    // Pluralise simply
    if (!base.endsWith('s')) base += 's';
    return base;
}

export function generateContextualActionsForItem(item) {
    if (!cachedServers) return [];

    const seen = new Set(); // track tool names to avoid duplicates
    const actions = [];

    // ── Phase 1: GitHub-specific fallbacks (preserved, becomes special case) ──
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
                seen.add(tool.name);
                const isWrite = WRITE_TOOL_RE.test(tool.name);
                actions.push({
                    label: deriveActionLabel(tool.name),
                    action: isWrite ? 'write' : 'read',
                    prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args }),
                    icon: isWrite ? 'edit' : 'search',
                    _specificity: toolSpecificity(tool.name),
                });
            }
        }
    }

    // ── Phase 2: Schema-key-generic matching ──
    const toolIndex = buildToolIndex();

    for (const [key, value] of Object.entries(item)) {
        // Skip already-handled GitHub fields
        if (key === 'full_name' || key === 'path' || key === 'number') continue;

        // --- 2a: Direct key match for scalar ID-like fields ---
        // Only process keys that look like entity references (ending in Id/Ids)
        // to avoid noise from descriptive fields like name, description, status
        const isIdKey = /Id$|_id$/i.test(key) || key === 'id';

        if ((typeof value === 'string' || typeof value === 'number') && isIdKey) {
            const candidates = toolIndex.byParam.get(key);
            if (candidates) {
                for (const { tool } of candidates) {
                    if (seen.has(tool.name)) continue;
                    const isWrite = WRITE_TOOL_RE.test(tool.name);
                    // Skip write tools for auto-generated drill-down actions
                    if (isWrite) continue;
                    seen.add(tool.name);
                    actions.push({
                        label: deriveActionLabel(tool.name),
                        action: 'read',
                        prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args: { [key]: value } }),
                        icon: toolSpecificity(tool.name) === 0 ? 'detail' : 'list',
                        _specificity: toolSpecificity(tool.name),
                    });
                }
            }

            // --- 2a-ii: Value-prefix matching for aliased ID fields ---
            // e.g. item has `authorId: "member-1"` — find tools with a required
            // param whose name matches the value prefix (memberId matches "member").
            if (typeof value === 'string' && key !== 'id' && key.endsWith('Id')) {
                const prefix = extractIdPrefix(value);
                if (prefix) {
                    for (const { tool } of toolIndex.all) {
                        if (seen.has(tool.name)) continue;
                        if (WRITE_TOOL_RE.test(tool.name)) continue;
                        const props = tool.inputSchema?.properties || {};
                        const required = new Set(tool.inputSchema?.required || []);

                        for (const paramName of Object.keys(props)) {
                            if (!required.has(paramName)) continue;
                            if (!paramName.endsWith('Id')) continue;
                            if (paramMatchesPrefix(paramName, prefix)) {
                                seen.add(tool.name);
                                actions.push({
                                    label: deriveActionLabel(tool.name),
                                    action: 'read',
                                    prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args: { [paramName]: value } }),
                                    icon: toolSpecificity(tool.name) === 0 ? 'detail' : 'list',
                                    _specificity: toolSpecificity(tool.name),
                                });
                                break;
                            }
                        }
                    }
                }
            }
        }

        // --- 2b: Array-valued ID fields (e.g. teamMemberIds, commentIds) ---
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
            // Find a tool that accepts this field directly
            const candidates = toolIndex.byParam.get(key);
            if (candidates) {
                for (const { tool } of candidates) {
                    if (seen.has(tool.name)) continue;
                    if (WRITE_TOOL_RE.test(tool.name)) continue;
                    seen.add(tool.name);
                    actions.push({
                        label: `View ${value.length} ${deriveArrayLabel(key)}`,
                        action: 'read',
                        prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args: { [key]: value } }),
                        icon: 'list',
                        _specificity: toolSpecificity(tool.name),
                    });
                }
            }

            // Also find get-* tools for the singular entity ID
            // e.g. "teamMemberIds" -> singular param "memberId" in get-team-member
            const sampleId = value[0];
            const prefix = extractIdPrefix(sampleId);
            if (prefix) {
                for (const { tool } of toolIndex.all) {
                    if (seen.has(tool.name)) continue;
                    if (WRITE_TOOL_RE.test(tool.name)) continue;
                    const props = tool.inputSchema?.properties || {};
                    const required = new Set(tool.inputSchema?.required || []);

                    // Find a required param that matches this entity prefix
                    for (const paramName of Object.keys(props)) {
                        if (!required.has(paramName)) continue;
                        if (!paramName.endsWith('Id')) continue;
                        if (paramMatchesPrefix(paramName, prefix)) {
                            // Find a list-* tool for this entity instead (better UX for arrays)
                            const listToolName = 'list-' + prefix + 's';
                            const listTool = toolIndex.all.find(e =>
                                e.tool.name === listToolName && !seen.has(e.tool.name)
                            );

                            if (listTool && !seen.has(listTool.tool.name)) {
                                // No direct filter param for the array, so just open the list
                                seen.add(listTool.tool.name);
                                actions.push({
                                    label: `View ${value.length} ${deriveArrayLabel(key)}`,
                                    action: 'read',
                                    prompt: JSON.stringify({ _directExec: true, toolName: listTool.tool.name, args: {} }),
                                    icon: 'list',
                                    _specificity: 1,
                                });
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // ── Phase 3: id -> entityId mapping ──
    // If the item has an "id" field like "project-1", find tools
    // whose param (e.g. "projectId") matches the entity prefix.
    // Matches both required and optional params for maximum drill-down.
    if (typeof item.id === 'string') {
        const prefix = extractIdPrefix(item.id);
        if (prefix) {
            for (const { tool } of toolIndex.all) {
                if (seen.has(tool.name)) continue;
                if (WRITE_TOOL_RE.test(tool.name)) continue;
                const props = tool.inputSchema?.properties || {};

                for (const paramName of Object.keys(props)) {
                    if (!paramName.endsWith('Id')) continue;
                    if (paramMatchesPrefix(paramName, prefix)) {
                        seen.add(tool.name);
                        actions.push({
                            label: deriveActionLabel(tool.name),
                            action: 'read',
                            prompt: JSON.stringify({ _directExec: true, toolName: tool.name, args: { [paramName]: item.id } }),
                            icon: toolSpecificity(tool.name) === 0 ? 'detail' : 'list',
                            _specificity: toolSpecificity(tool.name),
                        });
                        break;
                    }
                }
            }
        }
    }

    // ── Phase 4: Deduplicate, sort, cap ──
    // Sort: most specific first (get > list > search), then read before write
    actions.sort((a, b) => {
        const specDiff = (a._specificity ?? 3) - (b._specificity ?? 3);
        if (specDiff !== 0) return specDiff;
        if (a.action === 'read' && b.action !== 'read') return -1;
        if (a.action !== 'read' && b.action === 'read') return 1;
        return 0;
    });

    // Clean up internal _specificity before returning
    for (const action of actions) {
        delete action._specificity;
    }

    return actions.slice(0, 6);
}
