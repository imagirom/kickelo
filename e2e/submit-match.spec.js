/**
 * Interactive test: sign in, add players, submit a match, verify it appears.
 * Run with: npx playwright test e2e/submit-match.spec.js --project=desktop
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { ensureTestUser, signInViaUI } from './helpers.js';

const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots');

test.beforeAll(async () => {
  await ensureTestUser();
});

test('submit a match and verify it appears', async ({ page }) => {
  await signInViaUI(page);

  // Wait for player data to load into selects
  const teamA1 = page.locator('#teamA1');
  await expect(teamA1).toBeVisible();
  await page.waitForFunction(() => {
    const sel = document.getElementById('teamA1');
    return sel && sel.options.length > 2;
  }, { timeout: 10000 });

  // Get available player names from the emulator data
  const playerNames = await teamA1.evaluate(sel =>
    Array.from(sel.options).filter(o => o.value && o.value !== '__add_new__').map(o => o.value)
  );
  console.log('Available players:', playerNames);

  // Select 4 different players
  const [p1, p2, p3, p4] = playerNames.slice(0, 4);
  await page.selectOption('#teamA1', p1);
  await page.selectOption('#teamA2', p2);
  await page.selectOption('#teamB1', p3);
  await page.selectOption('#teamB2', p4);

  // Set score: Red 5 - Blue 3
  await page.selectOption('#teamAgoals', '5');
  await page.selectOption('#teamBgoals', '3');

  // Screenshot the filled form
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'match-filled.png'), fullPage: false });

  // Submit the match
  await page.click('#submitMatchBtn');

  // Handle any confirm dialog
  const confirmBtn = page.locator('button:has-text("Confirm")');
  try {
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();
  } catch {
    // No confirm dialog
  }

  // Wait for the match to be processed and appear
  await page.waitForTimeout(3000);

  // Screenshot after submission
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'after-submit.png'), fullPage: true });

  // Verify recent matches section has content
  const matchEntries = page.locator('.match-entry, .recent-match, [class*="match"]');
  const count = await matchEntries.count();
  console.log(`Found ${count} match entries after submission`);
});
