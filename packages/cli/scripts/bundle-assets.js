import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');
const assets = resolve(__dirname, '../assets');

// Create assets directory structure
mkdirSync(resolve(assets, 'components'), { recursive: true });
mkdirSync(resolve(assets, 'app'), { recursive: true });
mkdirSync(resolve(assets, 'renderer'), { recursive: true });

// Copy all top-level files from apps/demo/public/ to assets/.
//
// Previously this was a hand-maintained allowlist, which drifted from reality
// whenever a new .js file was added: 0.2.1 shipped without template-learning.js,
// perf-panel.js, and ambient-suggestions.js, so the landing page 404'd those
// imports and the MCP server buttons failed to render. Glob-copy everything
// top-level (by extension allowlist, not filename allowlist) so adding a new
// asset to the demo app just works, and remove this class of bug permanently.
//
// Subdirectories under public/ are intentionally NOT recursed — compiled
// packages (components/, app/, renderer/) are copied separately below.
// index.html is also handled explicitly at the bottom of this script.
const publicDir = resolve(root, 'apps/demo/public');
const PUBLIC_EXT_ALLOWLIST = new Set([
    '.js', '.mjs', '.css', '.html', '.json', '.svg',
    '.png', '.ico', '.webmanifest',
]);
for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === 'index.html') continue; // written explicitly at bottom
    const ext = extname(entry.name).toLowerCase();
    if (!PUBLIC_EXT_ALLOWLIST.has(ext)) continue;
    cpSync(resolve(publicDir, entry.name), resolve(assets, entry.name));
}

/**
 * Copy only .js and .css files from a dist directory (skip .d.ts, .map files).
 */
function copyDistFiles(srcDir, destDir) {
    if (!existsSync(srcDir)) {
        console.warn(`[burnish] Warning: ${srcDir} not found — run pnpm build first`);
        return;
    }
    cpSync(srcDir, destDir, { recursive: true });
    // Remove .d.ts, .d.ts.map, .js.map files to reduce package size
    cleanDir(destDir);
}

function cleanDir(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            cleanDir(fullPath);
        } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map') || entry.name.endsWith('.js.map')) {
            unlinkSync(fullPath);
        }
    }
}

// Copy compiled packages (JS only, no type declarations or source maps)
copyDistFiles(resolve(root, 'packages/components/dist'), resolve(assets, 'components'));
copyDistFiles(resolve(root, 'packages/app/dist'), resolve(assets, 'app'));
copyDistFiles(resolve(root, 'packages/renderer/dist'), resolve(assets, 'renderer'));

// Copy component tokens.css
const componentTokens = resolve(root, 'packages/components/src/tokens.css');
if (existsSync(componentTokens)) {
    cpSync(componentTokens, resolve(assets, 'components/tokens.css'));
}

// Favicons, logos, and manifests are now handled by the glob-copy above
// (the PUBLIC_EXT_ALLOWLIST includes .ico, .png, .svg, .webmanifest).

// Copy index.html from demo
// The import map already uses /app/, /renderer/, /components/ paths which match our layout
const demoHtml = readFileSync(resolve(publicDir, 'index.html'), 'utf-8');
writeFileSync(resolve(assets, 'index.html'), demoHtml);

console.log('[burnish] Assets bundled to packages/cli/assets/');
