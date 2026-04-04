# Burnish Contribution Rules

These rules apply to all contributions, whether by humans or AI agents.

## Issue-First Development
Every change starts as a GitHub issue. No code changes without a linked issue.

## Branch Naming
```
fix/<issue>-<slug>     # Bug fixes
feat/<issue>-<slug>    # New features
chore/<issue>-<slug>   # Maintenance, CI, docs
```
Example: `fix/142-card-grid-layout`

## Commit Message Format
```
type(scope): description (#issue)

Optional body explaining why, not what.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**Types**: feat, fix, refactor, docs, test, chore, style, perf, ci, build

Enforced by `.githooks/commit-msg` — never use `--no-verify`.

## Pull Request Requirements

### PR Title
Same format as commit: `type(scope): description`

### PR Body Template
```markdown
## Summary
Fixes #N / Closes #N

## Root Cause
[What was wrong — for bug fixes]

## Fix / Changes
[What was changed and why this approach]

## Verification
[For visual changes: Playwright screenshot at relevant viewport]
Screenshot: `tests/visual/screenshots/verify-<issue>.png`

## Test Plan
- [ ] `pnpm build` passes
- [ ] `npx playwright test` passes (headless)
- [ ] Visual verification screenshot confirms fix (if applicable)
```

### Build Gates
These must pass before creating a PR:
1. `pnpm build` — zero TypeScript errors
2. `npx playwright test` — all tests pass in headless mode

### Visual Verification
For any change that affects the UI (skip for non-visual changes):
1. Take a Playwright screenshot (headless) of the affected area
2. Save to `tests/visual/screenshots/verify-<issue>.png`
3. Reference the screenshot in the PR body
4. Analyze the screenshot to confirm the fix looks correct

Note: `tests/visual/screenshots/` is gitignored. Screenshots exist for PR verification only and are not committed to the repo.

## Code Review
- PRs are NEVER auto-merged
- The maintainer reviews all changes
- Address review feedback before re-requesting review
- Unrelated changes should be in separate PRs

## AI Agent Standards
When AI agents contribute:
- Always use `isolation: "worktree"` to prevent branch mixing
- Always run in headless mode (no visible browser windows)
- Always include `Co-Authored-By` attribution
- Never make assumptions about merge — create PR and stop
