import { test } from '@playwright/test';

test('component rendering check', async ({ page }) => {
    test.setTimeout(360_000); // 6 minutes

    await page.goto('/');
    await page.waitForSelector('.burnish-suggestion-server');

    // Click a server button to get a response
    await page.locator('.burnish-suggestion-server').first().click();

    // Wait for streaming to complete
    await page.waitForFunction(() => {
        const btn = document.getElementById('btn-submit');
        return btn && !btn.classList.contains('cancel');
    }, { timeout: 300_000 });
    await page.waitForTimeout(2000);

    // Screenshot the full response
    await page.screenshot({ path: 'tests/visual/screenshots/full-response.png', fullPage: true });

    // Try to screenshot individual component types if present
    const components = ['burnish-stat-bar', 'burnish-section', 'burnish-card', 'burnish-table', 'burnish-chart', 'burnish-metric', 'burnish-actions'];
    for (const tag of components) {
        const el = page.locator(tag).first();
        if (await el.count() > 0) {
            await el.screenshot({ path: `tests/visual/screenshots/component-${tag}.png` });
        }
    }

    // Screenshot the node header with feedback buttons
    const nodeHeader = page.locator('.burnish-node-header').first();
    if (await nodeHeader.count() > 0) {
        await nodeHeader.screenshot({ path: 'tests/visual/screenshots/node-header.png' });
    }

    // Log which components were found
    for (const tag of components) {
        const count = await page.locator(tag).count();
        console.log(`${tag}: ${count} instances`);
    }
});
