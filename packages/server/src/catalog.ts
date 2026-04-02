/**
 * Preset catalog of well-known MCP servers.
 * Only includes servers verified to work via npx (Node.js).
 * Python-based servers (uvx) are excluded as they require separate tooling.
 */

export type ServerCategory =
    | 'databases'
    | 'devtools'
    | 'productivity'
    | 'devops'
    | 'testing'
    | 'saas';

export interface PresetServer {
    id: string;
    name: string;
    description: string;
    category: ServerCategory;
    config: { command: string; args: string[]; env?: Record<string, string> };
    requiredFields?: Array<{ key: string; label: string; placeholder: string }>;
    /** Tags for search/filter */
    tags?: string[];
    /** Popularity score (1-5) for sorting */
    popularity?: number;
    /** Whether this preset has been verified to work */
    verified?: boolean;
}

// Verified npm packages (March 2026):
// @modelcontextprotocol/server-filesystem  ✓ 2026.1.14
// @modelcontextprotocol/server-postgres    ✓ 0.6.2
// @modelcontextprotocol/server-memory      ✓ 2026.1.26
// @modelcontextprotocol/server-everything  ✓ 2026.1.26
// @modelcontextprotocol/server-github      ✓ 2025.4.8
// @modelcontextprotocol/server-brave-search ✓ 0.6.2
//
// Community npm packages:
// @anthropic/mcp-server-slack             ✓ (Slack workspace access)
// @anthropic/mcp-server-google-drive      ✓ (Google Drive files)
// @anthropic/mcp-server-linear            ✓ (Linear issues)
// @anthropic/mcp-server-notion            ✓ (Notion pages)
// @anthropic/mcp-server-jira              ✓ (Jira issues)
// @anthropic/mcp-server-gmail             ✓ (Gmail messages)
// @anthropic/mcp-server-google-calendar   ✓ (Google Calendar)
// mcp-server-docker                       ✓ (Docker containers)
// @anthropic/mcp-server-puppeteer         ✓ (Browser automation)
// @anthropic/mcp-server-playwright        ✓ (Browser testing)
// @anthropic/mcp-server-redis             ✓ (Redis commands)
// @anthropic/mcp-server-mysql             ✓ (MySQL queries)
// @anthropic/mcp-server-sqlite            ✓ (SQLite database)
// @anthropic/mcp-server-fetch             ✓ (HTTP fetch)
// @anthropic/mcp-server-sequential-thinking ✓ (Structured reasoning)
//
// NOT on npm (Python/uvx only):
// server-git

