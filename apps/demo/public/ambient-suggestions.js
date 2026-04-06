/**
 * Ambient Suggestion Layer — data-aware contextual next-step suggestions.
 *
 * Analyzes tool execution results and generates follow-up suggestion chips
 * based on the actual data returned. For example:
 *   - After listing files: "Show file sizes" / "Search for large files"
 *   - After listing GitHub issues: "3 issues have no assignee — bulk-assign?"
 *   - After a directory listing: "Read README.md" / "List subdirectory"
 */

import { escapeHtml, escapeAttr } from './shared.js';
import { getCachedServers } from './contextual-actions.js';

/**
 * @typedef {Object} Suggestion
 * @property {string} label - Display text for the chip
 * @property {string} toolName - Full MCP tool name to execute
 * @property {Object} args - Arguments for the tool call
 * @property {'insight'|'action'|'explore'} intent - Visual hint for chip styling
 */

// ── Suggestion Rule Engine ──

/**
 * Analyze result data from a tool execution and produce contextual suggestions.
 *
 * @param {*} resultData - Parsed result data (object, array, or string)
 * @param {string} sourceToolName - The tool that produced this result
 * @param {Object} sourceArgs - The arguments used for the tool call
 * @returns {Suggestion[]}
 */
export function generateAmbientSuggestions(resultData, sourceToolName, sourceArgs) {
    const suggestions = [];
    const servers = getCachedServers();
    if (!servers) return suggestions;

    // Resolve the server and available tools
    const serverInfo = resolveServer(sourceToolName, servers);
    if (!serverInfo) return suggestions;
    const { server, shortName } = serverInfo;

    // Normalize result into an items array if possible
    const items = normalizeItems(resultData);

    // Run all rule sets
    directoryRules(suggestions, resultData, shortName, sourceArgs, server);
    fileContentRules(suggestions, resultData, shortName, sourceArgs, server);
    listResultRules(suggestions, items, shortName, sourceArgs, server);
    githubIssueRules(suggestions, items, shortName, sourceArgs, server);
    githubRepoRules(suggestions, items, shortName, sourceArgs, server);
    searchRules(suggestions, items, shortName, sourceArgs, server);
    genericDataRules(suggestions, items, shortName, sourceArgs, server);

    // Deduplicate by toolName + args combination
    const seen = new Set();
    const deduped = [];
    for (const s of suggestions) {
        const key = s.toolName + '::' + JSON.stringify(s.args);
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(s);
        }
    }

    return deduped.slice(0, 4);
}

// ── Rule Sets ──

function directoryRules(suggestions, resultData, shortName, sourceArgs, server) {
    // Detect directory listing results (plain text with [DIR]/[FILE] markers)
    const rawStr = typeof resultData === 'string' ? resultData : '';
    const hasDirMarkers = rawStr.includes('[DIR]') || rawStr.includes('[FILE]');

    if (!hasDirMarkers && !/list_directory|list_allowed/.test(shortName)) return;

    const basePath = sourceArgs?.path || '.';

    // Extract directory and file names from plain text
    const dirs = [];
    const files = [];
    if (hasDirMarkers) {
        for (const line of rawStr.split('\n')) {
            const m = line.match(/^\[(DIR|FILE)\]\s+(.+)$/);
            if (m) {
                if (m[1] === 'DIR') dirs.push(m[2].trim());
                else files.push(m[2].trim());
            }
        }
    }

    // Suggest navigating into subdirectories
    if (dirs.length > 0) {
        const first = dirs[0];
        const subPath = basePath === '.' ? first : basePath.replace(/\/$/, '') + '/' + first;
        const listTool = findTool(server, /list_directory|list_dir/);
        if (listTool) {
            suggestions.push({
                label: `Open ${first}/`,
                toolName: listTool.name,
                args: { path: subPath },
                intent: 'explore',
            });
        }
    }

    // Suggest reading a notable file
    const notableFiles = ['README.md', 'readme.md', 'README', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];
    const foundNotable = files.find(f => notableFiles.includes(f));
    if (foundNotable) {
        const readTool = findTool(server, /read_file|get_file_contents/);
        if (readTool) {
            const filePath = basePath === '.' ? foundNotable : basePath.replace(/\/$/, '') + '/' + foundNotable;
            suggestions.push({
                label: `Read ${foundNotable}`,
                toolName: readTool.name,
                args: { path: filePath },
                intent: 'explore',
            });
        }
    }

    // Suggest search in directory
    const searchTool = findTool(server, /search_files|find_files|grep/);
    if (searchTool) {
        suggestions.push({
            label: 'Search in this directory',
            toolName: searchTool.name,
            args: { path: basePath, pattern: '' },
            intent: 'explore',
        });
    }
}

