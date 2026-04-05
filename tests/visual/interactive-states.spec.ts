import { test } from '@playwright/test';

test('interactive state screenshots', async ({ page }) => {
    test.setTimeout(300_000); // 5 minutes for slow local models

    await page.goto('http://localhost:3000/');
    await page.waitForSelector('#prompt-input');

    // State 1: Empty state with server buttons and starter prompts
    await page.waitForTimeout(3000); // Wait for dynamic suggestions to load
    await page.screenshot({ path: 'tests/visual/screenshots/state-empty.png', fullPage: true });

    // State 2: Streaming/loading state - capture during response
    await page.fill('#prompt-input', 'List the tools available');
    await page.click('#btn-submit');
    await page.waitForTimeout(3000); // Capture mid-stream
    await page.screenshot({ path: 'tests/visual/screenshots/state-streaming.png', fullPage: true });

    // State 3: Complete state - poll for cancel class removal with logging
    for (let i = 0; i < 24; i++) {
        await page.waitForTimeout(10000); // 10s intervals
        const btnClass = await page.evaluate(() => {
            const btn = document.getElementById('btn-submit');
            return btn ? btn.className : 'NOT FOUND';
        });
        if (!btnClass.includes('cancel')) {
            break;
        }
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/visual/screenshots/state-complete.png', fullPage: true });

    // State 4: Click node header to collapse
    const nodeHeader = page.locator('.burnish-node-header').first();
    if (await nodeHeader.count() > 0) {
        await nodeHeader.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'tests/visual/screenshots/state-collapsed.png', fullPage: true });

        // Click again to expand
        await nodeHeader.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'tests/visual/screenshots/state-expanded.png', fullPage: true });
    }

    // State 5: New session via "+" button
    await page.click('#btn-new-session');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/visual/screenshots/state-new-session.png', fullPage: true });
});
