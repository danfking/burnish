/**
 * Burnish UI Audit Part 2 — View switcher + structured data rendering
 * Tests Cards/Table/JSON views with structured array results.
 */
import { chromium } from '@playwright/test';

const SCREENSHOTS = '/tmp/burnish-audit';
const BASE = 'http://localhost:3000';

const issues = [];
function report(severity, area, msg) {
    issues.push({ severity, area, msg });
    console.log(`[${severity.toUpperCase()}] ${area}: ${msg}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkForWhiteBackgrounds(page, label) {
    const whiteEls = await page.evaluate(() => {
        const found = [];
        const walk = (root) => {
            const els = root.querySelectorAll('*');
            for (const el of els) {
                const style = getComputedStyle(el);
                const bg = style.backgroundColor;
                if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
                const match = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
                if (match) {
                    const [, r, g, b] = match.map(Number);
                    if (r > 248 && g > 248 && b > 248) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 30 && rect.height > 10) {
                            const tag = el.tagName.toLowerCase();
                            const cls = el.className?.toString().substring(0, 50) || '';
                            found.push(`${tag}${cls ? '.'+cls.split(' ')[0] : ''} (${Math.round(rect.width)}x${Math.round(rect.height)}, bg=${bg})`);
                        }
                    }
                }
                if (el.shadowRoot) walk(el.shadowRoot);
            }
        };
        walk(document);
        return found.slice(0, 15);
    });
    if (whiteEls.length > 0) {
        report('high', label, `White/near-white backgrounds in dark mode:\n      ${whiteEls.join('\n      ')}`);
    } else {
        console.log(`  [ok] No white backgrounds in ${label}`);
    }
}

(async () => {
    console.log('=== Burnish UI Audit — View Switcher & Structured Data ===\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Ensure light mode + fresh session
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('burnish:theme', 'light');
    });
    await sleep(1000);

    // Create a new session to start clean
    const newSessionBtn = await page.$('#btn-new-session');
    if (newSessionBtn) await newSessionBtn.click();
    await sleep(500);

    // ──────────────────────────────────────────
    // Execute a tool that returns structured array data
    // Use list_directory_with_sizes which returns JSON objects
    // ──────────────────────────────────────────
    console.log('--- Executing list_directory_with_sizes for structured data ---');

    await page.evaluate(async () => {
        const { executeToolDirect } = await import('/deterministic-ui.js');
        await executeToolDirect('list_directory_with_sizes', { path: 'C:/Users/Home/projects/burnish' }, 'Directory listing');
    });
    await sleep(4000);
    await page.screenshot({ path: `${SCREENSHOTS}-20-structured-results-light.png`, fullPage: true });
    console.log('  Saved: 20-structured-results-light.png');

    // Check if we got structured results
    const structuredCheck = await page.evaluate(() => {
        const grid = document.querySelector('.burnish-cards-grid');
        const viewSwitcher = document.querySelector('.burnish-view-switcher');
        const statBars = document.querySelectorAll('burnish-stat-bar');
        const cards = document.querySelectorAll('.burnish-cards-grid burnish-card');
        return {
            hasGrid: !!grid,
            hasViewSwitcher: !!viewSwitcher,
            statBarCount: statBars.length,
            cardCount: cards.length,
            viewButtons: viewSwitcher ? Array.from(viewSwitcher.querySelectorAll('.burnish-view-btn')).map(b => ({
                text: b.textContent.trim(),
                active: b.classList.contains('active'),
                view: b.dataset.view
            })) : []
        };
    });
    console.log(`  Structured results: ${JSON.stringify(structuredCheck)}`);

    if (!structuredCheck.hasGrid && !structuredCheck.hasViewSwitcher) {
        console.log('  list_directory_with_sizes did not produce structured results.');
        console.log('  Trying search_repositories for structured array data...');

        await page.evaluate(async () => {
            const { executeToolDirect } = await import('/deterministic-ui.js');
            await executeToolDirect('search_repositories', { query: 'burnish mcp' }, 'Search repos');
        });
        await sleep(6000);
        await page.screenshot({ path: `${SCREENSHOTS}-20b-search-results-light.png`, fullPage: true });
        console.log('  Saved: 20b-search-results-light.png');
    }

    // Re-check for structured results
    const finalCheck = await page.evaluate(() => {
        const grid = document.querySelector('.burnish-cards-grid');
        const viewSwitcher = document.querySelector('.burnish-view-switcher');
        const cards = document.querySelectorAll('.burnish-cards-grid burnish-card');
        const statBars = document.querySelectorAll('burnish-stat-bar');
        const timingBadge = document.querySelector('.burnish-timing');
        const toolCall = document.querySelector('.burnish-tool-call');
        return {
            hasGrid: !!grid,
            gridChildCount: grid ? grid.children.length : 0,
            hasViewSwitcher: !!viewSwitcher,
            cardCount: cards.length,
            statBarCount: statBars.length,
            timingText: timingBadge?.textContent?.trim(),
            hasToolCall: !!toolCall,
            viewButtons: viewSwitcher ? Array.from(viewSwitcher.querySelectorAll('.burnish-view-btn')).map(b => ({
                text: b.textContent.trim(),
                active: b.classList.contains('active'),
            })) : []
        };
    });
    console.log(`  Final check: ${JSON.stringify(finalCheck)}`);

    if (!finalCheck.hasViewSwitcher) {
        report('medium', 'view-switcher', 'View switcher still not rendered — tool may not return array data');
    }

    // ──────────────────────────────────────────
    // Audit Cards view
    // ──────────────────────────────────────────
    if (finalCheck.hasGrid) {
        console.log('\n--- Auditing Cards view (light mode) ---');
        const gridStyle = await page.evaluate(() => {
            const grid = document.querySelector('.burnish-cards-grid');
            const s = getComputedStyle(grid);
            return {
                display: s.display,
                gridTemplateColumns: s.gridTemplateColumns?.substring(0, 100),
                gap: s.gap,
                overflow: s.overflow,
                overflowX: s.overflowX,
                scrollWidth: grid.scrollWidth,
                clientWidth: grid.clientWidth,
            };
        });
        console.log(`  Grid: ${JSON.stringify(gridStyle)}`);
        if (gridStyle.scrollWidth > gridStyle.clientWidth + 5) {
            report('medium', 'cards-grid', `Horizontal overflow: scrollWidth=${gridStyle.scrollWidth} > clientWidth=${gridStyle.clientWidth}`);
        }
    }

    // ──────────────────────────────────────────
    // Audit Table view
    // ──────────────────────────────────────────
    if (finalCheck.hasViewSwitcher) {
        console.log('\n--- Auditing Table view (light mode) ---');
        const tableBtnEl = await page.$('.burnish-view-btn[data-view="table"]');
        if (tableBtnEl) {
            await tableBtnEl.click();
            await sleep(800);
            await page.screenshot({ path: `${SCREENSHOTS}-21-table-light.png`, fullPage: true });
            console.log('  Saved: 21-table-light.png');

            const tableInfo = await page.evaluate(() => {
                const container = document.querySelector('.burnish-view-table');
                const table = document.querySelector('burnish-table');
                if (!table?.shadowRoot) return { found: false, container: !!container };

                const shadow = table.shadowRoot;
                const headers = shadow.querySelectorAll('th');
                const rows = shadow.querySelectorAll('tbody tr');
                const headerTexts = Array.from(headers).map(h => h.textContent.trim());

                // Check readability
                const firstRow = rows[0];
                let rowStyle = null;
                if (firstRow) {
                    const s = getComputedStyle(firstRow);
                    rowStyle = { color: s.color, bg: s.backgroundColor, fontSize: s.fontSize };
                }

                // Check header styling
                const firstHeader = headers[0];
                let headerStyle = null;
                if (firstHeader) {
                    const s = getComputedStyle(firstHeader);
                    headerStyle = { color: s.color, bg: s.backgroundColor, fontWeight: s.fontWeight };
                }

                return {
                    found: true,
                    container: !!container,
                    containerVisible: container ? getComputedStyle(container).display !== 'none' : false,
                    headers: headerTexts,
                    rowCount: rows.length,
                    headerStyle,
                    rowStyle,
                };
            });
            console.log(`  Table: ${JSON.stringify(tableInfo)}`);
            if (!tableInfo.found) report('medium', 'table-view', 'burnish-table not found');
            if (tableInfo.rowCount === 0) report('medium', 'table-view', 'No rows rendered');
            if (tableInfo.headers?.length === 0) report('medium', 'table-view', 'No headers rendered');
        }

        // ──────────────────────────────────────────
        // Audit JSON view
        // ──────────────────────────────────────────
        console.log('\n--- Auditing JSON view (light mode) ---');
        const jsonBtnEl = await page.$('.burnish-view-btn[data-view="json"]');
        if (jsonBtnEl) {
            await jsonBtnEl.click();
            await sleep(800);
            await page.screenshot({ path: `${SCREENSHOTS}-22-json-light.png`, fullPage: true });
            console.log('  Saved: 22-json-light.png');

            const jsonInfo = await page.evaluate(() => {
                const wrapper = document.querySelector('.burnish-json-wrapper');
                const pre = wrapper?.querySelector('.burnish-json-view') || document.querySelector('.burnish-json-view');
                const copyBtn = wrapper?.querySelector('.burnish-copy-btn') || document.querySelector('.burnish-copy-btn');

                if (!pre) return { found: false };

                const content = pre.textContent.trim();
                const preStyle = getComputedStyle(pre);
                const copyBtnBox = copyBtn?.getBoundingClientRect();

                return {
                    found: true,
                    wrapperVisible: wrapper ? getComputedStyle(wrapper).display !== 'none' : false,
                    contentLength: content.length,
                    startsWithBracket: content.startsWith('[') || content.startsWith('{'),
                    isPrettyPrinted: content.includes('\n'),
                    preColor: preStyle.color,
                    preBg: preStyle.backgroundColor,
                    preFontFamily: preStyle.fontFamily?.substring(0, 40),
                    copyBtnVisible: copyBtnBox ? (copyBtnBox.width > 0 && copyBtnBox.height > 0) : false,
                    copyBtnText: copyBtn?.textContent.trim(),
                    copyBtnColor: copyBtn ? getComputedStyle(copyBtn).color : null,
                    copyBtnBg: copyBtn ? getComputedStyle(copyBtn).backgroundColor : null,
                };
            });
            console.log(`  JSON: ${JSON.stringify(jsonInfo)}`);
            if (!jsonInfo.found) {
                report('medium', 'json-view', 'JSON pre element not found');
            } else {
                if (!jsonInfo.startsWithBracket) report('low', 'json-view', 'JSON content does not start with [ or {');
                if (!jsonInfo.isPrettyPrinted) report('medium', 'json-view', 'JSON is not pretty-printed');
                if (!jsonInfo.copyBtnVisible) report('medium', 'json-view', 'Copy button not visible');
                console.log(`  Copy button: visible=${jsonInfo.copyBtnVisible}, text="${jsonInfo.copyBtnText}", bg=${jsonInfo.copyBtnBg}`);
            }
        }

        // Switch back to Cards
        const cardsBtn2 = await page.$('.burnish-view-btn[data-view="cards"]');
        if (cardsBtn2) await cardsBtn2.click();
        await sleep(300);

        // ──────────────────────────────────────────
        // Dark mode — all three views
        // ──────────────────────────────────────────
        console.log('\n--- Dark mode: all views ---');
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await sleep(500);

        // Cards dark
        await page.screenshot({ path: `${SCREENSHOTS}-23-cards-dark.png`, fullPage: true });
        console.log('  Saved: 23-cards-dark.png');
        await checkForWhiteBackgrounds(page, 'dark-cards-view');

        // Table dark
        const tableBtnDark = await page.$('.burnish-view-btn[data-view="table"]');
        if (tableBtnDark) {
            await tableBtnDark.click();
            await sleep(500);
            await page.screenshot({ path: `${SCREENSHOTS}-24-table-dark.png`, fullPage: true });
            console.log('  Saved: 24-table-dark.png');
            await checkForWhiteBackgrounds(page, 'dark-table-view');

            // Check table header/row readability in dark
            const tableDark = await page.evaluate(() => {
                const table = document.querySelector('burnish-table');
                if (!table?.shadowRoot) return null;
                const th = table.shadowRoot.querySelector('th');
                const td = table.shadowRoot.querySelector('td');
                return {
                    headerColor: th ? getComputedStyle(th).color : null,
                    headerBg: th ? getComputedStyle(th).backgroundColor : null,
                    cellColor: td ? getComputedStyle(td).color : null,
                    cellBg: td ? getComputedStyle(td).backgroundColor : null,
                };
            });
            if (tableDark) {
                console.log(`  Table (dark): header=${tableDark.headerColor}/${tableDark.headerBg}, cell=${tableDark.cellColor}/${tableDark.cellBg}`);
            }
        }

        // JSON dark
        const jsonBtnDark = await page.$('.burnish-view-btn[data-view="json"]');
        if (jsonBtnDark) {
            await jsonBtnDark.click();
            await sleep(500);
            await page.screenshot({ path: `${SCREENSHOTS}-25-json-dark.png`, fullPage: true });
            console.log('  Saved: 25-json-dark.png');
            await checkForWhiteBackgrounds(page, 'dark-json-view');

            // Check copy button specifically
            const copyDark = await page.evaluate(() => {
                const btn = document.querySelector('.burnish-copy-btn');
                if (!btn) return null;
                const s = getComputedStyle(btn);
                const box = btn.getBoundingClientRect();
                return {
                    visible: box.width > 0 && box.height > 0,
                    color: s.color,
                    bg: s.backgroundColor,
                    border: s.border,
                    width: Math.round(box.width),
                    height: Math.round(box.height),
                };
            });
            if (copyDark) {
                console.log(`  Copy btn (dark): ${JSON.stringify(copyDark)}`);
                // Check if bg is white
                const m = copyDark.bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
                if (m) {
                    const [, r, g, b] = m.map(Number);
                    if (r > 248 && g > 248 && b > 248) {
                        report('high', 'dark-copy-btn', `Copy button has white background in dark mode: ${copyDark.bg}`);
                    }
                }
            }
        }
    }

    // ──────────────────────────────────────────
    // Also check the Tool Call copy button in dark mode
    // ──────────────────────────────────────────
    console.log('\n--- Tool Call section (dark mode) ---');
    const toolCallCopyDark = await page.evaluate(() => {
        const details = document.querySelector('.burnish-tool-call');
        if (!details) return { found: false };

        // Open it first
        details.open = true;

        const copyBtn = details.querySelector('.burnish-copy-btn');
        const pre = details.querySelector('pre');
        const summary = details.querySelector('summary');

        return {
            found: true,
            copyBtnExists: !!copyBtn,
            copyBtnBg: copyBtn ? getComputedStyle(copyBtn).backgroundColor : null,
            copyBtnColor: copyBtn ? getComputedStyle(copyBtn).color : null,
            copyBtnVisible: copyBtn ? (copyBtn.offsetWidth > 0) : null,
            preBg: pre ? getComputedStyle(pre).backgroundColor : null,
            preColor: pre ? getComputedStyle(pre).color : null,
            summaryColor: summary ? getComputedStyle(summary).color : null,
        };
    });
    console.log(`  Tool call (dark): ${JSON.stringify(toolCallCopyDark)}`);
    if (toolCallCopyDark.copyBtnBg) {
        const m = toolCallCopyDark.copyBtnBg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            const [, r, g, b] = m.map(Number);
            if (r > 248 && g > 248 && b > 248) {
                report('high', 'dark-toolcall-copy', `Tool Call copy button has white background in dark mode: ${toolCallCopyDark.copyBtnBg}`);
            }
        }
    }

    await sleep(300);
    await page.screenshot({ path: `${SCREENSHOTS}-26-toolcall-dark-open.png`, fullPage: true });
    console.log('  Saved: 26-toolcall-dark-open.png');

    // ──────────────────────────────────────────
    // Summary
    // ──────────────────────────────────────────
    console.log('\n\n========================================');
    console.log('   VIEW SWITCHER AUDIT SUMMARY');
    console.log('========================================\n');

    const high = issues.filter(i => i.severity === 'high');
    const medium = issues.filter(i => i.severity === 'medium');
    const low = issues.filter(i => i.severity === 'low');

    if (high.length) {
        console.log(`HIGH SEVERITY (${high.length}):`);
        high.forEach(i => console.log(`  [${i.area}] ${i.msg}`));
        console.log();
    }
    if (medium.length) {
        console.log(`MEDIUM SEVERITY (${medium.length}):`);
        medium.forEach(i => console.log(`  [${i.area}] ${i.msg}`));
        console.log();
    }
    if (low.length) {
        console.log(`LOW SEVERITY (${low.length}):`);
        low.forEach(i => console.log(`  [${i.area}] ${i.msg}`));
        console.log();
    }
    if (issues.length === 0) {
        console.log('No issues found!\n');
    }

    console.log(`Total: ${issues.length} issues (${high.length} high, ${medium.length} medium, ${low.length} low)`);
    console.log(`Screenshots: ${SCREENSHOTS}-2*.png`);

    await browser.close();
})();