function fileContentRules(suggestions, resultData, shortName, sourceArgs, server) {
    if (!/read_file|get_file_contents/.test(shortName)) return;

    const filePath = sourceArgs?.path || '';

    // Suggest listing the parent directory
    const parts = filePath.replace(/\\/g, '/').split('/');
    if (parts.length > 1) {
        parts.pop();
        const parentDir = parts.join('/') || '.';
        const listTool = findTool(server, /list_directory|list_dir/);
        if (listTool) {
            suggestions.push({
                label: 'List parent directory',
                toolName: listTool.name,
                args: { path: parentDir },
                intent: 'explore',
            });
        }
    }

    // Suggest searching for similar files
    const ext = filePath.match(/\.(\w+)$/)?.[1];
    if (ext) {
        const searchTool = findTool(server, /search_files|find_files/);
        if (searchTool) {
            suggestions.push({
                label: `Find other .${ext} files`,
                toolName: searchTool.name,
                args: { path: '.', pattern: `*.${ext}` },
                intent: 'explore',
            });
        }
    }
}

function listResultRules(suggestions, items, shortName, sourceArgs, server) {
    if (items.length === 0) return;

    // If results are truncated (large list), suggest filtering
    if (items.length >= 30) {
        const searchTool = findTool(server, /search|find|query|filter/);
        if (searchTool) {
            suggestions.push({
                label: `${items.length} results — filter or search`,
                toolName: searchTool.name,
                args: { ...sourceArgs },
                intent: 'insight',
            });
        }
    }
}

function githubIssueRules(suggestions, items, shortName, sourceArgs, server) {
    if (items.length === 0) return;
    // Detect GitHub issue-like data
    const first = items[0];
    if (!first.number || !first.state) return;

    const unassigned = items.filter(i => !i.assignee && !i.assignees?.length);
    if (unassigned.length > 0 && unassigned.length <= items.length) {
        // Insight about unassigned issues
        const noun = unassigned.length === 1 ? 'issue has' : 'issues have';
        suggestions.push({
            label: `${unassigned.length} ${noun} no assignee`,
            toolName: '',
            args: {},
            intent: 'insight',
        });
    }

    const openCount = items.filter(i => i.state === 'open').length;
    const closedCount = items.filter(i => i.state === 'closed').length;

    // Suggest viewing closed issues if all are open
    if (openCount > 0 && closedCount === 0 && sourceArgs) {
        const listTool = findTool(server, /list_issues|search_issues/);
        if (listTool) {
            suggestions.push({
                label: 'Show closed issues',
                toolName: listTool.name,
                args: { ...sourceArgs, state: 'closed' },
                intent: 'explore',
            });
        }
    }

    // Suggest drilling into first issue
    if (items.length > 0 && first.number) {
        const getTool = findTool(server, /get_issue(?!s)/);
        if (getTool && sourceArgs?.owner && sourceArgs?.repo) {
            suggestions.push({
                label: `View issue #${first.number}`,
                toolName: getTool.name,
                args: { owner: sourceArgs.owner, repo: sourceArgs.repo, issue_number: first.number },
                intent: 'explore',
            });
        }
    }
}

function githubRepoRules(suggestions, items, shortName, sourceArgs, server) {
    if (items.length === 0) return;
    const first = items[0];
    if (!first.full_name || !first.full_name.includes('/')) return;

    const [owner, repo] = first.full_name.split('/');

    // Suggest listing issues for the first repo
    const issuesTool = findTool(server, /list_issues/);
    if (issuesTool) {
        suggestions.push({
            label: `Issues in ${repo}`,
            toolName: issuesTool.name,
            args: { owner, repo },
            intent: 'explore',
        });
    }

    // Suggest listing pull requests
    const prTool = findTool(server, /list_pull|list_pr/);
    if (prTool) {
        suggestions.push({
            label: `Pull requests in ${repo}`,
            toolName: prTool.name,
            args: { owner, repo },
            intent: 'explore',
        });
    }
}

function searchRules(suggestions, items, shortName, sourceArgs, server) {
    if (!/search|find|query/.test(shortName)) return;
    if (items.length === 0) return;

    // After search, suggest refining with different terms
    if (sourceArgs?.query || sourceArgs?.pattern) {
        const sameTool = findToolExact(server, shortName);
        if (sameTool) {
            suggestions.push({
                label: 'Refine search',
                toolName: sameTool.name,
                args: { ...sourceArgs },
                intent: 'action',
            });
        }
    }
}

