<p align="center">
  <img src="apps/demo/public/logo.png" alt="Burnish" width="120">
</p>

# Burnish

**Explore any MCP server. No LLM required.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Explore with Burnish](https://img.shields.io/badge/Explore-with%20Burnish-8B3A3A)](https://github.com/danfking/burnish)

```bash
npx burnish -- npx @modelcontextprotocol/server-filesystem /tmp
```
---

## What is Burnish?

**Swagger UI for the MCP ecosystem.** Connect to any MCP server and immediately see every tool it exposes — with descriptions, auto-generated input forms, and results rendered as cards, tables, charts, and metrics. No LLM. No API key. No data leaving your machine.

## Features

Connect. Browse. Execute. Everything is driven by the server's tool schemas.

- **Instant tool discovery** — every tool listed with its description and input schema
- **Auto-generated forms** — JSON Schema in, interactive form out
- **Rich results** — responses rendered as cards, tables, charts, stat bars, not raw JSON
- **Fully private** — runs locally, no external calls, no telemetry
- **Zero config** — `npx burnish` and you're running

## Quick Start

### One command (once published to npm)

```bash
npx burnish -- npx @modelcontextprotocol/server-filesystem /tmp
```

### From source

```bash
git clone https://github.com/danfking/burnish.git
cd burnish
pnpm install
pnpm build
pnpm dev
```

Open `http://localhost:3000`. Your configured MCP servers appear with all their tools ready to use.

Configure your MCP servers in `apps/demo/mcp-servers.json`.

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
| **Works without LLM** | Yes | Yes | No | N/A | No |
| **Rich visualization** | Cards, tables, charts, metrics | Raw JSON | Limited | None (registry only) | Node output |
| **Any MCP server** | Yes | Yes | 500 pre-wrapped apps | Registry, no execution | Via custom nodes |
| **Auto-generated forms** | Yes (from schema) | Manual JSON input | Pre-built forms | No | Node config UI |
| **Local / private** | Yes, fully | Yes | Cloud-dependent | Cloud | Self-host (heavy) |
| **Setup time** | `npx burnish` | `npx` | Account + config | Browse only | Docker + config |
| **Composable** | Any server combo | Single server | Locked ecosystem | N/A | Workflow builder |

## Key Features

- Schema-driven tool discovery and form generation
- 10 web components: cards, tables, charts, forms, stat bars, metrics, sections, messages, actions, pipelines
- DOMPurify-sanitized rendering
- Works with any MCP server — filesystem, GitHub, databases, custom tools
- Framework-agnostic — standard web components, no React/Vue/Angular lock-in
- Themeable via `--burnish-*` CSS custom properties
- No build step required — import from CDN as ES modules
- Drill-down navigation with collapsible sections and session persistence

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

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@burnishdev/components/dist/index.js"></script>
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/@burnishdev/components/dist/tokens.css" />

<burnish-card
  title="API Gateway"
  status="success"
  body="All systems operational"
  meta='[{"label":"Uptime","value":"99.9%"},{"label":"Latency","value":"42ms"}]'
  item-id="api-gw-1">
</burnish-card>
```

### npm

```bash
npm install @burnishdev/components
```

```javascript
import '@burnishdev/components';

// Components auto-register with burnish-* prefix.
// Custom prefix:
import { BurnishCard } from '@burnishdev/components';
customElements.define('my-card', class extends BurnishCard {});
```

### Renderer

```bash
npm install @burnishdev/renderer
```

```javascript
import { findStreamElements, appendStreamElement } from '@burnishdev/renderer';

const elements = findStreamElements(chunk);
for (const el of elements) {
  appendStreamElement(container, stack, el, safeAttrs, sanitize);
}
```

## Configuration

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

All configured servers connect at startup. Their tools are available immediately.

## Development

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Start the demo
pnpm test             # Run Playwright tests
pnpm clean            # Clean all build artifacts
```

### Pre-release smoke test

`scripts/smoke-test.sh` (and `scripts/smoke-test.ps1` for Windows) verifies
that the **published** `burnish` npm package works end-to-end on a clean
machine. It is a pre-release verification gate, NOT a per-PR check — it
pulls `burnish@latest` from npm and only makes sense after a version has
been published.

Run manually:

```bash
bash scripts/smoke-test.sh
# or on Windows:
pwsh -File scripts/smoke-test.ps1
```

To test a specific version instead of `latest`:

```bash
BURNISH_SMOKE_PKG=burnish@0.2.0 bash scripts/smoke-test.sh
```

A ready-to-use GitHub Actions workflow lives at
`docs/smoke-test.workflow.yml.txt`. Maintainers can install it by copying
that file to `.github/workflows/smoke-test.yml`:

```bash
cp docs/smoke-test.workflow.yml.txt .github/workflows/smoke-test.yml
git add .github/workflows/smoke-test.yml
git commit -m "ci: install smoke-test workflow (#386)"
```

(It is shipped as a `.txt` template because adding workflow files requires
a token with the `workflow` OAuth scope, which routine contributor PRs do
not need to carry.)

Once installed, the workflow runs the same scripts on macOS, Windows, and
Ubuntu. It triggers on:

- `workflow_dispatch` — run manually from the Actions tab (accepts a
  `package` input to pin a specific version before promoting it).
- Any `v*` tag push — automatic post-release verification.

It is intentionally not triggered on push or pull_request.

```
burnish/
├── packages/
│   ├── components/       @burnishdev/components — 10 Lit web components
│   ├── renderer/         @burnishdev/renderer  — streaming parser + sanitizer
│   ├── app/              @burnishdev/app — drill-down logic + stream orchestration
│   ├── server/           @burnishdev/server — MCP hub + guards + intent resolver
│   └── cli/              @burnishdev/cli — npx burnish launcher
├── apps/
│   └── demo/
│       ├── server/       Hono API
│       └── public/       SPA shell (ES modules, no framework)
└── package.json          pnpm workspace root
```

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+

## How It Works

```
    ┌──────────────────────────────────┐
    │        MCP Servers                │
    │  (filesystem, GitHub, DB, ...)    │
    └──────────────┬───────────────────┘
                   │ tool calls / results
                   ▼
    ┌──────────────────────────┐
    │  Schema-Driven UI        │
    │                          │
    │  • List tools             │
    │  • Generate forms         │
    │  • Map results → comps    │
    └──────────┬───────────────┘
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

Burnish reads the MCP server's tool list, generates forms from JSON Schema, and maps results directly to components — no LLM in the loop. Everything runs locally.

## License

[AGPL-3.0](LICENSE) — Daniel King ([@danfking](https://github.com/danfking))
