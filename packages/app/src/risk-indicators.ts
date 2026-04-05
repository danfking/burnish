/**
 * Risk assessment utilities for MCP tools and server configurations.
 *
 * - assessToolRisk()   — classifies tools by name pattern and schema quality.
 * - assessConfigRisk() — scans server config for embedded secrets and insecure URLs.
 */

export interface ToolRisk {
    level: 'low' | 'medium' | 'high';
    reasons: string[];
}

/** Destructive or irreversible operations. */
const HIGH_RISK_RE = /^(delete|drop|remove|destroy|push|force)[_-]/i;

/** Mutations that create or modify state. */
const MEDIUM_RISK_RE = /^(create|update|write|set|modify|send)[_-]/i;

/** Read-only operations. */
const LOW_RISK_RE = /^(list|get|read|search|describe|show)[_-]/i;

interface ToolDefinition {
    name: string;
    description?: string;
    inputSchema?: {
        properties?: Record<string, {
            type?: string;
            description?: string;
            minLength?: number;
            pattern?: string;
            enum?: unknown[];
            [key: string]: unknown;
        }>;
        required?: string[];
        [key: string]: unknown;
    };
}

/**
 * Extract the base tool name from a potentially qualified identifier
 * (e.g. `mcp__server__toolname` → `toolname`).
 */
function baseName(toolName: string): string {
    const parts = toolName.split('__');
    return parts[parts.length - 1] || toolName;
}

/**
 * Classify a tool's risk level and enumerate quality concerns.
 *
 * Risk is determined first by name pattern, then augmented with
 * schema-quality reasons that help the caller understand *why*
 * the tool may be risky to invoke without review.
 */
export function assessToolRisk(tool: ToolDefinition): ToolRisk {
    const reasons: string[] = [];
    const name = baseName(tool.name);

    // --- Determine level from name pattern ---
    let level: ToolRisk['level'];

    if (HIGH_RISK_RE.test(name)) {
        level = 'high';
        reasons.push(`Name pattern "${name}" indicates a destructive operation`);
    } else if (MEDIUM_RISK_RE.test(name)) {
        level = 'medium';
        reasons.push(`Name pattern "${name}" indicates a write/mutate operation`);
    } else if (LOW_RISK_RE.test(name)) {
        level = 'low';
    } else {
        // Unknown pattern — default to medium as a conservative choice
        level = 'medium';
        reasons.push('Tool name does not match a known read or write pattern');
    }

    // --- Schema quality checks ---
    if (!tool.description) {
        reasons.push('Missing tool description');
    }

    const schema = tool.inputSchema;
    if (schema?.properties) {
        const propEntries = Object.entries(schema.properties);

        // Check for missing required array when properties exist
        if (propEntries.length > 0 && !schema.required?.length) {
            reasons.push('No required array defined despite having properties');
        }

        for (const [paramName, paramDef] of propEntries) {
            // Missing parameter description
            if (!paramDef.description) {
                reasons.push(`Parameter "${paramName}" has no description`);
            }

            // Unconstrained string parameters
            if (
                paramDef.type === 'string' &&
                !paramDef.minLength &&
                !paramDef.pattern &&
                !paramDef.enum
            ) {
                reasons.push(
                    `Parameter "${paramName}" is a string with no constraints (no minLength, pattern, or enum)`,
                );
            }
        }
    }

    return { level, reasons };
}

// ---------------------------------------------------------------------------
// Config risk assessment
// ---------------------------------------------------------------------------

export interface ConfigWarning {
    severity: 'info' | 'warning' | 'critical';
    message: string;
}

/**
 * Shape of a single MCP server entry in the config file.
 * Mirrors McpServerConfig from @burnish/server but kept local to avoid
 * a cross-package dependency — the app package must stay framework-agnostic.
 */
interface ServerConfigEntry {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
}

/** Patterns that strongly suggest an embedded secret or token. */
const SECRET_KEY_RE = /^(api[_-]?key|secret|token|password|auth|credential|private[_-]?key)$/i;
const SECRET_VALUE_RE = /^(sk-|ghp_|gho_|github_pat_|xoxb-|xoxp-|bearer\s)/i;

/** URLs that use plain HTTP — excluding localhost/127.0.0.1 which are safe. */
function isInsecureUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:') return false;
        const host = parsed.hostname;
        return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
    } catch {
        return false;
    }
}

/**
 * Scan a map of MCP server configurations for risky patterns:
 *
 * 1. **Embedded secrets** — env vars or command args whose key or value
 *    looks like an API token, password, or credential.
 * 2. **Non-HTTPS URLs** — base URLs using plain HTTP to a non-localhost host,
 *    which risks leaking auth headers over the network.
 *
 * Returns an array of warnings sorted by severity (critical first).
 */
export function assessConfigRisk(
    servers: Record<string, ServerConfigEntry>,
): ConfigWarning[] {
    const warnings: ConfigWarning[] = [];

    for (const [name, config] of Object.entries(servers)) {
        // --- Check env vars for secrets ---
        if (config.env) {
            for (const [key, value] of Object.entries(config.env)) {
                if (SECRET_KEY_RE.test(key)) {
                    warnings.push({
                        severity: 'critical',
                        message: `Server "${name}": env var "${key}" appears to contain a secret`,
                    });
                } else if (SECRET_VALUE_RE.test(value)) {
                    warnings.push({
                        severity: 'critical',
                        message: `Server "${name}": env var "${key}" value looks like an embedded token`,
                    });
                }
            }
        }

        // --- Check command args for secrets ---
        if (config.args) {
            for (const arg of config.args) {
                if (SECRET_VALUE_RE.test(arg)) {
                    warnings.push({
                        severity: 'critical',
                        message: `Server "${name}": command argument contains what looks like an embedded token`,
                    });
                }
            }
        }

        // --- Check headers for secret values ---
        if (config.headers) {
            for (const [key, value] of Object.entries(config.headers)) {
                if (SECRET_VALUE_RE.test(value) || SECRET_KEY_RE.test(key)) {
                    warnings.push({
                        severity: 'warning',
                        message: `Server "${name}": header "${key}" may contain an embedded credential`,
                    });
                }
            }
        }

        // --- Check URL for non-HTTPS ---
        if (config.url && isInsecureUrl(config.url)) {
            warnings.push({
                severity: 'warning',
                message: `Server "${name}": URL uses plain HTTP (${config.url}); credentials may be transmitted in cleartext`,
            });
        }
    }

    // Sort: critical first, then warning, then info
    const order: Record<ConfigWarning['severity'], number> = {
        critical: 0,
        warning: 1,
        info: 2,
    };
    warnings.sort((a, b) => order[a.severity] - order[b.severity]);

    return warnings;
}
