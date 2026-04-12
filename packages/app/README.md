<p align="center">
  <img src="https://raw.githubusercontent.com/danfking/burnish/main/apps/demo/public/logo.png" alt="Burnish" width="120">
</p>

<h1 align="center">@burnishdev/app</h1>

<p align="center">
  <em>Framework-agnostic headless SDK for Burnish — sessions, navigation, streaming, and output transformation.</em>
</p>

---

## Install

```bash
npm install @burnishdev/app
```

## Usage

Persist sessions and walk the drill-down navigation tree:

```ts
import {
  SessionStore,
  StreamOrchestrator,
  transformOutput,
  getActivePath,
} from '@burnishdev/app';

const sessions = new SessionStore();
const session = sessions.create({ title: 'Incident triage' });

const orchestrator = new StreamOrchestrator();
await orchestrator.run({
  sessionId: session.id,
  prompt: 'Show open incidents',
  onChunk: (chunk) => console.log(chunk),
});

const path = getActivePath(session.tree);
```

Also exports `generateSummary`, `assessToolRisk`, `PerfStore`, `TemplateStore`, `PromptLibrary`, and `generateFallbackForm` — the building blocks behind the Burnish demo UI.

## What this is

The headless application layer of [Burnish](https://github.com/danfking/burnish). It owns the drill-down tree, session persistence, stream orchestration, output transformation, risk assessment, and learned-template storage — everything between the raw MCP / LLM stream and the rendered components. Framework-agnostic; the demo SPA and any future Burnish frontend consume this package.

## Links

- [Burnish monorepo](https://github.com/danfking/burnish)
- [Documentation](https://github.com/danfking/burnish#readme)
- [Report an issue](https://github.com/danfking/burnish/issues)
