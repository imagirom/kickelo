// e2e/betting.spec.js
// Two phones: A sets the lineup and runs live mode, B watches and bets.
import { test, expect } from '@playwright/test';
import { ensureTestUser, signInViaUI, resetBettingState, DOCS, OWNER } from './helpers.js';

test.beforeAll(async () => { await ensureTestUser(); });
test.beforeEach(async () => { await resetBettingState(); });
test.afterAll(async () => { await resetBettingState(); }); // leave the emulator clean for manual testing

const shared = async () => (await (await fetch(`${DOCS}/meta/currentMatch`, { headers: OWNER })).json()).fields;

async function openPhone(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInViaUI(page);
  await page.waitForFunction(() => document.querySelectorAll('#teamA1 option').length > 6);
  await page.click('body'); // user activation
  return { ctx, page };
}

const playerNames = (page) => page.$$eval('#teamA1 option', (os) => os.map((o) => o.value).filter((v) => v && v !== '__add_new__').slice(0, 6));

// Programmatic lineup change the way Suggest / swaps / tournament prefill do it:
// set all four selects, then notifyRolesChanged() fires lineup-changed once per team.
async function setLineupLikeSuggest(page, [a1, a2, b1, b2]) {
  await page.evaluate(([v1, v2, v3, v4]) => {
    document.getElementById('teamA1').value = v1;
    document.getElementById('teamA2').value = v2;
    document.getElementById('teamB1').value = v3;
    document.getElementById('teamB2').value = v4;
    window.dispatchEvent(new CustomEvent('lineup-changed'));
    window.dispatchEvent(new CustomEvent('lineup-changed'));
  }, [a1, a2, b1, b2]);
}

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

test('live mode started before the teams are set is shared once they are', async ({ browser }) => {
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  const names = await playerNames(a);
  await a.click('#toggleLiveMode');
  await a.click('#btnRedScored');
  await pickLineup(a, names.slice(0, 4));

  const box = b.locator('#betsBox');
  await expect(box).toContainText('LIVE', { timeout: 10000 });
  await expect(box).toContainText('1 : 0');
  await expect(box).toContainText('Closed at first goal');
  await a.click('#btnBlueScored');
  await expect(box).toContainText('1 : 1');
  const doc = await shared();
  expect(doc.goalLog.arrayValue.values).toHaveLength(2);
  expect(doc.firstGoalAt.timestampValue).toBeTruthy();
  await expect(a.locator('#betsNotShared')).toBeHidden();

  // Changing a player mid-game (confirmed) keeps the live match shared with its goals.
  await a.selectOption('#teamB2', names[4]);
  await expect(a.locator('.confirm-dialog')).toContainText('currently live');
  await a.locator('.confirm-btn-ok').click();
  await expect(box).toContainText(names[4].slice(0, 3), { timeout: 10000 });
  await expect(box).toContainText('LIVE');
  await expect(box).toContainText('1 : 1');
  await expect(a.locator('#betsNotShared')).toBeHidden();

  await ctxA.close();
  await ctxB.close();
});

test('a burst of lineup events asks once and a decline is remembered', async ({ browser }) => {
  const { ctx, page: a } = await openPhone(browser);
  const names = await playerNames(a);
  await pickLineup(a, names.slice(0, 4));
  await a.click('#toggleLiveMode');
  await expect.poll(async () => (await shared())?.liveId?.stringValue ?? null, { timeout: 10000 }).toBeTruthy();
  await expect(a.locator('#betsNotShared')).toBeHidden();

  const other = [names[0], names[4], names[2], names[5]];
  await setLineupLikeSuggest(a, other);
  await expect(a.locator('.confirm-dialog')).toHaveCount(1);
  await a.waitForTimeout(500);
  await expect(a.locator('.confirm-dialog')).toHaveCount(1);
  await a.locator('.confirm-btn-cancel').click();
  await a.waitForTimeout(800);
  await expect(a.locator('.confirm-dialog')).toHaveCount(0);
  await expect(a.locator('#betsNotShared')).toBeVisible();

  // Same lineup again: no new dialog.
  await setLineupLikeSuggest(a, other);
  await a.waitForTimeout(800);
  await expect(a.locator('.confirm-dialog')).toHaveCount(0);

  // Back to the shared lineup: the owner never sees the hint.
  await setLineupLikeSuggest(a, names.slice(0, 4));
  await expect(a.locator('#betsNotShared')).toBeHidden();
  await a.click('#btnRedScored');
  await expect.poll(async () => (await shared())?.goalLog?.arrayValue?.values?.length ?? 0).toBe(1);
  await expect(a.locator('#betsNotShared')).toBeHidden();
  await ctx.close();
});

