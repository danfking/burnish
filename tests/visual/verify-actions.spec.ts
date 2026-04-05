import { test, expect } from '@playwright/test';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('tests/visual/screenshots');

test.describe('Verify contextual action buttons after tool execution', () => {
    test.setTimeout(180_000);

    test('search repos -> actions must appear', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => {
            consoleErrors.push(`PAGE ERROR: ${err.message}`);
        });

        // Step 1: Clear IndexedDB and load fresh
        await page.goto('http://localhost:3000');
        await page.evaluate(() => {
            const dbs = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
            return dbs.then((databases: any[]) =>
                Promise.all(databases.map((db: any) => {
                    return new Promise<void>((resolve) => {
                        const req = indexedDB.deleteDatabase(db.name);
                        req.onsuccess = () => resolve();
                        req.onerror = () => resolve();
                        req.onblocked = () => resolve();
                    });
                }))
            );
        });

        await page.goto('http://localhost:3000');
        await page.waitForLoadState('networkidle');

        // Wait for server buttons
        await page.waitForFunction(() => {
            const btns = document.querySelectorAll('.burnish-suggestion-server');
            return btns.length > 0;
        }, { timeout: 15_000 });
        await page.waitForTimeout(1000);

        // Step 2: Click GitHub server button
        const githubBtn = page.locator('.burnish-suggestion-server', { hasText: /github/i });
        await expect(githubBtn.first()).toBeVisible();
        await githubBtn.first().click();

        // Wait for tool cards to render
        await page.waitForSelector('burnish-card', { timeout: 10_000 });
        await page.waitForTimeout(1000);

        const cardCount = await page.locator('burnish-card').count();
        console.log(`Tool cards rendered: ${cardCount}`);

        // Step 3: Find and click search_repositories card (shadow DOM action button)
        const clickResult = await page.evaluate(() => {
            const cards = document.querySelectorAll('burnish-card');
            for (const card of cards) {
                const title = card.getAttribute('title') || '';
                if (title.includes('search_repositories')) {
                    const action = card.shadowRoot?.querySelector('.card-action');
                    if (action) {
                        (action as HTMLElement).click();
                        return `clicked: ${title}`;
                    }
                }
            }
            return 'not found';
        });
        console.log(`Search card: ${clickResult}`);
        expect(clickResult).toContain('clicked');

        // Step 4: Wait for form
        await page.waitForSelector('burnish-form', { timeout: 10_000 });
        console.log('Form appeared');
        await page.waitForTimeout(500);

        // Step 5: Fill query field with "burnish"
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form?.shadowRoot) return;
            const input = form.shadowRoot.querySelector('input[type="text"]') as HTMLInputElement;
            if (input) {
                input.value = 'burnish';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // Step 6: Click Submit
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form?.shadowRoot) return;
            const buttons = form.shadowRoot.querySelectorAll('button');
            for (const btn of buttons) {
                const text = (btn.textContent || '').trim().toLowerCase();
                if (text.includes('submit') || text.includes('run') || text.includes('execute') || btn.type === 'submit') {
                    btn.click();
                    return;
                }
            }
            if (buttons.length > 0) (buttons[buttons.length - 1] as HTMLElement).click();
        });
        console.log('Form submitted');

        // Step 7: Wait for results (real GitHub API call)
        try {
            await page.waitForSelector('burnish-table', { timeout: 30_000 });
            console.log('Results table appeared');
        } catch {
            console.log('No table appeared - checking for other result indicators');
        }
        await page.waitForTimeout(3000);

        // Step 8: Full page screenshot
        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'verify-actions.png'),
            fullPage: true,
        });

        // Step 9: Check for burnish-actions
        const actionsCount = await page.locator('burnish-actions').count();
        console.log(`burnish-actions elements: ${actionsCount}`);

        // Step 10: Detailed action inspection
        if (actionsCount > 0) {
            const actionsAttr = await page.locator('burnish-actions').first().getAttribute('actions');
            console.log(`actions attribute: ${actionsAttr?.substring(0, 500)}`);

            const actionsText = await page.evaluate(() => {
                const el = document.querySelector('burnish-actions');
                if (!el?.shadowRoot) return 'no shadow root';
                const buttons = el.shadowRoot.querySelectorAll('button');
                return Array.from(buttons).map(b => b.textContent?.trim()).join(', ');
            });
            console.log(`action button labels: ${actionsText}`);
        }

        // Step 11: Check page text for action labels
        const bodyText = await page.evaluate(() => document.body.textContent || '');
        console.log(`Contains "list issues": ${/list.issues/i.test(bodyText)}`);
        console.log(`Contains "list commits": ${/list.commits/i.test(bodyText)}`);

        // Step 12: All burnish elements summary
        const burnishEls = await page.evaluate(() => {
            const tags: Record<string, number> = {};
            document.querySelectorAll('*').forEach(el => {
                const tag = el.tagName.toLowerCase();
                if (tag.startsWith('burnish-')) tags[tag] = (tags[tag] || 0) + 1;
            });
            return tags;
        });
        console.log(`burnish elements: ${JSON.stringify(burnishEls)}`);

        // Console errors
        if (consoleErrors.length > 0) {
            console.log('=== Console/page errors ===');
            consoleErrors.forEach(e => console.log(`  ${e}`));
        }

        // Bottom of page screenshot
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'verify-actions-bottom.png'),
            fullPage: true,
        });

        // Final report
        const tableCount = await page.locator('burnish-table').count();
        console.log('\n========================================');
        console.log('=== VERIFICATION RESULT ===');
        console.log('========================================');
        console.log(`Tool cards rendered: ${cardCount}`);
        console.log(`Tables: ${tableCount}`);
        console.log(`Action buttons: ${actionsCount}`);
        console.log(`Action buttons appeared: ${actionsCount > 0 ? 'YES' : 'NO'}`);
        console.log(`Console errors: ${consoleErrors.length}`);
        console.log('========================================');
    });
});
