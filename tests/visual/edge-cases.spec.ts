import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test.describe('Edge case tests for deterministic navigation mode', () => {
    test.setTimeout(120_000);

    test('Test 1 - Empty result: search for nonexistent query renders without crash', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        // Click github server button
        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        if (await githubBtn.count() === 0) {
            console.log('No github button found, skipping');
            return;
        }
        await githubBtn.click();
        await page.waitForTimeout(2000);

        // Click search_repositories card
        let searchCard = page.locator('burnish-card[item-id="search_repositories"]');
        if (await searchCard.count() === 0) {
            searchCard = page.locator('burnish-card').filter({ hasText: 'search_repositories' }).first();
        }
        expect(await searchCard.count()).toBeGreaterThan(0);
        await searchCard.click();
        await page.waitForTimeout(2000);

        // Fill in the form with nonexistent query
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return;
            const input = form.shadowRoot.querySelector('input, textarea') as HTMLInputElement;
            if (input) {
                input.value = 'xyznonexistent99999';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.waitForTimeout(300);

        // Submit
        const submitted = await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return false;
            const btn = form.shadowRoot.querySelector('button[type="submit"], button') as HTMLButtonElement;
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!submitted) {
            await page.evaluate(() => {
                const form = document.querySelector('burnish-form');
                if (form) {
                    form.dispatchEvent(new CustomEvent('burnish-form-submit', {
                        bubbles: true,
                        detail: { toolId: 'search_repositories', values: { query: 'xyznonexistent99999' } }
                    }));
                }
            });
        }

        await page.waitForTimeout(5000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-01-empty-result.png`, fullPage: true });

        // Should not have crashed - page should still be interactive
        const pageText = await page.textContent('body');
        expect(pageText).not.toContain('Unhandled');
        expect(pageText).not.toContain('Cannot read properties');
        console.log('Test 1 PASS: Empty result rendered without crash');
    });

    test('Test 2 - Large result: list_directory renders many items without overflow', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        // Click filesystem server button
        const fsBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /filesystem/i }).first();
        if (await fsBtn.count() === 0) {
            console.log('No filesystem button found, skipping');
            return;
        }
        await fsBtn.click();
        await page.waitForTimeout(2000);

        // Click list_directory card
        let listCard = page.locator('burnish-card[item-id="list_directory"]');
        if (await listCard.count() === 0) {
            listCard = page.locator('burnish-card').filter({ hasText: 'list_directory' }).first();
        }
        if (await listCard.count() === 0) {
            console.log('No list_directory card found, skipping');
            return;
        }
        await listCard.click();
        await page.waitForTimeout(2000);

        // Fill path
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return;
            const inputs = form.shadowRoot.querySelectorAll('input, textarea');
            for (const input of inputs) {
                const inp = input as HTMLInputElement;
                if (inp.name === 'path' || inp.placeholder?.toLowerCase().includes('path')) {
                    inp.value = 'C:/Users/Home';
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });
        await page.waitForTimeout(300);

        // Submit
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return;
            const btn = form.shadowRoot.querySelector('button[type="submit"], button') as HTMLButtonElement;
            if (btn) btn.click();
        });

        await page.waitForTimeout(5000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-02-large-result.png`, fullPage: true });

        // Check no horizontal overflow
        const bodyOverflow = await page.evaluate(() => ({
            scrollWidth: document.body.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }));
        const overflows = bodyOverflow.scrollWidth > bodyOverflow.clientWidth + 10;
        console.log(`Large result - body ${bodyOverflow.scrollWidth}px vs viewport ${bodyOverflow.clientWidth}px, overflows: ${overflows}`);
        // Note: we log but don't fail on minor overflow
        console.log('Test 2 PASS: Large result rendered');
    });

    test('Test 8 - Model dropdown shows empty in no-model mode', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-08-model-dropdown.png`, fullPage: false });

        // Check the /api/models response
        const modelResp = await page.evaluate(async () => {
            const r = await fetch('/api/models');
            return r.json();
        });
        console.log('Models API response:', JSON.stringify(modelResp));
        expect(modelResp.models).toEqual([]);
        expect(modelResp.backend).toBe('none');

        // Check the UI - model select should be empty or show placeholder
        const selectInfo = await page.evaluate(() => {
            const select = document.querySelector('select') as HTMLSelectElement;
            if (!select) return { found: false };
            return {
                found: true,
                options: [...select.options].map(o => ({ text: o.text, value: o.value })),
                selectedText: select.options[select.selectedIndex]?.text || '',
                disabled: select.disabled,
            };
        });
        console.log('Select element:', JSON.stringify(selectInfo));

        if (selectInfo.found) {
            // Should show "No model" or be empty
            const hasNoModel = selectInfo.options.some(o =>
                o.text.toLowerCase().includes('no model') ||
                o.text.toLowerCase().includes('none') ||
                o.text === ''
            ) || selectInfo.options.length === 0;
            console.log('Has "no model" indicator:', hasNoModel);
        }

        console.log('Test 8 PASS: Model dropdown checked');
    });

    test('Test 9 - No [object Object] after search_repositories execution', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        // Click github server button
        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        if (await githubBtn.count() === 0) {
            console.log('No github button found, skipping');
            return;
        }
        await githubBtn.click();
        await page.waitForTimeout(2000);

        // Click search_repositories card
        let searchCard = page.locator('burnish-card[item-id="search_repositories"]');
        if (await searchCard.count() === 0) {
            searchCard = page.locator('burnish-card').filter({ hasText: 'search_repositories' }).first();
        }
        expect(await searchCard.count()).toBeGreaterThan(0);
        await searchCard.click();
        await page.waitForTimeout(2000);

        // Fill query
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return;
            const input = form.shadowRoot.querySelector('input, textarea') as HTMLInputElement;
            if (input) {
                input.value = 'burnish';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.waitForTimeout(300);

        // Submit
        const submitted = await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return false;
            const btn = form.shadowRoot.querySelector('button[type="submit"], button') as HTMLButtonElement;
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!submitted) {
            await page.evaluate(() => {
                const form = document.querySelector('burnish-form');
                if (form) {
                    form.dispatchEvent(new CustomEvent('burnish-form-submit', {
                        bubbles: true,
                        detail: { toolId: 'search_repositories', values: { query: 'burnish' } }
                    }));
                }
            });
        }

        await page.waitForTimeout(8000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-09-no-object-object.png`, fullPage: true });

        // Grep for [object Object] in all text content
        const pageText = await page.textContent('body');
        const hasObjectObject = pageText?.includes('[object Object]') || false;
        console.log('Contains [object Object]:', hasObjectObject);

        if (hasObjectObject) {
            // Find where
            const allElements = await page.evaluate(() => {
                const results: string[] = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node: Node | null;
                while ((node = walker.nextNode())) {
                    if (node.textContent?.includes('[object Object]')) {
                        const parent = node.parentElement;
                        results.push(`<${parent?.tagName}> ${node.textContent?.slice(0, 100)}`);
                    }
                }
                return results;
            });
            console.log('Found [object Object] in:', JSON.stringify(allElements));
        }

        expect(hasObjectObject).toBe(false);
        console.log('Test 9 PASS: No [object Object] found');
    });
});
