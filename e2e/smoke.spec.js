import { test, expect } from '@playwright/test';
import path from 'path';
import { ensureTestUser, signInViaUI } from './helpers.js';

const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots');

test.beforeAll(async () => {
  await ensureTestUser();
});

test('page loads and authenticates', async ({ page }, testInfo) => {
  await signInViaUI(page);

  const suffix = testInfo.project.name; // 'desktop' or 'mobile'
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `home-${suffix}.png`), fullPage: true });

  // Check key sections are present after auth
  await expect(page.locator('text=Recent Matches')).toBeVisible();
  await expect(page.locator('text=Leaderboard')).toBeVisible();
});

test('match submission form is visible', async ({ page }, testInfo) => {
  await signInViaUI(page);

  const suffix = testInfo.project.name;
  const form = page.locator('#matchForm, .match-form, form').first();
  await expect(form).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `match-form-${suffix}.png`), fullPage: false });
});

test('tournaments section exists', async ({ page }, testInfo) => {
  await signInViaUI(page);

  const suffix = testInfo.project.name;
  const tournaments = page.locator('text=Tournaments');
  await expect(tournaments).toBeVisible();
  await tournaments.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `tournaments-${suffix}.png`), fullPage: false });
});
