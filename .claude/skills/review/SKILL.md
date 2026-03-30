---
name: review
description: Review current branch for build errors, conventions, and code quality
user_invocable: true
---

# /review — Pre-Ship Code Review

Run a structured review of the current branch before creating a PR.

## Checks

### 1. Build Check
```bash
pnpm build
```
Report: PASS or FAIL with error output.

### 2. Uncommitted Changes
```bash
git status --porcelain
```
If there are uncommitted changes, report them as a WARNING.

### 3. Debug Artifacts
Search for leftover debug code:
- `console.log` (outside of server logging)
- `debugger` statements
- `TODO` or `FIXME` comments (report as info, not blocking)

### 4. Secret Detection
Search for patterns that look like secrets:
- `sk-ant-` or `sk-` followed by alphanumeric chars
- `ghp_` followed by alphanumeric chars
- `token` assigned to a string literal
- `.env` files staged for commit

Report any findings as CRITICAL.

### 5. Convention Compliance
Review the diff (`git diff main...HEAD`) for:
- **TypeScript**: all new files should be `.ts` (not `.js`)
- **CSS custom properties**: should use `--mcpui-*` prefix
- **Tag prefix**: custom elements should use `mcpui-` prefix
- **No innerHTML**: components should not use `innerHTML` (XSS risk)
- **JSON attributes**: should be parsed with try/catch

### 6. Commit Messages
```bash
git log main..HEAD --oneline
```
Verify all commits follow conventional format: `type(scope): description`

## Output Format

```
## Review Summary

| Check | Status | Details |
|-------|--------|---------|
| Build | PASS/FAIL | ... |
| Clean tree | PASS/WARN | ... |
| Debug artifacts | PASS/WARN | ... |
| Secrets | PASS/CRITICAL | ... |
| Conventions | PASS/WARN | ... |
| Commit messages | PASS/WARN | ... |

### Findings

[List any issues found with severity: CRITICAL / WARNING / INFO]

### Verdict: PASS / FAIL

[PASS = safe to ship, FAIL = must fix before shipping]
```
