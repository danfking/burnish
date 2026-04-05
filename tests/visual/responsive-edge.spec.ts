import { test } from '@playwright/test';

test('responsive breakpoint screenshots', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#prompt-input');
    await page.waitForTimeout(3000);

    // Test exact breakpoints (1px above and below each threshold)
    const breakpoints = [
        { width: 1025, label: 'above-tablet' },
        { width: 1024, label: 'tablet-exact' },
        { width: 769, label: 'above-mobile' },
        { width: 768, label: 'mobile-exact' },
        { width: 481, label: 'above-small' },
        { width: 480, label: 'small-exact' },
        { width: 375, label: 'iphone-se' },
    ];

    for (const bp of breakpoints) {
        await page.setViewportSize({ width: bp.width, height: 800 });
        await page.waitForTimeout(500);
        await page.screenshot({
            path: `tests/visual/screenshots/responsive-${bp.label}-${bp.width}px.png`,
            fullPage: true
        });
    }
});

test('edge case - long prompt', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#prompt-input');

    // Edge case 1: Very long text in prompt input
    const longText = 'a'.repeat(500);
    await page.fill('#prompt-input', longText);
    await page.screenshot({ path: 'tests/visual/screenshots/edge-long-prompt.png' });
});

test('edge case - many sessions', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#prompt-input');
    await page.waitForTimeout(1000);

    // Create multiple sessions
    for (let i = 0; i < 3; i++) {
        await page.click('#btn-new-session');
        await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'tests/visual/screenshots/edge-many-sessions.png', fullPage: true });
});

test('edge case - diagnostic panel', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.waitForSelector('#prompt-input');

    // Submit and get a response
    await page.fill('#prompt-input', 'Say hello briefly');
    await page.click('#btn-submit');
    await page.waitForFunction(() => {
        const btn = document.getElementById('btn-submit');
        return btn && !btn.classList.contains('cancel');
    }, { timeout: 160_000 });
    await page.waitForTimeout(1000);

    // Click info button to open diagnostic panel
    const infoBtn = page.locator('.burnish-node-btn[title*="info"], .burnish-node-btn[title*="Info"], .burnish-node-info').first();
    if (await infoBtn.count() > 0) {
        await infoBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'tests/visual/screenshots/edge-diagnostic.png', fullPage: true });
    }
});
