import { test, expect } from '@playwright/test';

test('server button generates tool listing without LLM', async ({ page }) => {
    await page.goto('/');

    // Wait for server buttons — skip test if MCP servers didn't connect
    const serverBtns = page.locator('#server-buttons button');
    try {
        await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
        test.skip(true, 'MCP servers not connected in time');
        return;
    }

    // Click a server button (prefer filesystem — fewer tools, faster)
    const fsButton = page.locator('.burnish-suggestion-server', { hasText: 'filesystem' });
    if (await fsButton.count() > 0) {
        await fsButton.click();
    } else {
        // Click whatever server button exists
        await page.locator('.burnish-suggestion-server').first().click();
    }

    // Wait for a node to appear
    await page.waitForSelector('.burnish-node', { timeout: 10_000 });

    // Should have at least one node rendered
    const nodeCount = await page.locator('.burnish-node').count();
    expect(nodeCount).toBeGreaterThanOrEqual(1);

    // Should have burnish-card components (tool listing)
    const cardCount = await page.locator('burnish-card').count();
    expect(cardCount).toBeGreaterThanOrEqual(1);
});
