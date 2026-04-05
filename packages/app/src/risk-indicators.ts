/**
 * Tool risk assessment — classifies MCP tools by risk level
 * based on name patterns and schema quality indicators.
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
