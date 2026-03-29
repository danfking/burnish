/**
 * Preset catalog of well-known MCP servers.
 */

export interface PresetServer {
    id: string;
    name: string;
    description: string;
    category: 'databases' | 'devtools' | 'observability' | 'saas';
    config: { command: string; args: string[]; env?: Record<string, string> };
    requiredFields?: Array<{ key: string; label: string; placeholder: string }>;
}

export const CATALOG: PresetServer[] = [
    { id: 'filesystem', name: 'Filesystem', description: 'Read, write, and navigate files', category: 'devtools', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{path}'] }, requiredFields: [{ key: 'path', label: 'Directory path', placeholder: '/home/user/project' }] },
    { id: 'sqlite', name: 'SQLite', description: 'Query SQLite databases', category: 'databases', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', '{dbPath}'] }, requiredFields: [{ key: 'dbPath', label: 'Database file path', placeholder: '/path/to/database.db' }] },
    { id: 'postgres', name: 'PostgreSQL', description: 'Query PostgreSQL databases', category: 'databases', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { POSTGRES_URL: '{connectionString}' } }, requiredFields: [{ key: 'connectionString', label: 'Connection string', placeholder: 'postgresql://user:pass@localhost:5432/db' }] },
    { id: 'git', name: 'Git', description: 'Git status, log, diff, and branch operations', category: 'devtools', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-git', '--repository', '{repoPath}'] }, requiredFields: [{ key: 'repoPath', label: 'Repository path', placeholder: '/home/user/repo' }] },
    { id: 'memory', name: 'Memory', description: 'Knowledge graph for persistent memory', category: 'devtools', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
    { id: 'fetch', name: 'Web Fetch', description: 'Fetch and convert web content', category: 'devtools', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] } },
    { id: 'github', name: 'GitHub', description: 'Repos, issues, PRs, and actions', category: 'saas', config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '{token}' } }, requiredFields: [{ key: 'token', label: 'GitHub Personal Access Token', placeholder: 'ghp_...' }] },
    { id: 'brave-search', name: 'Brave Search', description: 'Web and local search', category: 'saas', config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-brave-search'], env: { BRAVE_API_KEY: '{apiKey}' } }, requiredFields: [{ key: 'apiKey', label: 'Brave API Key', placeholder: 'BSA...' }] },
];

export function getCatalog(): PresetServer[] {
    return CATALOG;
}

export function getPreset(id: string): PresetServer | undefined {
    return CATALOG.find(s => s.id === id);
}
