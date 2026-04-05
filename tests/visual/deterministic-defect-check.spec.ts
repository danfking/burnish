import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test('375px card badge clipping check', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForTimeout(3000);

    const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
    await githubBtn.click();
    await page.waitForTimeout(2000);

    // Check horizontal scroll
    const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    console.log(`Horizontal scroll at 375px: ${hasHScroll}`);

    // Check stat-bar chip clipping
    const statBarOverflow = await page.evaluate(() => {
        const statBar = document.querySelector('burnish-stat-bar');
        if (!statBar || !statBar.shadowRoot) return 'no-stat-bar';
        const chips = statBar.shadowRoot.querySelectorAll('.chip, .stat-item, [class*="item"]');
        let clipped = 0;
        chips.forEach(chip => {
            const rect = (chip as HTMLElement).getBoundingClientRect();
            if (rect.right > window.innerWidth) clipped++;
        });
        return `${chips.length} chips, ${clipped} clipped`;
    });
    console.log(`Stat-bar: ${statBarOverflow}`);

    // Check card badge clipping
    const badgeClipping = await page.evaluate(() => {
        const cards = document.querySelectorAll('burnish-card');
        let clipped = 0;
        let total = 0;
        cards.forEach(card => {
            if (!card.shadowRoot) return;
            const badge = card.shadowRoot.querySelector('.card-badge');
            if (!badge) return;
            total++;
            const rect = (badge as HTMLElement).getBoundingClientRect();
            if (rect.right > window.innerWidth) clipped++;
        });
        return `${total} badges, ${clipped} clipped`;
    });
    console.log(`Card badges: ${badgeClipping}`);

    // Take close-up of first card
    const firstCard = page.locator('burnish-card').first();
    if (await firstCard.count() > 0) {
        await firstCard.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-13-card-375px.png` });
    }
});

test('stat-bar false value defect', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Click GitHub, then search_repositories, fill and submit
    const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
    await githubBtn.click();
    await page.waitForTimeout(2000);

    // Click search_repositories explore button
    const searchCard = page.locator('burnish-card[item-id="search_repositories"]');
    await searchCard.hover();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const card = document.querySelector('burnish-card[item-id="search_repositories"]');
        if (card?.shadowRoot) {
            const btn = card.shadowRoot.querySelector('.card-action');
            if (btn) (btn as HTMLElement).click();
        }
    });
    await page.waitForTimeout(2000);

    // Fill and submit
    await page.evaluate(() => {
        const form = document.querySelector('burnish-form');
        if (form?.shadowRoot) {
            const input = form.shadowRoot.querySelector('input') as HTMLInputElement;
            if (input) {
                input.value = 'burnish';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            setTimeout(() => {
                const btn = form.shadowRoot!.querySelector('button[type="submit"], button:last-of-type') as HTMLElement;
                if (btn) btn.click();
            }, 300);
        }
    });
    await page.waitForTimeout(8000);

    // Check for "false" text in stat-bar
    const statBarContent = await page.evaluate(() => {
        const statBars = document.querySelectorAll('burnish-stat-bar');
        const texts: string[] = [];
        statBars.forEach(sb => {
            if (sb.shadowRoot) {
                texts.push(sb.shadowRoot.textContent || '');
            }
        });
        return texts;
    });
    console.log('Stat-bar text content:', statBarContent);

    const hasFalseValue = statBarContent.some(t => /\bfalse\b/i.test(t));
    console.log(`Stat-bar shows "false": ${hasFalseValue}`);

    // Screenshot the stat-bar area
    const statBar = page.locator('burnish-stat-bar').last();
    if (await statBar.count() > 0) {
        await statBar.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-14-statbar-false.png` });
    }
});
