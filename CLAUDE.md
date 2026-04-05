# Burnish — Universal UI Layer for MCP Servers

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
- `LLM_BACKEND=api` (default when ANTHROPIC_API_KEY is set) — Direct Anthropic SDK with streaming tool-call loop (8 rounds max).
- `LLM_BACKEND=openai` — OpenAI-compatible API (Ollama, llama.cpp, vLLM, LM Studio, OpenAI). Streaming tool-call loop (8 rounds max).
- If no API key and no explicit backend, defaults to `cli`.

### Local Model Support (OpenAI Backend)

Run Burnish with local models via Ollama:

```bash
# Install Ollama (https://ollama.com)
ollama pull qwen2.5:7b

# Start Burnish with local model
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5:7b LLM_BACKEND=openai pnpm dev
```

**Recommended local models** (benchmarked for tool calling + burnish-* component output):

| Model | Size | Tool Calling | Component Output | Speed | Best For |
|-------|------|-------------|-----------------|-------|----------|
| **Qwen 2.5 7B** (recommended) | 4.7GB | ✅ Reliable | 11/15 | ~2s/req | Best overall for Burnish |
| Llama 3.1 8B | 4.9GB | ✅ Reliable | 12/15 | ~3s/req | Highest component accuracy |
| Llama 3.2 3B | 2.0GB | ✅ Reliable | 12/15 | ~1s/req | Low-resource / mobile |
| Phi-4 Mini | 2.5GB | ❌ Broken | 11/15 | ~1.5s/req | Not recommended (no tool calling) |

**Minimum requirements**: 8GB RAM for 7B models, 4GB for 3B models. GPU optional but recommended.

### MCP Transport

Burnish supports both stdio (local) and Streamable HTTP (remote) MCP server transports. Auto-detected from config:

```json
{
  "mcpServers": {
    "local-fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"] },
    "remote-api": { "url": "https://mcp.example.com/api", "headers": { "Authorization": "Bearer token" } }
  }
}
```

## Development Workflow

Every change follows: **Issue → Branch → PR → Squash Merge**

### Issue-Driven Development
Every change starts as a GitHub issue. Use `/dev <issue>` to begin work or `/dev "title"` to create an issue and start.

### Branch Naming
```
feat/<issue>-<slug>    # New features
fix/<issue>-<slug>     # Bug fixes
chore/<issue>-<slug>   # Maintenance, CI, docs
```
Example: `feat/42-add-tooltip-component`

### Conventional Commits
All commit messages must follow `type(scope): description`:
- **Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `ci`, `build`
- **Scope** is optional: `feat(components): add tooltip`, `fix: resolve race condition`
- Enforced by `.githooks/commit-msg` — never use `--no-verify`

### Workflow Commands
- `/dev 42` or `/dev "add tooltip"` — start work on an issue (branch + worktree)
- `/review` — run pre-ship checks (build, secrets, conventions)
- `/ship` — push branch, create PR, output merge command (does NOT auto-merge)

### PR Process
1. Work in a feature branch (created by `/dev`)
2. Run `/review` to check for issues
3. Run `/ship` to create the PR
4. Review the PR, then merge with: `gh pr merge <N> --squash --delete-branch`

## Architecture

```
burnish/
├── packages/
│   ├── components/     # @burnish/components — Lit web components (card, table, chart, etc.)
│   ├── renderer/       # @burnish/renderer — streaming HTML parser, sanitizer, component mapper
│   ├── server/         # @burnish/server — MCP hub, LLM orchestrator, conversation store
│   └── app/            # @burnish/app — headless SDK: nav tree, sessions, streaming, output transform
├── apps/
│   └── demo/           # Thin demo shell — Hono routes + DOM rendering/events
│       ├── server/     # index.ts (~200 LOC Hono wrapper over @burnish/server)
│       └── public/     # SPA shell, app.js (DOM-only, imports @burnish/app + @burnish/renderer)
├── package.json        # pnpm workspace root
└── CLAUDE.md           # this file
```

