import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test('horizontal scroll at 375px with tool listing', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Check h-scroll on initial page
    const initialHScroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    console.log('Initial h-scroll:', initialHScroll);

    const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
    await githubBtn.click();
    await page.waitForTimeout(2000);

    const afterHScroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    console.log('After tool listing h-scroll:', afterHScroll);

    // Find what element is causing overflow
    const overflowCulprit = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const elements = document.querySelectorAll('*');
        const culprits: string[] = [];
        elements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > vw + 2) {
                const tag = el.tagName.toLowerCase();
                const cls = el.className ? `.${Array.from(el.classList).join('.')}` : '';
                const id = el.id ? `#${el.id}` : '';
                culprits.push(`${tag}${id}${cls} (right: ${rect.right.toFixed(0)}, width: ${rect.width.toFixed(0)})`);
            }
        });
        return culprits.slice(0, 10);
    });
    console.log('Overflow culprits:', overflowCulprit);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-15-hscroll-375.png`, fullPage: true });
});
