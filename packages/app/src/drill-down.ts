/**
 * Drill-down helpers — prompt generation and write-tool detection.
 */

// NOTE: Intentionally duplicated from @burnish/server/guards.ts for runtime isolation
// (this package runs in the browser, server runs in Node)
const WRITE_TOOL_PATTERNS = /^(create|update|delete|remove|push|write|edit|move|fork|merge|add|set|close|lock|assign)/i;

/**
 * Classify a tool as a write/mutate operation based on its name.
 */
export function isWriteTool(toolName: string): boolean {
    // Extract the tool name from fully qualified name (mcp__server__toolname)
    const parts = toolName.split('__');
    const baseName = parts[parts.length - 1] || toolName;
    return WRITE_TOOL_PATTERNS.test(baseName);
}

/**
 * Build the drill-down prompt for a card click.
 */
export function getDrillDownPrompt(title: string, status?: string, itemId?: string): string {
    const idClause = itemId ? ` (tool: ${itemId})` : '';
    const looksLikeTool = itemId && (itemId.includes('__') || itemId.includes('mcp_'));

    if (looksLikeTool) {
        const toolName = title || '';
        const isWrite = WRITE_TOOL_PATTERNS.test(toolName);

        return `The user wants to use the "${title}" tool${idClause}.

${isWrite ? 'This is a WRITE operation — do NOT call it. Show a form.' : 'Check if this tool has required parameters.'}

RULES:
- If the tool has required parameters that need user input → show a burnish-form with the parameters as fields. Add lookup to fields where values can be searched. Do NOT guess parameter values.
- If the tool can run with NO parameters or has obvious defaults (like listing the current directory) → call it and show results.
${isWrite ? '- This is a write tool — ALWAYS show a form, never auto-invoke.' : '- Only auto-invoke if truly no user input is needed.'}

EXAMPLE — a tool with required params MUST produce a form like this:
<burnish-form title="${title}" tool-id="${itemId || 'tool_name'}" fields='[{"key":"query","label":"Search query","type":"text","required":true,"placeholder":"enter value"}]'></burnish-form>

Use ONLY burnish-* web components. Include burnish-actions with next steps after results.`;
    }
    return `Explore "${title}"${idClause} in more detail. Call the appropriate tools to get real data and show the results using burnish-* web components. If a tool requires parameters, show a burnish-form instead of guessing. Include burnish-actions with next steps.`;
}

/**
 * Generate a fallback burnish-form from a tool's JSON schema.
 * Returns null if the schema has no properties.
 */
export function generateFallbackForm(
    toolName: string,
    schema: { properties?: Record<string, any>; required?: string[] },
): string | null {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const fields = Object.entries(props).map(([key, prop]) => {
        const field: Record<string, any> = {
            key,
            label: prop.title || key.replace(/_/g, ' '),
            type: prop.type === 'number' || prop.type === 'integer' ? 'number' : prop.enum ? 'select' : 'text',
            required: required.has(key),
        };
        if (prop.description) field.placeholder = prop.description;
        if (prop.default !== undefined) field.value = String(prop.default);
        if (prop.enum) field.options = prop.enum.map(String);
        return field;
    });
    if (fields.length === 0) return null;
    const displayName = (toolName.split('__').pop() || toolName).replace(/_/g, ' ');
    const escAttr = (s: string) => s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return `<burnish-form title="${escAttr(displayName)}" tool-id="${escAttr(toolName)}" fields='${JSON.stringify(fields).replace(/'/g, '&#39;')}'></burnish-form>`;
}
