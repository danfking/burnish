import { test, expect } from '@playwright/test';

test.describe('Security', () => {
    test('card body rejects javascript: URLs in markdown links', async ({ page }) => {
        await page.goto('/');
        // Inject a burnish-card with a javascript: URL in the body
        await page.evaluate(() => {
            const card = document.createElement('burnish-card');
            card.setAttribute('title', 'XSS Test');
            card.setAttribute('body', 'Click [here](javascript:alert(1)) for details');
            card.setAttribute('status', 'info');
            document.querySelector('#dashboard-container')?.appendChild(card);
        });
        // Wait for component to render
        await page.waitForTimeout(500);
        // Check that no javascript: href exists in the shadow DOM
        const hasJsHref = await page.evaluate(() => {
            const card = document.querySelector('burnish-card[title="XSS Test"]');
            const shadow = card?.shadowRoot;
            if (!shadow) return false;
            const links = shadow.querySelectorAll('a[href]');
            return Array.from(links).some(a => /^\s*javascript\s*:/i.test(a.getAttribute('href') ?? ''));
        });
        expect(hasJsHref).toBe(false);
    });

    test('/api/tools/execute rejects array args', async ({ page }) => {
        await page.goto('/');
        const response = await page.request.post('/api/tools/execute', {
            data: { toolName: 'test_tool', args: [1, 2, 3] }
        });
        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('plain object');
    });

    test('/api/tools/execute rejects oversized args', async ({ page }) => {
        await page.goto('/');
        const hugeArgs: Record<string, string> = {};
        for (let i = 0; i < 1000; i++) {
            hugeArgs['key_' + i] = 'x'.repeat(100);
        }
        const response = await page.request.post('/api/tools/execute', {
            data: { toolName: 'test_tool', args: hugeArgs }
        });
        expect(response.status()).toBe(413);
    });

    test('/api/tools/execute rejects unconfirmed write tools', async ({ page }) => {
        await page.goto('/');
        // Get a real tool name that starts with create/delete
        const serversRes = await page.request.get('/api/servers');
        const { servers } = await serversRes.json();
        // Find a write tool if available
        let writeTool = null;
        for (const server of servers || []) {
            for (const tool of server.tools || []) {
                if (/^(create|delete|write)/.test(tool.name.split('__').pop() || '')) {
                    writeTool = tool.name;
                    break;
                }
            }
            if (writeTool) break;
        }
        if (writeTool) {
            const response = await page.request.post('/api/tools/execute', {
                data: { toolName: writeTool, args: {} }
            });
            expect(response.status()).toBe(403);
            const body = await response.json();
            expect(body.requiresConfirmation).toBe(true);
        }
    });
});
