/**
 * Prompt Library — stores successful tool executions in IndexedDB
 * for auto-suggest and quick re-execution.
 *
 * Each entry records the tool name, arguments, display label, and
 * the server it belongs to. Entries are deduped by tool+args hash
 * and ordered by most-recent-use.
 */

import { get, set, createStore, type UseStore } from 'idb-keyval';

export interface PromptEntry {
    /** Unique id for this entry */
    id: string;
    /** Full tool name (e.g. mcp__filesystem__list_directory) */
    toolName: string;
    /** Short display label shown to the user */
    label: string;
    /** Tool arguments that were used */
    args: Record<string, unknown>;
    /** Server name this tool belongs to */
    serverName: string;
    /** Timestamp of last use */
    lastUsed: number;
    /** Number of times this prompt was used */
    useCount: number;
}

/** Maximum number of stored prompts */
const MAX_ENTRIES = 200;

/**
 * Generate a stable hash key for deduplication based on tool name + args.
 */
function promptKey(toolName: string, args: Record<string, unknown>): string {
    const normalized = JSON.stringify(args, Object.keys(args).sort());
    return `${toolName}::${normalized}`;
}

export class PromptLibrary {
    private db: UseStore;
    private cache: PromptEntry[] | null = null;

    constructor(dbName = 'burnish-prompt-library') {
        this.db = createStore(dbName, 'prompts');
    }

    /**
     * Load all entries from IndexedDB into memory cache.
     */
    private async ensureLoaded(): Promise<PromptEntry[]> {
        if (this.cache) return this.cache;
        const entries = await get('entries', this.db) as PromptEntry[] | undefined;
        this.cache = entries || [];
        return this.cache;
    }

    /**
     * Save the in-memory cache back to IndexedDB.
     */
    private async persist(): Promise<void> {
        if (!this.cache) return;
        await set('entries', this.cache, this.db);
    }

    /**
     * Record a successful tool execution. If the same tool+args combo
     * already exists, bump its useCount and lastUsed timestamp.
     */
    async record(
        toolName: string,
        args: Record<string, unknown>,
        label: string,
        serverName: string,
    ): Promise<void> {
        const entries = await this.ensureLoaded();
        const key = promptKey(toolName, args);

        const existing = entries.find(e => promptKey(e.toolName, e.args as Record<string, unknown>) === key);
        if (existing) {
            existing.lastUsed = Date.now();
            existing.useCount += 1;
            existing.label = label;
        } else {
            entries.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                toolName,
                label,
                args,
                serverName,
                lastUsed: Date.now(),
                useCount: 1,
            });
        }

        // Enforce max entries — evict least-recently-used
        if (entries.length > MAX_ENTRIES) {
            entries.sort((a, b) => b.lastUsed - a.lastUsed);
            entries.length = MAX_ENTRIES;
        }

        this.cache = entries;
        await this.persist();
    }

    /**
     * Get suggestions filtered by connected server names.
     * Returns entries sorted by most-recently-used first.
     */
    async suggest(connectedServers: string[]): Promise<PromptEntry[]> {
        const entries = await this.ensureLoaded();
        const serverSet = new Set(connectedServers);
        return entries
            .filter(e => serverSet.has(e.serverName))
            .sort((a, b) => b.lastUsed - a.lastUsed);
    }

    /**
     * Get suggestions for a specific tool, sorted by use count.
     */
    async suggestForTool(toolName: string): Promise<PromptEntry[]> {
        const entries = await this.ensureLoaded();
        return entries
            .filter(e => e.toolName === toolName)
            .sort((a, b) => b.useCount - a.useCount);
    }

    /**
     * Search entries by label text (case-insensitive substring match).
     */
    async search(query: string, connectedServers?: string[]): Promise<PromptEntry[]> {
        const entries = await this.ensureLoaded();
        const q = query.toLowerCase();
        const serverSet = connectedServers ? new Set(connectedServers) : null;
        return entries
            .filter(e => {
                if (serverSet && !serverSet.has(e.serverName)) return false;
                return e.label.toLowerCase().includes(q) ||
                    e.toolName.toLowerCase().includes(q);
            })
            .sort((a, b) => b.lastUsed - a.lastUsed);
    }

    /**
     * Remove a specific entry by id.
     */
    async remove(entryId: string): Promise<void> {
        const entries = await this.ensureLoaded();
        const idx = entries.findIndex(e => e.id === entryId);
        if (idx >= 0) {
            entries.splice(idx, 1);
            await this.persist();
        }
    }

    /**
     * Clear all entries.
     */
    async clear(): Promise<void> {
        this.cache = [];
        await this.persist();
    }

    /**
     * Get total number of stored prompts.
     */
    async count(): Promise<number> {
        const entries = await this.ensureLoaded();
        return entries.length;
    }

    /**
     * Synchronous access to cached entries for a specific tool.
     * Returns empty array if cache is not yet loaded.
     * Call suggest() or suggestForTool() first to populate the cache.
     */
    getCachedForTool(toolName: string): PromptEntry[] {
        if (!this.cache) return [];
        return this.cache
            .filter(e => e.toolName === toolName)
            .sort((a, b) => b.useCount - a.useCount);
    }
}
