import { test, expect } from '@playwright/test';

test('empty session persists after page refresh', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.burnish-session-item');

    const sessionId = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    expect(sessionId).toBeTruthy();

    await page.waitForTimeout(1000);

    await page.reload();
    await page.waitForSelector('.burnish-session-item');

    const sessionIdAfter = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    expect(sessionIdAfter).toBe(sessionId);
});

test('session with prompt steps persists after refresh', async ({ page }) => {
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warn') {
            console.log(`[browser ${msg.type()}] ${msg.text()}`);
        }
    });

    await page.goto('/');
    await page.waitForSelector('.burnish-session-item');

    // Submit a prompt
    await page.fill('#prompt-input', 'What tools are available?');
    await page.click('#btn-submit');

    // Wait for response to complete — button loses "cancel" class
    await page.waitForFunction(() => {
        const btn = document.getElementById('btn-submit');
        return btn && !btn.classList.contains('cancel');
    }, { timeout: 60_000 });

    // Verify we have at least one node rendered
    const nodeCount = await page.locator('.burnish-node').count();
    expect(nodeCount).toBeGreaterThanOrEqual(1);

    // Get session info
    const sessionId = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    const sessionTitle = await page.locator('.burnish-session-item .burnish-session-title').first().textContent();

    // Wait for saveState to flush
    await page.waitForTimeout(2000);

    // Verify nodes are in IndexedDB (burnish-nodes database)
    const nodeKeys = await page.evaluate(async () => {
        return new Promise<string[]>((resolve) => {
            const req = indexedDB.open('burnish-nodes');
            req.onsuccess = () => {
                const db = req.result;
                const storeNames = Array.from(db.objectStoreNames);
                if (!storeNames.includes('nodes')) { db.close(); resolve([]); return; }
                const tx = db.transaction('nodes', 'readonly');
                const store = tx.objectStore('nodes');
                const keysReq = store.getAllKeys();
                keysReq.onsuccess = () => { db.close(); resolve(keysReq.result as string[]); };
                keysReq.onerror = () => { db.close(); resolve([]); };
            };
            req.onerror = () => resolve([]);
        });
    });
    console.log(`Node keys in IndexedDB: ${JSON.stringify(nodeKeys)}`);
    expect(nodeKeys.length, 'Nodes should be saved in IndexedDB').toBeGreaterThanOrEqual(1);

    // Refresh
    await page.reload();
    await page.waitForSelector('.burnish-session-item');

    // Session survived
    const sessionIdAfter = await page.locator('.burnish-session-item').first().getAttribute('data-session-id');
    expect(sessionIdAfter).toBe(sessionId);

    const sessionTitleAfter = await page.locator('.burnish-session-item .burnish-session-title').first().textContent();
    expect(sessionTitleAfter).toBe(sessionTitle);

    // Nodes restored
    const nodeCountAfter = await page.locator('.burnish-node').count();
    console.log(`Nodes after refresh: ${nodeCountAfter}`);
    expect(nodeCountAfter, 'Nodes should be restored after refresh').toBeGreaterThanOrEqual(1);
});
