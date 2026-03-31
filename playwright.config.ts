import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 120_000,
    use: {
        baseURL: 'http://localhost:3000',
    },
    // Don't auto-start — expect server already running
    webServer: undefined,
});
