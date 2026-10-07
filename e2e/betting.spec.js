// e2e/betting.spec.js
// Two phones: A sets the lineup and runs live mode, B watches and bets.
import { test, expect } from '@playwright/test';
import { ensureTestUser, signInViaUI } from './helpers.js';

// Emulator only: start from no shared match and no bets, so reruns are independent.
const DOCS = 'http://127.0.0.1:7070/v1/projects/kickelo/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };
async function resetBettingState() {
  const { documents = [] } = await (await fetch(`${DOCS}/bets?pageSize=1000`, { headers: OWNER })).json();
  const paths = [...documents.map((d) => d.name.split('/documents/')[1]), 'meta/currentMatch'];
  await Promise.all(paths.map((p) => fetch(`${DOCS}/${p}`, { method: 'DELETE', headers: OWNER })));
}

test.beforeAll(async () => { await ensureTestUser(); await resetBettingState(); });

async function pickLineup(page, [a1, a2, b1, b2]) {
  await page.selectOption('#teamA1', a1);
  await page.selectOption('#teamA2', a2);
  await page.selectOption('#teamB1', b1);
  await page.selectOption('#teamB2', b2);
}

test('lineup, live score and house bets sync across phones', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signInViaUI(a);
  await signInViaUI(b);
  await a.waitForFunction(() => document.querySelectorAll('#teamA1 option').length > 4);
  const names = await a.$$eval('#teamA1 option', (os) => os.map((o) => o.value).filter((v) => v && v !== '__add_new__').slice(0, 4));
  await a.click('body'); // user activation
  await pickLineup(a, names);

  const box = b.locator('#betsBox');
  await expect(box).toBeVisible({ timeout: 10000 });
  await expect(box.locator('button', { hasText: 'wins' })).toHaveCount(2);

  // B bets 10 on red.
  await box.locator('button', { hasText: 'Red wins' }).click();
  await b.locator('.confirm-dialog select.bet-sheet-bettor').selectOption(names[0]);
  await b.locator('.confirm-dialog input[type=number]').fill('10');
  await b.locator('.confirm-btn-ok').click();
  await expect(box).toContainText('10');
  await expect(a.locator('#betsBox')).toContainText('10'); // A sees B's bet

  // A starts live mode and scores; B sees live row and betting closes.
  await a.click('#toggleLiveMode');
  await a.click('#btnRedScored');
  await expect(box).toContainText('LIVE');
  await expect(box).toContainText('Closed at first goal');

  // Position swap on A (red defense/offense) does not ask and keeps the bet.
  await a.click('#swap_red_team_hitbox');
  await expect(a.locator('.confirm-dialog')).toHaveCount(0);

  // Changing a player on A asks for confirmation mentioning the open bet.
  // After the red swap names[0] sits in #teamA2; exchange it with names[2] (blue defense).
  await a.selectOption('#teamA2', names[2]);
  await a.selectOption('#teamB1', names[0]);
  await expect(a.locator('.confirm-dialog')).toContainText('1 bet');
  await a.locator('.confirm-btn-cancel').click();

  // Leaderboard option exists.
  await b.selectOption('#sortBySelect', 'goldenFootballs');
  await expect(b.locator('#leaderboard')).toContainText(/\d/);

  // B starting live mode on the same, already-live matchup asks first (spec Concurrency #7);
  // declining keeps A's live match: B's goals never reach the shared doc, betting stays closed.
  const shared = async () => (await (await fetch(`${DOCS}/meta/currentMatch`, { headers: OWNER })).json()).fields;
  await b.click('body');
  await pickLineup(b, names);
  await b.click('#toggleLiveMode');
  await expect(b.locator('.confirm-dialog')).toContainText('already live');
  await b.locator('.confirm-btn-cancel').click();
  await b.click('#btnBlueScored');
  await b.click('#btnBlueScored');
  await b.waitForTimeout(1000);
  const doc = await shared();
  expect(doc.goalLog.arrayValue.values).toHaveLength(1);
  expect(doc.firstGoalAt.timestampValue).toBeTruthy();

  await ctxA.close();
  await ctxB.close();
});
