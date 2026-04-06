/**
 * Intent Resolver — deterministic tool selection without an LLM.
 *
 * Two-phase approach for small model reliability:
 * 1. Resolve the user prompt to a tool + params (no LLM needed)
 * 2. Execute the tool, then ask the LLM only to format results
 *
 * This avoids overwhelming small 7B models with 26+ tool definitions.
 */

import type { ToolDef } from './mcp-hub.js';

export interface IntentResolution {
    tool: ToolDef;
    params: Record<string, unknown>;
    confidence: number;
    reason: string;
}

interface ScoredTool {
    tool: ToolDef;
    score: number;
    matchType: string;
}

/** Common English stop words to exclude from matching. */
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'it', 'this', 'that', 'from', 'by', 'as', 'be', 'was',
    'are', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
    'not', 'no', 'but', 'or', 'if', 'so', 'up', 'out', 'about',
    'into', 'over', 'after', 'before', 'between', 'under', 'again',
    'me', 'my', 'i', 'we', 'you', 'your', 'he', 'she', 'they', 'them',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'only', 'same', 'than', 'too', 'very', 'just',
    'please', 'show', 'give', 'tell', 'get', 'let', 'make',
]);

/** Action verbs used for multi-intent detection. */
const ACTION_VERBS = new Set([
    'find', 'search', 'list', 'get', 'fetch', 'read', 'show', 'display',
    'create', 'add', 'write', 'update', 'edit', 'modify', 'delete', 'remove',
    'send', 'email', 'post', 'push', 'deploy', 'run', 'execute', 'start',
    'stop', 'restart', 'check', 'test', 'verify', 'validate', 'analyze',
    'query', 'lookup', 'open', 'close', 'move', 'copy', 'rename',
]);

/**
 * Resolve a user prompt to a tool call deterministically, without an LLM.
 *
 * Returns null if the prompt is ambiguous, multi-intent, or no confident
 * match is found — in which case the caller should fall back to the LLM.
 */
export function resolveIntent(
    prompt: string,
    tools: ToolDef[],
    serverNames: string[],
): IntentResolution | null {
    if (!prompt || tools.length === 0) return null;

    // Stage A: Explicit "Call the tool X with params Y" pattern
    const explicitMatch = parseExplicitToolCall(prompt, tools);
    if (explicitMatch) return explicitMatch;

    // Detect multi-intent (multiple verbs) -- bail to LLM
    if (detectMultiIntent(prompt)) return null;

    // Filter tools by server name if mentioned in prompt
    const promptLower = prompt.toLowerCase();
    const matchedServer = serverNames.find(s => promptLower.includes(s.toLowerCase()));
    const candidateTools = matchedServer
        ? tools.filter(t => t.serverName === matchedServer)
        : tools;

    if (candidateTools.length === 0) return null;

    // Stage B: Verb + noun matching
    const scored = candidateTools.map(tool => scoreToolMatch(prompt, tool));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 0.2) return null;

    // Check ambiguity — only bail if the top two have VERY close scores
    // AND both matched via the same method (e.g., both verb-only)
    if (scored.length > 1 && scored[1].score > best.score * 0.95
        && best.matchType === scored[1].matchType) return null;

    // Stage C: Extract parameters
    const params = extractParams(prompt, best.tool);

    // Calculate confidence — weight score higher since param extraction is best-effort
    const paramCompleteness = calculateParamCompleteness(params, best.tool);
    const confidence = Math.min(1.0, best.score * 0.7 + paramCompleteness * 0.3);

    if (confidence < 0.4) return null;

    return {
        tool: best.tool,
        params,
        confidence,
        reason: `Matched "${best.tool.name}" via ${best.matchType} (score: ${best.score.toFixed(2)})`,
    };
}

/**
 * Parse explicit tool call instructions like:
 * "Call the tool search_repositories with parameters: query=burnish"
 */
function parseExplicitToolCall(
    prompt: string,
    tools: ToolDef[],
): IntentResolution | null {
    const match = prompt.match(
        /^Call the tool\s+(\S+)\s+with\s+[^:]*parameters?:?\s*(.*)/i,
    );
    if (!match) return null;

    const toolName = match[1];
    const paramsStr = match[2].trim();

    const tool = tools.find(
        t => t.name.toLowerCase() === toolName.toLowerCase(),
    );
    if (!tool) return null;

    const params: Record<string, unknown> = {};

    // Parse key=value or key="value" pairs
    const pairPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    let pairMatch: RegExpExecArray | null;
    while ((pairMatch = pairPattern.exec(paramsStr)) !== null) {
        const key = pairMatch[1];
        const value = pairMatch[2] ?? pairMatch[3] ?? pairMatch[4];
        params[key] = value;
    }

    return {
        tool,
        params,
        confidence: 1.0,
        reason: `Explicit tool call for "${tool.name}"`,
    };
}

/**
 * Detect if a prompt contains multiple action intents joined by conjunctions.
 * E.g., "find issues AND email a summary" -> true
 */
function detectMultiIntent(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    const conjunctions = /\b(?:and then|then|also|and)\b/;
    const parts = lower.split(conjunctions);

    if (parts.length < 2) return false;

    // Check if multiple parts contain action verbs
    let verbPartCount = 0;
    for (const part of parts) {
        const words = part.trim().split(/\s+/);
        if (words.some(w => ACTION_VERBS.has(w))) {
            verbPartCount++;
        }
    }

    return verbPartCount >= 2;
}

/**
 * Score how well a tool matches the user prompt via verb/noun matching.
 */
