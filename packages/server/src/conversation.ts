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

    getOrCreate(id?: string | null): Conversation {
        if (id && this.conversations.has(id)) return this.conversations.get(id)!;
        const conv: Conversation = {
            id: randomUUID(),
            messages: [],
            createdAt: Date.now(),
        };
        this.conversations.set(conv.id, conv);
        return conv;
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
