/**
 * In-memory conversation store.
 * Each conversation holds the full message history for multi-turn interactions.
 */

import { randomUUID } from 'node:crypto';

export interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export interface Conversation {
    id: string;
    messages: Message[];
    createdAt: number;
}

export class ConversationStore {
    private conversations = new Map<string, Conversation>();
    private maxConversations: number;

    constructor(maxConversations = 1000) {
        this.maxConversations = maxConversations;
    }

    getOrCreate(id?: string | null): Conversation {
        if (id && this.conversations.has(id)) return this.conversations.get(id)!;
        this.evictIfFull();
        const conv: Conversation = {
            id: randomUUID(),
            messages: [],
            createdAt: Date.now(),
        };
        this.conversations.set(conv.id, conv);
        return conv;
    }

    /** Evict the oldest conversation (first key in Map insertion order) when at capacity. */
    private evictIfFull(): void {
        if (this.conversations.size >= this.maxConversations) {
            const oldestKey = this.conversations.keys().next().value;
            if (oldestKey) this.conversations.delete(oldestKey);
        }
    }

    get(id: string): Conversation | undefined {
        return this.conversations.get(id);
    }

    addMessage(
        conversationId: string,
        role: 'user' | 'assistant',
        content: string,
    ): void {
        const conv = this.conversations.get(conversationId);
        if (!conv) return;
        conv.messages.push({ role, content, timestamp: Date.now() });
    }
}
