import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test.describe('Edge case - form submission verification', () => {
    test.setTimeout(120_000);

    test('empty search result renders as card, not crash', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        // Click github server button
        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        await expect(githubBtn).toBeVisible();
        await githubBtn.click();
        await page.waitForTimeout(3000);

        // Screenshot after tool listing
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-submit-01-tools.png`, fullPage: true });

        // Click search_repositories card
        let searchCard = page.locator('burnish-card[item-id="search_repositories"]');
        if (await searchCard.count() === 0) {
            searchCard = page.locator('burnish-card').filter({ hasText: 'search_repositories' }).first();
        }
        await expect(searchCard).toBeVisible();
        await searchCard.click();
        await page.waitForTimeout(3000);

        // Screenshot after form appears
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-submit-02-form.png`, fullPage: true });

        // Fill the query field in the shadow DOM
        const filled = await page.evaluate(() => {
            const forms = document.querySelectorAll('burnish-form');
            for (const form of forms) {
                if (!form.shadowRoot) continue;
                const inputs = form.shadowRoot.querySelectorAll('input[data-key], textarea[data-key]');
                for (const input of inputs) {
                    const inp = input as HTMLInputElement;
                    if (inp.dataset.key === 'query' || inp.placeholder?.toLowerCase().includes('search')) {
                        inp.value = 'xyznonexistent99999';
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        return { filled: true, key: inp.dataset.key, toolId: (form as any)['tool-id'] || form.getAttribute('tool-id') };
                    }
                }
                // Try first input
                const first = form.shadowRoot.querySelector('input') as HTMLInputElement;
                if (first) {
                    first.value = 'xyznonexistent99999';
                    first.dispatchEvent(new Event('input', { bubbles: true }));
                    return { filled: true, key: first.dataset?.key || 'unknown', toolId: (form as any)['tool-id'] || form.getAttribute('tool-id') };
                }
            }
            return { filled: false };
        });
        console.log('FILL RESULT:', JSON.stringify(filled));

        await page.waitForTimeout(500);

        // Click submit button in shadow DOM
        const clicked = await page.evaluate(() => {
            const forms = document.querySelectorAll('burnish-form');
            for (const form of forms) {
                if (!form.shadowRoot) continue;
                const btns = form.shadowRoot.querySelectorAll('button');
                for (const btn of btns) {
                    if (btn.textContent?.trim() === 'Submit' || btn.classList.contains('form-btn-submit')) {
                        btn.click();
                        return { clicked: true, text: btn.textContent?.trim() };
                    }
                }
            }
            return { clicked: false };
        });
        console.log('SUBMIT RESULT:', JSON.stringify(clicked));

        // Wait for API call and rendering
        await page.waitForTimeout(5000);

        // Screenshot after result
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-submit-03-empty-result.png`, fullPage: true });

        // Check page content
        const bodyText = await page.evaluate(() => document.body.innerText);
        const hasObjectObject = bodyText.includes('[object Object]');
        const hasCrash = bodyText.toLowerCase().includes('unhandled') || bodyText.toLowerCase().includes('cannot read');
        console.log('hasObjectObject:', hasObjectObject);
        console.log('hasCrash:', hasCrash);

        // Count result nodes
        const nodeCount = await page.evaluate(() => document.querySelectorAll('.burnish-node').length);
        console.log('Node count after submit:', nodeCount);

        expect(hasCrash).toBe(false);
        expect(hasObjectObject).toBe(false);
    });

    test('search burnish renders table with no [object Object]', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        await expect(githubBtn).toBeVisible();
        await githubBtn.click();
        await page.waitForTimeout(3000);

        let searchCard = page.locator('burnish-card[item-id="search_repositories"]');
        if (await searchCard.count() === 0) {
            searchCard = page.locator('burnish-card').filter({ hasText: 'search_repositories' }).first();
        }
        await expect(searchCard).toBeVisible();
        await searchCard.click();
        await page.waitForTimeout(3000);

        // Fill query
        await page.evaluate(() => {
            const forms = document.querySelectorAll('burnish-form');
            for (const form of forms) {
                if (!form.shadowRoot) continue;
                const first = form.shadowRoot.querySelector('input') as HTMLInputElement;
                if (first) {
                    first.value = 'burnish';
                    first.dispatchEvent(new Event('input', { bubbles: true }));
                    return;
                }
            }
        });
        await page.waitForTimeout(300);

        // Submit
        await page.evaluate(() => {
            const forms = document.querySelectorAll('burnish-form');
            for (const form of forms) {
                if (!form.shadowRoot) continue;
                const btns = form.shadowRoot.querySelectorAll('button');
                for (const btn of btns) {
                    if (btn.textContent?.trim() === 'Submit') {
                        btn.click();
                        return;
                    }
                }
            }
        });

        await page.waitForTimeout(8000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-submit-04-burnish-result.png`, fullPage: true });

        // Check for [object Object]
        const bodyText = await page.evaluate(() => document.body.innerText);
        const hasObjectObject = bodyText.includes('[object Object]');
        console.log('hasObjectObject:', hasObjectObject);

        if (hasObjectObject) {
            const locations = await page.evaluate(() => {
                const results: string[] = [];
                const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let n: Node | null;
                while ((n = walk.nextNode())) {
                    if (n.textContent?.includes('[object Object]')) {
                        const p = n.parentElement;
                        results.push(`${p?.tagName}.${p?.className} => "${n.textContent?.slice(0, 120)}"`);
                    }
                }
                return results;
            });
            console.log('[object Object] locations:', JSON.stringify(locations, null, 2));
        }

        // Count burnish components
        const components = await page.evaluate(() => ({
            tables: document.querySelectorAll('burnish-table').length,
            cards: document.querySelectorAll('burnish-card').length,
            statBars: document.querySelectorAll('burnish-stat-bar').length,
            nodes: document.querySelectorAll('.burnish-node').length,
        }));
        console.log('Components:', JSON.stringify(components));

        expect(hasObjectObject).toBe(false);
        expect(components.tables + components.cards).toBeGreaterThan(0);
    });
});
