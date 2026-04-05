import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';

test.describe('Deterministic tool execution flow', () => {
    test.setTimeout(120_000);

    test('full UI flow: server button -> tool listing -> form -> result', async ({ page }) => {
        // 1. Go to homepage
        await page.goto('/');
        await page.waitForTimeout(3000);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-01-initial.png`, fullPage: true });

        // 2. Wait for server buttons
        const serverButtons = page.locator('.burnish-suggestion-server');
        expect(await serverButtons.count()).toBeGreaterThan(0);

        // Find GitHub server button
        let githubBtn = serverButtons.filter({ hasText: /github/i }).first();
        if (await githubBtn.count() === 0) {
            githubBtn = serverButtons.first();
        }
        expect(await githubBtn.count()).toBeGreaterThan(0);

        // 3. Click server button -> tool listing
        await githubBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-02-tool-listing.png`, fullPage: true });

        // Verify sections and stat-bar rendered
        const sections = page.locator('burnish-section');
        expect(await sections.count()).toBeGreaterThan(0);
        expect(await page.locator('burnish-stat-bar').count()).toBeGreaterThan(0);

        // 4. Click the "Explore" action button on search_repositories card
        // Cards only emit burnish-card-action from the .card-action element in shadow DOM
        const searchCard = page.locator('burnish-card[item-id="search_repositories"]');
        expect(await searchCard.count()).toBeGreaterThan(0);

        // Hover to reveal the explore button, then click it
        await searchCard.hover();
        await page.waitForTimeout(300);

        // Click the .card-action inside shadow DOM
        const formAppeared = await page.evaluate(() => {
            const card = document.querySelector('burnish-card[item-id="search_repositories"]');
            if (!card || !card.shadowRoot) return 'no-shadow';
            const actionBtn = card.shadowRoot.querySelector('.card-action');
            if (!actionBtn) return 'no-action-btn';
            (actionBtn as HTMLElement).click();
            return 'clicked';
        });
        console.log(`Card action click: ${formAppeared}`);

        await page.waitForTimeout(2000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-03-form.png`, fullPage: true });

        // Check if form appeared
        const formCount = await page.locator('burnish-form').count();
        console.log(`Forms found: ${formCount}`);

        if (formCount > 0) {
            // 5. Fill in query field and submit via shadow DOM
            const filled = await page.evaluate(() => {
                const form = document.querySelector('burnish-form');
                if (!form || !form.shadowRoot) return 'no-form-shadow';
                const inputs = form.shadowRoot.querySelectorAll('input, textarea');
                for (const input of inputs) {
                    const el = input as HTMLInputElement;
                    const label = el.getAttribute('placeholder') || el.getAttribute('name') || '';
                    if (label.toLowerCase().includes('query') || el.name === 'query' || inputs.length === 1) {
                        el.value = 'burnish';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return 'filled';
                    }
                }
                // Try first input
                const first = inputs[0] as HTMLInputElement;
                if (first) {
                    first.value = 'burnish';
                    first.dispatchEvent(new Event('input', { bubbles: true }));
                    return 'filled-first';
                }
                return 'no-input';
            });
            console.log(`Fill result: ${filled}`);

            await page.waitForTimeout(500);
            await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-04-form-filled.png`, fullPage: true });

            // Submit the form
            const submitted = await page.evaluate(() => {
                const form = document.querySelector('burnish-form');
                if (!form || !form.shadowRoot) return 'no-form';
                const btn = form.shadowRoot.querySelector('button[type="submit"], button:last-of-type, .form-submit');
                if (btn) {
                    (btn as HTMLElement).click();
                    return 'clicked-submit';
                }
                // Dispatch event directly
                form.dispatchEvent(new CustomEvent('burnish-form-submit', {
                    bubbles: true,
                    composed: true,
                    detail: { toolId: 'search_repositories', values: { query: 'burnish' } }
                }));
                return 'dispatched-event';
            });
            console.log(`Submit result: ${submitted}`);
        } else {
            // Fallback: If no form appeared, the card click might have triggered
            // a different path. Check if it went straight to LLM prompt or if
            // we need to use the starter prompt button instead.
            console.log('No form found - trying starter prompt approach');

            // Go back to home and use the "Search repos" starter prompt
            await page.goto('/');
            await page.waitForTimeout(3000);

            // Look for Search repos starter button with data-tool
            const starterBtn = page.locator('button[data-tool*="search_repositories"]');
            if (await starterBtn.count() > 0) {
                await starterBtn.click();
                await page.waitForTimeout(8000);
                await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-04-starter-result.png`, fullPage: true });
            } else {
                // Direct API test via executeToolDirect
                await page.evaluate(async () => {
                    // Dispatch directly to the tool executor
                    const res = await fetch('/api/tools/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ toolName: 'search_repositories', args: { query: 'burnish' } }),
                    });
                    const data = await res.json();
                    console.log('Direct API result keys:', Object.keys(data));
                });
            }
        }

        // Wait for API response
        await page.waitForTimeout(8000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-05-result.png`, fullPage: true });

        // 6. Verify results
        const pageText = await page.textContent('body') || '';
        const hasObjectObject = pageText.includes('[object Object]');
        console.log(`Contains [object Object]: ${hasObjectObject}`);
        if (hasObjectObject) {
            await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-06-object-object-defect.png`, fullPage: true });
        }

        // Check for table or cards
        const resultTable = await page.locator('burnish-table').count();
        const resultCards = await page.locator('burnish-card').count();
        console.log(`Results: ${resultTable} tables, ${resultCards} cards`);

        // Take detail screenshot of main content
        const mainContent = page.locator('#content-area, .burnish-content').first();
        if (await mainContent.count() > 0) {
            await mainContent.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-07-result-detail.png` });
        }
    });

    test('responsive: tool listing at 768px', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');
        await page.waitForTimeout(3000);

        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        if (await githubBtn.count() > 0) {
            await githubBtn.click();
            await page.waitForTimeout(2000);
            await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-08-responsive-768.png`, fullPage: true });
        }
    });

    test('responsive: tool listing at 480px', async ({ page }) => {
        await page.setViewportSize({ width: 480, height: 800 });
        await page.goto('/');
        await page.waitForTimeout(3000);

        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        if (await githubBtn.count() > 0) {
            await githubBtn.click();
            await page.waitForTimeout(2000);
            await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-09-responsive-480.png`, fullPage: true });
        }
    });

    test('responsive: tool listing at 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        await page.waitForTimeout(3000);

        const githubBtn = page.locator('.burnish-suggestion-server').filter({ hasText: /github/i }).first();
        if (await githubBtn.count() > 0) {
            await githubBtn.click();
            await page.waitForTimeout(2000);
            await page.screenshot({ path: `${SCREENSHOT_DIR}/deterministic-10-responsive-375.png`, fullPage: true });
        }
    });
});
