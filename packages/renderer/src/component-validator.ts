/**
 * Component validator middleware for Burnish components.
 *
 * Validates burnish-* component attributes at render time:
 * - Checks required attributes are present
 * - Validates JSON attributes parse correctly (items, meta, columns, rows, config, fields, actions)
 * - Validates enum-constrained attribute values (status, role, trend, type, action)
 * - Logs warnings for invalid usage to help LLMs and developers catch malformed output
 *
 * Designed to run after DOMPurify sanitization, before DOM insertion.
 */

import { BURNISH_COMPONENTS, type ComponentDef } from './sanitizer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
    tag: string;
    attr: string;
    message: string;
    severity: ValidationSeverity;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
}

export interface ValidatorOptions {
    /** Tag prefix (default: 'burnish-') */
    prefix?: string;
    /** Additional component definitions beyond the defaults */
    extraComponents?: ComponentDef[];
    /** Custom logger — defaults to console.warn */
    logger?: (msg: string) => void;
    /** When true, suppress console output (issues still returned) */
    silent?: boolean;
}

// ---------------------------------------------------------------------------
// Constraint definitions
// ---------------------------------------------------------------------------

/** Attributes that must contain valid JSON */
const JSON_ATTRS = new Set([
    'items',    // burnish-stat-bar
    'meta',     // burnish-card
    'columns',  // burnish-table
    'rows',     // burnish-table
    'config',   // burnish-chart
    'fields',   // burnish-form
    'actions',  // burnish-actions
]);

/** Enum constraints for specific tag+attribute pairs */
interface EnumConstraint {
    values: string[];
    /** If true, values outside the enum produce a warning instead of error */
    soft?: boolean;
}

const ENUM_CONSTRAINTS: Record<string, Record<string, EnumConstraint>> = {
    'burnish-card': {
        status: {
            values: [
                'success', 'healthy', 'merged', 'resolved',
                'warning', 'draft', 'pending',
                'error', 'failing', 'failed',
                'muted', 'no-data', 'locked', 'archived',
                'info',
            ],
            soft: true, // unknown statuses get "info" coloring, so warn but don't error
        },
    },
    'burnish-metric': {
        trend: {
            values: ['up', 'down', 'flat'],
            soft: false,
        },
    },
    'burnish-message': {
        role: {
            values: ['user', 'assistant'],
            soft: false,
        },
    },
    'burnish-chart': {
        type: {
            values: ['line', 'bar', 'doughnut', 'pie', 'radar', 'polarArea', 'scatter', 'bubble'],
            soft: true, // Chart.js may support others
        },
    },
    'burnish-section': {
        status: {
            values: ['success', 'healthy', 'warning', 'error', 'failing', 'info', 'muted', 'no-data'],
            soft: true,
        },
    },
};

/** Required attributes per component (at least one must be present) */
const REQUIRED_ATTRS: Record<string, string[]> = {
    'burnish-card': ['title'],
    'burnish-stat-bar': ['items'],
    'burnish-table': ['columns', 'rows'],
    'burnish-chart': ['config'],
    'burnish-metric': ['value'],
    'burnish-message': ['content'],
    'burnish-section': ['label'],
    'burnish-form': ['fields'],
    'burnish-actions': ['actions'],
};

/** JSON shape validators for specific attributes */
interface JsonShapeRule {
    type: 'array' | 'object' | 'array-or-object';
    /** If type is 'array', optional check that items have these keys */
    itemKeys?: string[];
}

const JSON_SHAPE_RULES: Record<string, JsonShapeRule> = {
    items: { type: 'array', itemKeys: ['label', 'value'] },
    meta: { type: 'array-or-object' },
    columns: { type: 'array' },
    rows: { type: 'array' },
    config: { type: 'object' },
    fields: { type: 'array', itemKeys: ['key', 'label'] },
    actions: { type: 'array', itemKeys: ['label', 'prompt'] },
};

// ---------------------------------------------------------------------------
// Validator implementation
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from tag name to ComponentDef, handling prefix remapping.
 */
function buildRegistry(
    prefix: string,
    extraComponents: ComponentDef[],
): Map<string, ComponentDef> {
    const registry = new Map<string, ComponentDef>();

    for (const def of BURNISH_COMPONENTS) {
        const tag = prefix === 'burnish-' ? def.tag : def.tag.replace('burnish-', prefix);
        registry.set(tag, { tag, attrs: def.attrs });
    }

    for (const def of extraComponents) {
        registry.set(def.tag, def);
    }

    return registry;
}

