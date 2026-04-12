/**
 * Opt-in anonymous telemetry for the burnish CLI.
 *
 * Design goals (see FINANCIAL-TARGETS.md §5 and issue #382):
 * - **Opt-in only.** First invocation shows a disclosure prompt. Choice is
 *   persisted in the user's config directory (never in CWD).
 * - **Trivially disabled.** `BURNISH_TELEMETRY=0` (or `false`/`off`/`no`)
 *   disables regardless of stored choice. The prompt is also skipped in
 *   non-interactive environments and in CI.
 * - **Anonymous + minimal.** The only fields ever sent are:
 *     - `v`: burnish CLI version (e.g. "0.1.1")
 *     - `os`: OS family — one of "darwin" | "linux" | "win32" | "other"
 *     - `node`: Node major version (e.g. "20")
 *     - `bucket`: coarse invocation count bucket — "1" | "2-5" | "6-20" | "21+"
 *     - `id`: anonymous random install ID (UUID v4) generated on first opt-in
 *   No hostnames. No usernames. No schemas. No server URLs. No per-tool data.
 * - **Fire-and-forget.** A single HTTPS POST with a short timeout. All errors
 *   are swallowed. Telemetry never blocks CLI startup.
 *
 * TODO(danfking): wire the real endpoint before v1.0 ships. The placeholder
 * below is not provisioned. Until it is, failed pings are silent no-ops.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

// Placeholder — not provisioned yet. See TODO at top of file.
const TELEMETRY_ENDPOINT = 'https://telemetry.burnish.dev/v1/ping';
const TELEMETRY_TIMEOUT_MS = 1500;

export type TelemetryDecision = 'enabled' | 'disabled';

interface TelemetryConfig {
    /** User's stored opt-in choice. */
    decision: TelemetryDecision;
    /** Anonymous random install ID, only set if decision === 'enabled'. */
    id?: string;
    /** Total invocations since opt-in (used only to compute the coarse bucket). */
    count: number;
    /** ISO timestamp the choice was made — purely local, never transmitted. */
    chosenAt: string;
}

/** Return the path to the burnish CLI config directory (XDG-ish). */
function configDir(): string {
    if (process.env.BURNISH_CONFIG_DIR) {
        return process.env.BURNISH_CONFIG_DIR;
    }
    const home = homedir();
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
        return join(appData, 'burnish');
    }
    const xdg = process.env.XDG_CONFIG_HOME || join(home, '.config');
    return join(xdg, 'burnish');
}

export function configFilePath(): string {
    return join(configDir(), 'telemetry.json');
}

