import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testIgnore: process.env.CI ? ['**/visual/**'] : [],
    timeout: 120_000,
    use: {
        baseURL: 'http://localhost:3000',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: process.env.CI ? {
        command: 'npx tsx apps/demo/server/index.ts',
        url: 'http://localhost:3000',
        reuseExistingServer: false,
        timeout: 30_000,
        env: {
            LLM_BACKEND: 'none',
        },
    } : undefined,
});
