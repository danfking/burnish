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

const conversations = new Map<string, Conversation>();

export function getOrCreate(id?: string | null): Conversation {
    if (id && conversations.has(id)) return conversations.get(id)!;
    const conv: Conversation = {
        id: randomUUID(),
        messages: [],
        createdAt: Date.now(),
    };
    conversations.set(conv.id, conv);
    return conv;
}

export function get(id: string): Conversation | undefined {
    return conversations.get(id);
}

export function addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
): void {
    const conv = conversations.get(conversationId);
    if (!conv) return;
    conv.messages.push({ role, content, timestamp: Date.now() });
}