### Package Responsibilities
- **@burnish/components** — Lit web components, publishable to npm/CDN
- **@burnish/renderer** — Stream parser, HTML sanitizer config, component mapper
- **@burnish/server** — `McpHub` (MCP client management), `LlmOrchestrator` (dual CLI/API backends), `ConversationStore`, guards, catalog, prompt template
- **@burnish/app** — Framework-agnostic headless SDK: `SessionStore` (IndexedDB), `StreamOrchestrator` (SSE), navigation tree utils, output transformer, drill-down helpers, summary utils

## Conventions

- **TypeScript** for all packages and server code
- **Lit 3** for web components (extends LitElement)
- **CSS custom properties** with `--burnish-*` prefix for theming
- **JSON string attributes** on components (parsed internally, graceful degradation)
- **pnpm workspaces** — `packages/` for publishable libs, `apps/` for demo
- **Tag prefix `burnish-`** — generic, not branded
- Components emit `CustomEvent` for interactions (e.g. `burnish-card-action`)
- No framework dependency — works in React, Vue, Angular, vanilla

## Key Design Decisions

1. **System prompt as the mapper** — the LLM is instructed which components to use via system prompt. Component-mapper is supplementary auto-inference for raw JSON
2. **Configurable tag prefix** in renderer — default `burnish-`, but consumers can set e.g. `xm-` for their own branding
3. **No build step for consumers** — CDN-importable ES modules, optional npm install
4. **Container tags** (like `burnish-section`) nest children and stream progressively; leaf tags render as complete units

## Component Reference

| Component | Tag | Key Attributes |
|-----------|-----|---------------|
| Status Card | `<burnish-card>` | title, status, body, meta (JSON), item-id |
| Stat Bar | `<burnish-stat-bar>` | items (JSON: [{label, value, color?}]) |
| Data Table | `<burnish-table>` | title, columns (JSON), rows (JSON), status-field |
| Chart | `<burnish-chart>` | type (line\|bar\|doughnut), config (JSON Chart.js config) |
| Section | `<burnish-section>` | label, count, status, collapsed |
| Metric | `<burnish-metric>` | label, value, unit, trend (up\|down\|flat) |
| Message | `<burnish-message>` | role (user\|assistant), content, streaming |

Status values: `success`, `warning`, `error`, `muted` (maps to semantic colors)

## Implementation Plan & Progress

### Day 0: Repo + Plan
- [x] Create GitHub repo (danfking/burnish)
- [x] Write CLAUDE.md with full plan
- [x] Initial commit with project structure

### Day 1: Project Scaffold + Core Components
- [x] **1.1** pnpm workspace, tsconfig base, package.json files
- [x] **1.2** Design tokens (`packages/components/src/tokens.css`) — `--burnish-*` CSS custom props
- [x] **1.3** Core components (TypeScript Lit):
  - [x] `<burnish-card>` — status card with drill-down event
  - [x] `<burnish-stat-bar>` — horizontal metric chips
  - [x] `<burnish-table>` — data table with status coloring
  - [x] `<burnish-chart>` — Chart.js wrapper
  - [x] `<burnish-section>` — collapsible section with grid
  - [x] `<burnish-metric>` — single KPI display
  - [x] `<burnish-message>` — chat bubble
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
- [x] **5.1** Demo with filesystem MCP server (CLI + real MCP tool calling works)
- [ ] **5.2** Demo with GitHub MCP server (stretch)
- [ ] **5.3** Demo with SQLite MCP server (stretch)
- [ ] **5.4** README with screenshots, getting started guide

### Navigation UX (Post-MVP)
- [x] **N.1** Append-below rendering (sections instead of replace)
- [x] **N.2** Collapse/expand with auto-summary generation
- [x] **N.3** Browser history (pushState/popstate for back/forward)
- [x] **N.4** Persistence (localStorage save/restore)
- [x] **N.5** Sidebar ↔ section linking (click message → scroll to section)
- [ ] **N.6** Branching (fork from previous node)

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
<script type="module" src="https://cdn.jsdelivr.net/npm/@burnish/components/dist/index.js"></script>
```

```javascript
// npm install @burnish/components
// Re-register with custom prefix if needed:
import { BurnishCard } from '@burnish/components';
customElements.define('xm-card', class extends BurnishCard {});
```

Consumer keeps: their own backend, system prompt, tool definitions, branding.
Consumer imports: component library + optionally the renderer.

