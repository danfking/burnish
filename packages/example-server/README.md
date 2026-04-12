<p align="center">
  <img src="https://raw.githubusercontent.com/danfking/burnish/main/apps/demo/public/logo.png" alt="Burnish" width="120">
</p>

<h1 align="center">@burnishdev/example-server</h1>

<p align="center">
  <em>Example MCP server showcasing Burnish components with demo tools.</em>
</p>

---

## Install

```bash
npm install -g @burnishdev/example-server
# or run ad-hoc:
npx @burnishdev/example-server
```

## Usage

Point Burnish (or any MCP client) at the `burnish-example-server` binary:

```bash
npx burnish -- npx @burnishdev/example-server
```

Or wire it into an `mcp-servers.json`:

```json
{
  "mcpServers": {
    "example": {
      "command": "npx",
      "args": ["-y", "@burnishdev/example-server"]
    }
  }
}
```

## What this is

A stdio-based MCP server with a handful of demo tools (project info, user lists, metrics, charts) that return data shaped to exercise every component in [Burnish](https://github.com/danfking/burnish). Use it to try out the Explorer UI, build recipes, or develop new components against predictable output — no real backend required.

## Links

- [Burnish monorepo](https://github.com/danfking/burnish)
- [Documentation](https://github.com/danfking/burnish#readme)
- [Report an issue](https://github.com/danfking/burnish/issues)
