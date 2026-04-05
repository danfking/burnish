import { test, expect } from '@playwright/test';

test.describe('Deterministic mode gap fixes', () => {

    test('Gap A: no null string rendered for tools without params', async ({ page }) => {
        await page.goto('/');

        // Wait for server buttons — skip test if MCP servers didn't connect
        const serverBtns = page.locator('#server-buttons button');
        try {
            await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
        } catch {
            test.skip(true, 'MCP servers not connected in time');
            return;
        }

        // Click a server button to get tool listing
        const fsButton = page.locator('#server-buttons button', { hasText: /filesystem/i });
        if (await fsButton.count() > 0) {
            await fsButton.click();
        } else {
            const anyBtn = page.locator('#server-buttons button').first();
            if (await anyBtn.count() === 0) { test.skip(); return; }
            await anyBtn.click();
        }

        // Wait for tool listing to render
        await page.waitForSelector('.burnish-node', { timeout: 10_000 });
        await page.waitForSelector('burnish-card', { timeout: 10_000 });

        // The key assertion: no node content should contain the literal text "null"
        // rendered as the sole content (which happens when generateFallbackForm returns null)
        const nodeContents = page.locator('.burnish-node-content');
        const count = await nodeContents.count();
        for (let i = 0; i < count; i++) {
            const text = await nodeContents.nth(i).textContent();
            // Should not have "null" as the only meaningful content
            const trimmed = (text || '').trim();
            if (trimmed === 'null') {
                throw new Error(`Node content ${i} renders literal "null" - Gap A not fixed`);
            }
        }
    });

    test('Gap B: card item-id attributes are not undefined', async ({ page }) => {
        await page.goto('/');

        // Wait for server buttons — skip test if MCP servers didn't connect
        const serverBtns = page.locator('#server-buttons button');
        try {
            await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
        } catch {
            test.skip(true, 'MCP servers not connected in time');
            return;
        }

        // Click a server button
        const fsButton = page.locator('#server-buttons button', { hasText: /filesystem/i });
        if (await fsButton.count() > 0) {
            await fsButton.click();
        } else {
            const anyBtn = page.locator('#server-buttons button').first();
            if (await anyBtn.count() === 0) { test.skip(); return; }
            await anyBtn.click();
        }

        // Wait for tool listing
        await page.waitForSelector('burnish-card', { timeout: 10_000 });

        // Find a tool that returns array data — try list_directory or similar
        const listTool = page.locator('burnish-card', { hasText: /list.*director|list_dir/i });
        if (await listTool.count() > 0) {
            await listTool.first().click();

            // Wait for form or result
            await page.waitForTimeout(500);

            // If a form appeared, try submitting with default values
            const form = page.locator('burnish-form');
            if (await form.count() > 0) {
                // The form should auto-fire burnish-form-submit event
                // Try clicking submit button if available
                const submitBtn = page.locator('burnish-form button[type="submit"], burnish-form .burnish-form-submit');
                if (await submitBtn.count() > 0) {
                    await submitBtn.first().click();
                }
            }

            // Wait for results to render
            await page.waitForTimeout(2000);

            // Check all burnish-card elements with item-id attribute
            const cardsWithItemId = page.locator('burnish-card[item-id]');
            const cardCount = await cardsWithItemId.count();
            for (let i = 0; i < cardCount; i++) {
                const itemId = await cardsWithItemId.nth(i).getAttribute('item-id');
                expect(itemId).not.toContain('undefined');
            }
        }
    });

    test('Gap B: view switcher tabs work (cards/table/json)', async ({ page }) => {
        await page.goto('/');

        // Wait for server buttons — skip test if MCP servers didn't connect
        const serverBtns = page.locator('#server-buttons button');
        try {
            await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
        } catch {
            test.skip(true, 'MCP servers not connected in time');
            return;
        }

        // Click a server button
        const fsButton = page.locator('#server-buttons button', { hasText: /filesystem/i });
        if (await fsButton.count() > 0) {
            await fsButton.click();
        } else {
            const anyBtn = page.locator('#server-buttons button').first();
            if (await anyBtn.count() === 0) { test.skip(); return; }
            await anyBtn.click();
        }

        // Wait for tool listing
        await page.waitForSelector('burnish-card', { timeout: 10_000 });

        // Find and click a list-type tool to get array results
        const listTool = page.locator('burnish-card', { hasText: /list.*director|list_dir/i });
        if (await listTool.count() > 0) {
            await listTool.first().click();
            await page.waitForTimeout(500);

            // Submit form if present
            const form = page.locator('burnish-form');
            if (await form.count() > 0) {
                const submitBtn = page.locator('burnish-form button[type="submit"], burnish-form .burnish-form-submit');
                if (await submitBtn.count() > 0) {
                    await submitBtn.first().click();
                }
            }

            // Wait for view switcher to appear
            const viewSwitcher = page.locator('.burnish-view-switcher');
            if (await viewSwitcher.count() > 0) {
                // Click Table tab
                const tableBtn = viewSwitcher.first().locator('.burnish-view-btn[data-view="table"]');
                await tableBtn.click();

                // Verify table view rendered
                const viewContent = page.locator('.burnish-view-content').first();
                await expect(viewContent.locator('burnish-table')).toHaveCount(1, { timeout: 5_000 });

                // Click JSON tab
                const jsonBtn = viewSwitcher.first().locator('.burnish-view-btn[data-view="json"]');
                await jsonBtn.click();

                // Verify JSON view rendered
                await expect(viewContent.locator('.burnish-json-view')).toHaveCount(1, { timeout: 5_000 });

                // Click Cards tab back
                const cardsBtn = viewSwitcher.first().locator('.burnish-view-btn[data-view="cards"]');
                await cardsBtn.click();

                // Verify cards view rendered
                await expect(viewContent.locator('.burnish-cards-grid')).toHaveCount(1, { timeout: 5_000 });
            }
        }
    });

    test('Gap C: view switcher warns on missing content element', async ({ page }) => {
        const warnings: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'warning' && msg.text().includes('[burnish] View content element not found')) {
                warnings.push(msg.text());
            }
        });

        await page.goto('/');

        // Wait for server buttons — skip test if MCP servers didn't connect
        const serverBtns = page.locator('#server-buttons button');
        try {
            await serverBtns.first().waitFor({ state: 'visible', timeout: 30_000 });
        } catch {
            test.skip(true, 'MCP servers not connected in time');
            return;
        }

        // Inject a fake view switcher button inside dashboard-container that
        // points to a non-existent dataId, then click it via Playwright (not JS)
        // so the delegated event listener on the container picks it up.
        await page.evaluate(() => {
            const container = document.getElementById('dashboard-container');
            if (!container) return;
            // Wrap in a .burnish-view-switcher so btn.closest() works
            const switcher = document.createElement('div');
            switcher.className = 'burnish-view-switcher';
            const btn = document.createElement('button');
            btn.className = 'burnish-view-btn';
            btn.id = 'gap-c-test-btn';
            btn.dataset.view = 'cards';
            btn.dataset.target = 'nonexistent-id';
            btn.textContent = 'Test';
            switcher.appendChild(btn);
            (window as any)._viewData = (window as any)._viewData || {};
            (window as any)._viewData['nonexistent-id'] = { parsed: [{ name: 'test' }], label: 'test', sourceToolName: 'test' };
            container.appendChild(switcher);
        });

        // Click via Playwright so event bubbles through DOM naturally
        await page.locator('#gap-c-test-btn').click();

        // Give time for the click handler to fire
        await page.waitForTimeout(500);

        // Should have logged a warning
        expect(warnings.length).toBeGreaterThanOrEqual(1);
    });
});
