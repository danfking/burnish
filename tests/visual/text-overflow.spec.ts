import { test } from '@playwright/test';

test('text overflow checks - injected components', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#prompt-input');

    // Test 1: Empty state
    await page.screenshot({ path: 'tests/visual/screenshots/overflow-empty-state.png', fullPage: true });

    // Test 2: Inject burnish components with long text directly into the content area
    await page.evaluate(() => {
        const contentArea = document.querySelector('#content-area') || document.querySelector('main');
        if (!contentArea) return;
        contentArea.innerHTML = `
            <burnish-section label="Very Long Section Title That Should Wrap Or Truncate Properly Without Overflowing Its Container" count="12" status="success">
                <burnish-card
                    title="Card With an Extremely Long Title That Might Overflow the Card Header Area and Cause Text Clipping Issues"
                    status="success"
                    body="This is a very long body text that tests whether the card component properly wraps text content. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur."
                    meta='{"environment":"production-us-east-1-very-long-region-name","version":"v2.14.3-beta.42+build.9876543210","uptime":"99.997% over last 365 days","last_deploy":"2024-03-15T14:32:00Z"}'
                    item-id="long-card-1">
                </burnish-card>

                <burnish-card
                    title="Short"
                    status="error"
                    body="Minimal content."
                    meta='{"key":"value"}'>
                </burnish-card>

                <burnish-card
                    title="Card With Unicode Characters and Special Text"
                    status="warning"
                    body="Testing special characters: &lt;script&gt;alert('xss')&lt;/script&gt; and emoji-like text (not actual emojis) plus very-long-hyphenated-words-that-might-not-break-properly-in-css and superlongwordwithoutanyspacesorhyphensthatmightcauseoverflowissuesinnarrowcontainers"
                    meta='{"metric":"1234567890.123456789","url":"https://very-long-domain-name.example.com/path/to/some/deeply/nested/resource?param1=value1&param2=value2&param3=value3"}'>
                </burnish-card>
            </burnish-section>

            <burnish-section label="Metrics" count="4" status="warning">
                <burnish-metric label="Very Long Metric Label That Should Be Handled Gracefully" value="1234567890.123" unit="requests/second/per/node" trend="up"></burnish-metric>
                <burnish-metric label="CPU" value="99.9" unit="%" trend="up"></burnish-metric>
                <burnish-metric label="Memory Utilization Across All Nodes in the Cluster" value="72.3" unit="GB" trend="down"></burnish-metric>
                <burnish-metric label="Net" value="0.1" unit="Gbps" trend="flat"></burnish-metric>
            </burnish-section>

            <burnish-stat-bar items='[{"label":"Very Long Status Label","value":"1234567890","color":"green"},{"label":"Errors","value":"42","color":"red"},{"label":"Warnings With Extra Context","value":"156","color":"orange"},{"label":"Pending Operations in Queue","value":"7890","color":"blue"}]'></burnish-stat-bar>

            <burnish-table
                title="Table With Long Cell Content"
                columns='["Name","Description","Very Long Column Header That Might Overflow","Status"]'
                rows='[["superlongservicenamewithoutseparators","This is an extremely long description that tests how the table handles text wrapping in cells. It should either truncate with ellipsis or wrap properly.","ValueThatIsVeryLongAndHasNoSpacesOrBreakingCharactersAtAll","success"],["api","Short","Short","error"],["database-service-us-east-1-primary","PostgreSQL 15.2 connected to replica cluster in multi-region deployment","192.168.1.1:5432","warning"]]'
                status-field="Status">
            </burnish-table>
        `;
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/visual/screenshots/overflow-injected-full.png', fullPage: true });

    // Test 3: Screenshot individual sections
    const sections = page.locator('burnish-section');
    const sectionCount = await sections.count();
    for (let i = 0; i < sectionCount; i++) {
        await sections.nth(i).screenshot({ path: `tests/visual/screenshots/overflow-section-${i}.png` });
    }

    // Test 4: Screenshot the table
    const table = page.locator('burnish-table');
    if (await table.count() > 0) {
        await table.screenshot({ path: 'tests/visual/screenshots/overflow-table.png' });
    }

    // Test 5: Screenshot the stat bar
    const statBar = page.locator('burnish-stat-bar');
    if (await statBar.count() > 0) {
        await statBar.screenshot({ path: 'tests/visual/screenshots/overflow-stat-bar.png' });
    }

    // Test 6: Screenshot individual cards
    const cards = page.locator('burnish-card');
    const cardCount = await cards.count();
    for (let i = 0; i < cardCount; i++) {
        await cards.nth(i).screenshot({ path: `tests/visual/screenshots/overflow-card-${i}.png` });
    }

    // Test 7: Screenshot metrics
    const metrics = page.locator('burnish-metric');
    const metricCount = await metrics.count();
    for (let i = 0; i < metricCount; i++) {
        await metrics.nth(i).screenshot({ path: `tests/visual/screenshots/overflow-metric-${i}.png` });
    }

    // Test 8: Header area
    const header = page.locator('.burnish-header');
    if (await header.count() > 0) {
        await header.screenshot({ path: 'tests/visual/screenshots/overflow-header.png' });
    }

    // Test 9: Prompt bar
    const promptBar = page.locator('.burnish-prompt-bar');
    if (await promptBar.count() > 0) {
        await promptBar.screenshot({ path: 'tests/visual/screenshots/overflow-prompt-bar.png' });
    }

    // Test 10: Narrow viewport to stress test overflow
    await page.setViewportSize({ width: 400, height: 800 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/visual/screenshots/overflow-narrow-viewport.png', fullPage: true });

    // Test 11: Very wide card title in narrow viewport
    await page.setViewportSize({ width: 320, height: 600 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/visual/screenshots/overflow-320px.png', fullPage: true });
});
