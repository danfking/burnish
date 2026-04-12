<p align="center">
  <img src="https://raw.githubusercontent.com/danfking/burnish/main/apps/demo/public/logo.png" alt="Burnish" width="120">
</p>

<h1 align="center">@burnishdev/components</h1>

<p align="center">
  <em>Lit web components for rendering MCP tool call results — cards, tables, charts, forms, and more.</em>
</p>

---

## Install

```bash
npm install @burnishdev/components
```

## Usage

Import the package once — all components auto-register with the `burnish-` prefix.

```html
<script type="module">
  import '@burnishdev/components';
</script>

<burnish-card
  title="API Gateway"
  status="success"
  body="All systems operational"
  meta='[{"label":"Uptime","value":"99.9%"},{"label":"Latency","value":"42ms"}]'
  item-id="api-gw-1">
</burnish-card>
```

Or import specific classes to extend or re-register under a custom tag:

```js
import { BurnishCard, BurnishTable, BurnishChart } from '@burnishdev/components';
```

## What this is

The component library behind [Burnish](https://github.com/danfking/burnish) — a set of 10 themeable Lit 3 web components (`burnish-card`, `burnish-table`, `burnish-chart`, `burnish-stat-bar`, `burnish-metric`, `burnish-section`, `burnish-message`, `burnish-form`, `burnish-actions`, `burnish-pipeline`) that render MCP tool-call output as rich UI. Each component takes JSON attributes, lives in Shadow DOM, and is themeable via `--burnish-*` CSS custom properties. Framework-agnostic — works anywhere standard custom elements do.

## Links

- [Burnish monorepo](https://github.com/danfking/burnish)
- [Documentation](https://github.com/danfking/burnish#readme)
- [Report an issue](https://github.com/danfking/burnish/issues)
