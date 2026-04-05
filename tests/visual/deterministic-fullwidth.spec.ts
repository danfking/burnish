import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test('full width tool listing at 1920px', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await page.waitForTimeout(3000);

    const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
    await githubBtn.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-11-fullwidth-1920.png`, fullPage: true });

    // Scroll down to see more sections
    await page.evaluate(() => {
        const main = document.querySelector('#content-area') || document.querySelector('main');
        if (main) main.scrollTop = main.scrollHeight / 2;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-12-fullwidth-scrolled.png`, fullPage: true });
});
