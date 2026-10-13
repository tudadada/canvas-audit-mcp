import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: [['list']],
  timeout: 60000,
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:4178/blurry-animated.html',
    reuseExistingServer: true,
    cwd: new URL('.', import.meta.url).pathname,
  },
  use: {
    baseURL: 'http://127.0.0.1:4178',
  },
  projects: [
    {
      name: 'desktop-retina',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 15 Pro'], browserName: 'chromium' },
    },
  ],
});
