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

// Copy demo public files
const publicDir = resolve(root, 'apps/demo/public');
const filesToCopy = [
    'app.js', 'shared.js', 'view-renderers.js', 'contextual-actions.js',
    'deterministic-ui.js', 'llm-insight-ui.js', 'style.css', 'tokens.css',
];
for (const f of filesToCopy) {
    const src = resolve(publicDir, f);
    if (existsSync(src)) {
        cpSync(src, resolve(assets, f));
    } else {
        console.warn(`[burnish] Warning: ${f} not found in demo public/`);
    }
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

// Copy index.html from demo
// The import map already uses /app/, /renderer/, /components/ paths which match our layout
const demoHtml = readFileSync(resolve(publicDir, 'index.html'), 'utf-8');
writeFileSync(resolve(assets, 'index.html'), demoHtml);

console.log('[burnish] Assets bundled to packages/cli/assets/');
