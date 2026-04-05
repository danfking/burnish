/**
 * Burnish UI Quality Audit — Playwright script
 * Inspects tool execution flow, results rendering, and interactive states.
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
                        if (rect.width > 50 && rect.height > 20) {
                            const tag = el.tagName.toLowerCase();
                            const cls = el.className?.toString().substring(0, 50) || '';
                            found.push(`${tag}${cls ? '.'+cls.split(' ')[0] : ''} (${Math.round(rect.width)}x${Math.round(rect.height)}, bg=${bg})`);
                        }
                    }
                }
                // Check shadow DOM too
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

async function checkOverflow(page, label) {
    const overflowEls = await page.evaluate(() => {
        const found = [];
        const selectors = '.burnish-cards-grid, burnish-card, burnish-table, .burnish-json-view, .burnish-view-switcher, .burnish-node-content';
        const els = document.querySelectorAll(selectors);
        for (const el of els) {
            if (el.scrollWidth > el.clientWidth + 5) {
                found.push(`${el.tagName.toLowerCase()}${el.className ? '.'+el.className.toString().split(' ')[0] : ''} (scrollW=${el.scrollWidth} > clientW=${el.clientWidth})`);
            }
        }
        return found;
    });
    if (overflowEls.length > 0) {
        report('medium', label, `Overflow detected: ${overflowEls.join(', ')}`);
    } else {
        console.log(`  [ok] No overflow in ${label}`);
    }
}

(async () => {
    console.log('=== Burnish UI Quality Audit ===\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // Collect console errors
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ──────────────────────────────────────────
    // 1. Navigate, select filesystem, execute list_directory
    // ──────────────────────────────────────────
    console.log('--- Phase 1: Tool execution flow (light mode) ---');

    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Ensure light mode
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('burnish:theme', 'light');
    });
    await sleep(1000);
    await page.screenshot({ path: `${SCREENSHOTS}-01-landing.png`, fullPage: true });
    console.log('  Saved: 01-landing.png');

    // Click the filesystem server button (not github)
    console.log('  Looking for filesystem server button...');
    const allServerBtns = await page.$$('button.burnish-suggestion-server');
    let fsBtnClicked = false;
    for (const btn of allServerBtns) {
        const label = await btn.getAttribute('data-label');
        const text = await btn.textContent();
        console.log(`    Server button: label="${label}", text="${text.trim().substring(0, 40)}"`);
        if (label === 'filesystem' || text.toLowerCase().includes('filesystem')) {
            await btn.click();
            fsBtnClicked = true;
            console.log('  -> Clicked filesystem server');
            break;
        }
    }
    if (!fsBtnClicked) {
        report('high', 'setup', 'Filesystem server button not found, clicking first available');
        if (allServerBtns.length > 0) await allServerBtns[0].click();
    }
    await sleep(2000);
    await page.screenshot({ path: `${SCREENSHOTS}-02-tool-listing.png`, fullPage: true });
    console.log('  Saved: 02-tool-listing.png');

    // Check stat-bar
    const statBarInfo = await page.evaluate(() => {
        const sb = document.querySelector('burnish-stat-bar');
        if (!sb) return null;
        const box = sb.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height), visible: box.height > 0 };
    });
    if (statBarInfo?.visible) {
        console.log(`  [ok] Stat-bar visible (${statBarInfo.width}x${statBarInfo.height})`);
    } else {
        report('medium', 'tool-listing', 'Stat-bar not visible');
    }

    // Find and click list_directory tool card's Explore button via shadow DOM
    console.log('  Looking for list_directory card...');
    const cardClickResult = await page.evaluate(() => {
        const cards = document.querySelectorAll('burnish-card');
        for (const card of cards) {
            const itemId = card.getAttribute('item-id') || '';
            if (itemId.includes('list_directory') && !itemId.includes('list_directory_with_sizes')) {
                const shadow = card.shadowRoot;
                if (shadow) {
                    const action = shadow.querySelector('.card-action');
                    if (action) {
                        action.click();
                        return { method: 'shadow-click', itemId };
                    }
                }
                // Fallback: dispatch event
                card.dispatchEvent(new CustomEvent('burnish-card-action', {
                    detail: { title: card.getAttribute('title'), itemId, status: card.getAttribute('status') },
                    bubbles: true, composed: true
                }));
                return { method: 'event-dispatch', itemId };
            }
        }
        const allIds = Array.from(cards).map(c => c.getAttribute('item-id')).filter(Boolean);
        return { method: 'not-found', available: allIds.join(', ') };
    });
    console.log(`  Card click: ${JSON.stringify(cardClickResult)}`);
    await sleep(1500);
    await page.screenshot({ path: `${SCREENSHOTS}-03-form.png`, fullPage: true });
    console.log('  Saved: 03-form.png');

    // Check if form appeared
    const formCheck = await page.evaluate(() => {
        const forms = document.querySelectorAll('burnish-form');
        if (forms.length === 0) return { found: false };
        const form = forms[forms.length - 1];
        const shadow = form.shadowRoot;
        if (!shadow) return { found: true, shadow: false };
        const inputs = shadow.querySelectorAll('input, textarea');
        const labels = Array.from(shadow.querySelectorAll('.form-label')).map(l => l.textContent.trim());
        return { found: true, shadow: true, inputCount: inputs.length, labels };
    });
    console.log(`  Form: ${JSON.stringify(formCheck)}`);

    if (!formCheck.found) {
        report('high', 'form', 'burnish-form not found after clicking Explore on list_directory');
    }

    // Fill path field in burnish-form shadow DOM
    if (formCheck.found && formCheck.shadow) {
        const fillResult = await page.evaluate(() => {
            const forms = document.querySelectorAll('burnish-form');
            const form = forms[forms.length - 1];
            if (!form?.shadowRoot) return 'no shadow';
            const inputs = form.shadowRoot.querySelectorAll('input, textarea');
            let filled = false;
            for (const input of inputs) {
                const field = input.closest('.form-field');
                const label = field?.querySelector('.form-label')?.textContent?.toLowerCase() || '';
                const name = input.getAttribute('name') || '';
                if (label.includes('path') || name.includes('path') || inputs.length === 1) {
                    // Use native input setter to trigger Lit reactivity
                    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                    nativeSet.call(input, 'C:/Users/Home/projects/burnish');
                    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    filled = true;
                    break;
                }
            }
            return filled ? 'filled' : 'no path input found';
        });
        console.log(`  Fill result: ${fillResult}`);
        await sleep(300);

        // Submit the form
        const submitResult = await page.evaluate(() => {
            const forms = document.querySelectorAll('burnish-form');
            const form = forms[forms.length - 1];
            if (!form?.shadowRoot) return 'no shadow';

            // Try clicking the submit button in shadow DOM
            const buttons = form.shadowRoot.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent.toLowerCase();
                if (text.includes('execute') || text.includes('submit') || text.includes('run') || btn.type === 'submit') {
                    btn.click();
                    return 'clicked: ' + btn.textContent.trim();
                }
            }
            // Try last button
            if (buttons.length > 0) {
                buttons[buttons.length - 1].click();
                return 'clicked last button: ' + buttons[buttons.length - 1].textContent.trim();
            }
            return 'no button found';
        });
        console.log(`  Submit result: ${submitResult}`);
    }

    // Wait for execution results
    console.log('  Waiting for results...');
    await sleep(4000);
    await page.screenshot({ path: `${SCREENSHOTS}-04-results-light.png`, fullPage: true });
    console.log('  Saved: 04-results-light.png');

    // If form submit didn't work via UI, execute directly via the app's own function
    const hasResults = await page.evaluate(() => {
        return document.querySelector('.burnish-cards-grid') !== null ||
               document.querySelector('.burnish-view-switcher') !== null;
    });

    if (!hasResults) {
        console.log('  Results not rendered via form, executing tool directly via JS...');
        await page.evaluate(async () => {
            // Use the global module
            const { executeToolDirect } = await import('/deterministic-ui.js');
            await executeToolDirect('list_directory', { path: 'C:/Users/Home/projects/burnish' }, 'list_directory');
        });
        await sleep(4000);
        await page.screenshot({ path: `${SCREENSHOTS}-04b-results-direct.png`, fullPage: true });
        console.log('  Saved: 04b-results-direct.png');
    }

    // ──────────────────────────────────────────
    // Audit result rendering
    // ──────────────────────────────────────────
    console.log('\n--- Auditing result rendering ---');

    const gridCheck = await page.evaluate(() => {
        const grid = document.querySelector('.burnish-cards-grid');
        if (!grid) return null;
        const style = getComputedStyle(grid);
        const children = grid.children.length;
        return {
            display: style.display,
            columns: style.gridTemplateColumns?.substring(0, 80),
            gap: style.gap,
            children
        };
    });
    if (gridCheck) {
        console.log(`  [ok] Cards grid: display=${gridCheck.display}, cols=${gridCheck.columns}, gap=${gridCheck.gap}, children=${gridCheck.children}`);
    } else {
        report('medium', 'results', 'No .burnish-cards-grid found');
    }

    await checkOverflow(page, 'results-light');

    // Check stat-bar in results area
    const resultStatBars = await page.$$eval('burnish-stat-bar', els => els.length);
    console.log(`  Stat-bars on page: ${resultStatBars}`);

    // Check view switcher
    const viewSwitcherCheck = await page.evaluate(() => {
        const vs = document.querySelector('.burnish-view-switcher');
        if (!vs) return null;
        const box = vs.getBoundingClientRect();
        const btns = vs.querySelectorAll('.burnish-view-btn');
        return {
            visible: box.height > 0,
            width: Math.round(box.width),
            height: Math.round(box.height),
            buttons: Array.from(btns).map(b => ({ text: b.textContent.trim(), active: b.classList.contains('active') }))
        };
    });
    if (viewSwitcherCheck) {
        console.log(`  [ok] View switcher: ${viewSwitcherCheck.width}x${viewSwitcherCheck.height}, buttons=${JSON.stringify(viewSwitcherCheck.buttons)}`);
        if (viewSwitcherCheck.buttons.length !== 3) {
            report('medium', 'view-switcher', `Expected 3 buttons (Cards/Table/JSON), found ${viewSwitcherCheck.buttons.length}`);
        }
    } else {
        report('medium', 'view-switcher', 'View switcher not found');
    }

    // Check timing badge
    const timingCheck = await page.evaluate(() => {
        const badge = document.querySelector('.burnish-timing');
        if (!badge) return null;
        const style = getComputedStyle(badge);
        const box = badge.getBoundingClientRect();
        return {
            text: badge.textContent.trim(),
            visible: box.height > 0,
            color: style.color,
            bg: style.backgroundColor,
            fontSize: style.fontSize
        };
    });
    if (timingCheck) {
        console.log(`  [ok] Timing badge: "${timingCheck.text}", color=${timingCheck.color}, bg=${timingCheck.bg}`);
    } else {
        report('low', 'timing', 'Timing badge not found');
    }

    // Check tool call section
    const toolCallCheck = await page.evaluate(() => {
        const details = document.querySelector('.burnish-tool-call');
        if (!details) return null;
        const summary = details.querySelector('summary');
        const pre = details.querySelector('pre');
        const copyBtn = details.querySelector('.burnish-copy-btn');
        return {
            summaryText: summary?.textContent.trim(),
            hasPreContent: pre ? pre.textContent.length > 0 : false,
            hasCopyBtn: !!copyBtn,
            isOpen: details.open
        };
    });
    if (toolCallCheck) {
        console.log(`  [ok] Tool call section: summary="${toolCallCheck.summaryText}", hasContent=${toolCallCheck.hasPreContent}, copyBtn=${toolCallCheck.hasCopyBtn}`);
        if (!toolCallCheck.hasCopyBtn) {
            report('medium', 'tool-call', 'Copy button missing in tool call section');
        }
    } else {
        report('low', 'tool-call', 'Tool call section not found');
    }

    // Card consistency
    const cardConsistency = await page.evaluate(() => {
        const cards = document.querySelectorAll('burnish-card');
        const radiusSet = new Set();
        const shadowSet = new Set();
        let count = 0;
        for (const card of cards) {
            if (!card.shadowRoot) continue;
            const inner = card.shadowRoot.querySelector('.card');
            if (!inner) continue;
            count++;
            const s = getComputedStyle(inner);
            radiusSet.add(s.borderRadius);
            shadowSet.add(s.boxShadow?.substring(0, 50));
        }
        return { count, radii: [...radiusSet], shadows: shadowSet.size };
    });
    console.log(`  Cards: ${cardConsistency.count} inspected, ${cardConsistency.radii.length} border-radius variant(s), ${cardConsistency.shadows} shadow variant(s)`);
    if (cardConsistency.radii.length > 1) {
        report('low', 'card-consistency', `Inconsistent border-radius: ${cardConsistency.radii.join(' vs ')}`);
    }

    // ──────────────────────────────────────────
    // 2. View switcher audit
    // ──────────────────────────────────────────
    console.log('\n--- Phase 2: View switcher audit ---');

    // Table view
    const tableBtnEl = await page.$('.burnish-view-btn[data-view="table"]');
    if (tableBtnEl) {
        await tableBtnEl.click();
        await sleep(800);
        await page.screenshot({ path: `${SCREENSHOTS}-05-table-light.png`, fullPage: true });
        console.log('  Saved: 05-table-light.png');

        const tableInfo = await page.evaluate(() => {
            // Check visibility of table container
            const container = document.querySelector('.burnish-view-table');
            const visible = container ? getComputedStyle(container).display !== 'none' : false;

            const table = document.querySelector('burnish-table');
            if (!table?.shadowRoot) return { visible, element: !!table, shadow: false };
            const headers = table.shadowRoot.querySelectorAll('th');
            const rows = table.shadowRoot.querySelectorAll('tbody tr');
            const headerTexts = Array.from(headers).map(h => h.textContent.trim()).slice(0, 8);

            // Check for status colors in cells
            const statusCells = table.shadowRoot.querySelectorAll('.status-cell, [class*="status"], td');
            let hasStatusColors = false;
            for (const cell of statusCells) {
                const style = getComputedStyle(cell);
                if (style.color !== style.parentElement?.style?.color) {
                    hasStatusColors = true;
                    break;
                }
            }

            return {
                visible,
                element: true,
                shadow: true,
                headers: headerTexts,
                headerCount: headers.length,
                rowCount: rows.length,
            };
        });
        console.log(`  Table: ${JSON.stringify(tableInfo)}`);
        if (!tableInfo.visible) report('medium', 'table-view', 'Table container not visible after clicking Table button');
        if (tableInfo.headerCount === 0) report('medium', 'table-view', 'No table headers found');
        if (tableInfo.rowCount === 0) report('medium', 'table-view', 'No table rows found');
    } else {
        report('medium', 'view-switcher', 'Table view button not found');
    }

    // JSON view
    const jsonBtnEl = await page.$('.burnish-view-btn[data-view="json"]');
    if (jsonBtnEl) {
        await jsonBtnEl.click();
        await sleep(800);
        await page.screenshot({ path: `${SCREENSHOTS}-06-json-light.png`, fullPage: true });
        console.log('  Saved: 06-json-light.png');

        const jsonInfo = await page.evaluate(() => {
            const wrapper = document.querySelector('.burnish-json-wrapper');
            const pre = document.querySelector('.burnish-json-view');
            const copyBtn = document.querySelector('.burnish-json-wrapper .burnish-copy-btn') ||
                            document.querySelector('.burnish-copy-btn');
            if (!pre) return { found: false };
            const content = pre.textContent.trim();
            const wrapperVisible = wrapper ? getComputedStyle(wrapper).display !== 'none' : false;
            const copyBox = copyBtn ? copyBtn.getBoundingClientRect() : null;
            return {
                found: true,
                wrapperVisible,
                contentLength: content.length,
                startsWithBracket: content.startsWith('{') || content.startsWith('['),
                isFormatted: content.includes('\n'),
                copyBtnVisible: copyBox ? (copyBox.width > 0 && copyBox.height > 0) : false,
                copyBtnText: copyBtn?.textContent.trim()
            };
        });
        console.log(`  JSON: ${JSON.stringify(jsonInfo)}`);
        if (!jsonInfo.found) {
            report('medium', 'json-view', 'JSON view element not found');
        } else {
            if (!jsonInfo.startsWithBracket) report('low', 'json-view', 'JSON may not be properly formatted (does not start with { or [)');
            if (!jsonInfo.isFormatted) report('low', 'json-view', 'JSON does not appear pretty-printed (no newlines)');
            if (!jsonInfo.copyBtnVisible) report('medium', 'json-view', 'Copy button not visible in JSON view');
        }
    } else {
        report('medium', 'view-switcher', 'JSON view button not found');
    }

    // Switch back to Cards for dark mode testing
    const cardsBtn = await page.$('.burnish-view-btn[data-view="cards"]');
    if (cardsBtn) await cardsBtn.click();
    await sleep(300);

    // ──────────────────────────────────────────
    // 3. Dark mode audit
    // ──────────────────────────────────────────
    console.log('\n--- Phase 3: Dark mode audit ---');

    const themeToggle = await page.$('#theme-toggle');
    if (themeToggle) {
        await themeToggle.click();
        await sleep(500);
    } else {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        report('medium', 'dark-mode', '#theme-toggle button not found');
    }

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`  Theme: ${theme}`);

    // Results in dark mode
    await page.screenshot({ path: `${SCREENSHOTS}-07-results-dark.png`, fullPage: true });
    console.log('  Saved: 07-results-dark.png');
    await checkForWhiteBackgrounds(page, 'dark-results');

    // Timing badge readability
    const timingDark = await page.evaluate(() => {
        const badge = document.querySelector('.burnish-timing');
        if (!badge) return null;
        const s = getComputedStyle(badge);
        return { text: badge.textContent, color: s.color, bg: s.backgroundColor, visible: badge.offsetHeight > 0 };
    });
    if (timingDark) {
        console.log(`  Timing (dark): "${timingDark.text}", color=${timingDark.color}, bg=${timingDark.bg}, visible=${timingDark.visible}`);
        if (!timingDark.visible) report('medium', 'dark-mode', 'Timing badge not visible in dark mode');
    }

    // Tool call section readability
    const toolCallDark = await page.evaluate(() => {
        const d = document.querySelector('.burnish-tool-call');
        if (!d) return null;
        const summary = d.querySelector('summary');
        const pre = d.querySelector('pre');
        const copyBtn = d.querySelector('.burnish-copy-btn');
        return {
            summaryColor: summary ? getComputedStyle(summary).color : null,
            preBg: pre ? getComputedStyle(pre).backgroundColor : null,
            preColor: pre ? getComputedStyle(pre).color : null,
            copyBtnVisible: copyBtn ? (copyBtn.offsetWidth > 0) : null,
            copyBtnColor: copyBtn ? getComputedStyle(copyBtn).color : null,
        };
    });
    if (toolCallDark) {
        console.log(`  Tool call (dark): summary-color=${toolCallDark.summaryColor}, pre-bg=${toolCallDark.preBg}, pre-color=${toolCallDark.preColor}`);
        console.log(`    Copy btn: visible=${toolCallDark.copyBtnVisible}, color=${toolCallDark.copyBtnColor}`);
    }

    // Table in dark mode
    const tableBtnDark = await page.$('.burnish-view-btn[data-view="table"]');
    if (tableBtnDark) {
        await tableBtnDark.click();
        await sleep(500);
        await page.screenshot({ path: `${SCREENSHOTS}-08-table-dark.png`, fullPage: true });
        console.log('  Saved: 08-table-dark.png');
        await checkForWhiteBackgrounds(page, 'dark-table');
    }

    // JSON in dark mode
    const jsonBtnDark = await page.$('.burnish-view-btn[data-view="json"]');
    if (jsonBtnDark) {
        await jsonBtnDark.click();
        await sleep(500);
        await page.screenshot({ path: `${SCREENSHOTS}-09-json-dark.png`, fullPage: true });
        console.log('  Saved: 09-json-dark.png');
        await checkForWhiteBackgrounds(page, 'dark-json');

        const copyDark = await page.evaluate(() => {
            const btn = document.querySelector('.burnish-json-wrapper .burnish-copy-btn') ||
                        document.querySelector('.burnish-copy-btn');
            if (!btn) return null;
            const s = getComputedStyle(btn);
            return { visible: btn.offsetWidth > 0, color: s.color, bg: s.backgroundColor, border: s.border };
        });
        if (copyDark) {
            console.log(`  Copy btn (dark): visible=${copyDark.visible}, color=${copyDark.color}, bg=${copyDark.bg}`);
            if (!copyDark.visible) report('medium', 'dark-mode', 'Copy button not visible in dark mode JSON view');
        }
    }

    // ──────────────────────────────────────────
    // 4. Loading state audit
    // ──────────────────────────────────────────
    console.log('\n--- Phase 4: Loading state audit ---');

    // Check that spinner CSS rules exist
    const spinnerCssCheck = await page.evaluate(() => {
        const results = { ruleFound: false, keyframeFound: false, ruleText: '' };
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.selectorText?.includes('burnish-spinner')) {
                        results.ruleFound = true;
                        results.ruleText = rule.cssText.substring(0, 200);
                    }
                    if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === 'spin') {
                        results.keyframeFound = true;
                    }
                }
            } catch {}
        }
        return results;
    });
    console.log(`  Spinner CSS: rule=${spinnerCssCheck.ruleFound}, keyframe=${spinnerCssCheck.keyframeFound}`);
    if (spinnerCssCheck.ruleText) console.log(`    Rule: ${spinnerCssCheck.ruleText}`);
    if (!spinnerCssCheck.ruleFound) report('medium', 'loading', 'No .burnish-spinner CSS rule found');

    // Execute a tool and try to capture loading state
    // We'll inject a slow-responding mock then execute
    const loadingCapture = await page.evaluate(async () => {
        let spinnerSeen = false;
        let loadingTextSeen = false;

        const observer = new MutationObserver(() => {
            if (document.querySelector('.burnish-spinner')) spinnerSeen = true;
            if (document.querySelector('.burnish-loading')) loadingTextSeen = true;
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Execute a tool — the loading state appears briefly before result
        const { executeToolDirect } = await import('/deterministic-ui.js');
        await executeToolDirect('list_directory', { path: 'C:/Users/Home/projects/burnish' }, 'Loading Test');

        await new Promise(r => setTimeout(r, 100));
        observer.disconnect();
        return { spinnerSeen, loadingTextSeen };
    });
    console.log(`  Loading state: spinner=${loadingCapture.spinnerSeen}, loadingText=${loadingCapture.loadingTextSeen}`);
    if (!loadingCapture.spinnerSeen && !loadingCapture.loadingTextSeen) {
        report('low', 'loading', 'Loading spinner/text not observed (execution may be too fast to catch)');
    }

    // ──────────────────────────────────────────
    // 5. Error state audit
    // ──────────────────────────────────────────
    console.log('\n--- Phase 5: Error state audit ---');

    // Light mode error
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await sleep(200);

    // Execute bad tool via the app's own function
    await page.evaluate(async () => {
        const { executeToolDirect } = await import('/deterministic-ui.js');
        await executeToolDirect('nonexistent_tool_xyz', {}, 'Error Test');
    });
    await sleep(2000);
    await page.screenshot({ path: `${SCREENSHOTS}-10-error-light.png`, fullPage: true });
    console.log('  Saved: 10-error-light.png');

    // Check error rendering
    const errorLightCheck = await page.evaluate(() => {
        // Look for error-status cards
        const errorCards = document.querySelectorAll('burnish-card[status="error"]');
        // Look for any error indication in the last node
        const nodes = document.querySelectorAll('.burnish-node');
        const lastNode = nodes[nodes.length - 1];
        const lastContent = lastNode?.querySelector('.burnish-node-content')?.textContent || '';
        const hasErrorText = lastContent.toLowerCase().includes('error') || lastContent.toLowerCase().includes('failed') || lastContent.toLowerCase().includes('not found');

        let errorCardStyle = null;
        if (errorCards.length > 0) {
            const card = errorCards[errorCards.length - 1];
            const shadow = card.shadowRoot;
            if (shadow) {
                const inner = shadow.querySelector('.card');
                if (inner) {
                    const s = getComputedStyle(inner);
                    errorCardStyle = { bg: s.backgroundColor, color: s.color, borderLeft: s.borderLeftColor, borderLeftWidth: s.borderLeftWidth };
                }
            }
        }

        return {
            errorCardCount: errorCards.length,
            hasErrorText,
            errorCardStyle,
            lastNodeContent: lastContent.substring(0, 200),
        };
    });
    console.log(`  Error (light): cards=${errorLightCheck.errorCardCount}, hasErrorText=${errorLightCheck.hasErrorText}`);
    if (errorLightCheck.errorCardStyle) {
        console.log(`    Card style: bg=${errorLightCheck.errorCardStyle.bg}, color=${errorLightCheck.errorCardStyle.color}, border-left=${errorLightCheck.errorCardStyle.borderLeftWidth} ${errorLightCheck.errorCardStyle.borderLeft}`);
    }
    if (!errorLightCheck.hasErrorText && errorLightCheck.errorCardCount === 0) {
        report('medium', 'error-state', 'No error indication found after bad tool execution');
    }

    // Dark mode error
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await sleep(300);
    await page.screenshot({ path: `${SCREENSHOTS}-11-error-dark.png`, fullPage: true });
    console.log('  Saved: 11-error-dark.png');
    await checkForWhiteBackgrounds(page, 'dark-error');

    const errorDarkCheck = await page.evaluate(() => {
        const errorCards = document.querySelectorAll('burnish-card[status="error"]');
        if (errorCards.length === 0) return null;
        const card = errorCards[errorCards.length - 1];
        const shadow = card.shadowRoot;
        if (!shadow) return null;
        const inner = shadow.querySelector('.card');
        if (!inner) return null;
        const s = getComputedStyle(inner);
        return { bg: s.backgroundColor, color: s.color, borderLeft: s.borderLeftColor };
    });
    if (errorDarkCheck) {
        console.log(`  Error card (dark): bg=${errorDarkCheck.bg}, color=${errorDarkCheck.color}`);
        const m = errorDarkCheck.bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            const [, r, g, b] = m.map(Number);
            if (r > 240 && g > 240 && b > 240) {
                report('high', 'error-dark', 'Error card has white background in dark mode');
            }
        }
    }

    // ──────────────────────────────────────────
    // 6. Additional checks
    // ──────────────────────────────────────────
    console.log('\n--- Phase 6: Additional checks ---');

    // Console errors (filter out expected 404s from bad tool test)
    const realErrors = consoleErrors.filter(e => !e.includes('nonexistent_tool'));
    if (realErrors.length > 0) {
        report('medium', 'console', `${realErrors.length} console error(s):\n      ${realErrors.slice(0, 5).join('\n      ')}`);
    } else {
        console.log(`  [ok] No unexpected console errors (${consoleErrors.length} total, all from error test)`);
    }

    // Responsive check at 768px
    await page.setViewportSize({ width: 768, height: 900 });
    await sleep(500);
    await page.screenshot({ path: `${SCREENSHOTS}-12-responsive-768.png`, fullPage: true });
    console.log('  Saved: 12-responsive-768.png');

    const overflowCheck = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 5
            ? `Horizontal overflow: scrollWidth=${document.documentElement.scrollWidth} > viewport=${window.innerWidth}`
            : null;
    });
    if (overflowCheck) {
        report('medium', 'responsive', overflowCheck);
    } else {
        console.log('  [ok] No horizontal overflow at 768px');
    }

    // Mobile check at 375px
    await page.setViewportSize({ width: 375, height: 667 });
    await sleep(500);
    await page.screenshot({ path: `${SCREENSHOTS}-13-responsive-375.png`, fullPage: true });
    console.log('  Saved: 13-responsive-375.png');

    const mobileOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 5
            ? `Horizontal overflow: scrollWidth=${document.documentElement.scrollWidth} > viewport=${window.innerWidth}`
            : null;
    });
    if (mobileOverflow) {
        report('medium', 'responsive-mobile', mobileOverflow);
    } else {
        console.log('  [ok] No horizontal overflow at 375px');
    }

    // ──────────────────────────────────────────
    // Summary
    // ──────────────────────────────────────────
    console.log('\n\n========================================');
    console.log('         AUDIT SUMMARY');
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
    console.log(`Screenshots: ${SCREENSHOTS}-*.png`);

    await browser.close();
    process.exit(issues.filter(i => i.severity === 'high').length > 0 ? 1 : 0);
})();