function scoreToolMatch(prompt: string, tool: ToolDef): ScoredTool {
    const promptLower = prompt.toLowerCase();
    const promptWords = promptLower
        .split(/\s+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));

    const toolNameLower = tool.name.toLowerCase();
    const toolWords = toolNameLower.split(/[_\-]+/);
    const descWords = (tool.description || '')
        .toLowerCase()
        .split(/\s+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    let score = 0;
    let matchType = 'none';

    // Exact tool name substring match (highest signal)
    if (promptLower.includes(toolNameLower)) {
        score = Math.max(score, 0.9);
        matchType = 'exact_name';
    }

    // Individual tool name words appearing in prompt
    let toolWordMatches = 0;
    for (const tw of toolWords) {
        if (tw.length > 1 && promptWords.some(pw => pw === tw || pw.includes(tw) || tw.includes(pw))) {
            toolWordMatches++;
        }
    }
    if (toolWords.length > 0 && toolWordMatches > 0) {
        // More matched words = exponentially better score (verb+noun >> verb-only)
        const matchRatio = toolWordMatches / toolWords.length;
        const wordScore = matchRatio >= 1.0 ? 0.8 : matchRatio >= 0.5 ? 0.5 : 0.25;
        if (wordScore > score) {
            score = wordScore;
            matchType = toolWordMatches === toolWords.length ? 'verb+noun' : 'partial_name';
        }
    }

    // Description keyword overlap
    let descMatches = 0;
    for (const dw of descWords) {
        if (promptWords.includes(dw)) {
            descMatches++;
        }
    }
    if (descWords.length > 0 && descMatches > 0) {
        const descScore = (descMatches / Math.max(descWords.length, 5)) * 0.2;
        // Description alone is weak -- only boost, don't replace higher scores
        if (score === 0) {
            score = descScore;
            matchType = 'description';
        } else {
            score += descScore * 0.5;
        }
    }

    return { tool, score, matchType };
}

/**
 * Extract parameter values from a natural language prompt based on the
 * tool's input schema.
 */
function extractParams(
    prompt: string,
    tool: ToolDef,
): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const schema = tool.inputSchema as {
        properties?: Record<string, { type?: string }>;
        required?: string[];
    };
    const properties = schema.properties || {};

    // Remove the tool name and server name from prompt to get "the rest"
    let cleanPrompt = prompt;
    const toolNameLower = tool.name.toLowerCase();
    cleanPrompt = cleanPrompt.replace(new RegExp(toolNameLower.replace(/[_\-]/g, '[\\s_\\-]'), 'i'), '');
    cleanPrompt = cleanPrompt.replace(new RegExp(`\\b${tool.serverName}\\b`, 'i'), '');

    // Extract quoted strings
    const quotedStrings: string[] = [];
    const quotePattern = /["']([^"']+)["']/g;
    let qMatch: RegExpExecArray | null;
    while ((qMatch = quotePattern.exec(prompt)) !== null) {
        quotedStrings.push(qMatch[1]);
    }

    // Extract path-like patterns
    const pathPattern = /(?:\/[\w.\-/]+|[A-Z]:\\[\w.\-\\]+)/g;
    const paths = prompt.match(pathPattern) || [];

    // Extract numeric tokens
    const numberPattern = /\b(\d+(?:\.\d+)?)\b/g;
    const numbers: number[] = [];
    let nMatch: RegExpExecArray | null;
    while ((nMatch = numberPattern.exec(prompt)) !== null) {
        numbers.push(parseFloat(nMatch[1]));
    }

    // Get words that could be the "object" of the sentence (after the verb)
    const promptWords = cleanPrompt.trim().split(/\s+/).filter(
        w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()) && !ACTION_VERBS.has(w.toLowerCase()),
    );
    const objectPhrase = promptWords.join(' ').trim();

    let quotedIndex = 0;
    let pathIndex = 0;
    let numberIndex = 0;
    let usedObjectPhrase = false;

    const queryParamNames = new Set(['query', 'search', 'q', 'name', 'term', 'keyword', 'filter', 'pattern']);
    const pathParamNames = new Set(['path', 'dir', 'directory', 'file', 'filepath', 'filename', 'folder']);

    for (const [key, prop] of Object.entries(properties)) {
        const keyLower = key.toLowerCase();
        const propType = (prop as { type?: string }).type;

        if (pathParamNames.has(keyLower) && paths.length > pathIndex) {
            params[key] = paths[pathIndex++];
        } else if (queryParamNames.has(keyLower)) {
            if (quotedStrings.length > quotedIndex) {
                params[key] = quotedStrings[quotedIndex++];
            } else if (objectPhrase && !usedObjectPhrase) {
                params[key] = objectPhrase;
                usedObjectPhrase = true;
            }
        } else if (propType === 'number' || propType === 'integer') {
            if (numbers.length > numberIndex) {
                params[key] = numbers[numberIndex++];
            }
        } else if (propType === 'string') {
            // For generic string params, use quoted strings first
            if (quotedStrings.length > quotedIndex) {
                params[key] = quotedStrings[quotedIndex++];
            }
        }
    }

    // If there's a first required string param with no value yet,
    // and we have unused quoted strings, assign one
    const required = schema.required || [];
    for (const reqKey of required) {
        if (params[reqKey] !== undefined) continue;
        const prop = properties[reqKey] as { type?: string } | undefined;
        if (prop?.type === 'string' && quotedStrings.length > quotedIndex) {
            params[reqKey] = quotedStrings[quotedIndex++];
        }
    }

    return params;
}

/**
 * Calculate how many required params have been filled (0.0 - 1.0).
 */
function calculateParamCompleteness(
    params: Record<string, unknown>,
    tool: ToolDef,
): number {
    const schema = tool.inputSchema as { required?: string[] };
    const required = schema.required || [];

    if (required.length === 0) return 1.0;

    let filled = 0;
    for (const key of required) {
        if (params[key] !== undefined && params[key] !== '') {
            filled++;
        }
    }

    return filled / required.length;
}
