# MCPUI — Universal UI Layer for MCP Servers

A component library + streaming renderer + demo app that connects to any MCP server and renders navigable visual dashboards from LLM tool call results.

## Quick Start

```bash
pnpm install
pnpm build

# Option 1: Use Claude Code CLI auth (no API key needed)
pnpm dev:cli

# Option 2: Use direct API key
ANTHROPIC_API_KEY=sk-... pnpm dev
```

### LLM Backend Selection
- `LLM_BACKEND=cli` — Spawns `claude` CLI subprocess, uses your Claude Code subscription auth. No API key needed. Tools are pre-fetched into context (no tool-call loop).
- `LLM_BACKEND=api` (default when ANTHROPIC_API_KEY is set) — Direct Anthropic SDK with streaming tool-call loop (5 rounds max).
- If no API key and no explicit backend, defaults to `cli`.

## Architecture

```
mcpui/
├── packages/
│   ├── components/     # @mcpui/components — Lit web components (card, table, chart, etc.)
│   └── renderer/       # @mcpui/renderer — streaming HTML parser, sanitizer, component mapper
├── apps/
│   └── demo/           # Demo app — Hono backend + vanilla HTML frontend
│       ├── server/     # LLM orchestrator, MCP client hub, API endpoints
│       └── public/     # SPA shell, app.js orchestration
├── package.json        # pnpm workspace root
└── CLAUDE.md           # this file
```

## Conventions

- **TypeScript** for all packages and server code
- **Lit 3** for web components (extends LitElement)
- **CSS custom properties** with `--mcpui-*` prefix for theming
- **JSON string attributes** on components (parsed internally, graceful degradation)
- **pnpm workspaces** — `packages/` for publishable libs, `apps/` for demo
- **Tag prefix `mcpui-`** — generic, not branded
- Components emit `CustomEvent` for interactions (e.g. `mcpui-card-action`)
- No framework dependency — works in React, Vue, Angular, vanilla

## Key Design Decisions

1. **System prompt as the mapper** — the LLM is instructed which components to use via system prompt. Component-mapper is supplementary auto-inference for raw JSON
2. **Configurable tag prefix** in renderer — default `mcpui-`, but consumers can set e.g. `xm-` for their own branding
3. **No build step for consumers** — CDN-importable ES modules, optional npm install
4. **Container tags** (like `mcpui-section`) nest children and stream progressively; leaf tags render as complete units

## Component Reference

| Component | Tag | Key Attributes |
|-----------|-----|---------------|
| Status Card | `<mcpui-card>` | title, status, body, meta (JSON), item-id |
| Stat Bar | `<mcpui-stat-bar>` | items (JSON: [{label, value, color?}]) |
| Data Table | `<mcpui-table>` | title, columns (JSON), rows (JSON), status-field |
| Chart | `<mcpui-chart>` | type (line\|bar\|doughnut), config (JSON Chart.js config) |
| Section | `<mcpui-section>` | label, count, status, collapsed |
| Metric | `<mcpui-metric>` | label, value, unit, trend (up\|down\|flat) |
| Message | `<mcpui-message>` | role (user\|assistant), content, streaming |

Status values: `success`, `warning`, `error`, `muted` (maps to semantic colors)

## Implementation Plan & Progress

### Day 0: Repo + Plan
- [x] Create GitHub repo (danfking/mcpui)
- [x] Write CLAUDE.md with full plan
- [x] Initial commit with project structure

### Day 1: Project Scaffold + Core Components
- [x] **1.1** pnpm workspace, tsconfig base, package.json files
- [x] **1.2** Design tokens (`packages/components/src/tokens.css`) — `--mcpui-*` CSS custom props
- [x] **1.3** Core components (TypeScript Lit):
  - [x] `<mcpui-card>` — status card with drill-down event
  - [x] `<mcpui-stat-bar>` — horizontal metric chips
  - [x] `<mcpui-table>` — data table with status coloring
  - [x] `<mcpui-chart>` — Chart.js wrapper
  - [x] `<mcpui-section>` — collapsible section with grid
  - [x] `<mcpui-metric>` — single KPI display
  - [x] `<mcpui-message>` — chat bubble
  - [x] `index.ts` barrel export
- [x] Build succeeds (`pnpm build`)

### Day 2: Streaming Renderer
- [x] **2.1** Stream parser — `findStreamElements()` + `appendStreamElement()`
- [x] **2.2** Sanitizer — DOMPurify config auto-generated from component registry
- [x] **2.3** Component mapper — `inferComponent(data)` auto-selects component from JSON shape
- [x] **2.4** Chat client — SSE EventSource with cancel/abort support

### Day 3: Demo App Backend
- [x] **3.1** MCP client hub — `@modelcontextprotocol/sdk`, reads `mcp-servers.json`
- [x] **3.2** LLM orchestrator — Anthropic SDK, tool-call loop (5 rounds max), SSE streaming
- [x] **3.3** Hono API server — `/api/chat`, `/api/chat/:id/stream`, `/api/servers`
- [x] **3.4** System prompt template — generic component docs, exportable for extension

### Day 4: Demo App Frontend + Drill-Down
- [x] **4.1** SPA shell — two-pane layout (content + chat sidebar), prompt bar
- [x] **4.2** App orchestration — streaming → progressive rendering, skeleton states
- [x] **4.3** Drill-down — card click → contextual follow-up prompt → recursive render + breadcrumb trail
- [ ] **4.4** MCP server config panel (stretch)

### Day 5: Integration Testing + Polish
- [ ] **5.1** Demo with filesystem MCP server
- [ ] **5.2** Demo with GitHub MCP server (stretch)
- [ ] **5.3** Demo with SQLite MCP server (stretch)
- [ ] **5.4** README with screenshots, getting started guide

## Verification Checklist

1. `pnpm build` — all packages compile
2. `pnpm dev` — demo app starts, connects to MCP server
3. Submit prompt → streaming component rendering works
4. Click card → drill-down triggers follow-up → new components render
5. Components styled correctly via design tokens
6. Different MCP servers produce different tool sets and data
7. Components importable via CDN (no build step)

## How Other Projects Consume This

```html
<!-- CDN (simplest) -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@mcpui/components/dist/index.js"></script>
```

```javascript
// npm install @mcpui/components
// Re-register with custom prefix if needed:
import { McpuiCard } from '@mcpui/components';
customElements.define('xm-card', class extends McpuiCard {});
```

Consumer keeps: their own backend, system prompt, tool definitions, branding.
Consumer imports: component library + optionally the renderer.
