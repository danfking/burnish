/**
 * Navigation tree utilities — pure functions for traversing node trees.
 */

export interface TreeNode {
    id: string;
    parentId?: string | null;
    children?: string[];
    [key: string]: unknown;
}

export interface TreeSession {
    nodes: TreeNode[];
    activeNodeId?: string | null;
}

export function getNodeById<T extends TreeNode>(session: TreeSession, id: string): T | undefined {
    return session.nodes.find(n => n.id === id) as T | undefined;
}

export function getChildren<T extends TreeNode>(session: TreeSession, nodeId: string): T[] {
    return session.nodes.filter(n => n.parentId === nodeId) as T[];
}

export function getRootNodes<T extends TreeNode>(session: TreeSession): T[] {
    return session.nodes.filter(n => !n.parentId) as T[];
}

export function getAncestryPath<T extends TreeNode>(session: TreeSession, nodeId: string): T[] {
    const path: T[] = [];
    let current = getNodeById<T>(session, nodeId);
    while (current) {
        path.unshift(current);
        current = current.parentId ? getNodeById<T>(session, current.parentId) : undefined;
    }
    return path;
}

export function getActivePath(session: TreeSession): Set<string> {
    if (!session.activeNodeId) return new Set();
    return new Set(getAncestryPath(session, session.activeNodeId).map(n => n.id));
}

export function getDescendantIds(session: TreeSession, nodeId: string): string[] {
    const ids = [nodeId];
    const children = getChildren(session, nodeId);
    for (const child of children) {
        ids.push(...getDescendantIds(session, child.id));
    }
    return ids;
}
