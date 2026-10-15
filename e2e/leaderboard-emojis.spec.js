import { test, expect } from '@playwright/test';
import { ensureTestUser, signInViaUI } from './helpers.js';

test.beforeAll(async () => {
  await ensureTestUser();
});

async function openEmojiView(page) {
  await signInViaUI(page);
  await page.locator('#leaderboardOptionsToggle').click();
  await page.locator('#seasonSelect').selectOption('all-time');
  await page.locator('#showInactiveToggle').click();
  await page.locator('#sortBySelect').selectOption('emojis');
  await expect(page.locator('#leaderboardChips .leaderboard-chip').first()).toBeVisible();
}

test('emoji chips expose their state and keep keyboard focus', async ({ page }) => {
  await openEmojiView(page);
  const chips = page.locator('#leaderboardChips .leaderboard-chip');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true'); // "All"
  const second = chips.nth(1);
  const emoji = await second.getAttribute('data-emoji');
  await second.focus();
  await page.keyboard.press('Enter');
  const pressed = page.locator(`#leaderboardChips .leaderboard-chip[data-emoji="${emoji}"]`);
  await expect(pressed).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed).toBeFocused();
  await page.keyboard.press('Enter'); // back to All
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
});

test('emoji rows with many big counts wrap instead of overflowing', async ({ page }) => {
  await openEmojiView(page);
  // The emulator data has only small counts: stuff the first row like an all-time veteran's
  const fit = await page.evaluate(() => {
    const li = document.querySelector('#leaderboard li.leaderboard-item');
    const badges = li.querySelector('.leaderboard-badges');
    const one = badges.firstElementChild;
    badges.replaceChildren(...Array.from({ length: 11 }, () => {
      const clone = one.cloneNode(true);
      clone.lastChild.textContent = '188';
      return clone;
    }));
    li.querySelector('.leaderboard-name').textContent = 'Friedrich';
    return {
      overflow: li.scrollWidth - li.clientWidth,
      nameWidth: li.querySelector('.leaderboard-name').getBoundingClientRect().width,
    };
  });
  expect(fit.overflow).toBeLessThanOrEqual(1);
  expect(fit.nameWidth).toBeGreaterThan(60);
});
