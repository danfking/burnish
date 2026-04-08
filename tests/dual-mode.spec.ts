import { test, expect } from '@playwright/test';

test.describe('Dual mode (Explorer/LLM Insight)', () => {
    test('Explorer mode works without LLM', async ({ page }) => {
        await page.goto('/');
        // Should load and show server buttons
        await expect(page.locator('#server-buttons')).toBeVisible();
        // Mode toggle should be hidden (no LLM configured in test env)
        const toggle = page.locator('.burnish-mode-toggle');
        // Either not present or hidden
        const toggleCount = await toggle.count();
        if (toggleCount > 0) {
            await expect(toggle).not.toBeVisible();
        }
    });

    test('/api/models returns empty when no LLM configured', async ({ page }) => {
        await page.goto('/');
        const response = await page.request.get('/api/models');
        expect(response.ok()).toBe(true);
        const data = await response.json();
        expect(data.models).toEqual([]);
    });

    test('/api/chat returns 503 when no LLM configured', async ({ page }) => {
        await page.goto('/');
        const response = await page.request.post('/api/chat', {
            data: { prompt: 'test' }
        });
        expect(response.status()).toBe(503);
    });

    test('AI insight slot is not visible in Explorer mode', async ({ page }) => {
        await page.goto('/');
        // Click a server and execute a tool
        const serverBtn = page.locator('#server-buttons button').first();
        if (await serverBtn.count() > 0) {
            await serverBtn.click();
            await page.waitForTimeout(1000);
            // No insight slots should be visible
            const insightSlots = page.locator('.burnish-ai-insight');
            const count = await insightSlots.count();
            for (let i = 0; i < count; i++) {
                await expect(insightSlots.nth(i)).not.toBeVisible();
            }
        }
    });

    test('LLM Insight prompt bar is hidden in Explorer mode', async ({ page }) => {
        await page.goto('/');
        const promptBar = page.locator('#llm-insight-prompt-bar');
        if (await promptBar.count() > 0) {
            await expect(promptBar).not.toBeVisible();
        }
    });
});
