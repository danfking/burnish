import { test, expect } from '@playwright/test';

test.describe('Error message handling', () => {
    test('tool execution error shows descriptive message', async ({ page }) => {
        await page.goto('/');

        // Discover a real tool name from the server so we don't hardcode prefixes
        const serversResp = await page.request.get('/api/servers');
        const data = await serversResp.json();
        const firstServer = (data.servers || data)[0];
        if (!firstServer || !firstServer.tools?.length) { test.skip(); return; }
        const readTool = firstServer.tools.find((t: any) => /read.file/i.test(t.name)) || firstServer.tools[0];
        const toolName = readTool.name;

        // Call /api/tools/execute with a nonexistent path to trigger an error
        const response = await page.request.post('/api/tools/execute', {
            data: {
                toolName,
                args: { path: '/nonexistent/path/that/does/not/exist/at/all' }
            }
        });

        const body = await response.json();

        // Verify error message is NOT just the old generic "Tool execution failed"
        expect(body.error).toBeDefined();
        expect(body.error).not.toBe('Tool execution failed');
        expect(body.error.length).toBeGreaterThan(10); // Should have meaningful detail
    });

    test('/api/tools/execute rejects array args with 400', async ({ page }) => {
        await page.goto('/');
        const response = await page.request.post('/api/tools/execute', {
            data: { toolName: 'read_file', args: ['invalid'] }
        });
        expect(response.status()).toBe(400);
    });

    test('/api/tools/execute rejects oversized args with 413', async ({ page }) => {
        await page.goto('/');
        const args: Record<string, string> = {};
        for (let i = 0; i < 1000; i++) args['k' + i] = 'x'.repeat(100);
        const response = await page.request.post('/api/tools/execute', {
            data: { toolName: 'read_file', args }
        });
        expect(response.status()).toBe(413);
    });
});
