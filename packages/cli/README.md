<p align="center">
  <img src="https://raw.githubusercontent.com/danfking/burnish/main/apps/demo/public/logo.png" alt="Burnish" width="120">
</p>

<h1 align="center">burnish</h1>

<p align="center">
  <em>Swagger UI for MCP servers — explore, test, and visualize any MCP server from one command.</em>
</p>

---

## Install

```bash
npm install -g burnish
# or run ad-hoc:
npx burnish -- npx @modelcontextprotocol/server-filesystem /tmp
```

## Usage

Point Burnish at any MCP server command and open the UI in your browser:

```bash
# Explorer mode — no LLM, instant tool execution
npx burnish -- npx @modelcontextprotocol/server-filesystem /tmp

# LLM Insight mode — natural language + tool orchestration
npx burnish --llm=cli -- npx @modelcontextprotocol/server-filesystem /tmp
```

Or embed the server programmatically:

```ts
import { McpHub } from '@burnishdev/server';
import { startServerWithHub, withBurnishUI } from 'burnish';

const hub = new McpHub();
await hub.initialize('./mcp-servers.json');
await startServerWithHub(hub, { port: 4000 });
```

`withBurnishUI(server, { port })` attaches the Burnish explorer to an existing MCP server in one line.

## What this is

The CLI and embeddable web server for [Burnish](https://github.com/danfking/burnish). Launches a local UI against any MCP server config — auto-generating forms from tool schemas and rendering results as rich components. Runs fully offline in Explorer mode; add an LLM backend (Anthropic API, Claude CLI, or OpenAI-compatible) for natural-language queries and multi-tool orchestration.

## Links

- [Burnish monorepo](https://github.com/danfking/burnish)
- [Documentation](https://github.com/danfking/burnish#readme)
- [Report an issue](https://github.com/danfking/burnish/issues)
