import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testIgnore: ['**/visual/**'],
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
        command: 'pnpm --filter demo dev:nomodel',
        url: 'http://localhost:3000',
        reuseExistingServer: false,
        timeout: 30_000,
        env: {
            LLM_BACKEND: 'none',
        },
    } : undefined,
});
