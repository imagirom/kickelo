// e2e/betting.spec.js
// Two phones: A sets the lineup and runs live mode, B watches and bets.
import { test, expect } from '@playwright/test';
import { BETTING } from '../src/betting/betting-config.js';
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
  // "Keep shared match" undoes the change itself: blue defense is back to what it was.
  await expect(a.locator('#teamB1')).toHaveValue(names[2]);

  // Leaderboard option exists.
  await b.selectOption('#sortBySelect', 'goldenFootballs');
  await expect(b.locator('#leaderboard')).toContainText(/\d/);

  // B starting live mode on the same, already-live matchup asks first (spec Concurrency #7);
  // "Keep other phone" means B's live mode never starts and A's live match is untouched.
  await b.click('body');
  await pickLineup(b, names);
  await b.click('#toggleLiveMode');
  await expect(b.locator('.confirm-dialog')).toContainText('already live');
  await b.locator('.confirm-btn-cancel').click();
  await expect(b.locator('#liveMatchPanel')).toBeHidden();
  await expect(b.locator('#toggleLiveMode')).toBeVisible();
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

test('a burst of lineup events asks once and a decline undoes the change', async ({ browser }) => {
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
  // The lineup is back to the shared one; the owner never sees the hint.
  await expect(a.locator('#teamA2')).toHaveValue(names[1]);
  await expect(a.locator('#teamB2')).toHaveValue(names[3]);
  await expect(a.locator('#betsNotShared')).toBeHidden();
  expect((await shared()).matchupKey.stringValue).toContain(names[1]);
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
    // the "No" side is phrased positively, so it is a different text from the prop label
    for (const p of [b, a]) {
      const li = p.locator('#betsBox .bets-feed li');
      await expect(li).toHaveCount(1);
      await expect(li).toContainText(names[1]);
      expect((await li.locator('.bets-feed-what').textContent()).startsWith(`${desc} ·`)).toBe(false);
    }
  }
  await ctxA.close();
  await ctxB.close();
});

test('challenges: one of two concurrent accepts wins, withdraw hides Accept', async ({ browser }) => {
  test.skip(!BETTING.challenges, 'challenges are switched off in betting-config.js');
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
    await expect(dlg.locator('.challenge-preview')).toHaveText("Doesn't go to 4:4");
    await dlg.locator('input.challenge-my-stake').fill(String(myStake));
    await dlg.locator('input.challenge-their-stake').fill('15');
    await a.locator('.confirm-btn-ok').click();
  }
  await postChallenge(10);
  const line = (p, stake) => p.locator('#betsBox .bets-feed li', { hasText: `${stake} vs 15` });
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
  await expect(a.locator('.confirm-dialog')).toContainText(`Withdraw ${names[4]}'s challenge?`);
  await a.locator('.confirm-btn-ok').click();
  await expect(line(b, 7)).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('a phone that lost the shared match never writes its goals or end onto the new one', async ({ browser }) => {
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  const names = await playerNames(a);
  await pickLineup(a, names.slice(0, 4));
  await a.click('#toggleLiveMode');
  await expect.poll(async () => (await shared())?.liveId?.stringValue ?? null, { timeout: 10000 }).toBeTruthy();

  // A drops off the network; B replaces the shared match (confirmed, A was live).
  await ctxA.setOffline(true);
  await pickLineup(b, [names[0], names[4], names[2], names[5]]);
  await expect(b.locator('.confirm-dialog')).toContainText('currently live');
  await b.locator('.confirm-btn-ok').click();
  await expect.poll(async () => (await shared())?.red?.arrayValue?.values?.map((v) => v.stringValue).includes(names[4]) ?? false,
    { timeout: 10000 }).toBe(true);

  // A, still on its old snapshot, scores and cancels; back online nothing of it reaches B's match.
  await a.click('#btnRedScored');
  await ctxA.setOffline(false);
  await a.click('#btnRedScored');
  await a.click('#cancelLiveMode');
  if (await a.locator('.confirm-dialog').count()) await a.locator('.confirm-btn-ok').click();
  await a.waitForTimeout(3000);
  const doc = await shared();
  expect(doc.goalLog.arrayValue.values ?? []).toHaveLength(0);
  expect(doc.firstGoalAt.nullValue).toBeDefined();
  expect(doc.offer.mapValue).toBeTruthy();
  await ctxA.close();
  await ctxB.close();
});

test('declining a takeover or a replace keeps live mode off on this phone', async ({ browser }) => {
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  const names = await playerNames(a);
  await pickLineup(a, names.slice(0, 4));
  await a.click('#toggleLiveMode');
  await expect.poll(async () => (await shared())?.liveId?.stringValue ?? null, { timeout: 10000 }).toBeTruthy();
  const aLive = (await shared()).liveId.stringValue;

  // Same matchup: takeover question; "Keep other phone" -> live mode never starts here.
  await pickLineup(b, names.slice(0, 4));
  await b.click('#toggleLiveMode');
  await expect(b.locator('.confirm-dialog')).toContainText('already live');
  await b.locator('.confirm-btn-cancel').click();
  await expect(b.locator('.confirm-dialog')).toHaveCount(0); // let the answered dialog fade out
  await expect(b.locator('#liveMatchPanel')).toBeHidden();

  // Different matchup: the lineup change itself asks and "Keep shared match" reverts it.
  await b.selectOption('#teamB2', names[4]);
  await expect(b.locator('.confirm-dialog')).toContainText('currently live');
  await b.locator('.confirm-btn-cancel').click();
  await expect(b.locator('#teamB2')).toHaveValue(names[3]);
  await expect(b.locator('#liveMatchPanel')).toBeHidden();
  expect((await shared()).liveId.stringValue).toBe(aLive);
  await ctxA.close();
  await ctxB.close();
});

test('a challenge to a named player locks in straight away; oversized stakes say why', async ({ browser }) => {
  test.skip(!BETTING.challenges, 'challenges are switched off in betting-config.js');
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  const names = await playerNames(a);
  await pickLineup(a, names.slice(0, 4));
  const open = async (opponent, theirs) => {
    await a.locator('#betsBox .bets-challenge-btn').click();
    const dlg = a.locator('.confirm-dialog');
    await dlg.locator('select.challenge-challenger').selectOption(names[4]);
    await dlg.locator('select.challenge-opponent').selectOption(opponent);
    await dlg.locator('input.challenge-their-stake').fill(String(theirs));
    return dlg;
  };
  // opponent can't cover the stake -> confirm disabled, says who
  let dlg = await open(names[5], 5000);
  await expect(dlg.locator('.confirm-btn-ok')).toHaveText('Lock in');
  await expect(dlg).toContainText('Locks in straight away');
  await expect(dlg.locator('.confirm-btn-ok')).toBeDisabled();
  await expect(dlg).toContainText(`Not enough golden footballs: ${names[5]}`);
  await dlg.locator('.confirm-btn-cancel').click();
  // over the stake cap -> cap message
  await expect(a.locator('.confirm-dialog')).toHaveCount(0);
  dlg = await open('', 20000);
  await expect(dlg.locator('.confirm-btn-ok')).toHaveText('Post challenge');
  await dlg.locator('.confirm-btn-ok').click();
  await expect(a.locator('.toast-message', { hasText: 'Stakes are limited to 10000' })).toBeVisible();
  // affordable -> locked in on every phone, no Accept step
  await expect(a.locator('.confirm-dialog')).toHaveCount(0);
  dlg = await open(names[5], 20);
  await dlg.locator('.confirm-btn-ok').click();
  const line = b.locator('#betsBox .bets-feed li.bets-feed-challenge', { hasText: `${names[4]} → ${names[5]}` });
  await expect(line).toContainText('locked in', { timeout: 10000 });
  await expect(line.locator('button', { hasText: 'Accept' })).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});

async function matchesSince(ms) {
  const res = await fetch(`${DOCS}:runQuery`, { method: 'POST', headers: OWNER, body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'matches' }],
    where: { fieldFilter: { field: { fieldPath: 'timestamp' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date(ms).toISOString() } } },
  } }) });
  return (await res.json()).filter((r) => r.document);
}

