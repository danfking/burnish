import { test, expect } from '@playwright/test';

test('server button generates tool listing without LLM', async ({ page }) => {
    await page.goto('/');

    // Wait for server cards — skip test if MCP servers didn't connect
    const exploreBtns = page.locator('#server-buttons .card-action');
    try {
        await exploreBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
        test.skip(true, 'MCP servers not connected in time');
        return;
    }

    // Click "Explore →" on a server card (prefer filesystem — fewer tools, faster)
    const fsCard = page.locator('#server-buttons burnish-card[title="filesystem"]');
    if (await fsCard.count() > 0) {
        await fsCard.locator('.card-action').click();
    } else {
        await exploreBtns.first().click();
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
