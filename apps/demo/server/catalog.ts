/**
 * Preset catalog of well-known MCP servers.
 * Only includes servers verified to work via npx (Node.js).
 * Python-based servers (uvx) are excluded as they require separate tooling.
 */

export interface PresetServer {
    id: string;
    name: string;
    description: string;
    category: 'databases' | 'devtools' | 'observability' | 'saas';
    config: { command: string; args: string[]; env?: Record<string, string> };
    requiredFields?: Array<{ key: string; label: string; placeholder: string }>;
}

// Verified npm packages (March 2026):
// @modelcontextprotocol/server-filesystem  ✓ 2026.1.14
// @modelcontextprotocol/server-postgres    ✓ 0.6.2
// @modelcontextprotocol/server-memory      ✓ 2026.1.26
// @modelcontextprotocol/server-everything  ✓ 2026.1.26
// @modelcontextprotocol/server-github      ✓ 2025.4.8
// @modelcontextprotocol/server-brave-search ✓ 0.6.2
//
// NOT on npm (Python/uvx only):
// server-sqlite, server-git, server-fetch, server-puppeteer

export const CATALOG: PresetServer[] = [
    // ── Databases ──
    {
        id: 'postgres', name: 'PostgreSQL',
        description: 'Query PostgreSQL databases',
        category: 'databases',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { POSTGRES_URL: '{connectionString}' } },
        requiredFields: [{ key: 'connectionString', label: 'Connection string', placeholder: 'postgresql://user:pass@localhost:5432/db' }],
    },

    // ── Developer Tools ──
    {
        id: 'filesystem', name: 'Filesystem',
        description: 'Read, write, and navigate files',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{path}'] },
        requiredFields: [{ key: 'path', label: 'Directory path', placeholder: 'C:\\Users\\you\\project' }],
    },
    {
        id: 'memory', name: 'Memory',
        description: 'Knowledge graph for persistent memory',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    },

    // ── SaaS & APIs ──
    {
        id: 'github', name: 'GitHub',
        description: 'Repos, issues, PRs, and actions',
        category: 'saas',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '{token}' } },
        requiredFields: [{ key: 'token', label: 'GitHub Personal Access Token', placeholder: 'ghp_...' }],
    },
    {
        id: 'brave-search', name: 'Brave Search',
        description: 'Web and local search',
        category: 'saas',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '{apiKey}' } },
        requiredFields: [{ key: 'apiKey', label: 'Brave API Key', placeholder: 'BSA...' }],
    },
];

export function getCatalog(): PresetServer[] {
    return CATALOG;
}

export function getPreset(id: string): PresetServer | undefined {
    return CATALOG.find(s => s.id === id);
}
