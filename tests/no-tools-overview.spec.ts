import { test, expect } from '@playwright/test';

test('server overview button generates cards without calling tools', async ({ page }) => {
    await page.goto('/');

    // Wait for server buttons to load
    await page.waitForSelector('.burnish-suggestion-server');

    // Verify server buttons have data-no-tools attribute
    const noToolsAttr = await page.locator('.burnish-suggestion-server').first().getAttribute('data-no-tools');
    expect(noToolsAttr).toBe('true');

    // Click a server button (prefer filesystem — fewer tools, faster)
    const fsButton = page.locator('.burnish-suggestion-server', { hasText: 'filesystem' });
    if (await fsButton.count() > 0) {
        await fsButton.click();
    } else {
        // Click whatever server button exists
        await page.locator('.burnish-suggestion-server').first().click();
    }

    // Wait for response to complete
    await page.waitForFunction(() => {
        const btn = document.getElementById('btn-submit');
        return btn && !btn.classList.contains('cancel');
    }, { timeout: 120_000 });

    // Should have at least one node rendered
    const nodeCount = await page.locator('.burnish-node').count();
    expect(nodeCount).toBeGreaterThanOrEqual(1);

    // Should NOT have "No response received" (which means tool loop exhausted)
    const content = await page.locator('.burnish-node-content').first().textContent();
    expect(content).not.toContain('No response received');
});