/**
 * Resolve constraint keys for a tag, handling custom prefixes.
 * E.g. if prefix is 'xm-', maps 'xm-card' back to 'burnish-card' for constraint lookup.
 */
function canonicalTag(tag: string, prefix: string): string {
    if (prefix === 'burnish-') return tag;
    return tag.replace(prefix, 'burnish-');
}

/**
 * Validate a single element's attributes against the component contract.
 */
function validateElement(
    tag: string,
    attrs: Record<string, string>,
    prefix: string,
    registry: Map<string, ComponentDef>,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const def = registry.get(tag);

    // Unknown component — not necessarily invalid, but worth noting
    if (!def) {
        return issues;
    }

    const canonical = canonicalTag(tag, prefix);

    // Check required attributes
    const required = REQUIRED_ATTRS[canonical];
    if (required) {
        const missing = required.filter(r => !(r in attrs) || attrs[r] === '');
        if (missing.length > 0) {
            for (const attr of missing) {
                issues.push({
                    tag,
                    attr,
                    message: `Missing required attribute "${attr}" on <${tag}>`,
                    severity: 'error',
                });
            }
        }
    }

    // Validate each attribute
    for (const [attr, value] of Object.entries(attrs)) {
        // JSON validation
        if (JSON_ATTRS.has(attr) && value) {
            try {
                const parsed = JSON.parse(value);
                // Shape validation
                const rule = JSON_SHAPE_RULES[attr];
                if (rule) {
                    const actualType = Array.isArray(parsed) ? 'array' : typeof parsed === 'object' && parsed !== null ? 'object' : 'other';

                    const typeOk =
                        rule.type === 'array-or-object'
                            ? actualType === 'array' || actualType === 'object'
                            : actualType === rule.type;

                    if (!typeOk) {
                        issues.push({
                            tag,
                            attr,
                            message: `Attribute "${attr}" on <${tag}> should be ${rule.type}, got ${actualType}`,
                            severity: 'warning',
                        });
                    } else if (rule.itemKeys && actualType === 'array' && parsed.length > 0) {
                        const first = parsed[0];
                        if (typeof first === 'object' && first !== null) {
                            const missingKeys = rule.itemKeys.filter(k => !(k in first));
                            if (missingKeys.length > 0) {
                                issues.push({
                                    tag,
                                    attr,
                                    message: `Array items in "${attr}" on <${tag}> should have keys: ${rule.itemKeys.join(', ')}. Missing: ${missingKeys.join(', ')}`,
                                    severity: 'warning',
                                });
                            }
                        }
                    }
                }
            } catch {
                issues.push({
                    tag,
                    attr,
                    message: `Invalid JSON in attribute "${attr}" on <${tag}>`,
                    severity: 'error',
                });
            }
        }

        // Enum validation
        const enumConstraints = ENUM_CONSTRAINTS[canonical];
        if (enumConstraints && attr in enumConstraints && value) {
            const constraint = enumConstraints[attr];
            if (!constraint.values.includes(value.toLowerCase())) {
                issues.push({
                    tag,
                    attr,
                    message: `Unknown ${attr} value "${value}" on <${tag}>. Expected one of: ${constraint.values.join(', ')}`,
                    severity: constraint.soft ? 'warning' : 'error',
                });
            }
        }
    }

    return issues;
}

/**
 * Parse attributes from an HTML element string.
 */
