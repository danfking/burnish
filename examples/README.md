# Burnish Examples

Runnable examples that verify every README usage pattern works.

## Tier 1 — No external dependencies

These examples only need Node.js and the `@modelcontextprotocol/server-filesystem` MCP server (installed on demand via `npx`).

| Example | What it tests | How to run |
|---------|---------------|------------|
| `explorer-mode.sh` | CLI Explorer mode with a stdio MCP server | `bash explorer-mode.sh` |
| `config-file-mode/` | `--config mcp-servers.json` startup | `cd config-file-mode && bash run.sh` |
| `schema-export.sh` | `burnish export` JSON output | `bash schema-export.sh` |
| `cdn-components.html` | CDN import of web components | Open in a browser |
| `npm-import/` | `npm install` + ESM import | `cd npm-import && npm install && node test.mjs` |
| `middleware-sdk/` | `@burnishdev/server` McpHub import | `cd middleware-sdk && npm install && node test.mjs` |

## Prerequisites

- Node.js 20+
- For CLI examples: `pnpm build` from the repo root (so `packages/cli/dist/` exists)
- For npm examples: internet access to install packages

## Running all CLI examples

```bash
# From repo root
pnpm build

# Then run each example
cd examples
bash explorer-mode.sh
bash schema-export.sh
cd config-file-mode && bash run.sh && cd ..
```

Each script prints `PASS` or `FAIL` with a short description.
