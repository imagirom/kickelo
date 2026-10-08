import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'off',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        // Use Chromium (already installed) instead of WebKit
        browserName: 'chromium',
      },
    },
  ],
  webServer: [
    {
      command: 'npx firebase emulators:start --only firestore,auth --import=./firebase_emulator_cache',
      port: 7070,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      // The emulator opens firestore (7070) before auth (9099); this idle process just
      // makes Playwright also wait for the auth port, which the emulator above opens.
      command: 'node -e "setInterval(() => {}, 1 << 30)"',
      port: 9099,
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: 'npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