function parseAttrsFromHtml(html: string): Record<string, string> {
    const attrs: Record<string, string> = {};

    // Skip past the opening tag name
    const tagEnd = html.indexOf(' ');
    if (tagEnd === -1) return attrs;
    const attrString = html.substring(tagEnd);

    // Parse key="value" and key='value' pairs with a linear-time scanner
    // (avoids polynomial backtracking flagged by CodeQL).
    let i = 0;
    while (i < attrString.length) {
        // Skip whitespace
        while (i < attrString.length && (attrString[i] === ' ' || attrString[i] === '\t' || attrString[i] === '\n' || attrString[i] === '\r')) i++;
        // Read attribute name ([\w-] chars)
        const nameStart = i;
        while (i < attrString.length && /[\w-]/.test(attrString[i])) i++;
        if (i === nameStart) { i++; continue; }
        const name = attrString.substring(nameStart, i).toLowerCase();
        // Skip whitespace around =
        while (i < attrString.length && attrString[i] === ' ') i++;
        if (i >= attrString.length || attrString[i] !== '=') continue;
        i++; // skip '='
        while (i < attrString.length && attrString[i] === ' ') i++;
        // Read quoted value
        if (i >= attrString.length) break;
        const quote = attrString[i];
        if (quote !== '"' && quote !== "'") continue;
        i++; // skip opening quote
        const valStart = i;
        while (i < attrString.length && attrString[i] !== quote) i++;
        attrs[name] = attrString.substring(valStart, i);
        if (i < attrString.length) i++; // skip closing quote
    }

    // Match bare boolean attributes by splitting on whitespace and filtering
    // out tokens that are key=value pairs, closing slashes, or brackets.
    for (const token of attrString.split(/\s+/)) {
        if (!token || token === '/' || token === '>' || token.includes('=')) continue;
        // Strip any trailing /> or >
        const name = token.replace(/\/?>/g, '').toLowerCase();
        if (name && /^[\w-]+$/.test(name) && !(name in attrs)) {
            attrs[name] = '';
        }
    }

    return attrs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a single HTML element string (e.g. `<burnish-card title="...">`).
 *
 * Returns a ValidationResult with `valid` and `issues`.
 */
export function validateElement$(
    html: string,
    options: ValidatorOptions = {},
): ValidationResult {
    const prefix = options.prefix ?? 'burnish-';
    const extra = options.extraComponents ?? [];
    const registry = buildRegistry(prefix, extra);
    const logger = options.logger ?? console.warn;
    const silent = options.silent ?? false;

    // Extract tag name
    const tagMatch = html.match(/<([\w-]+)/);
    if (!tagMatch) {
        return { valid: true, issues: [] };
    }

    const tag = tagMatch[1].toLowerCase();

    // Only validate prefixed components
    if (!tag.startsWith(prefix)) {
        return { valid: true, issues: [] };
    }

    const attrs = parseAttrsFromHtml(html);
    const issues = validateElement(tag, attrs, prefix, registry);

    if (!silent && issues.length > 0) {
        for (const issue of issues) {
            logger(`[burnish-validator] ${issue.severity.toUpperCase()}: ${issue.message}`);
        }
    }

    return {
        valid: issues.every(i => i.severity !== 'error'),
        issues,
    };
}

/**
 * Validate all burnish-* components in an HTML string.
 *
 * Scans the HTML for all component tags and validates each one.
 * Returns a combined ValidationResult.
 */
export function validateHtml(
    htmlContent: string,
    options: ValidatorOptions = {},
): ValidationResult {
    const prefix = options.prefix ?? 'burnish-';
    const extra = options.extraComponents ?? [];
    const registry = buildRegistry(prefix, extra);
    const logger = options.logger ?? console.warn;
    const silent = options.silent ?? false;

    const allIssues: ValidationIssue[] = [];

    // Find all opening tags for prefixed components
    const tagRe = new RegExp(`<(${prefix}[a-z][a-z-]*)([^>]*)>`, 'gi');
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(htmlContent)) !== null) {
        const tag = m[1].toLowerCase();
        const fullMatch = m[0];
        const attrs = parseAttrsFromHtml(fullMatch);
        const issues = validateElement(tag, attrs, prefix, registry);
        allIssues.push(...issues);
    }

    if (!silent && allIssues.length > 0) {
        for (const issue of allIssues) {
            logger(`[burnish-validator] ${issue.severity.toUpperCase()}: ${issue.message}`);
        }
    }

    return {
        valid: allIssues.every(i => i.severity !== 'error'),
        issues: allIssues,
    };
}

/**
 * Create a validation middleware function that can be composed into a render pipeline.
 *
 * Returns a function that takes HTML, validates it, and returns the HTML unchanged.
 * Issues are logged (unless silent) and can be collected via the returned result.
 *
 * Usage:
 * ```ts
 * const validate = createValidator({ silent: false });
 * const result = validate(htmlFromLlm);
 * if (!result.valid) {
 *   // handle validation errors
 * }
 * // result.html is the original HTML (unchanged)
 * ```
 */
export function createValidator(options: ValidatorOptions = {}): (html: string) => ValidationResult & { html: string } {
    return (html: string) => {
        const result = validateHtml(html, options);
        return { ...result, html };
    };
}
