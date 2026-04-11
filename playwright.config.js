import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'off',
  },
  webServer: [
    {
      command: 'npx firebase emulators:start --only firestore --import=./firebase_emulator_cache',
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
