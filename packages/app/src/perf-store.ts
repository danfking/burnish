/**
 * Model performance tracking store.
 * Records per-response metrics and provides aggregated stats.
 * Uses localStorage for simplicity and persistence.
 */

export interface PerfRecord {
    id: string;
    timestamp: number;
    model: string;
    toolName: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    /** Whether burnish components were present in the response */
    componentSuccess: boolean;
    /** Number of burnish-* tags found in the response */
    componentCount: number;
}

export interface ModelStats {
    model: string;
    requestCount: number;
    avgLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    componentSuccessRate: number;
    avgComponentCount: number;
}

export interface ToolStats {
    toolName: string;
    requestCount: number;
    avgLatencyMs: number;
    componentSuccessRate: number;
}

const STORAGE_KEY = 'burnish:perfRecords';
const MAX_RECORDS = 500;

export class PerfStore {
    private records: PerfRecord[] = [];

    constructor() {
        this.load();
    }

    private load(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                this.records = JSON.parse(raw);
            }
        } catch {
            this.records = [];
        }
    }

    private persist(): void {
        try {
            // Enforce max records — evict oldest first
            if (this.records.length > MAX_RECORDS) {
                this.records = this.records.slice(-MAX_RECORDS);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
        } catch {
            // localStorage full — trim further
            this.records = this.records.slice(-100);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
            } catch { /* give up */ }
        }
    }

    /** Record a new performance entry. */
    add(record: Omit<PerfRecord, 'id' | 'timestamp'>): PerfRecord {
        const entry: PerfRecord = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            ...record,
        };
        this.records.push(entry);
        this.persist();
        return entry;
    }

    /** Get all records, newest first. */
    getAll(): PerfRecord[] {
        return [...this.records].reverse();
    }

    /** Get records filtered by time range. */
    getRecent(withinMs: number): PerfRecord[] {
        const cutoff = Date.now() - withinMs;
        return this.records.filter(r => r.timestamp >= cutoff).reverse();
    }

    /** Aggregate stats per model. */
    getModelStats(): ModelStats[] {
        const byModel = new Map<string, PerfRecord[]>();
        for (const r of this.records) {
            const group = byModel.get(r.model) || [];
            group.push(r);
            byModel.set(r.model, group);
        }

        const stats: ModelStats[] = [];
        for (const [model, records] of byModel) {
            const latencies = records.map(r => r.latencyMs);
            const successCount = records.filter(r => r.componentSuccess).length;
            stats.push({
                model,
                requestCount: records.length,
                avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
                minLatencyMs: Math.min(...latencies),
                maxLatencyMs: Math.max(...latencies),
                totalInputTokens: records.reduce((a, r) => a + r.inputTokens, 0),
                totalOutputTokens: records.reduce((a, r) => a + r.outputTokens, 0),
                totalCostUsd: records.reduce((a, r) => a + r.costUsd, 0),
                componentSuccessRate: records.length > 0 ? successCount / records.length : 0,
                avgComponentCount: records.length > 0
                    ? Math.round(records.reduce((a, r) => a + r.componentCount, 0) / records.length * 10) / 10
                    : 0,
            });
        }

        // Sort by request count descending
        stats.sort((a, b) => b.requestCount - a.requestCount);
        return stats;
    }

    /** Aggregate stats per tool. */
    getToolStats(): ToolStats[] {
        const byTool = new Map<string, PerfRecord[]>();
        for (const r of this.records) {
            if (!r.toolName || r.toolName === 'none') continue;
            const group = byTool.get(r.toolName) || [];
            group.push(r);
            byTool.set(r.toolName, group);
        }

        const stats: ToolStats[] = [];
        for (const [toolName, records] of byTool) {
            const latencies = records.map(r => r.latencyMs);
            const successCount = records.filter(r => r.componentSuccess).length;
            stats.push({
                toolName,
                requestCount: records.length,
                avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
                componentSuccessRate: records.length > 0 ? successCount / records.length : 0,
            });
        }

        stats.sort((a, b) => b.requestCount - a.requestCount);
        return stats;
    }

    /** Get total count. */
    get count(): number {
        return this.records.length;
    }

    /** Clear all records. */
    clear(): void {
        this.records = [];
        localStorage.removeItem(STORAGE_KEY);
    }
}
