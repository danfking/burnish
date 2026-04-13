// Visual verification script for #410 — exercises the new connected-graph
// example-server through Burnish's existing rendering and drill-down code.
//
// Captures four screenshots (light + dark, each at two depths):
//   verify-410-light.png      list-projects rendered as cards
//   verify-410-dark.png       same, dark theme
//   verify-410-drill-light.png  one click into a project (level 2)
//   verify-410-drill-dark.png   same, dark theme

import { chromium } from '@playwright/test';

const BASE = process.env.BURNISH_URL || 'http://localhost:4567';

async function snap(page, theme, name) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/visual/screenshots/${name}.png`, fullPage: true });
    console.log('saved', name);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => console.log('[page]', msg.type(), msg.text().slice(0, 200)));

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Click the "showcase" server card on the landing page if present.
    const showcaseBtn = page.locator('[data-server="showcase"], button:has-text("showcase"), button:has-text("Showcase")').first();
    if (await showcaseBtn.count()) {
        await showcaseBtn.click().catch(() => {});
        await page.waitForTimeout(500);
    }

    // Snapshot 1: tool catalog (showcase the 28-tool surface).
    await page.waitForTimeout(1000);
    await snap(page, 'light', 'verify-410-catalog-light');
    await snap(page, 'dark', 'verify-410-catalog-dark');

    // Execute list-projects directly via the API-backed tool exec.
    // The Explore button on the catalog card calls executeToolDirect.
    const listProjectsCard = page.locator('burnish-card[item-id="list-projects"]').first();
    await listProjectsCard.waitFor({ timeout: 5000 });
    // Click the Explore action inside the card's shadow DOM.
    await listProjectsCard.evaluate((el) => {
        const action = el.shadowRoot?.querySelector('.card-action');
        action?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await page.waitForTimeout(2500);

    // The optional `status` enum makes Burnish render a form. Capture it,
    // then submit empty to actually execute the tool.
    await snap(page, 'light', 'verify-410-form-light');
    await snap(page, 'dark', 'verify-410-form-dark');

    // Submit the auto-generated form.
    const submitBtn = page.locator('button:has-text("Submit")').first();
    if (await submitBtn.count()) {
        await submitBtn.click();
        await page.waitForTimeout(2500);
    }
    await snap(page, 'light', 'verify-410-light');
    await snap(page, 'dark', 'verify-410-dark');

    // Drill into the first project result card (item-id="vd-...:0").
    const projectCard = page.locator('burnish-card[item-id^="vd-"]').first();
    if (await projectCard.count()) {
        await projectCard.evaluate((el) => {
            const action = el.shadowRoot?.querySelector('.card-action');
            action?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        });
        await page.waitForTimeout(1500);
        await snap(page, 'light', 'verify-410-drill-light');
        await snap(page, 'dark', 'verify-410-drill-dark');
    } else {
        console.log('No project result cards found — skipping drill snapshot');
    }

    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
