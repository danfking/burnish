/**
 * Template store — learns from positively-rated responses.
 *
 * When a response gets a positive signal (thumbs-up, drill-down engagement),
 * extracts the HTML layout as a template and persists it in IndexedDB.
 * These templates are later injected as few-shot examples in the system prompt
 * via `extraInstructions`.
 */

import { get, set, del, keys, createStore, type UseStore } from 'idb-keyval';

/** A learned template extracted from a successful response. */
export interface LearnedTemplate {
    /** Unique identifier */
    id: string;
    /** Tool name or server+tool combo that produced this response */
    toolKey: string;
    /** The HTML layout structure (sanitized — tags + attributes, no raw data) */
    htmlStructure: string;
    /** The original user prompt that led to this response */
    prompt: string;
    /** How the template was learned: 'thumbs-up' or 'drill-down' */
    signal: 'thumbs-up' | 'drill-down';
    /** Number of times this template has been reinforced */
    useCount: number;
    /** Timestamp when first learned */
    createdAt: number;
    /** Timestamp when last reinforced */
    updatedAt: number;
}

/** Maximum templates per tool key */
const MAX_TEMPLATES_PER_TOOL = 3;
/** Maximum total templates stored */
const MAX_TOTAL_TEMPLATES = 50;
/** Maximum HTML structure length (characters) */
const MAX_STRUCTURE_LENGTH = 2000;

/**
 * Extract the structural layout from a burnish-* HTML response.
 *
 * Strips data content from attributes (JSON values, body text, etc.)
 * but preserves the component hierarchy and attribute names. This gives
 * the LLM a skeleton to follow without memorizing specific data.
 */
export function extractHtmlStructure(html: string): string {
    if (!html || typeof html !== 'string') return '';

    // Only keep burnish-* tags — strip everything else
    // Replace JSON attribute values with placeholder to show structure
    let structure = html
        // Remove excessive whitespace between tags
        .replace(/>\s+</g, '>\n<')
        // Strip body/content attribute values but keep the attribute name
        .replace(/\b(body|content|meta|items|columns|rows|config|fields|actions)='[^']*'/g, '$1="..."')
        .replace(/\b(body|content|meta|items|columns|rows|config|fields|actions)="[^"]*"/g, '$1="..."')
        // Strip title values but keep the attribute
        .replace(/\b(title)="[^"]*"/g, '$1="..."')
        .replace(/\b(title)='[^']*'/g, '$1="..."')
        // Strip item-id values
        .replace(/\b(item-id)="[^"]*"/g, '$1="..."')
        .replace(/\b(item-id)='[^']*'/g, '$1="..."')
        // Strip tool-id values
        .replace(/\b(tool-id)="[^"]*"/g, '$1="..."')
        .replace(/\b(tool-id)='[^']*'/g, '$1="..."')
        // Keep status, type, trend, label, value, count attributes as-is
        // (they show the pattern of component usage)
        .trim();

    // Truncate if too long
    if (structure.length > MAX_STRUCTURE_LENGTH) {
        structure = structure.substring(0, MAX_STRUCTURE_LENGTH) + '\n<!-- truncated -->';
    }

    return structure;
}

/**
 * Derive a tool key from a response's context.
 *
 * Uses the tool name if available, or falls back to a generic key
 * derived from the prompt.
 */
export function deriveToolKey(toolName?: string | null, serverName?: string | null): string {
    if (toolName) {
        // Strip mcp__ prefix and server name for a cleaner key
        const cleaned = toolName.replace(/^mcp__\w+__/, '');
        return serverName ? `${serverName}/${cleaned}` : cleaned;
    }
    return '_general';
}

export class TemplateStore {
    private db: UseStore;

    constructor(dbName = 'burnish-templates') {
        this.db = createStore(dbName, 'templates');
    }

