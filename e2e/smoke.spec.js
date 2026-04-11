import { test, expect } from '@playwright/test';
import path from 'path';

const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots');

test('page loads with title and main sections', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Kicker/i);

  // Take a full-page screenshot
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'home-full.png'), fullPage: true });

  // Check main heading exists
  const heading = page.locator('h1').first();
  await expect(heading).toBeVisible();

  // Check key sections are present
  await expect(page.locator('text=Recent Matches')).toBeVisible();
  await expect(page.locator('text=Leaderboard')).toBeVisible();
});

test('match submission form is visible', async ({ page }) => {
  await page.goto('/');

  // Screenshot of just the match form area
  const form = page.locator('#matchForm, .match-form, form').first();
  await expect(form).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'match-form.png'), fullPage: false });
});

test('tournaments section exists', async ({ page }) => {
  await page.goto('/');

  // Scroll to tournaments section and screenshot
  const tournaments = page.locator('text=Tournaments');
  await expect(tournaments).toBeVisible();
  await tournaments.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'tournaments.png'), fullPage: false });
});
