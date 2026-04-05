import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test.describe('Debug form submission', () => {
    test.setTimeout(120_000);

    test('debug card click and form appearance', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        // Click github server button
        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        await expect(githubBtn).toBeVisible();
        await githubBtn.click();
        await page.waitForTimeout(3000);

        // Check what nodes exist
        const nodesBefore = await page.evaluate(() => document.querySelectorAll('.burnish-node').length);
        console.log('Nodes before card click:', nodesBefore);

        // Check toolSchemaCache
        const cacheKeys = await page.evaluate(() => {
            return Object.keys((window as any).toolSchemaCache || {}).slice(0, 10);
        });
        console.log('toolSchemaCache keys:', JSON.stringify(cacheKeys));

        // Hmm, toolSchemaCache might not be on window. Let's check the card's item-id
        const cardIds = await page.evaluate(() => {
            const cards = document.querySelectorAll('burnish-card[item-id]');
            return [...cards].map(c => c.getAttribute('item-id')).slice(0, 10);
        });
        console.log('Card item-ids:', JSON.stringify(cardIds));

        // Listen for burnish-card-action event
        await page.evaluate(() => {
            (window as any).__cardActionFired = false;
            (window as any).__cardActionDetail = null;
            document.addEventListener('burnish-card-action', (e: any) => {
                (window as any).__cardActionFired = true;
                (window as any).__cardActionDetail = e.detail;
            });
        });

        // Click the search_repositories card
        const searchCard = page.locator('burnish-card[item-id="search_repositories"]').first();
        if (await searchCard.count() > 0) {
            // Click via the card's shadow DOM action button
            const clicked = await page.evaluate(() => {
                const card = document.querySelector('burnish-card[item-id="search_repositories"]');
                if (!card) return 'no card found';
                // Try clicking the card itself
                card.click();
                return 'clicked card element';
            });
            console.log('Click result:', clicked);
        } else {
            console.log('No search_repositories card found');
        }

        await page.waitForTimeout(3000);

        // Check if card action fired
        const actionFired = await page.evaluate(() => ({
            fired: (window as any).__cardActionFired,
            detail: (window as any).__cardActionDetail,
        }));
        console.log('Card action fired:', JSON.stringify(actionFired));

        // Check nodes after click
        const nodesAfter = await page.evaluate(() => document.querySelectorAll('.burnish-node').length);
        console.log('Nodes after card click:', nodesAfter);

        // Check if a form appeared anywhere
        const formCount = await page.evaluate(() => document.querySelectorAll('burnish-form').length);
        console.log('Forms after click:', formCount);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-debug-after-click.png`, fullPage: true });

        // If no form, try the burnish-card-action event manually
        if (formCount === 0) {
            console.log('No form appeared. Trying to dispatch burnish-card-action manually...');
            await page.evaluate(() => {
                const card = document.querySelector('burnish-card[item-id="search_repositories"]');
                if (card) {
                    card.dispatchEvent(new CustomEvent('burnish-card-action', {
                        bubbles: true, composed: true,
                        detail: { title: 'search_repositories', itemId: 'search_repositories', status: 'info' }
                    }));
                }
            });
            await page.waitForTimeout(3000);

            const formCount2 = await page.evaluate(() => document.querySelectorAll('burnish-form').length);
            const nodesAfter2 = await page.evaluate(() => document.querySelectorAll('.burnish-node').length);
            console.log('After manual dispatch - Forms:', formCount2, 'Nodes:', nodesAfter2);

            await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-debug-after-manual.png`, fullPage: true });
        }

        // If form exists now, try to fill and submit
        const formExists = await page.evaluate(() => document.querySelectorAll('burnish-form').length > 0);
        if (formExists) {
            // Fill
            await page.evaluate(() => {
                const form = document.querySelector('burnish-form');
                if (!form?.shadowRoot) return;
                const inputs = form.shadowRoot.querySelectorAll('input[data-key]');
                for (const inp of inputs) {
                    const input = inp as HTMLInputElement;
                    if (input.dataset.key === 'query') {
                        input.value = 'xyznonexistent99999';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
            await page.waitForTimeout(300);

            // Submit
            await page.evaluate(() => {
                const form = document.querySelector('burnish-form');
                if (!form?.shadowRoot) return;
                const btn = form.shadowRoot.querySelector('.form-btn-submit') as HTMLButtonElement;
                if (btn) btn.click();
            });
            await page.waitForTimeout(5000);

            await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-debug-after-submit.png`, fullPage: true });

            const finalText = await page.evaluate(() => document.body.innerText);
            console.log('Has [object Object]:', finalText.includes('[object Object]'));
            console.log('Has crash:', finalText.toLowerCase().includes('unhandled'));
        }
    });
});
