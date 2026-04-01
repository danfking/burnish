/**
 * Stream orchestrator — manages SSE streaming lifecycle.
 */

export interface WorkflowStep {
    server: string;
    tool: string;
    status: 'pending' | 'running' | 'success' | 'error';
}

export interface StreamCallbacks {
    onChunk: (chunk: string, fullText: string) => void;
    onDone: (fullText: string, conversationId: string) => void;
    onError: (error: string) => void;
    onProgress?: (stage: string, detail?: string, meta?: Record<string, string>) => void;
    onStats?: (stats: { durationMs: number; inputTokens: number; outputTokens: number; costUsd?: number }) => void;
    onWorkflowTrace?: (steps: WorkflowStep[]) => void;
}

export class StreamOrchestrator {
    private activeSource: EventSource | null = null;
    private cancelGeneration = 0;

    get isStreaming(): boolean {
        return this.activeSource !== null;
    }

    cancel(): void {
        this.cancelGeneration++;
        if (this.activeSource) {
            this.activeSource.close();
            this.activeSource = null;
        }
    }

    /**
     * Submit a prompt to the chat API and stream the response.
     */
    async submitPrompt(
        apiBase: string,
        prompt: string,
        conversationId: string | null,
        model: string | undefined,
        callbacks: StreamCallbacks,
    ): Promise<void> {
        try {
            const res = await fetch(`${apiBase}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, conversationId, model }),
            });
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const data = await res.json();
            const newConversationId = data.conversationId;
            await this.streamResponse(
                `${apiBase}${data.streamUrl}`,
                callbacks.onChunk,
                (fullText) => callbacks.onDone(fullText, newConversationId),
                callbacks.onError,
                callbacks.onProgress,
                callbacks.onStats,
                callbacks.onWorkflowTrace,
            );
        } catch (err) {
            callbacks.onError(err instanceof Error ? err.message : String(err));
        }
    }

    private streamResponse(
        streamUrl: string,
        onChunk: (chunk: string, fullText: string) => void,
        onDone: (fullText: string) => void,
        onError: (error: string) => void,
        onProgress?: (stage: string, detail?: string, meta?: Record<string, string>) => void,
        onStats?: (stats: { durationMs: number; inputTokens: number; outputTokens: number; costUsd?: number }) => void,
        onWorkflowTrace?: (steps: WorkflowStep[]) => void,
    ): Promise<void> {
        let fullText = '';
        const myGeneration = this.cancelGeneration;

        return new Promise((resolve) => {
            const source = new EventSource(streamUrl);
            this.activeSource = source;

            source.onmessage = (event) => {
                if (this.cancelGeneration > myGeneration) return;
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'error') {
                        source.close(); this.activeSource = null;
                        onError(data.message || 'Unknown error');
                        resolve();
                    } else if (data.type === 'progress') {
                        if (onProgress) onProgress(data.stage, data.detail, data.meta);
                    } else if (data.type === 'content') {
                        fullText += data.text;
                        onChunk(data.text, fullText);
                    } else if (data.type === 'workflow_trace') {
                        if (onWorkflowTrace) onWorkflowTrace(data.steps);
                    } else if (data.type === 'stats') {
                        if (onStats) onStats(data);
                    } else if (data.type === 'done') {
                        source.close(); this.activeSource = null;
                        onDone(fullText);
                        resolve();
                    }
                } catch (e) { console.error('SSE parse error:', e); }
            };

            source.onerror = () => {
                source.close(); this.activeSource = null;
                if (this.cancelGeneration > myGeneration) { resolve(); }
                else if (fullText) { onDone(fullText); resolve(); }
                else { onError('Connection lost'); resolve(); }
            };
        });
    }
}
