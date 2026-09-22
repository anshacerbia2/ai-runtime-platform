import { defineConfig } from '@playwright/test';
import { loadEnvironment } from './config/environment.mjs';

const config = loadEnvironment();
const baseURL = `http://${config.webHost}:${config.webPort}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  expect: { timeout: config.playwright.timeoutMs },
  timeout: config.playwright.timeoutMs,
  use: {
    baseURL,
    browserName: config.playwright.browserName as
      'chromium' | 'firefox' | 'webkit',
    channel:
      config.playwright.channel === 'none'
        ? undefined
        : config.playwright.channel,
    viewport: {
      width: config.playwright.viewportWidth,
      height: config.playwright.viewportHeight,
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: config.playwright.reuseExistingServer,
    timeout: config.playwright.webServerTimeoutMs,
  },
});