function readConfig(): TelemetryConfig | null {
    try {
        const p = configFilePath();
        if (!existsSync(p)) return null;
        const raw = readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TelemetryConfig>;
        if (parsed.decision !== 'enabled' && parsed.decision !== 'disabled') {
            return null;
        }
        return {
            decision: parsed.decision,
            id: typeof parsed.id === 'string' ? parsed.id : undefined,
            count: typeof parsed.count === 'number' ? parsed.count : 0,
            chosenAt: typeof parsed.chosenAt === 'string' ? parsed.chosenAt : new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

function writeConfig(cfg: TelemetryConfig): void {
    try {
        const p = configFilePath();
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch {
        // Never fail the CLI because of telemetry bookkeeping.
    }
}

/** Is telemetry forcibly disabled via env var? */
export function envDisabled(): boolean {
    const v = process.env.BURNISH_TELEMETRY;
    if (v === undefined) return false;
    const lower = v.trim().toLowerCase();
    return lower === '0' || lower === 'false' || lower === 'off' || lower === 'no';
}

function isCi(): boolean {
    // Common CI env flags. Be conservative: never prompt in CI.
    return Boolean(
        process.env.CI ||
        process.env.GITHUB_ACTIONS ||
        process.env.GITLAB_CI ||
        process.env.CIRCLECI ||
        process.env.BUILDKITE ||
        process.env.TRAVIS
    );
}

function isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function osFamily(): 'darwin' | 'linux' | 'win32' | 'other' {
    const p = platform();
    if (p === 'darwin' || p === 'linux' || p === 'win32') return p;
    return 'other';
}

function countBucket(count: number): '1' | '2-5' | '6-20' | '21+' {
    if (count <= 1) return '1';
    if (count <= 5) return '2-5';
    if (count <= 20) return '6-20';
    return '21+';
}

/**
 * Show the first-run disclosure and return the user's choice.
 * Default on empty/unknown answer is 'disabled' (opt-in, not opt-out).
 */
async function promptForConsent(): Promise<TelemetryDecision> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        process.stdout.write(
            '\n' +
            'burnish: help improve the project with anonymous telemetry?\n' +
            '\n' +
            '  We send a single ping per invocation containing:\n' +
            '    - burnish version\n' +
            '    - OS family (darwin / linux / win32)\n' +
            '    - Node major version\n' +
            '    - a coarse invocation-count bucket (1, 2-5, 6-20, 21+)\n' +
            '    - a random install ID generated on first opt-in\n' +
            '\n' +
            '  We never send: server URLs, tool names, schemas, file paths,\n' +
            '  hostnames, usernames, or any content from your MCP servers.\n' +
            '\n' +
            '  You can change your mind anytime by editing or deleting:\n' +
            `    ${configFilePath()}\n` +
            '  or by setting BURNISH_TELEMETRY=0 in your environment.\n' +
            '\n'
        );
        const answer = (await rl.question('Enable anonymous telemetry? [y/N]: ')).trim().toLowerCase();
        return answer === 'y' || answer === 'yes' ? 'enabled' : 'disabled';
    } catch {
        return 'disabled';
    } finally {
        rl.close();
    }
}

/** The exact JSON shape sent to the telemetry endpoint. */
export interface TelemetryPayload {
    v: string;
    os: 'darwin' | 'linux' | 'win32' | 'other';
    node: string;
    bucket: '1' | '2-5' | '6-20' | '21+';
    id: string;
}

export function buildPayload(version: string, id: string, count: number): TelemetryPayload {
    return {
        v: version,
        os: osFamily(),
        node: String(process.versions.node.split('.')[0] || 'unknown'),
        bucket: countBucket(count),
        id,
    };
}

/** Fire-and-forget ping. Never throws, never blocks beyond the short timeout. */
async function sendPing(payload: TelemetryPayload): Promise<void> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
        try {
            await fetch(TELEMETRY_ENDPOINT, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    } catch {
        // Silent: endpoint may not be provisioned, offline, etc.
    }
}

/**
 * Run telemetry for this invocation.
 *
 * - Honors `BURNISH_TELEMETRY=0`.
 * - Prompts once on first interactive run, then persists the choice.
 * - If enabled, bumps the local invocation counter and fires a single
 *   non-blocking ping.
 *
 * Safe to call unconditionally from CLI startup. All errors are swallowed.
 */
export async function runTelemetry(version: string): Promise<void> {
    try {
        if (envDisabled()) return;

        let cfg = readConfig();

        if (!cfg) {
            // No stored choice yet. Only prompt in interactive, non-CI sessions.
            if (!isInteractive() || isCi()) return;
            const decision = await promptForConsent();
            cfg = {
                decision,
                id: decision === 'enabled' ? randomUUID() : undefined,
                count: 0,
                chosenAt: new Date().toISOString(),
            };
            writeConfig(cfg);
        }

        if (cfg.decision !== 'enabled' || !cfg.id) return;

        cfg.count += 1;
        writeConfig(cfg);

        // Fire-and-forget. We do NOT await the ping against CLI startup.
        void sendPing(buildPayload(version, cfg.id, cfg.count));
    } catch {
        // Never let telemetry break the CLI.
    }
}
