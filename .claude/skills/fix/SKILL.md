---
name: fix
description: Fix a GitHub issue — branch, implement, build, verify with Playwright screenshot, create PR
disable-model-invocation: true
allowed-tools: Bash Read Write Edit Glob Grep Agent
argument-hint: "<issue-number>"
---

# Fix GitHub Issue #$ARGUMENTS

Follow the Burnish contribution workflow to fix this issue.

## 1. Understand the Issue
```bash
gh issue view $ARGUMENTS
```
Read the issue description, understand the root cause, identify the files that need to change.

## 2. Create Feature Branch
```bash
git checkout -b fix/$ARGUMENTS-<slug-from-title>
```
Use the issue title to create a descriptive slug (lowercase, hyphens, max 40 chars).

## 3. Implement the Fix
- Read the relevant source files identified in the issue
- Make minimal, focused changes that address the root cause
- Follow existing code patterns and conventions from @CLAUDE.md
- Do not add unrelated changes or "improvements"

## 4. Build Gate
```bash
pnpm build
```
Must pass with zero errors before proceeding.

## 5. Test Gate
```bash
npx playwright test
```
All existing tests must pass. **Playwright must run in headless mode (default). Never use --headed.**

## 6. Visual Verification (if applicable)
Skip this step for non-visual changes (e.g., backend-only, docs, config).

For visual/UI fixes, take a Playwright screenshot verifying the fix:
- Write a small Playwright script that navigates to the affected area
- Save screenshot to `tests/visual/screenshots/verify-$ARGUMENTS.png`
- Analyze the screenshot to confirm the fix looks correct
- **All Playwright runs must be headless.**
- Screenshots are gitignored — they exist only for PR verification, not committed.

## 7. Commit
Use conventional commit format:
```
fix(scope): description (#$ARGUMENTS)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

## 8. Push and Create PR
```bash
git push -u origin fix/$ARGUMENTS-<slug>
gh pr create --title "fix(scope): description" --body "## Summary
Fixes #$ARGUMENTS

## Root Cause
[What was wrong and why]

## Fix
[What was changed and why this is the right approach]

## Verification
Screenshot taken after fix (if visual change):
- Viewport: [size]
- File: tests/visual/screenshots/verify-$ARGUMENTS.png

## Test Plan
- [ ] pnpm build passes
- [ ] npx playwright test passes
- [ ] Visual verification screenshot confirms fix (if applicable)"
```

## 9. Do NOT Merge
The maintainer will review and merge. Never auto-merge PRs.
