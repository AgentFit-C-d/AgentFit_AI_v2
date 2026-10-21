import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', timeout: 45000, workers: 1, globalSetup: './tests/e2e/setup.ts', use: { baseURL: 'http://localhost:3011', headless: true, trace: 'off', video: 'off', screenshot: 'only-on-failure' }, reporter: 'line' });
