/**
 * Burnish UI Quality Audit
 * Comprehensive responsive, component, and visual consistency checks.
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const SCREENSHOT_DIR = process.platform === 'win32' ? 'C:/tmp' : '/tmp';
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE = 'http://localhost:3000';
const BREAKPOINTS = [
  { name: 'mobile', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 800 },
  { name: 'desktop', width: 1280, height: 800 },
];

const issues = [];
function report(severity, area, msg) {
  issues.push({ severity, area, msg });
  const icon = severity === 'CRITICAL' ? '[!!!]' : severity === 'HIGH' ? '[!!]' : severity === 'MEDIUM' ? '[!]' : '[~]';
  console.log(`  ${icon} ${severity} | ${area} | ${msg}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ========================================
  // 1. RESPONSIVE AUDIT AT 3 BREAKPOINTS
  // ========================================
  console.log('\n=== 1. RESPONSIVE AUDIT ===\n');

  for (const bp of BREAKPOINTS) {
    console.log(`--- ${bp.name} (${bp.width}x${bp.height}) ---`);
    const context = await browser.newContext({ viewport: { width: bp.width, height: bp.height } });
    const page = await context.newPage();

    // Navigate to landing page
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/burnish-audit-${bp.name}-landing.png`, fullPage: false });

    // --- Check sidebar visibility ---
    const sessionPanel = await page.$('.burnish-session-panel');
    if (sessionPanel) {
      const panelBox = await sessionPanel.boundingBox();
      if (bp.width <= 1024) {
        // Mobile/tablet: sidebar should be hidden (off-screen left)
        if (panelBox && panelBox.x >= 0) {
          report('HIGH', `Sidebar/${bp.name}`, `Sidebar is visible at ${bp.width}px — should be hidden (off-screen). x=${panelBox.x}`);
        }
      } else {
        // Desktop: sidebar should be visible
        if (!panelBox || panelBox.x < 0) {
          report('HIGH', `Sidebar/${bp.name}`, `Sidebar is NOT visible at ${bp.width}px — should be visible.`);
        }
      }
    }

    // --- Check for horizontal overflow (scrollbar) ---
    const hasHScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (hasHScroll) {
      report('CRITICAL', `Overflow/${bp.name}`, `Horizontal scrollbar detected at ${bp.width}px!`);
    }

    // --- Click a server button if available ---
    const serverBtns = await page.$$('.burnish-suggestion-server');
    if (serverBtns.length > 0) {
      console.log(`  Found ${serverBtns.length} server button(s), clicking first...`);
      await serverBtns[0].click();
      await sleep(2000); // Wait for tools to load

      await page.screenshot({ path: `${SCREENSHOT_DIR}/burnish-audit-${bp.name}-tools.png`, fullPage: false });

      // --- Check card grid layout ---
      const cards = await page.$$('burnish-card');
      if (cards.length > 1) {
        const firstBox = await cards[0].boundingBox();
        const secondBox = await cards[1].boundingBox();
        if (firstBox && secondBox) {
          const sameRow = Math.abs(firstBox.y - secondBox.y) < 20;
          if (bp.width <= 500 && sameRow) {
            report('HIGH', `Grid/${bp.name}`, `Cards are side-by-side at ${bp.width}px — should be single column.`);
          }
          if (bp.width >= 1024 && !sameRow && cards.length >= 3) {
            report('MEDIUM', `Grid/${bp.name}`, `Cards are stacking at ${bp.width}px — expected multi-column grid.`);
          }
        }
      }

      // --- Check filter input width ---
      const filterInput = await page.$('.burnish-tool-filter');
      if (filterInput) {
        const filterBox = await filterInput.boundingBox();
        const contentArea = await page.$('.burnish-content');
        const contentBox = contentArea ? await contentArea.boundingBox() : null;
        if (filterBox && contentBox) {
          const widthRatio = filterBox.width / contentBox.width;
          if (widthRatio < 0.85) {
            report('MEDIUM', `Filter/${bp.name}`, `Filter input is only ${Math.round(widthRatio * 100)}% of content width — should stretch to ~100%.`);
          }
        }
      } else {
        // Filter might not appear if no tools loaded
        console.log(`  (No filter input found at ${bp.name})`);
      }

      // --- Check stat-bar wrapping ---
      const statBar = await page.$('burnish-stat-bar');
      if (statBar) {
        const statBarBox = await statBar.boundingBox();
        if (statBarBox) {
          // At narrow widths, check that stat-bar doesn't overflow its container
          const overflow = await page.evaluate(el => {
            const shadowRoot = el.shadowRoot;
            if (!shadowRoot) return false;
            const bar = shadowRoot.querySelector('.stat-bar');
            if (!bar) return false;
            return bar.scrollWidth > bar.clientWidth + 5;
          }, statBar);
          if (overflow) {
            report('HIGH', `StatBar/${bp.name}`, `Stat-bar content overflows at ${bp.width}px — flex-wrap may not be working.`);
          }
        }
      }
    } else {
      console.log('  No server buttons found on landing page.');
    }

    // --- Header audit ---
    const header = await page.$('.burnish-header');
    if (header) {
      const headerBox = await header.boundingBox();
      if (headerBox) {
        // Check header fits viewport
        if (headerBox.width > bp.width + 2) {
          report('HIGH', `Header/${bp.name}`, `Header wider than viewport: ${headerBox.width}px > ${bp.width}px`);
        }
      }

      // Check theme toggle visibility
      const themeToggle = await page.$('#theme-toggle');
      if (themeToggle) {
        const toggleBox = await themeToggle.boundingBox();
        if (!toggleBox || toggleBox.x + toggleBox.width > bp.width) {
          report('HIGH', `Header/${bp.name}`, `Theme toggle overflows viewport at ${bp.width}px`);
        }
      }

      // Check mode toggle visibility
      const modeToggle = await page.$('#mode-toggle');
      if (modeToggle) {
        const modeBox = await modeToggle.boundingBox();
        // Only report if it has actual content (non-zero size) and overflows
        if (modeBox && modeBox.width > 0 && modeBox.x + modeBox.width > bp.width) {
          report('HIGH', `Header/${bp.name}`, `Mode toggle overflows viewport at ${bp.width}px`);
        }
      }

      // Check breadcrumb readability
      const breadcrumb = await page.$('.burnish-breadcrumb');
      if (breadcrumb) {
        const bcBox = await breadcrumb.boundingBox();
        if (bcBox && bcBox.width < 30) {
          report('MEDIUM', `Header/${bp.name}`, `Breadcrumb area very narrow (${Math.round(bcBox.width)}px) — may be unreadable.`);
        }
      }
    }

    // Check mobile hamburger button visibility
    const mobileBtn = await page.$('.burnish-mobile-only');
    if (mobileBtn) {
      const mobileBtnBox = await mobileBtn.boundingBox();
      if (bp.width <= 1024) {
        if (!mobileBtnBox || mobileBtnBox.width === 0) {
          report('HIGH', `Header/${bp.name}`, `Mobile hamburger button not visible at ${bp.width}px`);
        }
      } else {
        if (mobileBtnBox && mobileBtnBox.width > 0) {
          report('LOW', `Header/${bp.name}`, `Mobile hamburger button visible at desktop width ${bp.width}px`);
        }
      }
    }

    await context.close();
  }

  // ========================================
  // 2. COMPONENT CONSISTENCY AUDIT
  // ========================================
  console.log('\n=== 2. COMPONENT CONSISTENCY AUDIT ===\n');

  for (const theme of ['light', 'dark']) {
    console.log(`--- ${theme} mode ---`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(300);

    // Set theme
    if (theme === 'dark') {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('burnish:theme', 'dark');
      });
      await sleep(200);
    } else {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('burnish:theme', 'light');
      });
      await sleep(200);
    }

    // Inject test components
    await page.evaluate(() => {
      const container = document.getElementById('dashboard-container');
      if (!container) return;
      container.innerHTML = `
        <burnish-stat-bar items='[{"label":"Files","value":"42","color":"success"},{"label":"Errors","value":"3","color":"error"},{"label":"Pending","value":"7","color":"warning"},{"label":"Info","value":"12","color":"info"}]'></burnish-stat-bar>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:16px;">
          <burnish-card title="Test Card" status="success" body="This is a test card with a longer body text to check wrapping behavior and readability across themes." meta='[{"label":"Size","value":"1.2 KB"},{"label":"Type","value":"file"}]'></burnish-card>
          <burnish-card title="Warning Card" status="warning" body="Warning state card" meta='[{"label":"Status","value":"pending"}]'></burnish-card>
          <burnish-card title="Error Card" status="error" body="Error state card" meta='[{"label":"Errors","value":"3"}]'></burnish-card>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:16px;">
          <burnish-metric label="Response Time" value="243" unit="ms" trend="down"></burnish-metric>
          <burnish-metric label="Total Files" value="1,847" trend="up"></burnish-metric>
        </div>
      `;
    });
    await sleep(800); // Wait for Lit components to render

    await page.screenshot({ path: `${SCREENSHOT_DIR}/burnish-audit-components-${theme}.png`, fullPage: false });

    // --- Check status color consistency ---
    // Get stat-bar success dot color
    const statBarSuccessColor = await page.evaluate(() => {
      const statBar = document.querySelector('burnish-stat-bar');
      if (!statBar || !statBar.shadowRoot) return null;
      const dots = statBar.shadowRoot.querySelectorAll('.stat-dot');
      for (const dot of dots) {
        if (dot.nextElementSibling && dot.nextElementSibling.textContent.trim() === '42') {
          return getComputedStyle(dot).backgroundColor;
        }
      }
      return null;
    });

    // Get success card top border color
    const cardSuccessBorderColor = await page.evaluate(() => {
      const card = document.querySelector('burnish-card[status="success"]');
      if (!card || !card.shadowRoot) return null;
      const cardEl = card.shadowRoot.querySelector('.card');
      if (!cardEl) return null;
      const before = getComputedStyle(cardEl, '::before');
      return before.backgroundColor || before.background;
    });

    // Get success card badge color
    const cardSuccessBadgeColor = await page.evaluate(() => {
      const card = document.querySelector('burnish-card[status="success"]');
      if (!card || !card.shadowRoot) return null;
      const badge = card.shadowRoot.querySelector('.card-badge');
      return badge ? getComputedStyle(badge).color : null;
    });

    console.log(`  Stat-bar success dot: ${statBarSuccessColor}`);
    console.log(`  Card success border: ${cardSuccessBorderColor}`);
    console.log(`  Card success badge text: ${cardSuccessBadgeColor}`);

    // --- Check metrics alignment ---
    const metricBoxes = await page.evaluate(() => {
      const metrics = document.querySelectorAll('burnish-metric');
      return Array.from(metrics).map(m => {
        const box = m.getBoundingClientRect();
        return { top: box.top, height: box.height, left: box.left };
      });
    });
    if (metricBoxes.length >= 2) {
      const topDiff = Math.abs(metricBoxes[0].top - metricBoxes[1].top);
      const heightDiff = Math.abs(metricBoxes[0].height - metricBoxes[1].height);
      if (topDiff > 5) {
        report('MEDIUM', `Metrics/${theme}`, `Metrics are not vertically aligned — top diff: ${topDiff}px`);
      }
      if (heightDiff > 5) {
        report('MEDIUM', `Metrics/${theme}`, `Metrics have different heights: ${metricBoxes[0].height} vs ${metricBoxes[1].height}`);
      }
    }

    // --- Check dark mode component rendering ---
    if (theme === 'dark') {
      // Check card background color in dark mode is actually dark
      const cardBg = await page.evaluate(() => {
        const card = document.querySelector('burnish-card');
        if (!card || !card.shadowRoot) return null;
        const el = card.shadowRoot.querySelector('.card');
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      console.log(`  Card background in dark: ${cardBg}`);
      if (cardBg) {
        // Parse rgb and check it's dark
        const match = cardBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
          if (brightness > 180) {
            report('HIGH', 'DarkMode/Card', `Card background too bright in dark mode: ${cardBg} (avg brightness ${Math.round(brightness)})`);
          }
        }
      }

      // Check stat-bar chip background in dark mode
      const chipBg = await page.evaluate(() => {
        const sb = document.querySelector('burnish-stat-bar');
        if (!sb || !sb.shadowRoot) return null;
        const chip = sb.shadowRoot.querySelector('.stat-chip');
        return chip ? getComputedStyle(chip).backgroundColor : null;
      });
      console.log(`  Stat chip background in dark: ${chipBg}`);
      if (chipBg) {
        const match = chipBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
          if (brightness > 180) {
            report('HIGH', 'DarkMode/StatBar', `Stat chip too bright in dark mode: ${chipBg}`);
          }
        }
      }

      // Check metric background in dark mode
      const metricBg = await page.evaluate(() => {
        const m = document.querySelector('burnish-metric');
        if (!m || !m.shadowRoot) return null;
        const el = m.shadowRoot.querySelector('.metric');
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      console.log(`  Metric background in dark: ${metricBg}`);
      if (metricBg) {
        const match = metricBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
          if (brightness > 180) {
            report('HIGH', 'DarkMode/Metric', `Metric background too bright in dark mode: ${metricBg}`);
          }
        }
      }

      // Check text color readability in dark mode
      const textColor = await page.evaluate(() => {
        const card = document.querySelector('burnish-card');
        if (!card || !card.shadowRoot) return null;
        const title = card.shadowRoot.querySelector('.card-title');
        return title ? getComputedStyle(title).color : null;
      });
      console.log(`  Card title color in dark: ${textColor}`);
      if (textColor && cardBg) {
        // Simple contrast check
        const parseBg = cardBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        const parseFg = textColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (parseBg && parseFg) {
          const bgL = (parseInt(parseBg[1]) * 0.299 + parseInt(parseBg[2]) * 0.587 + parseInt(parseBg[3]) * 0.114);
          const fgL = (parseInt(parseFg[1]) * 0.299 + parseInt(parseFg[2]) * 0.587 + parseInt(parseFg[3]) * 0.114);
          const contrast = Math.abs(bgL - fgL);
          if (contrast < 50) {
            report('CRITICAL', 'DarkMode/Contrast', `Low contrast between card title and background: ${contrast} (bg=${cardBg}, fg=${textColor})`);
          }
        }
      }
    }

    await context.close();
  }

  // ========================================
  // 3. SIDEBAR AUDIT
  // ========================================
  console.log('\n=== 3. SIDEBAR AUDIT ===\n');

  for (const theme of ['light', 'dark']) {
    console.log(`--- Sidebar in ${theme} mode ---`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(300);

    if (theme === 'dark') {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      await sleep(200);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/burnish-audit-sidebar-${theme}.png`, fullPage: false });

    // Check session panel background vs header
    const sidebarBg = await page.evaluate(() => {
      const panel = document.querySelector('.burnish-session-panel');
      return panel ? getComputedStyle(panel).backgroundColor : null;
    });
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log(`  Sidebar bg: ${sidebarBg}, Body bg: ${bodyBg}`);

    // Check session search input styling similarity to tool filter
    const sessionSearchStyles = await page.evaluate(() => {
      const el = document.querySelector('.burnish-session-search');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, borderRadius: s.borderRadius, padding: s.padding, borderColor: s.borderColor };
    });
    console.log(`  Session search styles: ${JSON.stringify(sessionSearchStyles)}`);

    // Check session list readability (text color)
    const sessionTextColor = await page.evaluate(() => {
      const el = document.querySelector('.burnish-session-panel-title');
      return el ? getComputedStyle(el).color : null;
    });
    console.log(`  Session panel title color: ${sessionTextColor}`);

    if (theme === 'dark' && sidebarBg) {
      const match = sidebarBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
        if (brightness > 180) {
          report('HIGH', 'DarkMode/Sidebar', `Sidebar background too bright in dark mode: ${sidebarBg}`);
        }
      }
    }

    await context.close();
  }

  // ========================================
  // 4. SCROLLING BEHAVIOR AUDIT
  // ========================================
  console.log('\n=== 4. SCROLLING BEHAVIOR AUDIT ===\n');

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(300);

    // Click a server button to load tools
    const serverBtns = await page.$$('.burnish-suggestion-server');
    if (serverBtns.length > 0) {
      await serverBtns[0].click();
      await sleep(2000);

      // Check if filter bar is sticky
      const filterContainer = await page.$('.burnish-tool-filter-container');
      if (filterContainer) {
        const position = await page.evaluate(el => getComputedStyle(el).position, filterContainer);
        const zIndex = await page.evaluate(el => getComputedStyle(el).zIndex, filterContainer);
        console.log(`  Filter container position: ${position}, z-index: ${zIndex}`);
        if (position !== 'sticky') {
          report('MEDIUM', 'Scroll/Filter', `Filter container is not sticky (position: ${position})`);
        }
      }

      // Scroll down and check filter stays visible
      const contentArea = await page.$('.burnish-content');
      if (contentArea) {
        await page.evaluate(el => el.scrollTop = 500, contentArea);
        await sleep(300);

        await page.screenshot({ path: `${SCREENSHOT_DIR}/burnish-audit-scrolled.png`, fullPage: false });

        // Check if filter bar is still visible after scrolling
        if (filterContainer) {
          const filterBox = await filterContainer.boundingBox();
          if (filterBox) {
            console.log(`  Filter bar position after scroll: top=${Math.round(filterBox.y)}`);
            // The filter should be near the top of the content area (sticky)
            if (filterBox.y < 0) {
              report('HIGH', 'Scroll/Filter', 'Filter bar scrolled out of view — sticky not working');
            }
          }
        }

        // Check for z-index issues - any node header overlapping the filter
        const nodeHeaders = await page.$$('.burnish-node-header');
        if (nodeHeaders.length > 0 && filterContainer) {
          const filterBox = await filterContainer.boundingBox();
          for (let i = 0; i < Math.min(nodeHeaders.length, 3); i++) {
            const headerBox = await nodeHeaders[i].boundingBox();
            if (filterBox && headerBox) {
              // Check if a header overlaps the filter bar area
              const overlaps = headerBox.y < filterBox.y + filterBox.height && headerBox.y + headerBox.height > filterBox.y;
              if (overlaps) {
                const filterZ = await page.evaluate(el => {
                  return parseInt(getComputedStyle(el).zIndex) || 0;
                }, filterContainer);
                const headerZ = await page.evaluate(el => {
                  return parseInt(getComputedStyle(el).zIndex) || 0;
                }, nodeHeaders[i]);
                if (headerZ >= filterZ) {
                  report('HIGH', 'Scroll/ZIndex', `Node header (z-index:${headerZ}) may overlap filter bar (z-index:${filterZ})`);
                }
              }
            }
          }
        }
      }
    } else {
      console.log('  No server buttons available for scroll test.');
    }

    await context.close();
  }

  // ========================================
  // 5. MOBILE SIDEBAR TOGGLE TEST
  // ========================================
  console.log('\n=== 5. MOBILE SIDEBAR TOGGLE ===\n');

  {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(300);

    // Try toggling the sidebar
    const hamburger = await page.$('#btn-toggle-sessions');
    if (hamburger) {
      const isVisible = await page.evaluate(el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
      }, hamburger);
      console.log(`  Hamburger button visible: ${isVisible}`);

      if (isVisible) {
        await hamburger.click();
        await sleep(400);

        const panel = await page.$('.burnish-session-panel');
        if (panel) {
          const hasOpenClass = await page.evaluate(el => el.classList.contains('open'), panel);
          const panelBox = await panel.boundingBox();
          console.log(`  After toggle: open class=${hasOpenClass}, x=${panelBox?.x}`);
          await page.screenshot({ path: `${SCREENSHOT_DIR}/burnish-audit-mobile-sidebar-open.png`, fullPage: false });

          if (!hasOpenClass && (!panelBox || panelBox.x < 0)) {
            report('HIGH', 'Mobile/Sidebar', 'Hamburger click did not open sidebar');
          }
        }
      }
    } else {
      report('HIGH', 'Mobile/Sidebar', 'No hamburger button found at mobile width');
    }

    await context.close();
  }

  // ========================================
  // FINAL REPORT
  // ========================================
  console.log('\n========================================');
  console.log('         AUDIT SUMMARY');
  console.log('========================================\n');

  const critical = issues.filter(i => i.severity === 'CRITICAL');
  const high = issues.filter(i => i.severity === 'HIGH');
  const medium = issues.filter(i => i.severity === 'MEDIUM');
  const low = issues.filter(i => i.severity === 'LOW');

  console.log(`Total issues: ${issues.length}`);
  console.log(`  CRITICAL: ${critical.length}`);
  console.log(`  HIGH:     ${high.length}`);
  console.log(`  MEDIUM:   ${medium.length}`);
  console.log(`  LOW:      ${low.length}`);

  if (issues.length > 0) {
    console.log('\nAll issues:');
    for (const issue of issues) {
      console.log(`  [${issue.severity}] ${issue.area}: ${issue.msg}`);
    }
  } else {
    console.log('\nNo visual issues detected!');
  }

  console.log(`\nScreenshots saved to ${SCREENSHOT_DIR}/burnish-audit-*.png`);

  await browser.close();
})();
