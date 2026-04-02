---
name: dev
description: Start working on an issue — fetch or create it, branch + worktree, begin implementing
user_invocable: true
arguments:
  - name: issue
    description: "GitHub issue number (e.g. 42) or title string to create a new issue (e.g. \"add tooltip component\")"
    required: true
---

# /dev — Start Development on an Issue

You are starting work on a new feature, fix, or chore. Follow this workflow exactly.

## Input

The argument is either:
- **A number** (e.g. `42`) — an existing GitHub issue number
- **A quoted string** (e.g. `"add tooltip component"`) — create a new issue first

## Steps

### 1. Resolve the Issue

**If the argument is a number:**
```bash
gh issue view <number>
```
Read the issue title, body, and labels to understand what needs to be done.

**If the argument is a string:**
```bash
gh issue create --title "<string>" --body "Created via /dev skill"
```
Note the created issue number.

### 2. Determine Branch Type

Based on the issue title/labels:
- `feat/` — new functionality, enhancements
- `fix/` — bug fixes
- `chore/` — maintenance, CI, docs, refactoring

### 3. Create Branch + Worktree

Create a slug from the issue title (lowercase, hyphens, max 40 chars):

```bash
# Example: issue #42 "Add tooltip component" → feat/42-add-tooltip-component
git worktree add .claude/worktrees/<branch-name> -b <branch-name>
```

Then switch the session to the worktree directory.

### 4. Set Up Context

- Read `CLAUDE.md` for project conventions
- Read relevant source files based on the issue description
- Summarize what you understand and your planned approach

### 5. Begin Implementation

Start working on the issue. Follow all conventions in CLAUDE.md:
- TypeScript for all code
- `--burnish-*` CSS custom properties
- `burnish-` tag prefix for components
- Conventional commit messages

## Branch Naming Examples

| Issue | Title | Branch |
|-------|-------|--------|
| #42 | Add tooltip component | `feat/42-add-tooltip-component` |
| #15 | Fix chart rendering on mobile | `fix/15-fix-chart-rendering-mobile` |
| #30 | Update CI workflow | `chore/30-update-ci-workflow` |
