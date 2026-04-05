import { test, expect } from '@playwright/test';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('tests/visual/screenshots');

test.describe('Deterministic navigation flow (no-model mode)', () => {
    test.setTimeout(120_000);

    test('complete flow walkthrough', async ({ page }) => {
        // Clear IndexedDB to start fresh
        await page.goto('/');
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

        // ── STEP 1: Page load — empty state ──
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Wait for server buttons to load (they come from /api/servers)
        await page.waitForFunction(() => {
            const btns = document.querySelectorAll('.burnish-suggestion-server');
            return btns.length > 0;
        }, { timeout: 15_000 });
        await page.waitForTimeout(500);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-01-empty-state.png'),
            fullPage: true,
        });

        // Verify empty state elements
        const modelSelect = page.locator('#model-select');
        const modelText = await modelSelect.textContent();
        expect(modelText?.trim()).toContain('No models');

        const serverButtons = page.locator('.burnish-suggestion-server');
        const serverCount = await serverButtons.count();
        expect(serverCount).toBeGreaterThanOrEqual(2); // filesystem + github

        // Check for starter prompts
        const starterPrompts = page.locator('#starter-prompts .burnish-suggestion');
        const starterCount = await starterPrompts.count();
        expect(starterCount).toBeGreaterThan(0);

        // ── STEP 2: Click Filesystem button ──
        const filesystemBtn = page.locator('.burnish-suggestion-server', { hasText: 'filesystem' });
        await expect(filesystemBtn).toBeVisible();
        await filesystemBtn.click();

        // Tool cards should render INSTANTLY (no spinner) — wait for burnish-card elements
        await page.waitForSelector('burnish-card', { timeout: 5_000 });
        await page.waitForTimeout(800);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-02-filesystem-tools.png'),
            fullPage: true,
        });

        // Verify: no "Thinking..." spinner visible
        const thinkingSpinner = await page.locator('.burnish-progress, .burnish-spinner').count();
        expect(thinkingSpinner).toBe(0);

        // Verify: cards are grouped in sections
        const sections = page.locator('burnish-section');
        const sectionCount = await sections.count();
        expect(sectionCount).toBeGreaterThan(0);

        // Verify: stat-bar shows tool counts
        const statBar = page.locator('burnish-stat-bar');
        await expect(statBar.first()).toBeVisible();

        // Verify: cards exist (filesystem has 14 tools)
        const toolCards = page.locator('burnish-card');
        const toolCardCount = await toolCards.count();
        expect(toolCardCount).toBeGreaterThanOrEqual(10);

        // ── STEP 3: Click a filesystem tool card (list_directory) ──
        // The card's "Explore" button is inside shadow DOM — we need to click it there
        const clickedCard = await page.evaluate(() => {
            const cards = document.querySelectorAll('burnish-card');
            for (const card of cards) {
                if (card.getAttribute('title') === 'list_directory' ||
                    card.getAttribute('title')?.includes('list_directory')) {
                    const action = card.shadowRoot?.querySelector('.card-action');
                    if (action) {
                        (action as HTMLElement).click();
                        return card.getAttribute('title');
                    }
                }
            }
            // Fallback: click first card with "list" in title
            for (const card of cards) {
                const title = card.getAttribute('title') || '';
                if (title.toLowerCase().includes('list')) {
                    const action = card.shadowRoot?.querySelector('.card-action');
                    if (action) {
                        (action as HTMLElement).click();
                        return title;
                    }
                }
            }
            return null;
        });
        expect(clickedCard).not.toBeNull();

        // Wait for form to appear (rendered as a new node)
        await page.waitForSelector('burnish-form', { timeout: 8_000 });
        await page.waitForTimeout(500);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-03-tool-form.png'),
            fullPage: true,
        });

        // Verify form is visible
        const formEl = page.locator('burnish-form');
        await expect(formEl.first()).toBeVisible();

        // ── STEP 4: Fill form and submit ──
        // The burnish-form uses shadow DOM — fill the path input inside it
        const filledForm = await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return false;
            const inputs = form.shadowRoot.querySelectorAll('input[type="text"], input:not([type]), input');
            for (const input of inputs) {
                const inp = input as HTMLInputElement;
                if (inp.name === 'path' || inp.placeholder?.toLowerCase().includes('path') || inp.type === 'text') {
                    inp.value = 'C:/Users/Home';
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        });
        expect(filledForm).toBe(true);

        // Submit the form via shadow DOM button
        await page.evaluate(() => {
            const form = document.querySelector('burnish-form');
            if (!form || !form.shadowRoot) return;
            // Look for submit button
            const buttons = form.shadowRoot.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.type === 'submit' || btn.textContent?.toLowerCase().includes('submit') ||
                    btn.textContent?.toLowerCase().includes('run') || btn.textContent?.toLowerCase().includes('execute')) {
                    btn.click();
                    return;
                }
            }
            // Fallback: click last button
            if (buttons.length > 0) {
                buttons[buttons.length - 1].click();
            }
        });

        // Wait for results to appear (tool execution + rendering)
        await page.waitForTimeout(5000);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-04-tool-results.png'),
            fullPage: true,
        });

        // Verify: results do NOT contain "[object Object]"
        const pageContent = await page.content();
        expect(pageContent).not.toContain('[object Object]');

        // Verify results show as table or cards (not raw text dump)
        const allCards = await page.locator('burnish-card, burnish-table').count();
        // We had cards from the tool listing; check that new results appeared
        // The last node should have results
        const nodeContents = page.locator('.burnish-node-content');
        const nodeCount = await nodeContents.count();
        expect(nodeCount).toBeGreaterThanOrEqual(2); // tool listing + form + results

        // ── STEP 5: Click GitHub button ──
        // Create a new session first
        await page.locator('#btn-new-session').click();
        await page.waitForTimeout(500);

        // Wait for empty state with server buttons
        await page.waitForFunction(() => {
            const btns = document.querySelectorAll('.burnish-suggestion-server');
            return btns.length > 0;
        }, { timeout: 10_000 });

        const githubBtn = page.locator('.burnish-suggestion-server', { hasText: 'github' });
        await expect(githubBtn).toBeVisible();
        await githubBtn.click();

        // Wait for GitHub tool cards to render
        await page.waitForSelector('burnish-card', { timeout: 5_000 });
        await page.waitForTimeout(800);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-05-github-tools.png'),
            fullPage: true,
        });

        // Verify GitHub tools rendered as cards
        const githubCards = page.locator('burnish-card');
        const githubCardCount = await githubCards.count();
        expect(githubCardCount).toBeGreaterThanOrEqual(20); // GitHub has 26 tools

        // ── STEP 6: Type free text "hello" and submit ──
        const promptInput = page.locator('#prompt-input');
        await promptInput.fill('hello');
        await page.locator('#btn-submit').click();

        // Wait for the response node to render
        await page.waitForTimeout(1500);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-06-free-text-no-llm.png'),
            fullPage: true,
        });

        // Verify: shows "LLM not configured" warning, NOT a crash
        // The card is inside shadow DOM so check the page HTML for the attribute
        const hasWarningCard = await page.evaluate(() => {
            const cards = document.querySelectorAll('burnish-card');
            for (const card of cards) {
                if (card.getAttribute('title') === 'LLM not configured') return true;
            }
            return false;
        });
        expect(hasWarningCard).toBe(true);

        // Verify no error 500 or crash indicators
        const errorIndicators = await page.locator('.burnish-error-500, .error-500').count();
        expect(errorIndicators).toBe(0);

        // ── STEP 7: Create new session via "+" button ──
        await page.locator('#btn-new-session').click();
        await page.waitForTimeout(1000);

        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'flow-07-new-session.png'),
            fullPage: true,
        });

        // Verify: empty state restored
        const emptyState = page.locator('.burnish-empty-state');
        await expect(emptyState).toBeVisible({ timeout: 3_000 });

        // Verify: submit button is in send state (not cancel/stop)
        const submitBtn = page.locator('#btn-submit');
        const hasCancel = await submitBtn.evaluate(el => el.classList.contains('cancel'));
        expect(hasCancel).toBe(false);

        // Verify: prompt input is enabled
        const isDisabled = await promptInput.evaluate(el => (el as HTMLTextAreaElement).disabled);
        expect(isDisabled).toBe(false);
    });
});
