# MCP Server Catalog & Configuration Plan

## Preset Server Catalog

Curated list of MCP servers users can add from the UI with one click, grouped by category.

### Tier 1 — Core (ship with demo)

| Name | Package | Config | Dashboard Value |
|------|---------|--------|----------------|
| **Filesystem** | `@modelcontextprotocol/server-filesystem` | `{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "{path}"] }` | File trees, stat cards |
| **SQLite** | `@modelcontextprotocol/server-sqlite` | `{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sqlite", "{dbPath}"] }` | Query tables, schema |
| **PostgreSQL** | `@modelcontextprotocol/server-postgres` | `{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres"], "env": { "POSTGRES_URL": "{connectionString}" } }` | Tables, charts |
| **Git** | `@modelcontextprotocol/server-git` | `{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-git", "--repository", "{repoPath}"] }` | Diffs, commit timeline |
| **Memory** | `@modelcontextprotocol/server-memory` | `{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }` | Knowledge graph |

### Tier 2 — Popular Integrations

| Name | Package | Requires | Dashboard Value |
|------|---------|----------|----------------|
| **GitHub** | `github/github-mcp-server` (Go binary) | `GITHUB_PERSONAL_ACCESS_TOKEN` | PRs, issues, actions |
| **Slack** | `@anthropic/mcp-server-slack` | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` | Messages, channels |
| **Sentry** | `@sentry/mcp-server-sentry` | `SENTRY_AUTH_TOKEN` | Error cards, issues |
| **Docker** | `@0xshariq/docker-mcp-server` | Docker running | Container status |
| **Brave Search** | `@anthropic/mcp-server-brave-search` | `BRAVE_API_KEY` | Search results |

### Tier 3 — Databases & Cloud

| Name | Package | Requires | Dashboard Value |
|------|---------|----------|----------------|
| **MySQL** | `mysql_mcp_server` | Connection string | Tables, schema |
| **MongoDB** | `mcp-mongo-server` | Connection URI | Document cards |
| **Redis** | `mcp-redis` | Redis URL | Key-value cards |
| **Grafana** | `mcp-grafana` | `GRAFANA_URL`, `GRAFANA_TOKEN` | Metric charts, alerts |
| **AWS CloudWatch** | `@aws/mcp-server-cloudwatch` | AWS credentials | Metric charts, alarms |

## UI Design: Server Configuration Panel

### Accessing the Panel
- Click the "Connected servers" button (database icon) in the header
- Opens a modal/drawer over the main content

### Panel Layout
```
┌─────────────────────────────────────────────────┐
│  MCP Servers                              [×]   │
│                                                  │
│  Connected (2)                                   │
│  ┌────────────────────────────────────────────┐  │
│  │ ● filesystem     14 tools     [Disconnect] │  │
│  │ ● sqlite          8 tools     [Disconnect] │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Add Server                                      │
│  ┌──────────────────────────────────────────┐    │
│  │ 🔍 Search servers...                     │    │
│  ├──────────────────────────────────────────┤    │
│  │ 📁 Databases                              │    │
│  │   PostgreSQL  SQLite  MySQL  MongoDB      │    │
│  │ 🔧 Developer Tools                        │    │
│  │   Git  GitHub  Docker  Filesystem         │    │
│  │ 📊 Observability                          │    │
│  │   Grafana  Sentry  AWS CloudWatch         │    │
│  │ 💬 SaaS                                   │    │
│  │   Slack  Linear  Notion  Jira             │    │
│  ├──────────────────────────────────────────┤    │
│  │ ⚙ Custom Server (JSON config)            │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Adding a Preset Server
1. Click a server from the catalog
2. Modal shows: name, description, required fields (path, API key, URL)
3. Fill in required fields → click "Connect"
4. Backend adds the server config, spawns the process, discovers tools
5. Server appears in "Connected" list with tool count

### Adding a Custom Server
1. Click "Custom Server (JSON config)"
2. Textarea for pasting JSON: `{ "command": "...", "args": [...], "env": {...} }`
3. Name field
4. Click "Connect"

### Disconnecting
1. Click "Disconnect" on a connected server
2. Backend shuts down the process, removes from hub
3. Tools from that server are no longer available

## Backend API Changes

```
POST /api/servers              — add a server (body: { name, config })
DELETE /api/servers/:name      — disconnect a server
GET  /api/servers              — list connected servers (existing)
GET  /api/servers/catalog      — get preset server catalog
```

## Implementation Architecture

### Backend: Dynamic server management in mcp-hub.ts

```typescript
// New exports
export async function addServer(name: string, config: McpServerConfig): Promise<ServerInfo>;
export async function removeServer(name: string): Promise<void>;
export function getCatalog(): PresetServer[];
```

### Frontend: Server config modal in app.js

- Rendered as an overlay/drawer
- Fetches catalog from `/api/servers/catalog`
- POST to `/api/servers` to add
- DELETE to `/api/servers/:name` to remove
- Refreshes connected server list on changes

### Persistence

Server configs saved to `mcp-servers.json` so they survive restarts. The file is read on startup and written when servers are added/removed.

## References

- [MCP Server Registries](https://pulsemcp.com/) — 6,800+ servers indexed
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers) — reference implementations
- [AWS MCP (66 servers)](https://github.com/awslabs/mcp) — 208+ tools across 57 AWS services
- [Claude Desktop config format](https://modelcontextprotocol.io/quickstart/user)