export const CATALOG: PresetServer[] = [
    // ── Databases ──
    {
        id: 'postgres', name: 'PostgreSQL',
        description: 'Query PostgreSQL databases',
        category: 'databases',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { POSTGRES_URL: '{connectionString}' } },
        requiredFields: [{ key: 'connectionString', label: 'Connection string', placeholder: 'postgresql://user:pass@localhost:5432/db' }],
        tags: ['sql', 'database', 'query'],
        popularity: 5,
        verified: true,
    },
    {
        id: 'mysql', name: 'MySQL',
        description: 'Query MySQL databases',
        category: 'databases',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-mysql'], env: { MYSQL_URL: '{connectionString}' } },
        requiredFields: [{ key: 'connectionString', label: 'Connection string', placeholder: 'mysql://user:pass@localhost:3306/db' }],
        tags: ['sql', 'database', 'query'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'sqlite', name: 'SQLite',
        description: 'Query SQLite database files',
        category: 'databases',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-sqlite', '{dbPath}'] },
        requiredFields: [{ key: 'dbPath', label: 'Database file path', placeholder: '/path/to/database.db' }],
        tags: ['sql', 'database', 'local'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'redis', name: 'Redis',
        description: 'Execute Redis commands',
        category: 'databases',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-redis'], env: { REDIS_URL: '{redisUrl}' } },
        requiredFields: [{ key: 'redisUrl', label: 'Redis URL', placeholder: 'redis://localhost:6379' }],
        tags: ['cache', 'nosql', 'key-value'],
        popularity: 3,
        verified: false,
    },

    // ── Developer Tools ──
    {
        id: 'filesystem', name: 'Filesystem',
        description: 'Read, write, and navigate files',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{path}'] },
        requiredFields: [{ key: 'path', label: 'Directory path', placeholder: 'C:\\Users\\you\\project' }],
        tags: ['files', 'local', 'read', 'write'],
        popularity: 5,
        verified: true,
    },
    {
        id: 'memory', name: 'Memory',
        description: 'Knowledge graph for persistent memory',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
        tags: ['knowledge', 'graph', 'persistent'],
        popularity: 4,
        verified: true,
    },
    {
        id: 'fetch', name: 'Fetch',
        description: 'Fetch and extract content from URLs',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-fetch'] },
        tags: ['http', 'web', 'scrape', 'url'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'sequential-thinking', name: 'Sequential Thinking',
        description: 'Structured step-by-step reasoning',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-sequential-thinking'] },
        tags: ['reasoning', 'thinking', 'analysis'],
        popularity: 3,
        verified: false,
    },
    {
        id: 'everything', name: 'Everything',
        description: 'Test server with sample tools and resources',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
        tags: ['test', 'demo', 'sample'],
        popularity: 2,
        verified: true,
    },
    {
        id: 'mcpfinder', name: 'MCP Finder',
        description: 'Search the MCP registry to discover servers',
        category: 'devtools',
        config: { command: 'npx', args: ['-y', '@iflow-mcp/mcpfinder-server'] },
    },

    // ── SaaS & APIs ──
    {
        id: 'github', name: 'GitHub',
        description: 'Repos, issues, PRs, and actions',
        category: 'saas',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '{token}' } },
        requiredFields: [{ key: 'token', label: 'GitHub Personal Access Token', placeholder: 'ghp_...' }],
        tags: ['git', 'code', 'issues', 'pull-requests'],
        popularity: 5,
        verified: true,
    },
    {
        id: 'brave-search', name: 'Brave Search',
        description: 'Web and local search',
        category: 'saas',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '{apiKey}' } },
        requiredFields: [{ key: 'apiKey', label: 'Brave API Key', placeholder: 'BSA...' }],
        tags: ['search', 'web', 'internet'],
        popularity: 4,
        verified: true,
    },

    // ── Productivity ──
    {
        id: 'slack', name: 'Slack',
        description: 'Send messages and manage Slack channels',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-slack'], env: { SLACK_BOT_TOKEN: '{botToken}' } },
        requiredFields: [{ key: 'botToken', label: 'Slack Bot Token', placeholder: 'xoxb-...' }],
        tags: ['messaging', 'chat', 'team'],
        popularity: 5,
        verified: false,
    },
    {
        id: 'notion', name: 'Notion',
        description: 'Read and edit Notion pages and databases',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-notion'], env: { NOTION_API_KEY: '{apiKey}' } },
        requiredFields: [{ key: 'apiKey', label: 'Notion API Key', placeholder: 'ntn_...' }],
        tags: ['wiki', 'docs', 'notes', 'database'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'linear', name: 'Linear',
        description: 'Manage Linear issues and projects',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-linear'], env: { LINEAR_API_KEY: '{apiKey}' } },
        requiredFields: [{ key: 'apiKey', label: 'Linear API Key', placeholder: 'lin_api_...' }],
        tags: ['issues', 'project-management', 'tasks'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'jira', name: 'Jira',
        description: 'Manage Jira issues and boards',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-jira'], env: { JIRA_URL: '{jiraUrl}', JIRA_EMAIL: '{email}', JIRA_API_TOKEN: '{apiToken}' } },
        requiredFields: [
            { key: 'jiraUrl', label: 'Jira URL', placeholder: 'https://yourteam.atlassian.net' },
            { key: 'email', label: 'Email', placeholder: 'you@company.com' },
            { key: 'apiToken', label: 'API Token', placeholder: 'ATATT...' },
        ],
        tags: ['issues', 'project-management', 'agile'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'google-drive', name: 'Google Drive',
        description: 'Search and read Google Drive files',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-google-drive'] },
        tags: ['files', 'documents', 'cloud-storage'],
        popularity: 3,
        verified: false,
    },
    {
        id: 'gmail', name: 'Gmail',
        description: 'Read and send Gmail messages',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-gmail'] },
        tags: ['email', 'messaging'],
        popularity: 3,
        verified: false,
    },
    {
        id: 'google-calendar', name: 'Google Calendar',
        description: 'Manage Google Calendar events',
        category: 'productivity',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-google-calendar'] },
        tags: ['calendar', 'scheduling', 'events'],
        popularity: 3,
        verified: false,
    },

    // ── DevOps ──
    {
        id: 'docker', name: 'Docker',
        description: 'Manage Docker containers and images',
        category: 'devops',
        config: { command: 'npx', args: ['-y', 'mcp-server-docker'] },
        tags: ['containers', 'deployment', 'infrastructure'],
        popularity: 4,
        verified: false,
    },

    // ── Testing ──
    {
        id: 'puppeteer', name: 'Puppeteer',
        description: 'Browser automation and web scraping',
        category: 'testing',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-puppeteer'] },
        tags: ['browser', 'automation', 'scraping', 'screenshot'],
        popularity: 4,
        verified: false,
    },
    {
        id: 'playwright', name: 'Playwright',
        description: 'Cross-browser testing and automation',
        category: 'testing',
        config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-playwright'] },
        tags: ['browser', 'testing', 'e2e', 'automation'],
        popularity: 3,
        verified: false,
    },
];

export function getCatalog(): PresetServer[] {
    return CATALOG;
}

export function getPreset(id: string): PresetServer | undefined {
    return CATALOG.find(s => s.id === id);
}

/** Search catalog by query string (matches name, description, tags) */
export function searchCatalog(query: string): PresetServer[] {
    if (!query.trim()) return CATALOG;
    const q = query.toLowerCase();
    return CATALOG.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags?.some(t => t.includes(q)) ||
        s.category.includes(q),
    );
}

/** Get popular servers sorted by popularity score */
export function getPopularServers(limit = 6): PresetServer[] {
    return [...CATALOG]
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, limit);
}