    /**
     * Save a learned template from a positively-rated response.
     *
     * If a template with the same tool key and similar structure already
     * exists, reinforces it (increments useCount) instead of duplicating.
     */
    async saveTemplate(
        toolKey: string,
        html: string,
        prompt: string,
        signal: 'thumbs-up' | 'drill-down',
    ): Promise<LearnedTemplate | null> {
        const structure = extractHtmlStructure(html);
        if (!structure || structure.length < 20) return null; // Too short to be useful

        // Check for existing similar template
        const existing = await this.getTemplatesForTool(toolKey);
        const similar = existing.find(t => this.isSimilarStructure(t.htmlStructure, structure));

        if (similar) {
            // Reinforce existing template
            similar.useCount++;
            similar.updatedAt = Date.now();
            if (signal === 'thumbs-up') {
                // Thumbs-up is a stronger signal — upgrade if it was drill-down
                similar.signal = 'thumbs-up';
            }
            await set(`template:${similar.id}`, similar, this.db);
            return similar;
        }

        // New template — evict oldest if at capacity for this tool
        if (existing.length >= MAX_TEMPLATES_PER_TOOL) {
            const oldest = existing.sort((a, b) => a.updatedAt - b.updatedAt)[0];
            await del(`template:${oldest.id}`, this.db);
        }

        // Enforce total limit
        await this.enforceGlobalLimit();

        const template: LearnedTemplate = {
            id: this.generateId(),
            toolKey,
            htmlStructure: structure,
            prompt: prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt,
            signal,
            useCount: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await set(`template:${template.id}`, template, this.db);
        return template;
    }

    /**
     * Get all templates for a specific tool key.
     */
    async getTemplatesForTool(toolKey: string): Promise<LearnedTemplate[]> {
        const allKeys = await keys(this.db);
        const templates: LearnedTemplate[] = [];

        for (const key of allKeys) {
            if (typeof key !== 'string' || !key.startsWith('template:')) continue;
            const template = await get(key, this.db) as LearnedTemplate | undefined;
            if (template?.toolKey === toolKey) {
                templates.push(template);
            }
        }

        return templates.sort((a, b) => b.useCount - a.useCount);
    }

    /**
     * Get the best templates for injection into the system prompt.
     *
     * Returns templates sorted by relevance: matching tool key first,
     * then by use count. Limited to a reasonable number for prompt size.
     */
    async getBestTemplates(toolKey?: string, limit = 2): Promise<LearnedTemplate[]> {
        const allKeys = await keys(this.db);
        const templates: LearnedTemplate[] = [];

        for (const key of allKeys) {
            if (typeof key !== 'string' || !key.startsWith('template:')) continue;
            const template = await get(key, this.db) as LearnedTemplate | undefined;
            if (template) templates.push(template);
        }

        // Sort: matching tool key first, then by use count, then by recency
        return templates
            .sort((a, b) => {
                const aMatch = toolKey && a.toolKey === toolKey ? 1 : 0;
                const bMatch = toolKey && b.toolKey === toolKey ? 1 : 0;
                if (aMatch !== bMatch) return bMatch - aMatch;
                if (a.useCount !== b.useCount) return b.useCount - a.useCount;
                return b.updatedAt - a.updatedAt;
            })
            .slice(0, limit);
    }

    /**
     * Get all stored templates.
     */
    async getAllTemplates(): Promise<LearnedTemplate[]> {
        const allKeys = await keys(this.db);
        const templates: LearnedTemplate[] = [];

        for (const key of allKeys) {
            if (typeof key !== 'string' || !key.startsWith('template:')) continue;
            const template = await get(key, this.db) as LearnedTemplate | undefined;
            if (template) templates.push(template);
        }

        return templates.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /**
     * Delete a specific template.
     */
    async deleteTemplate(id: string): Promise<void> {
        await del(`template:${id}`, this.db);
    }

    /**
     * Clear all stored templates.
     */
    async clear(): Promise<void> {
        const allKeys = await keys(this.db);
        for (const key of allKeys) {
            if (typeof key === 'string' && key.startsWith('template:')) {
                await del(key, this.db);
            }
        }
    }

    /**
     * Check if two HTML structures are similar enough to be considered
     * the same template pattern.
     */
    private isSimilarStructure(a: string, b: string): boolean {
        // Extract just the tag sequence for comparison
        const tagsA = this.extractTagSequence(a);
        const tagsB = this.extractTagSequence(b);
        return tagsA === tagsB;
    }

    /**
     * Extract the sequence of burnish-* tag names from HTML structure.
     */
    private extractTagSequence(html: string): string {
        const tags = html.match(/<\/?burnish-[a-z-]+/g) || [];
        return tags.join(',');
    }

    private generateId(): string {
        return crypto.randomUUID();
    }

    private async enforceGlobalLimit(): Promise<void> {
        const allKeys = await keys(this.db);
        const templateKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith('template:'));

        if (templateKeys.length < MAX_TOTAL_TEMPLATES) return;

        // Load all, sort by least useful, delete excess
        const templates: LearnedTemplate[] = [];
        for (const key of templateKeys) {
            const t = await get(key, this.db) as LearnedTemplate | undefined;
            if (t) templates.push(t);
        }

        templates.sort((a, b) => {
            if (a.useCount !== b.useCount) return a.useCount - b.useCount;
            return a.updatedAt - b.updatedAt;
        });

        const toRemove = templates.slice(0, templates.length - MAX_TOTAL_TEMPLATES + 1);
        for (const t of toRemove) {
            await del(`template:${t.id}`, this.db);
        }
    }
}
