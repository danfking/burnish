import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { isWriteTool, authorizeToolCall, consumeAuthorization, guardToolExecution, safePath } from './guards.js';

describe('safePath', () => {
    const baseDir = resolve('/tmp/burnish-assets');

    it('accepts a URL-style path with a leading slash and treats it as relative to baseDir', () => {
        // Regression: v0.2.0 shipped a safePath that called path.resolve(baseDir, '/style.css'),
        // which on POSIX returns '/style.css' and on Windows returns the current drive root.
        // Both fail the startsWith(baseDir) check, causing every CLI static asset to 404.
        expect(safePath(baseDir, '/style.css')).toBe(resolve(baseDir, 'style.css'));
        expect(safePath(baseDir, '/components/card.js')).toBe(resolve(baseDir, 'components/card.js'));
    });

    it('accepts a relative path', () => {
        expect(safePath(baseDir, 'tokens.css')).toBe(resolve(baseDir, 'tokens.css'));
    });

    it('rejects path traversal attempts', () => {
        expect(safePath(baseDir, '../etc/passwd')).toBe(null);
        expect(safePath(baseDir, '/../../etc/passwd')).toBe(null);
    });
});

describe('isWriteTool', () => {
    it('identifies write tools by name prefix', () => {
        expect(isWriteTool('create_issue')).toBe(true);
        expect(isWriteTool('update_resource')).toBe(true);
        expect(isWriteTool('delete_file')).toBe(true);
        expect(isWriteTool('remove_item')).toBe(true);
        expect(isWriteTool('push_changes')).toBe(true);
        expect(isWriteTool('write_file')).toBe(true);
        expect(isWriteTool('edit_document')).toBe(true);
        expect(isWriteTool('move_file')).toBe(true);
        expect(isWriteTool('fork_repo')).toBe(true);
        expect(isWriteTool('merge_branch')).toBe(true);
        expect(isWriteTool('add_label')).toBe(true);
        expect(isWriteTool('set_config')).toBe(true);
        expect(isWriteTool('close_issue')).toBe(true);
        expect(isWriteTool('lock_thread')).toBe(true);
        expect(isWriteTool('assign_user')).toBe(true);
    });

    it('identifies read-only tools by name', () => {
        expect(isWriteTool('get_issue')).toBe(false);
        expect(isWriteTool('list_resources')).toBe(false);
        expect(isWriteTool('search_files')).toBe(false);
        expect(isWriteTool('read_file')).toBe(false);
        expect(isWriteTool('fetch_data')).toBe(false);
    });

    it('extracts base name from fully qualified MCP tool names', () => {
        expect(isWriteTool('mcp__github__create_issue')).toBe(true);
        expect(isWriteTool('mcp__github__get_issue')).toBe(false);
        expect(isWriteTool('mcp__filesystem__write_file')).toBe(true);
        expect(isWriteTool('mcp__filesystem__read_file')).toBe(false);
    });

    it('handles edge cases', () => {
        // Empty parts result in last element being empty string — falls back to full name
        expect(isWriteTool('')).toBe(false);
        // Single segment
        expect(isWriteTool('create')).toBe(true);
    });
});

describe('authorizeToolCall and consumeAuthorization', () => {
    it('generates a valid authorization token', () => {
        const token = authorizeToolCall('create_issue');
        expect(typeof token).toBe('string');
        expect(token.startsWith('create_issue:')).toBe(true);
    });

    it('authorizes a token once (one-time use)', () => {
        const token = authorizeToolCall('delete_file');
        expect(consumeAuthorization(token)).toBe(true);
        // Second consumption should fail
        expect(consumeAuthorization(token)).toBe(false);
    });

    it('rejects unknown tokens', () => {
        expect(consumeAuthorization('invalid-token-xyz')).toBe(false);
    });
});

describe('guardToolExecution', () => {
    it('blocks write tools without authorization', () => {
        const result = guardToolExecution('create_issue', {});
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('create_issue');
    });

    it('allows read-only tools', () => {
        const result = guardToolExecution('get_issue', {});
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('blocks fully qualified write tools', () => {
        const result = guardToolExecution('mcp__github__delete_branch', {});
        expect(result.allowed).toBe(false);
    });

    it('allows fully qualified read tools', () => {
        const result = guardToolExecution('mcp__github__list_issues', {});
        expect(result.allowed).toBe(true);
    });
});