async function deleteMatchesSince(ms) {
  const rows = await matchesSince(ms);
  await Promise.all(rows.map((r) => fetch(`${DOCS}/${r.document.name.split('/documents/')[1]}`, { method: 'DELETE', headers: OWNER })));
}

test('pre-match challenges close at the first goal; results stay visible after the next lineup', async ({ browser }) => {
  test.skip(!BETTING.challenges, 'challenges are switched off in betting-config.js');
  const since = Date.now();
  const { ctx: ctxA, page: a } = await openPhone(browser);
  const { ctx: ctxB, page: b } = await openPhone(browser);
  try {
    const names = await playerNames(a);
    await pickLineup(a, names.slice(0, 4));
    const box = b.locator('#betsBox');
    await expect(box).toContainText('live mode only', { timeout: 10000 });

    await box.locator('button', { hasText: 'Red wins' }).click();
    await b.locator('.confirm-dialog select.bet-sheet-bettor').selectOption(names[1]);
    await b.getByRole('button', { name: '5', exact: true }).click();
    await expect(b.getByRole('button', { name: '5', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await b.locator('.confirm-btn-ok').click();

    await a.locator('#betsBox .bets-challenge-btn').click();
    await a.locator('.confirm-dialog select.challenge-challenger').selectOption(names[4]);
    await a.locator('.confirm-btn-ok').click();
    const challenge = box.locator('.bets-feed li.bets-feed-challenge');
    await expect(challenge.locator('button', { hasText: 'Accept' })).toBeVisible();

    await a.click('#toggleLiveMode');
    await a.click('#btnRedScored');
    await expect(box).toContainText('Closed at first goal · odds were');
    await expect(challenge).toContainText('closed at first goal');
    await expect(challenge.locator('button', { hasText: 'Accept' })).toHaveCount(0);

    // Final-score submit on the shared matchup, then the next lineup: the result is still shown.
    await a.click('#cancelLiveMode');
    await a.locator('.confirm-btn-ok').click();
    await a.selectOption('#teamAgoals', '5');
    await a.selectOption('#teamBgoals', '3');
    await a.click('#submitMatchBtn');
    await expect(a.locator('.confirm-dialog')).toContainText('positions');
    await a.locator('.confirm-btn-ok').click();
    const submit = a.locator('.confirm-dialog', { hasText: 'Confirm match submission' });
    await submit.locator('.confirm-btn-ok').click();
    // right after Submit (the form resets once it is done): the logged bets are not "refunded"
    await expect(a.locator('.toast-message', { hasText: 'Match submitted' })).toBeVisible();
    await expect(a.locator('#teamA1')).toHaveValue('');
    await pickLineup(a, [names[0], names[4], names[2], names[5]]);
    await a.waitForTimeout(500);
    await expect(a.locator('.confirm-dialog')).toHaveCount(0);
    await expect.poll(async () => (await matchesSince(since)).length, { timeout: 10000 }).toBe(1);
    await expect(box.locator('.bets-feed-heading')).toContainText('Last match', { timeout: 10000 });
    await expect(box).toContainText('refunded');
  } finally {
    await ctxA.close();
    await ctxB.close();
    await deleteMatchesSince(since - 60000);
  }
});
