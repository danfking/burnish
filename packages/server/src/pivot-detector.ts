/**
 * Pivot Detector — detects data transformation commands in user prompts.
 *
 * Recognizes natural language patterns like "group by assignee", "sort by date",
 * "show as chart", "filter by status=open", and constructs context-aware prompts
 * that include previous result data for re-derivation by the LLM.
 *
 * This enables conversational pivot tables where users iteratively reshape
 * data views without re-executing tools.
 */

export interface PivotCommand {
    /** The type of transformation requested */
    type: 'group' | 'sort' | 'filter' | 'chart' | 'table' | 'summary' | 'pivot' | 'count';
    /** The field or dimension to operate on (e.g., "assignee", "status") */
    field?: string;
    /** Sort direction, filter value, or chart type */
    value?: string;
    /** The original user prompt text */
    originalPrompt: string;
}

/**
 * Transformation patterns — ordered by specificity (most specific first).
 * Each pattern extracts a command type and optional field/value.
 */
const PIVOT_PATTERNS: Array<{
    pattern: RegExp;
    type: PivotCommand['type'];
    fieldGroup?: number;
    valueGroup?: number;
}> = [
    // "group by X" / "group on X"
    { pattern: /\b(?:group|cluster|categorize|bucket)\s+(?:by|on|into)\s+(\w+)/i, type: 'group', fieldGroup: 1 },
    // "sort by X" / "order by X" with optional direction
    { pattern: /\b(?:sort|order|rank|arrange)\s+(?:by|on)\s+(\w+)(?:\s+(asc|desc|ascending|descending))?/i, type: 'sort', fieldGroup: 1, valueGroup: 2 },
    // "filter by X=Y" / "filter where X is Y" / "show only X"
    { pattern: /\b(?:filter|where|only\s+show|show\s+only)\s+(?:by\s+|where\s+)?(\w+)\s*(?:=|is|==|equals?)\s*["']?([^"'\s,]+)["']?/i, type: 'filter', fieldGroup: 1, valueGroup: 2 },
    // "filter by X" (without value — broader filter)
    { pattern: /\b(?:filter)\s+(?:by|on)\s+(\w+)/i, type: 'filter', fieldGroup: 1 },
    // "show as chart" / "visualize as bar chart" / "make a pie chart"
    { pattern: /\b(?:show|display|visualize|render|make|convert)\s+(?:as\s+|into\s+)?(?:a\s+)?(\w+)?\s*(?:chart|graph|plot|visualization)/i, type: 'chart', valueGroup: 1 },
    // "as a chart" / "as bar chart"
    { pattern: /\bas\s+(?:a\s+)?(\w+\s+)?(?:chart|graph|plot)/i, type: 'chart', valueGroup: 1 },
    // "show as table" / "display as table"
    { pattern: /\b(?:show|display|render|convert)\s+(?:as\s+|into\s+)?(?:a\s+)?table/i, type: 'table' },
    // "as a table"
    { pattern: /\bas\s+(?:a\s+)?table/i, type: 'table' },
    // "summarize" / "give me a summary"
    { pattern: /\b(?:summarize|summary|overview|recap|aggregate)\b/i, type: 'summary' },
    // "pivot by X" / "pivot on X"
    { pattern: /\bpivot\s+(?:by|on|around)\s+(\w+)/i, type: 'pivot', fieldGroup: 1 },
    // "count by X" / "tally by X"
    { pattern: /\b(?:count|tally|total)\s+(?:by|per|for\s+each)\s+(\w+)/i, type: 'count', fieldGroup: 1 },
];

/**
 * Detect if a user prompt contains a data transformation command.
 * Returns the parsed command, or null if no transformation is detected.
 */
export function detectPivotCommand(prompt: string): PivotCommand | null {
    if (!prompt || typeof prompt !== 'string') return null;

    const trimmed = prompt.trim();
    // Skip prompts that are clearly not transformations (too long = likely a new question)
    if (trimmed.length > 200) return null;

    for (const { pattern, type, fieldGroup, valueGroup } of PIVOT_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
            return {
                type,
                field: fieldGroup ? match[fieldGroup]?.toLowerCase() : undefined,
                value: valueGroup ? match[valueGroup]?.trim() : undefined,
                originalPrompt: trimmed,
            };
        }
    }

    return null;
}

/**
 * Build a context-aware prompt for a data transformation request.
 *
 * Includes the full previous assistant response (which contains the data
 * to transform) and clear instructions for how to reshape it.
 */
export function buildPivotPrompt(command: PivotCommand, previousResponse: string): string {
    const dataContext = previousResponse.length > 12000
        ? previousResponse.substring(0, 12000) + '\n<!-- truncated -->'
        : previousResponse;

    const instructions = getPivotInstructions(command);

    return `The user wants to transform the data from the previous response.

## Previous Response Data
${dataContext}

## Transformation Request
${instructions}

## Rules
- Re-render the data using burnish-* components
- Start with <burnish-stat-bar> summarizing the transformed view
- Use the most appropriate component for the result (table for grouped data, chart for visualizations, etc.)
- End with <burnish-actions> offering further transformations (e.g., "Group by another field", "Show as chart", "Filter by...")
- Output ONLY burnish-* components — no prose, no markdown
- Preserve all data from the original response — just reshape the presentation`;
}

/**
 * Generate human-readable transformation instructions from a pivot command.
 */
function getPivotInstructions(command: PivotCommand): string {
    switch (command.type) {
        case 'group':
            return `Group/categorize all items by their "${command.field}" field. Show each group as a <burnish-section> with the group value as the label and the count of items. Inside each section, list the items as <burnish-card> elements.`;

        case 'sort':
            return `Sort all items by their "${command.field}" field in ${command.value?.startsWith('desc') ? 'descending' : 'ascending'} order. Present as a <burnish-table> with the sort column highlighted.`;

        case 'filter':
            if (command.value) {
                return `Filter the data to show only items where "${command.field}" equals or contains "${command.value}". Show the filtered results and a stat-bar indicating how many items matched vs. total.`;
            }
            return `Filter the data by the "${command.field}" field. Show a breakdown of unique values and their counts.`;

        case 'chart':
            const chartType = command.value?.toLowerCase() || 'bar';
            const validTypes = ['bar', 'line', 'doughnut', 'pie'];
            const resolvedType = validTypes.includes(chartType) ? chartType : 'bar';
            return `Visualize the data as a <burnish-chart> with type="${resolvedType}". Extract meaningful labels and numeric values from the data. If there are categories, use them as labels; if there are counts or amounts, use them as values.`;

        case 'table':
            return `Present all the data as a <burnish-table>. Extract all relevant fields as columns and each item as a row. Include a status-field if there is a status-like column.`;

        case 'summary':
            return `Provide a high-level summary of the data. Use <burnish-stat-bar> for key metrics, <burnish-metric> for important KPIs, and a brief <burnish-section> grouping major categories.`;

        case 'pivot':
            return `Create a pivot table view organized around the "${command.field}" dimension. For each unique value of "${command.field}", show aggregated counts/metrics of the other fields. Present as a <burnish-table> with "${command.field}" values as rows.`;

        case 'count':
            return `Count items by their "${command.field}" field. Show the result as a <burnish-stat-bar> with each unique value and its count, followed by a <burnish-table> with columns for "${command.field}" and "Count", sorted by count descending.`;

        default:
            return command.originalPrompt;
    }
}
