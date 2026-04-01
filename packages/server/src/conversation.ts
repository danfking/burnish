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

const DEFAULT_MAX_CONVERSATIONS = 100;
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 200;

export class ConversationStore {
    private conversations = new Map<string, Conversation>();
    private maxConversations: number;
    private maxMessages: number;

    constructor(
        maxConversations = DEFAULT_MAX_CONVERSATIONS,
        maxMessages = DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
    ) {
        this.maxConversations = maxConversations;
        this.maxMessages = maxMessages;
    }

    getOrCreate(id?: string | null): Conversation {
        if (id && this.conversations.has(id)) return this.conversations.get(id)!;

        // Evict oldest conversation if at capacity
        if (this.conversations.size >= this.maxConversations) {
            let oldestId: string | undefined;
            let oldestTime = Infinity;
            for (const [cid, conv] of this.conversations) {
                if (conv.createdAt < oldestTime) {
                    oldestTime = conv.createdAt;
                    oldestId = cid;
                }
            }
            if (oldestId) this.conversations.delete(oldestId);
        }

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

        // Enforce max messages per conversation
        if (conv.messages.length >= this.maxMessages) {
            // Remove the oldest message to make room
            conv.messages.shift();
        }

        conv.messages.push({ role, content, timestamp: Date.now() });
    }
}
