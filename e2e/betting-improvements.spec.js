import { test, expect } from '@playwright/test';
import { ensureTestUser, signInViaUI, resetBettingState, DOCS, OWNER } from './helpers.js';

import { buildCombinations } from '../src/betting/combinations.js';
import { outcomeProbability, toOdds } from '../src/betting/model.js';
import { BETTING } from '../src/betting/betting-config.js';
import params from '../src/betting/model-params.json' with { type: 'json' };

test.beforeAll(ensureTestUser);
test.beforeEach(resetBettingState);
test.afterAll(resetBettingState);

async function setup(page) {
  await signInViaUI(page);
  await page.waitForFunction(() => document.querySelectorAll('#teamA1 option').length > 6);
  const names = await page.locator('#teamA1 option').evaluateAll(os => os.map(o => o.value).filter(v => v && v !== '__add_new__'));
  for (const [i, id] of ['teamA1', 'teamA2', 'teamB1', 'teamB2'].entries()) await page.selectOption(`#${id}`, names[i]);
  await expect(page.locator('.bets-odds button')).toHaveCount(2);
  await expect(page.locator('.bets-prop')).toHaveCount(2);
  await expect(page.locator('.bets-prop-btn')).toHaveCount(4);
  await expect(page.locator('.bets-advanced summary')).toBeVisible();
  await expect(page.locator('.bets-combine-btn')).toBeHidden();
  return names;
}

test('AND ticket, ALL IN and empty-wallet credit work together', async ({ page }) => {
  const names = await setup(page);
  await page.locator('.bets-advanced summary').click();
  await page.locator('.bets-combine-btn').click();
  await expect(page.locator('.combo-preview')).toContainText(' AND ');
  await page.getByRole('button', { name: 'Choose stake', exact: true }).click();
  await page.locator('.bet-sheet-bettor').selectOption(names[4]);
  await page.locator('.bet-all-in').click();
  await expect(page.locator('.bet-sheet-stake')).toHaveValue('20');
  await page.getByRole('button', { name: 'Place bet', exact: true }).click();
  await expect(page.locator('.bets-feed')).toContainText(' AND ');
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Red wins/ }).click();
  await expect(page.locator('.bet-all-in')).toBeDisabled();
  await page.locator('.bet-credit-borrow').click();
  await expect(page.locator('.bet-credit')).toContainText('13 will be deducted');
  await expect(page.locator('.bet-credit-borrow')).toBeHidden();
  await page.locator('.bet-all-in').click();
  await expect(page.locator('.bet-sheet-stake')).toHaveValue('10');
  await page.getByRole('button', { name: 'Place bet', exact: true }).click();
  await expect(page.locator('.bets-feed li')).toHaveCount(2);
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Red wins/ }).click();
  await expect(page.locator('.bet-all-in')).toBeDisabled();
  await expect(page.locator('.bet-credit-borrow')).toBeHidden();
  await expect(page.locator('.bet-credit')).toContainText('13 will be deducted');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('the live clock stops at the fifth goal and resumes when it is removed', async ({ page }) => {
  await setup(page);
  await page.locator('#toggleLiveMode').click();
  for (let i = 0; i < 5; i++) await page.locator('#btnRedScored').click();
  await expect(page.locator('#btnRedScored')).toBeDisabled();
  await expect(page.locator('#btnBlueScored')).toBeDisabled();
  await page.waitForTimeout(1100);
  const stopped = await page.locator('#liveMatchTimer').textContent();
  await page.waitForTimeout(1200);
  await expect(page.locator('#liveMatchTimer')).toHaveText(stopped);
  await page.locator('.goal-remove-btn').last().click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#btnRedScored')).toBeEnabled();
  await expect(page.locator('#liveMatchTimer')).not.toHaveText(stopped);
});


// Seed a published duration market so this check is independent of the daily prop draw.
function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
}

test('both duration choices can be combined with a winner bet', async ({ page }) => {
  const names = await setup(page);
  const current = await (await fetch(`${DOCS}/meta/currentMatch`, { headers: OWNER })).json();
  const props = [
    { id: 'duration', outcome: { test: 'durationOver', team: null, threshold: 300 } },
    { id: 'first', outcome: { test: 'scoresFirst', team: names.slice(0, 2), threshold: null } },
  ].map(prop => {
    const p = outcomeProbability(prop.outcome, 0, params);
    return { ...prop, oddsYes: toOdds(p), oddsNo: toOdds(1 - p) };
  });
  const combos = buildCombinations(names.slice(0, 2), names.slice(2, 4), 0, params, BETTING, props);
  const offer = { ...current.fields.offer.mapValue.fields, ...firestoreValue({ props, ...combos }).mapValue.fields };
  const res = await fetch(`${DOCS}/meta/currentMatch?updateMask.fieldPaths=offer`, {
    method: 'PATCH', headers: { ...OWNER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { offer: { mapValue: { fields: offer } } } }),
  });
  expect(res.ok).toBe(true);
  await expect(page.locator('.bets-prop-label').first()).toHaveText('Duration over 5:00');
  await page.locator('.bets-advanced summary').click();
  await expect(page.locator('#betsBox')).not.toContainText('Duration bets are available individually');
  for (const [choice, expected] of [['s2', 'Duration over 5:00'], ['s3', 'Duration not over 5:00']]) {
    await page.locator('.bets-combine-btn').click();
    await page.locator('.combo-first').selectOption(choice);
    await page.locator('.combo-second').selectOption('s0');
    await expect(page.locator('.combo-preview')).toContainText(expected);
    await page.getByRole('button', { name: 'Choose stake', exact: true }).click();
    await page.locator('.bet-sheet-bettor').selectOption(names[4]);
    await page.locator('.bet-sheet-stake').fill('5');
    await page.getByRole('button', { name: 'Place bet', exact: true }).click();
    await expect(page.locator('.toast-message', { hasText: 'Bet placed' })).toBeVisible();
    await expect(page.locator('.bets-feed')).toContainText(expected);
    await expect(page.locator('.confirm-dialog')).toHaveCount(0);
  }
  await expect(page.locator('.bets-feed li')).toHaveCount(2);
});
