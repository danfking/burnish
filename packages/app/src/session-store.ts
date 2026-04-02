/**
 * Session persistence via IndexedDB (idb-keyval).
 * Handles save, load, lazy-loading of nodes, and migration from localStorage.
 */

import { get, set, del, keys, createStore, type UseStore } from 'idb-keyval';

export interface SessionMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    conversationId: string | null;
    activeNodeId: string | null;
    nodeIds: string[];
}

export interface AppNode {
    id: string;
    parentId?: string | null;
    children?: string[];
    prompt: string;
    promptDisplay?: string;
    response?: string | null;
    type?: string | null;
    summary?: string | null;
    tags?: string[] | null;
    stats?: { durationMs: number; inputTokens: number; outputTokens: number; costUsd?: number } | null;
    timestamp: number;
    collapsed?: boolean;
    _hasExplicitLabel?: boolean;
    _toolHint?: { toolName: string; title: string } | null;
    _progressLog?: Array<{ stage: string; detail?: string; meta?: Record<string, string>; timestamp: number }>;
    _nodeIds?: string[];
    [key: string]: unknown;
}

export interface AppSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    conversationId: string | null;
    activeNodeId: string | null;
    nodes: AppNode[];
    _nodeIds?: string[];
}

/** Maximum number of sessions allowed */
const MAX_SESSIONS = 100;
/** Maximum total storage size in bytes (10 MB) */
const MAX_STORAGE_BYTES = 10 * 1024 * 1024;

export class SessionStore {
    private sessionDb: UseStore;
    private nodeDb: UseStore;
    private _loadedSessionIds = new Set<string>();

    constructor(
        sessionDbName = 'burnish-sessions',
        nodeDbName = 'burnish-nodes',
    ) {
        this.sessionDb = createStore(sessionDbName, 'sessions');
        this.nodeDb = createStore(nodeDbName, 'nodes');
    }

    get loadedSessionIds(): ReadonlySet<string> {
        return this._loadedSessionIds;
    }

    markLoaded(sessionId: string): void {
        this._loadedSessionIds.add(sessionId);
    }

    markUnloaded(sessionId: string): void {
        this._loadedSessionIds.delete(sessionId);
    }

    isLoaded(sessionId: string): boolean {
        return this._loadedSessionIds.has(sessionId);
    }

    async save(sessions: AppSession[], activeSessionId: string | null): Promise<void> {
        try {
            // Enforce session count limit — evict oldest sessions first
            if (sessions.length > MAX_SESSIONS) {
                const sorted = [...sessions].sort((a, b) => a.updatedAt - b.updatedAt);
                const toEvict = sorted.slice(0, sessions.length - MAX_SESSIONS);
                const evictIds = new Set(toEvict.map(s => s.id));
                // Delete evicted session nodes
                for (const s of toEvict) {
                    const nodeIds = this._loadedSessionIds.has(s.id)
                        ? s.nodes.map(n => n.id)
                        : (s._nodeIds || []);
                    if (nodeIds.length > 0) await this.deleteNodes(nodeIds);
                    this._loadedSessionIds.delete(s.id);
                }
                sessions = sessions.filter(s => !evictIds.has(s.id));
                if (activeSessionId && evictIds.has(activeSessionId)) {
                    activeSessionId = sessions.length > 0 ? sessions[sessions.length - 1].id : null;
                }
            }

            // Enforce total storage size limit — estimate and evict oldest if exceeded
            let estimatedSize = 0;
            const sessionsByAge = [...sessions].sort((a, b) => a.updatedAt - b.updatedAt);
            for (const s of sessionsByAge) {
                const nodeCount = this._loadedSessionIds.has(s.id) ? s.nodes.length : (s._nodeIds?.length || 0);
                // Rough estimate: ~2KB per node average
                estimatedSize += 200 + nodeCount * 2048;
            }
            while (estimatedSize > MAX_STORAGE_BYTES && sessions.length > 1) {
                const oldest = sessionsByAge.shift()!;
                if (oldest.id === activeSessionId) continue;
                const nodeIds = this._loadedSessionIds.has(oldest.id)
                    ? oldest.nodes.map(n => n.id)
                    : (oldest._nodeIds || []);
                if (nodeIds.length > 0) await this.deleteNodes(nodeIds);
                this._loadedSessionIds.delete(oldest.id);
                sessions = sessions.filter(s => s.id !== oldest.id);
                const nodeCount = nodeIds.length;
                estimatedSize -= 200 + nodeCount * 2048;
            }

            const sessionMeta = sessions.map(s => ({
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                conversationId: s.conversationId,
                activeNodeId: s.activeNodeId,
                nodeIds: this._loadedSessionIds.has(s.id) ? s.nodes.map(n => n.id) : (s._nodeIds || []),
            }));
            await set('sessions', { activeSessionId, sessions: sessionMeta }, this.sessionDb);

            const nodePromises: Promise<void>[] = [];
            for (const s of sessions) {
                if (!this._loadedSessionIds.has(s.id)) continue;
                for (const node of s.nodes) {
                    nodePromises.push(set(`node:${node.id}`, node, this.nodeDb));
                }
            }
            await Promise.all(nodePromises);
        } catch (e) {
            console.error('Failed to save state:', e);
        }
    }

