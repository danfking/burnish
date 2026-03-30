---
name: ship
description: Push branch, create PR with linked issue, output merge command
user_invocable: true
---

# /ship — Create Pull Request

Push the current branch and create a PR. Does NOT auto-merge — Dan decides.

## Pre-Flight Checks

1. **Clean working tree** — no uncommitted changes
   ```bash
   git status --porcelain
   ```
   If dirty, ask whether to commit or stash.

2. **Build passes**
   ```bash
   pnpm build
   ```
   If build fails, stop and report errors.

3. **Commits exist on branch**
   ```bash
   git log main..HEAD --oneline
   ```
   If no commits, stop — nothing to ship.

4. **Branch is not main**
   If on `main`, stop — create a branch first.

## Create the PR

### 1. Push the Branch
```bash
git push -u origin HEAD
```

### 2. Extract Issue Number
Parse the branch name for the issue number:
- `feat/42-add-tooltip` → issue #42
- `fix/15-chart-bug` → issue #15

### 3. Create PR
```bash
gh pr create --title "<concise title>" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points describing the changes>

## Linked Issue
Closes #<issue-number>

## Changes
<list of key changes, one per line>

## Test Plan
- [ ] `pnpm build` passes
- [ ] Manual testing: <what to test>
EOF
)"
```

Use the issue title as the PR title (cleaned up if needed). Keep it under 70 characters.

### 4. Output

```
PR created: <URL>

To merge (squash):
  gh pr merge <number> --squash --delete-branch
```

## Important

- Never auto-merge. Dan reviews and decides.
- Always link the issue with `Closes #N` in the PR body.
- If there's no issue number in the branch name, ask Dan which issue to link.
