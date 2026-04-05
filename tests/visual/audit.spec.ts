import { test } from '@playwright/test';
import path from 'path';

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

function ssPath(name: string) {
    return path.join(SCREENSHOT_DIR, name);
}

async function clearState(page: any) {
    await page.evaluate(() => {
        indexedDB.deleteDatabase('burnish-sessions');
        indexedDB.deleteDatabase('burnish-nodes');
        localStorage.clear();
    });
}

async function settle(page: any, ms = 1500) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(ms);
}

/** Click a card's Explore action by dispatching the custom event */
async function clickCardExplore(page: any, cardTitle: string) {
    return page.evaluate((title: string) => {
        const cards = document.querySelectorAll('burnish-card');
        for (const card of cards) {
            if (card.getAttribute('title') === title) {
                card.dispatchEvent(new CustomEvent('burnish-card-action', {
                    detail: {
                        title,
                        status: card.getAttribute('status') || 'success',
                        itemId: card.getAttribute('item-id') || title,
                    },
                    bubbles: true,
                    composed: true,
                }));
                return true;
            }
        }
        return false;
    }, cardTitle);
}

/** Fill a burnish-form and submit it */
async function fillAndSubmitForm(page: any, fieldValues: Record<string, string>) {
    return page.evaluate((values: Record<string, string>) => {
        const forms = document.querySelectorAll('burnish-form');
        let submitted = false;
        for (const form of forms) {
            const sr = (form as any).shadowRoot;
            if (!sr) continue;

            // Fill each field by data-key
            for (const [key, val] of Object.entries(values)) {
                const input = sr.querySelector(`[data-key="${key}"]`) as HTMLInputElement;
                if (input) {
                    input.value = val;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }

            // If no specific keys matched, fill the first visible text input
            if (Object.keys(values).length === 0 || !sr.querySelector('[data-key]')) {
                const firstInput = sr.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
                if (firstInput) {
                    firstInput.value = Object.values(values)[0] || '';
                    firstInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }

            // Click submit button
            const submitBtn = sr.querySelector('.form-btn-submit') as HTMLButtonElement;
            if (submitBtn) {
                submitBtn.click();
                submitted = true;
            }
            break;
        }
        return submitted;
    }, fieldValues);
}

test('visual audit - full flow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // ── 1. Landing page ──
    await page.goto('/');
    await clearState(page);
    await page.reload();
    await settle(page, 3000);
    await page.screenshot({ path: ssPath('audit-01-landing-1280.png'), fullPage: true });

    // ── 2. Click GitHub server button ──
    const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
    if (await githubBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await githubBtn.click();
        await settle(page, 2000);
    }
    await page.screenshot({ path: ssPath('audit-02-tool-listing.png'), fullPage: true });

    // ── 3. Click search_repositories card ──
    await clickCardExplore(page, 'search_repositories');
    await settle(page, 2000);
    await page.screenshot({ path: ssPath('audit-03-form.png'), fullPage: true });

    // ── 4. Fill and submit form with "burnish" ──
    // The search_repositories tool has a "query" field
    await fillAndSubmitForm(page, { query: 'burnish' });
    await settle(page, 8000); // Wait for GitHub API
    await page.screenshot({ path: ssPath('audit-04-results-cards.png'), fullPage: true });

    // ── 5. Switch to table view ──
    const tableBtn = page.locator('.burnish-view-btn[data-view="table"]').first();
    if (await tableBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tableBtn.click();
        await settle(page, 1500);
    }
    await page.screenshot({ path: ssPath('audit-05-results-table.png'), fullPage: true });

    // ── 6. Click Explore on a table row ──
    // burnish-table dispatches burnish-table-row-click on row click
    const explored = await page.evaluate(() => {
        const tables = document.querySelectorAll('burnish-table');
        for (const table of tables) {
            const sr = (table as any).shadowRoot;
            if (!sr) continue;
            // Find first row's explore button
            const exploreBtn = sr.querySelector('.row-explore, [title="Explore"]') as HTMLButtonElement;
            if (exploreBtn) { exploreBtn.click(); return 'explore-btn'; }
            // Otherwise click first data row
            const firstRow = sr.querySelector('tbody tr') as HTMLTableRowElement;
            if (firstRow) { firstRow.click(); return 'row-click'; }
        }
        return 'none';
    });
    await settle(page, 2000);
    await page.screenshot({ path: ssPath('audit-06-detail-card.png'), fullPage: true });

    // ── 7. Expanded card ──
    const expandResult = await page.evaluate(() => {
        const cards = document.querySelectorAll('burnish-card');
        for (const card of cards) {
            const sr = (card as any).shadowRoot;
            if (!sr) continue;
            const expandBtn = sr.querySelector('.expand-btn') as HTMLButtonElement;
            if (expandBtn) { expandBtn.click(); return 'card-expand'; }
        }
        const nodeEls = document.querySelectorAll('.burnish-node');
        const lastNode = nodeEls[nodeEls.length - 1];
        const maxBtn = lastNode?.querySelector('.burnish-node-maximize') as HTMLButtonElement;
        if (maxBtn) { maxBtn.click(); return 'node-maximize'; }
        return 'none';
    });
    await settle(page, 1000);
    await page.screenshot({ path: ssPath('audit-07-expanded.png'), fullPage: true });

    // Restore
    if (expandResult === 'node-maximize') {
        await page.evaluate(() => {
            const btn = document.querySelector('.burnish-node-maximized .burnish-node-maximize') as HTMLButtonElement;
            if (btn) btn.click();
        });
    } else if (expandResult === 'card-expand') {
        await page.evaluate(() => {
            const cards = document.querySelectorAll('burnish-card[expanded]');
            for (const card of cards) {
                const sr = (card as any).shadowRoot;
                const btn = sr?.querySelector('.expand-btn') as HTMLButtonElement;
                if (btn) btn.click();
            }
        });
    }
    await settle(page, 500);

    // ── 8. Mobile views at 768px ──
    await page.setViewportSize({ width: 768, height: 1024 });
    await settle(page, 1000);
    await page.screenshot({ path: ssPath('audit-08a-mobile-current.png'), fullPage: true });

    // 8b. Fresh landing at mobile
    await clearState(page);
    await page.reload();
    await settle(page, 3000);
    await page.screenshot({ path: ssPath('audit-08b-mobile-landing.png'), fullPage: true });

    // 8c. Tool listing at mobile
    const mobileGithub = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
    if (await mobileGithub.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mobileGithub.click();
        await settle(page, 2000);
    }
    await page.screenshot({ path: ssPath('audit-08c-mobile-tools.png'), fullPage: true });

    // 8d. Form + results at mobile
    await clickCardExplore(page, 'search_repositories');
    await settle(page, 2000);
    await fillAndSubmitForm(page, { query: 'burnish' });
    await settle(page, 8000);
    await page.screenshot({ path: ssPath('audit-08d-mobile-results.png'), fullPage: true });
});