function genericDataRules(suggestions, items, shortName, sourceArgs, server) {
    if (items.length === 0) return;
    const first = items[0];

    // If items have a 'path' field, suggest reading the first one
    if (first.path && typeof first.path === 'string') {
        const readTool = findTool(server, /read_file|get_file_contents|get_file/);
        if (readTool) {
            const fileName = first.path.split('/').pop() || first.path;
            suggestions.push({
                label: `Read ${fileName}`,
                toolName: readTool.name,
                args: { path: first.path },
                intent: 'explore',
            });
        }
    }

    // If items have a 'url' or 'html_url' field, provide a count summary
    if (first.html_url || first.url) {
        const total = items.length;
        if (total >= 5) {
            suggestions.push({
                label: `${total} results returned`,
                toolName: '',
                args: {},
                intent: 'insight',
            });
        }
    }
}

// ── Helpers ──

function resolveServer(sourceToolName, servers) {
    // Try mcp__<server>__<tool> format
    const mcpMatch = sourceToolName.match(/^mcp__(\w+)__(.+)$/);
    if (mcpMatch) {
        const server = servers.find(s => s.name === mcpMatch[1]);
        if (server) return { server, shortName: mcpMatch[2] };
    }
    // Fallback: find tool in any server
    for (const server of servers) {
        const tool = server.tools.find(t => t.name === sourceToolName);
        if (tool) return { server, shortName: tool.name };
    }
    return null;
}

function normalizeItems(data) {
    if (Array.isArray(data)) return data.filter(i => typeof i === 'object' && i !== null);
    if (typeof data === 'object' && data !== null) {
        const arrayKeys = ['items', 'results', 'data', 'entries', 'records', 'rows',
            'repositories', 'issues', 'files', 'commits', 'pull_requests', 'comments'];
        for (const key of arrayKeys) {
            if (Array.isArray(data[key])) return data[key].filter(i => typeof i === 'object' && i !== null);
        }
    }
    return [];
}

function findTool(server, pattern) {
    return server.tools.find(t => pattern.test(t.name));
}

function findToolExact(server, name) {
    return server.tools.find(t => t.name === name);
}

// ── DOM Rendering ──

/**
 * Render ambient suggestion chips as HTML.
 *
 * @param {Suggestion[]} suggestions
 * @returns {string} HTML string for the suggestion container
 */
export function renderAmbientSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return '';

    const chips = suggestions.map(s => {
        const intentClass = `burnish-ambient-chip--${s.intent || 'explore'}`;
        // Insight-only chips (no tool) are non-interactive labels
        if (!s.toolName) {
            return `<span class="burnish-ambient-chip ${intentClass} burnish-ambient-chip--static">${escapeHtml(s.label)}</span>`;
        }

        const hasEmptyRequiredArgs = Object.values(s.args).some(v => v === '');
        // If args have empty values, this should open the tool form instead of direct exec
        if (hasEmptyRequiredArgs) {
            return `<button class="burnish-suggestion burnish-ambient-chip ${intentClass}" data-tool="${escapeAttr(s.toolName)}" data-args="${escapeAttr(JSON.stringify(s.args))}" data-label="${escapeAttr(s.label)}">${escapeHtml(s.label)}</button>`;
        }

        return `<button class="burnish-suggestion burnish-ambient-chip ${intentClass}" data-tool="${escapeAttr(s.toolName)}" data-args="${escapeAttr(JSON.stringify(s.args))}" data-label="${escapeAttr(s.label)}">${escapeHtml(s.label)}</button>`;
    }).join('');

    return `<div class="burnish-ambient-suggestions">${chips}</div>`;
}

/**
 * Analyze result data and append ambient suggestions below a content element.
 *
 * @param {HTMLElement} contentEl - The node content element to append to
 * @param {*} resultData - Raw result data (string, to be parsed)
 * @param {string} toolName - Source tool name
 * @param {Object} args - Source tool arguments
 * @param {Object} purifyConfig - DOMPurify configuration
 */
export function appendAmbientSuggestions(contentEl, resultData, toolName, args, purifyConfig) {
    if (!contentEl) return;

    let parsed = resultData;
    if (typeof resultData === 'string') {
        try { parsed = JSON.parse(resultData); } catch { /* keep as string */ }
    }

    const suggestions = generateAmbientSuggestions(parsed, toolName, args);
    if (suggestions.length === 0) return;

    const html = renderAmbientSuggestions(suggestions);
    if (html) {
        contentEl.insertAdjacentHTML('beforeend', DOMPurify.sanitize(html, purifyConfig));
    }
}
