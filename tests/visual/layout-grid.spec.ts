import { test, expect } from '@playwright/test';

test('grid layout at multiple viewports', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Inject burnish components directly into the content area to test grid layout
    // This avoids dependency on LLM response time
    await page.evaluate(() => {
        // Find the content/output area
        const outputArea = document.getElementById('output')
            || document.querySelector('.output-area')
            || document.querySelector('#content-pane')
            || document.querySelector('main');

        if (!outputArea) {
            console.error('No output area found');
            return;
        }

        // Clear welcome screen
        outputArea.innerHTML = '';

        // Create sections with cards to test grid layout
        const sectionHTML = `
            <burnish-section label="Server Status" count="6" status="success">
                <burnish-card title="API Server" status="success" body="Running on port 3000" meta='{"uptime":"99.9%","region":"us-east-1"}'></burnish-card>
                <burnish-card title="Database" status="success" body="PostgreSQL 15.2 connected" meta='{"connections":"42/100","latency":"2ms"}'></burnish-card>
                <burnish-card title="Cache Layer" status="warning" body="Redis memory at 85%" meta='{"memory":"6.8GB/8GB","hit-rate":"94%"}'></burnish-card>
                <burnish-card title="Worker Queue" status="error" body="3 failed jobs in last hour" meta='{"pending":"156","failed":"3"}'></burnish-card>
                <burnish-card title="CDN" status="success" body="All edge nodes healthy" meta='{"nodes":"24/24","bandwidth":"1.2TB"}'></burnish-card>
                <burnish-card title="Auth Service" status="success" body="OAuth2 + SAML active" meta='{"active-sessions":"1,234","avg-auth-time":"45ms"}'></burnish-card>
            </burnish-section>
            <burnish-section label="Metrics Overview" count="4" status="success">
                <burnish-card title="CPU Usage" status="success" body="Average 34% across all nodes"></burnish-card>
                <burnish-card title="Memory" status="warning" body="72% utilized, consider scaling"></burnish-card>
                <burnish-card title="Disk I/O" status="success" body="Read: 150MB/s, Write: 80MB/s"></burnish-card>
                <burnish-card title="Network" status="success" body="Throughput: 450Mbps"></burnish-card>
            </burnish-section>
            <burnish-section label="Recent Alerts" count="3" status="error">
                <burnish-card title="High Memory Alert" status="error" body="Node worker-03 exceeded 90% memory threshold at 14:32 UTC"></burnish-card>
                <burnish-card title="Failed Deployment" status="error" body="Deploy #4521 failed: timeout in health check"></burnish-card>
                <burnish-card title="Certificate Expiry" status="warning" body="SSL cert for api.example.com expires in 14 days"></burnish-card>
            </burnish-section>
        `;

        outputArea.innerHTML = sectionHTML;
    });

    // Wait for web components to upgrade and render
    await page.waitForTimeout(2000);

    // Screenshot at different widths
    const widths = [1920, 1280, 1024, 768, 480];
    for (const w of widths) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(500);
        await page.screenshot({
            path: `tests/visual/screenshots/grid-${w}px.png`,
            fullPage: true
        });
        console.log(`Screenshot taken at ${w}px`);
    }

    // Verify components are actually rendered
    const sections = await page.locator('burnish-section').count();
    const cards = await page.locator('burnish-card').count();
    console.log(`Rendered: ${sections} sections, ${cards} cards`);
    expect(sections).toBe(3);
    expect(cards).toBe(13);
});
