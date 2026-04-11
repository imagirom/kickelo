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
      command: 'npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
