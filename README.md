# Burnish

**Explore any MCP server. No LLM required.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Explore with Burnish](https://img.shields.io/badge/Explore-with%20Burnish-8B3A3A)](https://github.com/danfking/burnish)

```bash
npx burnish -- npx @modelcontextprotocol/server-filesystem /tmp
```

> `npx burnish` is not yet published to npm — use [git clone](#from-source) for now.

---

## What is Burnish?

**Swagger UI for the MCP ecosystem.** Connect to any MCP server and immediately see every tool it exposes — with descriptions, auto-generated input forms, and results rendered as cards, tables, charts, and metrics. No LLM. No API key. No data leaving your machine.

Add an LLM and Burnish levels up: natural language queries, AI-generated insights streamed alongside structured data, and multi-tool orchestration across servers.

## Two Modes

### Explorer Mode — no LLM required

Connect. Browse. Execute. Everything is driven by the server's tool schemas.

- **Instant tool discovery** — every tool listed with its description and input schema
- **Auto-generated forms** — JSON Schema in, interactive form out
- **Rich results** — responses rendered as cards, tables, charts, stat bars, not raw JSON
- **Fully private** — runs locally, no external calls, no telemetry
- **Zero config** — `pnpm dev:nomodel` and you're running

### Copilot Mode — LLM-enhanced

Everything from Explorer, plus:

- **Natural language queries** — "show me the 10 largest files modified this week"
- **AI-generated insights** — analysis streamed below structured data
- **Contextual next steps** — suggested follow-up actions based on results
- **Multi-tool orchestration** — LLM chains tools across multiple servers in a single query
- **Drill-down navigation** — click any card to trigger a contextual follow-up; results append below

## Quick Start

### One command (once published to npm)

```bash
# Explorer — no LLM, no API key
npx burnish -- npx @modelcontextprotocol/server-filesystem /tmp

# Copilot — with LLM
npx burnish --llm=cli -- npx @modelcontextprotocol/server-filesystem /tmp
```

> Not yet available via npx — packages are pending npm publish. Use the git clone method below.

### From source

```bash
git clone https://github.com/danfking/burnish.git
cd burnish
pnpm install
pnpm build
pnpm dev:nomodel
```

Open `http://localhost:3000`. Your configured MCP servers appear with all their tools ready to use.

#### Copilot Mode (with LLM)

```bash
# Option A: Claude Code CLI auth (no API key needed)
LLM_BACKEND=cli pnpm dev

# Option B: Direct Anthropic API
ANTHROPIC_API_KEY=sk-ant-... pnpm dev

# Option C: Local model via Ollama (fully offline)
LLM_BACKEND=openai OPENAI_BASE_URL=http://localhost:11434/v1 pnpm dev
```

Configure your MCP servers in `apps/demo/mcp-servers.json`, then ask a question.

## For MCP Server Owners

Let your users explore your server instantly. Add this badge to your README:

```markdown
[![Explore with Burnish](https://img.shields.io/badge/Explore-with%20Burnish-8B3A3A)](https://github.com/danfking/burnish)
```

Then add a quick-start snippet so users can connect in one command:

```bash
# Explore your MCP server with Burnish (no LLM required)
npx burnish -- npx @your-org/your-mcp-server
```

Replace `@your-org/your-mcp-server` with your server's npm package or startup command.

## Why Burnish?

| | Burnish | MCP Inspector | Composio / Rube | Smithery | n8n |
|---|---|---|---|---|---|
| **Works without LLM** | Yes (Explorer) | Yes | No | N/A | No |
| **Rich visualization** | Cards, tables, charts, metrics | Raw JSON | Limited | None (registry only) | Node output |
| **Any MCP server** | Yes | Yes | 500 pre-wrapped apps | Registry, no execution | Via custom nodes |
| **Auto-generated forms** | Yes (from schema) | Manual JSON input | Pre-built forms | No | Node config UI |
| **Natural language** | Yes (Copilot) | No | Yes | No | No |
| **Streaming results** | Progressive SSE | No | No | No | No |
| **Local / private** | Yes, fully | Yes | Cloud-dependent | Cloud | Self-host (heavy) |
| **Setup time** | `npx burnish` | `npx` | Account + config | Browse only | Docker + config |
| **Composable** | Any server combo | Single server | Locked ecosystem | N/A | Workflow builder |

## Key Features

**Explorer (no LLM)**
- Schema-driven tool discovery and form generation
- 10 web components: cards, tables, charts, forms, stat bars, metrics, sections, messages, actions, pipelines
- DOMPurify-sanitized rendering
- Works with any MCP server — filesystem, GitHub, databases, custom tools
- Framework-agnostic — standard web components, no React/Vue/Angular lock-in
- Themeable via `--burnish-*` CSS custom properties
- No build step required — import from CDN as ES modules

**Copilot (LLM-enhanced)**
- Progressive streaming — components render as the LLM generates them
- Three LLM backends: Anthropic API (streaming tool-call loop), Claude CLI (zero-config auth), OpenAI-compatible (Ollama, llama.cpp, vLLM, LM Studio)
- Drill-down navigation with collapsible sections and session persistence
- Multi-server tool orchestration in a single query

## Component Reference

| Component | Tag | Key Attributes | Purpose |
|-----------|-----|----------------|---------|
| Card | `<burnish-card>` | `title`, `status`, `body`, `meta` (JSON), `item-id` | Individual items with drill-down |
| Stat Bar | `<burnish-stat-bar>` | `items` (JSON: `[{label, value, color?}]`) | Summary metrics / filter pills |
| Table | `<burnish-table>` | `title`, `columns` (JSON), `rows` (JSON), `status-field` | Tabular data with status coloring |
| Chart | `<burnish-chart>` | `type` (line/bar/doughnut), `config` (JSON) | Chart.js visualizations |
| Section | `<burnish-section>` | `label`, `count`, `status`, `collapsed` | Collapsible grouping container |
| Metric | `<burnish-metric>` | `label`, `value`, `unit`, `trend` (up/down/flat) | Single KPI display |
| Message | `<burnish-message>` | `role` (user/assistant), `content`, `streaming` | Chat bubbles |
| Form | `<burnish-form>` | `title`, `tool-id`, `fields` (JSON) | User input / tool execution |
| Actions | `<burnish-actions>` | `actions` (JSON: `[{label, action, prompt, icon?}]`) | Contextual next-step buttons |
| Pipeline | `<burnish-pipeline>` | `steps` (JSON: `[{server, tool, status}]`) | Real-time tool chain visualization |

**Status values:** `success`, `warning`, `error`, `muted`, `info` — mapped to semantic colors via CSS custom properties.

**Action types:** `read` (auto-invoke, safe) and `write` (shows form, requires user confirmation).

## SDK Integration

### Middleware

Add Burnish Explorer to your MCP server with one line:

```typescript
import { withBurnishUI } from "burnish/middleware";
await withBurnishUI(server, { port: 3001 });
```

### Schema Export

```bash
npx burnish export -- npx @your-org/your-server > schema.json
```

> SDK packages are not yet published to npm — this section describes the planned API.

## Recipes

Multi-server combinations that show Burnish at its best. Each recipe is a `mcp-servers.json` config plus a prompt.

### Incident Triage

Connect PagerDuty + GitHub + your database. Surface the alert, related commits, and recent error rates in one view.

```json
{
  "mcpServers": {
    "pagerduty": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-pagerduty"],
      "env": { "PAGERDUTY_API_KEY": "${PAGERDUTY_API_KEY}" }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}" }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
    }
  }
}
```

**Prompt:** "Show open PagerDuty incidents, then for the highest-severity one, find related commits from the last 24 hours and query the error_logs table for matching stack traces."

### Project Standup

Connect GitHub + Linear (or Jira) + Slack. Get a daily digest without opening three tabs.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}" }
    },
    "linear": {
      "command": "npx",
      "args": ["-y", "mcp-linear"],
      "env": { "LINEAR_API_KEY": "${LINEAR_API_KEY}" }
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-slack"],
      "env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
    }
  }
}
```

**Prompt:** "Summarize yesterday's merged PRs, open Linear issues assigned to me, and any unread Slack threads in #engineering."

### Research Brief

Connect web search + filesystem. Search, summarize, save.

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-brave-search"],
      "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./research"]
    }
  }
}
```

