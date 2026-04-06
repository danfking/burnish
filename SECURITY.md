# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on `main` | Yes |
| Previous releases | Best effort |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use [GitHub's private vulnerability reporting](https://github.com/danfking/burnish/security/advisories/new) to report security issues.

Alternatively, contact the maintainer directly via GitHub: [@danfking](https://github.com/danfking)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected component(s) and version(s)
- Potential impact

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: Depends on severity, but we aim for critical fixes within 2 weeks

## Scope

This security policy covers:

- `@burnish/components` — web component library
- `@burnish/renderer` — streaming HTML parser and sanitizer
- `@burnish/server` — MCP hub and LLM orchestrator
- `@burnish/app` — headless SDK
- `burnish` CLI

**Out of scope**: Third-party MCP servers connected via Burnish. Security issues with MCP servers should be reported to their respective maintainers.

## Security Practices

- All user-provided HTML is sanitized via DOMPurify before rendering
- Component attributes are validated and constrained
- The pre-commit hook scans for accidentally committed secrets
- Dependencies are monitored via Dependabot alerts
