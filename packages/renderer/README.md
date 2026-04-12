<p align="center">
  <img src="https://raw.githubusercontent.com/danfking/burnish/main/apps/demo/public/logo.png" alt="Burnish" width="120">
</p>

<h1 align="center">@burnishdev/renderer</h1>

<p align="center">
  <em>Streaming HTML parser, sanitizer, and component mapper for the Burnish component vocabulary.</em>
</p>

---

## Install

```bash
npm install @burnishdev/renderer
```

## Usage

Parse a streaming chunk of LLM-generated HTML and append each element to the DOM as it arrives:

```js
import {
  findStreamElements,
  appendStreamElement,
  buildSanitizerConfig,
} from '@burnishdev/renderer';
import DOMPurify from 'dompurify';

const safeAttrs = buildSanitizerConfig();
const stack = [];

function onChunk(chunk, container) {
  const elements = findStreamElements(chunk);
  for (const el of elements) {
    appendStreamElement(container, stack, el, safeAttrs, (html) =>
      DOMPurify.sanitize(html, safeAttrs)
    );
  }
}
```

Also exports `inferComponent` (map raw tool results to components), `convertMarkdownToComponents` (markdown fallback), and `createValidator` (validate component HTML).

## What this is

The render engine for [Burnish](https://github.com/danfking/burnish). It parses `<burnish-*>` tags out of a streaming byte stream, sanitizes them via a DOMPurify-compatible allowlist, and maps raw MCP tool results onto component suggestions. Used by both the demo UI and any app that wants to stream Burnish components from an LLM.

## Links

- [Burnish monorepo](https://github.com/danfking/burnish)
- [Documentation](https://github.com/danfking/burnish#readme)
- [Report an issue](https://github.com/danfking/burnish/issues)
