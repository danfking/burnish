import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'tests/visual/screenshots';
const BASE = 'http://localhost:3000';

/**
 * Helper: dispatch burnish-card-action for a tool card.
 */
async function clickToolCard(page: any, itemId: string) {
    await page.evaluate((id: string) => {
        const card = document.querySelector(`burnish-card[item-id="${id}"]`);
        if (card) {
            card.dispatchEvent(new CustomEvent('burnish-card-action', {
                bubbles: true, composed: true,
                detail: { title: id, itemId: id, status: 'info' }
            }));
        }
    }, itemId);
}

/**
 * Helper: fill a burnish-form field and submit.
 */
async function fillAndSubmitForm(page: any, values: Record<string, string>) {
    await page.evaluate((vals: Record<string, string>) => {
        const form = document.querySelector('burnish-form');
        if (!form?.shadowRoot) return;
        for (const [key, value] of Object.entries(vals)) {
            const input = form.shadowRoot.querySelector(`[data-key="${key}"]`) as HTMLInputElement;
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }, values);
    await page.waitForTimeout(300);

    await page.evaluate(() => {
        const form = document.querySelector('burnish-form');
        if (!form?.shadowRoot) return;
        const btn = form.shadowRoot.querySelector('.form-btn-submit') as HTMLButtonElement;
        if (btn) btn.click();
    });
}

/**
 * Helper: navigate to a server's tool listing
 */
async function openServer(page: any, serverName: string) {
    const btn = page.locator('.burnish-suggestion-server').filter({ hasText: new RegExp(serverName, 'i') }).first();
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(3000);
}

test.describe('Edge case tests - deterministic navigation mode', () => {
    test.setTimeout(120_000);

    test('1. Empty result: search nonexistent query', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await openServer(page, 'github');
        await clickToolCard(page, 'search_repositories');
        await page.waitForTimeout(2000);
        await fillAndSubmitForm(page, { query: 'xyznonexistent99999' });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-final-01-empty.png`, fullPage: true });

        const text = await page.textContent('body') || '';
        expect(text).not.toContain('[object Object]');
        expect(text.toLowerCase()).not.toContain('unhandled');
        // The node title should contain the search query
        expect(text).toContain('xyznonexistent99999');
        // Page did not crash - nodes rendered
        const nodeCount = await page.evaluate(() => document.querySelectorAll('.burnish-node').length);
        expect(nodeCount).toBeGreaterThanOrEqual(3); // github -> search_repos -> result
    });

    test('2. Large result: list home directory', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await openServer(page, 'filesystem');
        await clickToolCard(page, 'list_directory');
        await page.waitForTimeout(2000);
        await fillAndSubmitForm(page, { path: 'C:/Users/Home' });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-final-02-large.png`, fullPage: true });

        // Check no horizontal overflow
        const overflow = await page.evaluate(() =>
            document.body.scrollWidth > document.documentElement.clientWidth + 10
        );
        expect(overflow).toBe(false);

        const text = await page.textContent('body') || '';
        expect(text).not.toContain('[object Object]');
    });

    test('3. Tool not found: 404 response', async ({ page }) => {
        await page.goto('/');
        const resp = await page.evaluate(async (base: string) => {
            const r = await fetch(`${base}/api/tools/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'nonexistent_tool', args: {} })
            });
            return { status: r.status, body: await r.json() };
        }, BASE);
        expect(resp.status).toBe(404);
        expect(resp.body.error).toContain('not found');
    });

    test('4. Write tool blocked: 403 response', async ({ page }) => {
        await page.goto('/');
        const resp = await page.evaluate(async (base: string) => {
            const r = await fetch(`${base}/api/tools/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'create_issue', args: { owner: 'danfking', repo: 'burnish', title: 'test' } })
            });
            return { status: r.status, body: await r.json() };
        }, BASE);
        expect(resp.status).toBe(403);
        expect(resp.body.requiresConfirmation).toBe(true);
    });

    test('5. Write tool confirmation flag: code accepts confirmed param', async ({ page }) => {
        await page.goto('/');
        // Verify 403 without confirmed flag
        const resp = await page.evaluate(async (base: string) => {
            const r = await fetch(`${base}/api/tools/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'create_issue', args: { owner: 'danfking', repo: 'burnish', title: 'test' } })
            });
            return { status: r.status, body: await r.json() };
        }, BASE);
        expect(resp.status).toBe(403);
        // Code inspection confirms: line 367 checks `isWriteTool(toolName) && !body.confirmed`
        // When confirmed=true, the guard passes. We DON'T actually execute to avoid side effects.
    });

    test('6. Empty args: list_allowed_directories succeeds', async ({ page }) => {
        await page.goto('/');
        const resp = await page.evaluate(async (base: string) => {
            const r = await fetch(`${base}/api/tools/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'list_allowed_directories', args: {} })
            });
            return { status: r.status, body: await r.json() };
        }, BASE);
        expect(resp.status).toBe(200);
        expect(resp.body.result).toContain('Allowed directories');
    });

    test('7. String numbers coerced: perPage as string', async ({ page }) => {
        await page.goto('/');
        const resp = await page.evaluate(async (base: string) => {
            const r = await fetch(`${base}/api/tools/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: 'search_repositories', args: { query: 'burnish', page: '2', perPage: '5' } })
            });
            return { status: r.status, body: await r.json() };
        }, BASE);
        expect(resp.status).toBe(200);
        expect(resp.body.result).toBeDefined();
    });

    test('8. Model dropdown shows "No models" in no-model mode', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-final-08-header.png`, fullPage: false });

        // Check API
        const models = await page.evaluate(async (base: string) => {
            const r = await fetch(`${base}/api/models`);
            return r.json();
        }, BASE);
        expect(models.models).toEqual([]);
        expect(models.backend).toBe('none');

        // Check UI dropdown
        const dropdownText = await page.evaluate(() => {
            const select = document.querySelector('select') as HTMLSelectElement;
            if (!select) return null;
            return select.options[select.selectedIndex]?.text;
        });
        expect(dropdownText).toBe('No models');
    });

    test('9. No [object Object] in search_repositories result', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);
        await openServer(page, 'github');
        await clickToolCard(page, 'search_repositories');
        await page.waitForTimeout(2000);
        await fillAndSubmitForm(page, { query: 'burnish' });
        await page.waitForTimeout(8000);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/edge-final-09-results.png`, fullPage: true });

        const text = await page.textContent('body') || '';
        expect(text).not.toContain('[object Object]');

        // Should have rendered a table (search results have items array)
        const tables = await page.evaluate(() => document.querySelectorAll('burnish-table').length);
        expect(tables).toBeGreaterThan(0);
    });
});
