import { chromium } from '@playwright/test';

const URL = process.env.BURNISH_URL || 'http://localhost:3411';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.burnish-suggestion-server', { timeout: 10000 });
await page.waitForFunction(() => {
    const el = document.querySelector('.burnish-server-card-description');
    return el && el.textContent && el.textContent.trim().length > 0;
}, { timeout: 5000 });

for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(150);
    const out = `tests/visual/screenshots/verify-411-${theme}.png`;
    await page.screenshot({ path: out, fullPage: false });
    console.log('saved', out);
}

await browser.close();
