import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPayload, configFilePath, envDisabled } from './telemetry.js';

describe('telemetry', () => {
    let tmp: string;
    const origEnv = { ...process.env };

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), 'burnish-telemetry-test-'));
        process.env.BURNISH_CONFIG_DIR = tmp;
        delete process.env.BURNISH_TELEMETRY;
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
        process.env = { ...origEnv };
    });

    describe('envDisabled', () => {
        it('returns false when unset', () => {
            delete process.env.BURNISH_TELEMETRY;
            expect(envDisabled()).toBe(false);
        });

        it('returns true for 0 / false / off / no', () => {
            for (const v of ['0', 'false', 'off', 'no', 'FALSE', 'Off']) {
                process.env.BURNISH_TELEMETRY = v;
                expect(envDisabled()).toBe(true);
            }
        });

        it('returns false for 1 / true', () => {
            process.env.BURNISH_TELEMETRY = '1';
            expect(envDisabled()).toBe(false);
            process.env.BURNISH_TELEMETRY = 'true';
            expect(envDisabled()).toBe(false);
        });
    });

    describe('configFilePath', () => {
        it('honors BURNISH_CONFIG_DIR override', () => {
            expect(configFilePath()).toBe(join(tmp, 'telemetry.json'));
        });
    });

    describe('buildPayload', () => {
        it('includes all required fields and nothing else', () => {
            const p = buildPayload('1.2.3', 'abc-id', 1);
            expect(Object.keys(p).sort()).toEqual(['bucket', 'id', 'node', 'os', 'v']);
            expect(p.v).toBe('1.2.3');
            expect(p.id).toBe('abc-id');
            expect(['darwin', 'linux', 'win32', 'other']).toContain(p.os);
            expect(p.node).toMatch(/^\d+$/);
        });

        it('buckets counts coarsely', () => {
            expect(buildPayload('0', 'x', 1).bucket).toBe('1');
            expect(buildPayload('0', 'x', 2).bucket).toBe('2-5');
            expect(buildPayload('0', 'x', 5).bucket).toBe('2-5');
            expect(buildPayload('0', 'x', 6).bucket).toBe('6-20');
            expect(buildPayload('0', 'x', 20).bucket).toBe('6-20');
            expect(buildPayload('0', 'x', 21).bucket).toBe('21+');
            expect(buildPayload('0', 'x', 9999).bucket).toBe('21+');
        });

        it('never includes hostname, username, schema, or path fields', () => {
            const p = buildPayload('1.0.0', 'id', 3) as unknown as Record<string, unknown>;
            for (const forbidden of ['host', 'hostname', 'user', 'username', 'cwd', 'path', 'schema', 'tools']) {
                expect(p[forbidden]).toBeUndefined();
            }
        });
    });
});
