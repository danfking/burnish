/**
 * Rule-based response quality scorer.
 * Scores a response HTML string 0-10 based on structural quality rules.
 */

export interface QualityScore {
    total: number;        // 0-10
    breakdown: Record<string, boolean>;
}

export function scoreResponse(html: string): QualityScore {
    const breakdown: Record<string, boolean> = {};
    let total = 0;

    // Has burnish-* components at all (+1)
    const hasComponents = /burnish-/.test(html);
    breakdown.hasComponents = hasComponents;
    if (hasComponents) total += 1;

    // Has stat-bar summary (+1)
    const hasStatBar = /burnish-stat-bar/.test(html);
    breakdown.hasStatBar = hasStatBar;
    if (hasStatBar) total += 1;

    // Has actions for next steps (+1)
    const hasActions = /burnish-actions/.test(html);
    breakdown.hasActions = hasActions;
    if (hasActions) total += 1;

    // Has sections for grouping (+1)
    const hasSections = /burnish-section/.test(html);
    breakdown.hasSections = hasSections;
    if (hasSections) total += 1;

    // No preamble text before first component (+1)
    const startsWithComponent = /^\s*<burnish-/.test(html);
    breakdown.noPreamble = startsWithComponent;
    if (startsWithComponent) total += 1;

    // No raw HTML tags (h1-h6, div, p, table) mixed in (+1)
    const noRawHtml = !/<(h[1-6]|div|p|table)\b/.test(html);
    breakdown.noRawHtml = noRawHtml;
    if (noRawHtml) total += 1;

    // No markdown code fences (+1)
    const noCodeFences = !(/```/.test(html));
    breakdown.noCodeFences = noCodeFences;
    if (noCodeFences) total += 1;

    // Uses multiple component types (+1)
    const componentTypes = new Set((html.match(/burnish-\w+/g) || []).map(m => m));
    const multipleTypes = componentTypes.size >= 2;
    breakdown.multipleTypes = multipleTypes;
    if (multipleTypes) total += 1;

    // Has valid JSON in at least one attribute (+1)
    let hasValidJson = false;
    const jsonMatch = html.match(/(?:items|columns|rows|meta|fields|actions)='([^']*)'/);
    if (jsonMatch) {
        try { JSON.parse(jsonMatch[1]); hasValidJson = true; } catch { /* ignore */ }
    }
    breakdown.hasValidJson = hasValidJson;
    if (hasValidJson) total += 1;

    // Response is not empty and reasonable length (+1)
    const reasonableLength = html.length > 50 && html.length < 100000;
    breakdown.reasonableLength = reasonableLength;
    if (reasonableLength) total += 1;

    return { total, breakdown };
}