test('house props: at most count rows, a "No" bet shows on both feeds', async ({ browser }) => {
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  const names = await playerNames(a);
  await pickLineup(a, names.slice(0, 4));

  const box = b.locator('#betsBox');
  await expect(box.locator('button', { hasText: 'wins' })).toHaveCount(2, { timeout: 10000 });
  const rows = box.locator('.bets-prop');
  const n = await rows.count();
  expect(n).toBeLessThanOrEqual(2);
  if (n > 0) {
    const desc = await rows.first().locator('.bets-prop-label').textContent();
    await rows.first().locator('.bets-prop-btn', { hasText: 'No' }).click();
    await b.locator('.confirm-dialog select.bet-sheet-bettor').selectOption(names[1]);
    await b.locator('.confirm-dialog input[type=number]').fill('5');
    await b.locator('.confirm-btn-ok').click();
    await expect(box.locator('.bets-feed')).toContainText(`Not: ${desc}`);
    await expect(a.locator('#betsBox .bets-feed')).toContainText(`Not: ${desc}`);
  }
  await ctxA.close();
  await ctxB.close();
});

test('challenges: one of two concurrent accepts wins, withdraw hides Accept', async ({ browser }) => {
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  const { ctx: ctxC, page: c } = await openPhone(browser);
  const names = await playerNames(a);
  await pickLineup(a, names.slice(0, 4));
  await expect(b.locator('#betsBox')).toBeVisible({ timeout: 10000 });
  await a.click('#toggleLiveMode');
  await a.click('#btnRedScored');
  await expect(b.locator('#betsBox')).toContainText('Closed at first goal');

  // A challenges anyone after the first goal.
  async function postChallenge(myStake) {
    await a.locator('#betsBox .bets-challenge-btn').click();
    const dlg = a.locator('.confirm-dialog');
    await dlg.locator('select.challenge-challenger').selectOption(names[4]);
    await dlg.locator('select.challenge-test').selectOption('goesToFourFour');
    await dlg.locator('button', { hasText: 'I bet against' }).click();
    await expect(dlg.locator('.challenge-preview')).toHaveText('Not: Goes to 4:4');
    await dlg.locator('input.challenge-my-stake').fill(String(myStake));
    await dlg.locator('input.challenge-their-stake').fill('30');
    await a.locator('.confirm-btn-ok').click();
  }
  await postChallenge(10);
  const line = (p, stake) => p.locator('#betsBox .bets-feed li', { hasText: `${stake} vs 30` });
  await expect(line(b, 10)).toContainText(`${names[4]} → anyone`);
  await expect(line(c, 10).locator('button', { hasText: 'Accept' })).toBeVisible();

  // B and C accept at the same time.
  for (const [p, who] of [[b, names[5]], [c, names[0]]]) {
    await line(p, 10).locator('button', { hasText: 'Accept' }).click();
    await p.locator('.confirm-dialog select.challenge-acceptor').selectOption(who);
  }
  await Promise.all([b.locator('.confirm-btn-ok').click(), c.locator('.confirm-btn-ok').click()]);
  const toasts = async (p) => (await p.locator('.toast-message').allTextContents()).join('|');
  await expect.poll(async () => `${await toasts(b)}#${await toasts(c)}`, { timeout: 10000 })
    .toMatch(/Challenge accepted.*#.*Already taken by|Already taken by.*#.*Challenge accepted/);
  for (const p of [a, b, c]) await expect(line(p, 10)).toContainText('accepted by');

  // A second challenge is withdrawn; its Accept button disappears on B.
  await postChallenge(7);
  await expect(line(b, 7).locator('button', { hasText: 'Accept' })).toBeVisible();
  await line(a, 7).locator('button', { hasText: 'Withdraw' }).click();
  await expect(line(b, 7)).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
