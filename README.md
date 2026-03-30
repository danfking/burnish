# Burnish

**A universal UI layer for MCP servers.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![npm: @burnish/components](https://img.shields.io/badge/npm-@burnish/components-cb3837.svg)](https://www.npmjs.com/package/@burnish/components)
[![npm: @burnish/renderer](https://img.shields.io/badge/npm-@burnish/renderer-cb3837.svg)](https://www.npmjs.com/package/@burnish/renderer)

> Demo screenshots coming soon.

---

## What is this?

Burnish is a component library, streaming renderer, and demo application that turns any [Model Context Protocol](https://modelcontextprotocol.io/) server into a navigable, interactive UI. Point it at an MCP server, ask a question in natural language, and get back dashboards, forms, data tables, charts, and action buttons -- not a wall of JSON. Read and write operations are both supported: view data with cards and tables, mutate it with forms.

The core idea is simple: instead of teaching an LLM to generate complex framework-specific code, you give it a small vocabulary of web components via a system prompt. The LLM writes HTML using those components, and the renderer streams the output progressively into the browser. The components handle all styling, interaction, and drill-down navigation. This works with **any** MCP server -- filesystem, GitHub, databases, custom internal tools -- without writing a single line of server-specific UI code.

Burnish ships as two independently publishable npm packages (`@burnish/components` and `@burnish/renderer`) plus a demo app that wires everything together with an LLM backend. You can use the components on their own, use the renderer for streaming, or run the full demo to see it all in action.

## Key Features

- **9 web components** built with [Lit 3](https://lit.dev/) -- cards, tables, charts, forms, action bars, metrics, and more
- **Progressive streaming** -- components render as the LLM generates them, not after it finishes
- **Drill-down navigation** -- click any card to trigger a contextual follow-up query; results append below with collapsible sections
- **Works with any MCP server** -- filesystem, GitHub, SQLite, or your own custom tools
- **Framework-agnostic** -- standard web components that work in React, Vue, Angular, Svelte, or vanilla HTML
- **No build step required** -- import from CDN as ES modules, or install via npm
- **Themeable** -- all styling via `--burnish-*` CSS custom properties
- **LLM-as-the-mapper** -- the system prompt teaches the LLM which components to use; no brittle mapping code
- **Two LLM backends** -- direct Anthropic API with streaming tool-call loop, or Claude CLI for zero-config auth
- **Collapsible sections** with auto-summary, session persistence, and sidebar-to-section linking

## Quick Start

```bash
# Clone and install
git clone https://github.com/danfking/burnish.git
cd burnish
pnpm install
pnpm build

# Option 1: Use Claude Code CLI auth (no API key needed)
pnpm dev:cli

# Option 2: Use direct Anthropic API key
ANTHROPIC_API_KEY=sk-ant-... pnpm dev
```

The demo app starts at `http://localhost:3000`. Configure your MCP servers in `apps/demo/mcp-servers.json`, then ask a question.

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- For CLI backend: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- For API backend: an Anthropic API key

## Architecture

```
burnish/
├── packages/
│   ├── components/       @burnish/components — 9 Lit web components
│   └── renderer/         @burnish/renderer  — streaming parser, sanitizer, component mapper
├── apps/
│   └── demo/
│       ├── server/       Hono API + LLM orchestrator + MCP client hub
│       └── public/       SPA shell (vanilla JS, no framework)
└── package.json          pnpm workspace root
```

**Layer 1: Components** (`@burnish/components`) -- Self-contained Lit elements with shadow DOM, CSS custom property theming, and JSON string attributes. Each component parses its own data, handles errors gracefully, and emits `CustomEvent`s for interactions.

**Layer 2: Renderer** (`@burnish/renderer`) -- A streaming HTML parser that identifies component tags as they arrive from an LLM response. Container tags like `<burnish-section>` emit open/close events so their children can render individually as they stream in. Includes a DOMPurify-based sanitizer and a component mapper that can auto-infer the right component from raw JSON.

**Layer 3: Demo App** -- A Hono backend that connects to MCP servers via `@modelcontextprotocol/sdk`, orchestrates tool-call loops with the Anthropic API (or Claude CLI), and streams results as SSE. The frontend progressively renders components, manages drill-down navigation with browser history, and persists sessions to localStorage.

## Component Reference

| Component | Tag                | Key Attributes                                           | Purpose                           |
|-----------|--------------------|----------------------------------------------------------|-----------------------------------|
| Card      | `<burnish-card>`     | `title`, `status`, `body`, `meta` (JSON), `item-id`      | Individual items with drill-down  |
| Stat Bar  | `<burnish-stat-bar>` | `items` (JSON: `[{label, value, color?}]`)               | Summary metrics / filter pills    |
| Table     | `<burnish-table>`    | `title`, `columns` (JSON), `rows` (JSON), `status-field` | Tabular data with status coloring |
| Chart     | `<burnish-chart>`    | `type` (line/bar/doughnut), `config` (JSON)              | Chart.js visualizations           |
| Section   | `<burnish-section>`  | `label`, `count`, `status`, `collapsed`                  | Collapsible grouping container    |
| Metric    | `<burnish-metric>`   | `label`, `value`, `unit`, `trend` (up/down/flat)         | Single KPI display                |
| Message   | `<burnish-message>`  | `role` (user/assistant), `content`, `streaming`          | Chat bubbles                      |
| Form      | `<burnish-form>`     | `title`, `tool-id`, `fields` (JSON)                      | User input for write operations   |
| Actions   | `<burnish-actions>`  | `actions` (JSON: `[{label, action, prompt, icon?}]`)     | Contextual next-step buttons      |

**Status values:** `success`, `warning`, `error`, `muted`, `info` -- mapped to semantic colors via CSS custom properties.

**Action types** (on `burnish-actions`): `read` (auto-invoke, safe) and `write` (shows form, needs user input).

## How It Works

```
User prompt
       │
       ▼
┌─────────────────────────────────────┐
│  LLM (with system prompt that       │
│  documents all burnish-* components)  │
│                                     │
│  1. Calls MCP tools to get data     │
│  2. Generates HTML using            │
│     burnish-* web components          │
│  3. Streams the response via SSE    │
└─────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Streaming Renderer                 │
│                                     │
│  • Parses tags as they arrive       │
│  • Sanitizes via DOMPurify          │
│  • Appends to DOM progressively     │
└─────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Web Components                     │
│                                     │
│  • Parse JSON attributes            │
│  • Render with shadow DOM           │
│  • Emit events for drill-down       │
└─────────────────────────────────────┘
```

The system prompt is the key integration point. It teaches the LLM the component vocabulary -- which tags exist, what attributes they accept, and when to use each one. The LLM then generates the right HTML for whatever data it retrieves from MCP tools. This approach is more robust than rule-based mapping because the LLM can make contextual decisions about layout and grouping.

When a user clicks a card's "Explore" button, the frontend dispatches a follow-up prompt with context about the clicked item. The LLM calls the appropriate tool, generates new components, and the renderer appends them below the previous results -- building up a navigable trail of exploration.

## Use in Your Own Project

### CDN (no build step)

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@burnish/components/dist/index.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@burnish/components/dist/tokens.css" />

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
npm install @burnish/components
```

```javascript
import '@burnish/components';

// Components auto-register with burnish-* prefix.
// To use a custom prefix:
import { BurnishCard } from '@burnish/components';
customElements.define('my-card', class extends BurnishCard {});
```

### Renderer (optional)

```bash
npm install @burnish/renderer
```

```javascript
import { findStreamElements, appendStreamElement } from '@burnish/renderer';

// Parse streaming LLM output into renderable elements
const elements = findStreamElements(chunk);
for (const el of elements) {
  appendStreamElement(container, stack, el, safeAttrs, sanitize);
}
```

### System Prompt

The demo app includes an exportable system prompt template you can reuse or extend:

```javascript
// From within the repo or after copying prompt-template.ts to your project
import { buildSystemPrompt } from './prompt-template.js';

const prompt = buildSystemPrompt('Your additional domain-specific instructions here.');
```

## Configuration

### LLM Backend

| Mode | Env Var                        | Description                                                           |
|------|--------------------------------|-----------------------------------------------------------------------|
| API  | `ANTHROPIC_API_KEY=sk-ant-...` | Direct Anthropic SDK with streaming tool-call loop (5 rounds max)     |
| CLI  | `LLM_BACKEND=cli`              | Spawns Claude CLI subprocess; uses your Claude Code subscription auth |
| Auto | *(none)*                       | Defaults to CLI if no API key is set                                  |

### MCP Servers

Configure connected MCP servers in `apps/demo/mcp-servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    }
  }
}
```

The demo app connects to all configured servers at startup and makes their tools available to the LLM.

## Development

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Start demo app with file watcher
pnpm clean            # Clean all build artifacts
```

The workspace uses pnpm workspaces. Changes to `packages/components` or `packages/renderer` require a rebuild (`pnpm build`) before the demo app picks them up.

## License

[AGPL-3.0](LICENSE) -- Daniel King ([@danfking](https://github.com/danfking))
