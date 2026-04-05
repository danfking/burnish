import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const screenshotDir = 'C:/Users/Home/projects/burnish/tests/visual/screenshots';

// Test 8: Model dropdown in header
async function testModelDropdown() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Try to find and click model dropdown
    const modelSelect = await page.$('select#model-select, [data-model-select], .model-selector, select');
    if (modelSelect) {
        await modelSelect.click().catch(() => {});
    }

    await page.screenshot({ path: `${screenshotDir}/edge-model-dropdown.png`, fullPage: false });

    // Get the model dropdown text content
    const modelText = await page.evaluate(() => {
        const select = document.querySelector('select');
        if (select) return { tag: 'select', text: select.textContent, options: [...select.options].map(o => o.text) };
        const header = document.querySelector('header, .header, nav');
        return { tag: 'header', text: header?.textContent || 'no header found' };
    });
    console.log('MODEL DROPDOWN:', JSON.stringify(modelText));
    await page.close();
}

// Test 9: No [object Object] anywhere
async function testNoObjectObject() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Find and click on search_repositories tool in the tool catalog
    const toolButtons = await page.$$eval('button, [role="button"], a', els =>
        els.map(e => ({ text: e.textContent?.trim().slice(0, 80), tag: e.tagName })).filter(e => e.text?.includes('search'))
    );
    console.log('SEARCH BUTTONS:', JSON.stringify(toolButtons));

    // Try clicking the search_repositories tool
    const searchBtn = await page.$('text=search_repositories');
    if (searchBtn) {
        await searchBtn.click();
        await page.waitForTimeout(500);
    }

    // Look for a form
    const queryInput = await page.$('input[name="query"], input[placeholder*="query"], input[placeholder*="Query"]');
    if (queryInput) {
        await queryInput.fill('burnish');
        const submitBtn = await page.$('button[type="submit"], button:has-text("Execute"), button:has-text("Run")');
        if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(3000);
        }
    } else {
        console.log('No query input found, trying direct API call rendering...');
    }

    await page.screenshot({ path: `${screenshotDir}/edge-no-object-object.png`, fullPage: true });

    // Check for [object Object] in the page text
    const pageText = await page.evaluate(() => document.body.innerText);
    const hasObjectObject = pageText.includes('[object Object]');
    console.log('HAS [object Object]:', hasObjectObject);
    if (hasObjectObject) {
        const lines = pageText.split('\n').filter(l => l.includes('[object Object]'));
        console.log('FOUND AT:', JSON.stringify(lines.slice(0, 5)));
    }

    await page.close();
}

// Test 1 visual: Empty result rendering
async function testEmptyResultVisual() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const searchBtn = await page.$('text=search_repositories');
    if (searchBtn) {
        await searchBtn.click();
        await page.waitForTimeout(500);
        const queryInput = await page.$('input[name="query"]');
        if (queryInput) {
            await queryInput.fill('xyznonexistent99999');
            const submitBtn = await page.$('button[type="submit"], button:has-text("Execute"), button:has-text("Run")');
            if (submitBtn) {
                await submitBtn.click();
                await page.waitForTimeout(3000);
            }
        }
    }

    await page.screenshot({ path: `${screenshotDir}/edge-empty-result.png`, fullPage: true });

    const text = await page.evaluate(() => document.body.innerText);
    const hasError = text.toLowerCase().includes('crash') || text.toLowerCase().includes('unhandled');
    const hasObjectObject = text.includes('[object Object]');
    console.log('EMPTY RESULT - hasCrash:', hasError, 'hasObjectObject:', hasObjectObject);

    await page.close();
}

// Test 2 visual: Large result rendering
async function testLargeResultVisual() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Expand filesystem section if needed
    const fsSection = await page.$('text=filesystem');
    if (fsSection) {
        await fsSection.click();
        await page.waitForTimeout(500);
    }

    const listBtn = await page.$('text=list_directory');
    if (listBtn) {
        await listBtn.click();
        await page.waitForTimeout(500);
        const pathInput = await page.$('input[name="path"]');
        if (pathInput) {
            await pathInput.fill('C:/Users/Home');
            const submitBtn = await page.$('button[type="submit"], button:has-text("Execute"), button:has-text("Run")');
            if (submitBtn) {
                await submitBtn.click();
                await page.waitForTimeout(3000);
            }
        }
    }

    await page.screenshot({ path: `${screenshotDir}/edge-large-result.png`, fullPage: true });

    // Check for horizontal overflow on body
    const bodyOverflow = await page.evaluate(() => {
        return {
            scrollWidth: document.body.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            overflows: document.body.scrollWidth > document.documentElement.clientWidth + 5
        };
    });
    console.log('LARGE RESULT - body overflow:', JSON.stringify(bodyOverflow));

    await page.close();
}

try {
    await testModelDropdown();
    await testEmptyResultVisual();
    await testLargeResultVisual();
    await testNoObjectObject();
    console.log('ALL PLAYWRIGHT TESTS COMPLETE');
} catch (err) {
    console.error('TEST ERROR:', err.message);
    console.error(err.stack);
} finally {
    await browser.close();
}