**Prompt:** "Search for recent benchmarks on MCP server performance, summarize the top 5 results, and save the summary to research/mcp-benchmarks.md."

## Use in Your Own Project

### CDN (no build step)

> Available after npm publish. The CDN URLs below will work once packages are released.

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@burnish/components/dist/index.js"></script>
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/@burnish/components/dist/tokens.css" />

<burnish-card
  title="API Gateway"
  status="success"
  body="All systems operational"
  meta='[{"label":"Uptime","value":"99.9%"},{"label":"Latency","value":"42ms"}]'
  item-id="api-gw-1">
</burnish-card>
```

### npm

> Available after npm publish.

```bash
npm install @burnish/components
```

```javascript
import '@burnish/components';

// Components auto-register with burnish-* prefix.
// Custom prefix:
import { BurnishCard } from '@burnish/components';
customElements.define('my-card', class extends BurnishCard {});
```

### Renderer

> Available after npm publish.

```bash
npm install @burnish/renderer
```

```javascript
import { findStreamElements, appendStreamElement } from '@burnish/renderer';

const elements = findStreamElements(chunk);
for (const el of elements) {
  appendStreamElement(container, stack, el, safeAttrs, sanitize);
}
```

## Configuration

### LLM Backend

| Mode | Env Var | Description |
|------|---------|-------------|
| None | `LLM_BACKEND=none` | Explorer only — no LLM, instant tool execution |
| API | `ANTHROPIC_API_KEY=sk-ant-...` | Direct Anthropic SDK with streaming tool-call loop (8 rounds max) |
| CLI | `LLM_BACKEND=cli` | Spawns Claude CLI subprocess; uses your Claude Code subscription auth |
| OpenAI | `LLM_BACKEND=openai` | OpenAI-compatible API (Ollama, llama.cpp, vLLM, LM Studio) |
| Auto | *(none)* | Defaults to CLI if no API key is set |

### MCP Servers

Configure in `apps/demo/mcp-servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

