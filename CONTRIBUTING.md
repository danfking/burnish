# Contributing to Burnish

Thanks for your interest in contributing to Burnish! This guide will help you get started.

## Getting Started

```bash
git clone https://github.com/danfking/burnish.git
cd burnish
pnpm install
pnpm build
pnpm dev:nomodel  # Start Explorer mode (no LLM needed)
```

Open http://localhost:3000 to see the app.

## Reporting Issues

- **Bugs**: Use the [Bug Report](https://github.com/danfking/burnish/issues/new?template=bug.md) template
- **Features**: Use the [Feature Request](https://github.com/danfking/burnish/issues/new?template=feature.md) template

## Development Workflow

1. **Create an issue** first — every change starts as a GitHub issue
2. **Branch from main**: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or `chore/<issue>-<slug>`
3. **Build and test**: `pnpm build` must pass with zero errors
4. **Create a PR** linked to the issue with `Closes #N`
5. **Review**: The maintainer reviews all PRs before merging

## Branch Naming

```
feat/42-add-tooltip        # New features
fix/15-chart-rendering     # Bug fixes
chore/30-update-deps       # Maintenance
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(components): add tooltip component
fix(renderer): resolve streaming parser race condition
chore: update dependencies
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `ci`, `build`

## Code Style

- **TypeScript** for all packages and server code
- **Lit 3** for web components (extends `LitElement`)
- **CSS custom properties** with `--burnish-*` prefix
- **Tag prefix** `burnish-` for all custom elements
- **No framework dependencies** — works in React, Vue, Angular, vanilla

## Project Structure

```
packages/
  components/   # @burnishdev/components — Lit web components
  renderer/     # @burnishdev/renderer — streaming HTML parser
  server/       # @burnishdev/server — MCP hub + LLM orchestrator
  app/          # @burnishdev/app — headless SDK
  cli/          # burnish — CLI tool
apps/
  demo/         # Demo app shell
```

## Pull Request Checklist

- [ ] `pnpm build` passes
- [ ] PR title follows conventional commit format
- [ ] PR body includes `Closes #N` linking the issue
- [ ] Visual changes include screenshots (light + dark mode)
- [ ] No unrelated changes included

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
