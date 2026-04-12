import { test, expect } from '@playwright/test';

// Regression tests for the post-0.2.2 UI bugs:
//  - Bug A: result cards rendered edge-to-edge by default
//  - Bug B: the Focus/Restore button produced no visible change because the
//           default node was already nearly the full width
test('result card is contained and Focus button visibly maximizes it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const serverBtns = page.locator('#server-buttons button');
    try {
        await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
        test.skip(true, 'MCP servers not connected in time');
        return;
    }

    // Trigger any tool result by clicking the first server button (deterministic listing)
    await serverBtns.first().click();
    await page.waitForSelector('.burnish-node', { timeout: 10_000 });

    const node = page.locator('.burnish-node').last();

    // Bug A: the un-focused node must be contained — not stretched edge-to-edge.
    const containedWidth = await node.evaluate((el) => (el as HTMLElement).offsetWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(containedWidth).toBeLessThan(viewportWidth - 100);

    // Bug B: clicking the Focus button must add the maximized class AND visibly
    // grow the node. We compare offsetWidth before/after to make sure the toggle
    // produces a real visual change, not just a class flip.
    const maxBtn = node.locator('.burnish-node-maximize');
    await expect(maxBtn).toHaveCount(1);
    await maxBtn.click();

    await expect(node).toHaveClass(/burnish-node-maximized/);
    const focusedWidth = await node.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(focusedWidth).toBeGreaterThan(containedWidth);

    // Toggling again should restore.
    await maxBtn.click();
    await expect(node).not.toHaveClass(/burnish-node-maximized/);
});