    async load(): Promise<{ activeSessionId: string; sessions: AppSession[] } | null> {
        try {
            await this.migrateFromLocalStorage();

            const data = await get('sessions', this.sessionDb);
            if (!data?.sessions?.length) return null;

            const activeId = data.activeSessionId || data.sessions[0].id;
            const fullSessions: AppSession[] = [];

            for (const meta of data.sessions) {
                const session: AppSession = {
                    id: meta.id,
                    title: meta.title,
                    createdAt: meta.createdAt,
                    updatedAt: meta.updatedAt,
                    conversationId: meta.conversationId,
                    activeNodeId: meta.activeNodeId,
                    nodes: [],
                };

                if (meta.id === activeId) {
                    await this.loadNodes(session, meta.nodeIds || []);
                    this._loadedSessionIds.add(meta.id);
                } else {
                    session._nodeIds = meta.nodeIds || [];
                }

                fullSessions.push(session);
            }

            return { activeSessionId: activeId, sessions: fullSessions };
        } catch (e) {
            console.error('Failed to load state:', e);
            return null;
        }
    }

    async loadNodes(session: AppSession, nodeIds: string[]): Promise<void> {
        if (!nodeIds || nodeIds.length === 0) return;
        const nodes = await Promise.all(
            nodeIds.map(id => get(`node:${id}`, this.nodeDb)),
        );
        session.nodes = nodes.filter(Boolean) as AppNode[];
    }

    /**
     * Look up a session's nodeIds from persisted metadata.
     * Useful when a session hasn't been loaded into memory.
     */
    async getSessionNodeIds(sessionId: string): Promise<string[] | null> {
        try {
            const data = await get('sessions', this.sessionDb);
            const meta = data?.sessions?.find((s: SessionMeta) => s.id === sessionId);
            return meta?.nodeIds?.length ? meta.nodeIds : null;
        } catch {
            return null;
        }
    }

    async deleteNodes(nodeIds: string[]): Promise<void> {
        await Promise.all(nodeIds.map(id => del(`node:${id}`, this.nodeDb)));
    }

    async clear(): Promise<void> {
        const allKeys = await keys(this.nodeDb);
        await Promise.all(allKeys.map(k => del(k, this.nodeDb)));
        await del('sessions', this.sessionDb);
        this._loadedSessionIds.clear();
    }

    async migrateFromLocalStorage(): Promise<void> {
        try {
            if (typeof localStorage === 'undefined') return;

            const existing = await get('sessions', this.sessionDb);
            if (existing) return;

            // Try new multi-session format from localStorage
            const raw = localStorage.getItem('burnish:sessions');
            if (raw) {
                const data = JSON.parse(raw);
                if (data?.sessions?.length > 0) {
                    const sessionMeta = data.sessions.map((s: any) => ({
                        id: s.id,
                        title: s.title,
                        createdAt: s.createdAt,
                        updatedAt: s.updatedAt,
                        conversationId: s.conversationId,
                        activeNodeId: s.activeNodeId,
                        nodeIds: (s.nodes || []).map((n: any) => n.id),
                    }));
                    await set('sessions', { activeSessionId: data.activeSessionId, sessions: sessionMeta }, this.sessionDb);

                    const nodePromises: Promise<void>[] = [];
                    for (const s of data.sessions) {
                        for (const node of (s.nodes || [])) {
                            nodePromises.push(set(`node:${node.id}`, node, this.nodeDb));
                        }
                    }
                    await Promise.all(nodePromises);

                    localStorage.removeItem('burnish:sessions');
                    return;
                }
            }

            // Try old single-session format
            const oldRaw = localStorage.getItem('burnish:state');
            if (oldRaw) {
                const old = JSON.parse(oldRaw);
                if (old.nodes?.length > 0) {
                    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                    const sessionMeta = [{
                        id: sessionId,
                        title: old.nodes[0]?.promptDisplay || 'Previous session',
                        createdAt: old.nodes[0]?.timestamp || Date.now(),
                        updatedAt: old.nodes[old.nodes.length - 1]?.timestamp || Date.now(),
                        conversationId: old.conversationId,
                        activeNodeId: old.nodes[old.nodes.length - 1]?.id,
                        nodeIds: old.nodes.map((n: any) => n.id),
                    }];
                    await set('sessions', { activeSessionId: sessionId, sessions: sessionMeta }, this.sessionDb);

                    const nodePromises = old.nodes.map((n: any) => set(`node:${n.id}`, n, this.nodeDb));
                    await Promise.all(nodePromises);
                }
                localStorage.removeItem('burnish:state');
            }
        } catch (e) {
            console.error('Migration from localStorage failed:', e);
        }
    }
}