All configured servers connect at startup. Their tools are available immediately in Explorer mode and to the LLM in Copilot mode.

## Development

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev:nomodel      # Explorer mode (no LLM)
pnpm dev              # Copilot mode (auto-detect backend)
pnpm test             # Run Playwright tests
pnpm clean            # Clean all build artifacts
```

```
burnish/
├── packages/
│   ├── components/       @burnish/components — 10 Lit web components
│   ├── renderer/         @burnish/renderer  — streaming parser + sanitizer
│   ├── app/              @burnish/app — drill-down logic + stream orchestration
│   └── server/           @burnish/server — LLM orchestrator + MCP hub
├── apps/
│   └── demo/
│       ├── server/       Hono API + dual-mode routing
│       └── public/       SPA shell (ES modules, no framework)
└── package.json          pnpm workspace root
```

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- For CLI backend: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- For API backend: an Anthropic API key
- For local models: [Ollama](https://ollama.ai/) or any OpenAI-compatible server

## How It Works

```
                    ┌──────────────────────────────────┐
                    │        MCP Servers                │
                    │  (filesystem, GitHub, DB, ...)    │
                    └──────────────┬───────────────────┘
                                   │ tool calls / results
                                   │
           ┌───────────────────────┴───────────────────────┐
           │                                               │
    Explorer Mode                                   Copilot Mode
           │                                               │
    ┌──────┴──────┐                              ┌─────────┴─────────┐
    │ Schema      │                              │ LLM               │
    │ Parser      │                              │ (Anthropic / CLI  │
    │             │                              │  / OpenAI-compat) │
    │ • List tools│                              │                   │
    │ • Gen forms │                              │ • NL → tool calls │
    │ • Map result│                              │ • Data → HTML     │
    │   → comps   │                              │ • Streams via SSE │
    └──────┬──────┘                              └─────────┬─────────┘
           │                                               │
           └───────────────────┬───────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │  Streaming Renderer      │
                    │                          │
                    │  • Parse tags on arrival  │
                    │  • Sanitize (DOMPurify)  │
                    │  • Append to DOM         │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │  Web Components (Lit 3)  │
                    │                          │
                    │  • Shadow DOM isolation  │
                    │  • JSON attribute parsing│
                    │  • Event-driven drill-   │
                    │    down navigation       │
                    └──────────────────────────┘
```

**Explorer mode** reads the MCP server's tool list, generates forms from JSON Schema, and maps results directly to components — no LLM in the loop.

**Copilot mode** adds an LLM that interprets natural language, orchestrates tool calls, and generates HTML using the burnish component vocabulary. The system prompt teaches the LLM which tags to use; the renderer streams them into the browser progressively.

## License

[AGPL-3.0](LICENSE) — Daniel King ([@danfking](https://github.com/danfking))
