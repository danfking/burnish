import { test, expect } from '@playwright/test';

test('empty session persists after page refresh', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.burnish-session-item');

    const sessionId = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    expect(sessionId).toBeTruthy();

    await page.waitForTimeout(1000);

    await page.reload();
    await page.waitForSelector('.burnish-session-item');

    const sessionIdAfter = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    expect(sessionIdAfter).toBe(sessionId);
});

test('session with explorer steps persists after refresh', async ({ page }) => {
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warn') {
            console.log(`[browser ${msg.type()}] ${msg.text()}`);
        }
    });

    await page.goto('/');
    await page.waitForSelector('.burnish-session-item');

    // Wait for server buttons — skip test if MCP servers didn't connect
    const serverBtns = page.locator('#server-buttons button');
    try {
        await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
        test.skip(true, 'MCP servers not connected in time');
        return;
    }
    await page.locator('.burnish-suggestion-server').first().click();

    // Wait for tool listing to render
    await page.waitForSelector('burnish-card', { timeout: 10_000 });

    // Verify we have at least one node rendered
    const nodeCount = await page.locator('.burnish-node').count();
    expect(nodeCount).toBeGreaterThanOrEqual(1);

    // Get session info
    const sessionId = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');

    // Wait for saveState to flush
    await page.waitForTimeout(2000);

    // Refresh
    await page.reload();
    await page.waitForSelector('.burnish-session-item');

    // Session survived
    const sessionIdAfter = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    expect(sessionIdAfter).toBe(sessionId);

    // Nodes restored — tool listing should still be visible
    await page.waitForSelector('.burnish-node', { timeout: 10_000 });
    const nodeCountAfter = await page.locator('.burnish-node').count();
    console.log(`Nodes after refresh: ${nodeCountAfter}`);
    expect(nodeCountAfter, 'Nodes should be restored after refresh').toBeGreaterThanOrEqual(1);
});
