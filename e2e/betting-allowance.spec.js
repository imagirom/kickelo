import { test, expect } from '@playwright/test';
import { ensureTestUser, signInViaUI, resetBettingState, DOCS, OWNER } from './helpers.js';
import { matchupKey } from '../src/betting/matchup.js';

const matchPath = `${DOCS}/matches/allowance-e2e-match`;
const cleanup = async () => {
  await resetBettingState();
  await fetch(matchPath, { method: 'DELETE', headers: OWNER });
  await fetch(`${DOCS}/matches/allowance-e2e-second`, { method: 'DELETE', headers: OWNER });
};
test.beforeAll(ensureTestUser);
test.beforeEach(cleanup);
test.afterEach(cleanup);

function field(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (value === null) return { nullValue: null };
  if (typeof value === 'object') return { mapValue: { fields: fields(value) } };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value };
}
const fields = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, field(value)]));
async function seed(path, value) {
  const response = await fetch(path, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields(value) }) });
  expect(response.ok).toBe(true);
}

test('bet sheet combines a small allowance with partial loan repayment', async ({ page }) => {
  await signInViaUI(page);
  await page.waitForFunction(() => document.querySelectorAll('#teamA1 option').length > 6);
  const names = await page.locator('#teamA1 option').evaluateAll((options) => options.map((o) => o.value).filter((v) => v && v !== '__add_new__').slice(0, 5));
  const red = names.slice(0, 2), blue = names.slice(2, 4), bettor = names[4];
  const key = matchupKey(red, blue);
  const previous = new Date();
  previous.setDate(previous.getDate() - 2); // an idle day must not reset the allowance
  previous.setHours(12, 0, 0, 0);
  await seed(matchPath, {
    timestamp: new Date(+previous + 300000), teamA: red, teamB: blue,
    winner: 'A', goalsA: 5, goalsB: 2, ranked: false, matchDuration: 240000,
    goalLog: [{ team: 'red', timestamp: 30000 }],
  });
  await seed(`${DOCS}/bets/allowance-e2e-bet`, {
    kind: 'house', allowancePolicy: 2, bettor, placedAt: previous, matchupKey: key,
    stake: 20, odds: 2, outcome: { test: 'winner', team: blue, negate: false }, void: false,
  });
  // Start a loan after the initial loss, then stake four on the following day.
  await seed(`${DOCS}/bets/allowance-e2e-loan`, {
    kind: 'credit', bettor, placedAt: new Date(+previous + 400000), advance: 10, repayment: 13, void: false,
  });
  const yesterday = new Date(previous); yesterday.setDate(yesterday.getDate() + 1);
  await seed(`${DOCS}/matches/allowance-e2e-second`, {
    timestamp: new Date(+yesterday + 300000), teamA: red, teamB: blue,
    winner: 'A', goalsA: 5, goalsB: 2, ranked: false, matchDuration: 240000,
    goalLog: [{ team: 'red', timestamp: 30000 }],
  });
  await seed(`${DOCS}/bets/allowance-e2e-second`, {
    kind: 'house', allowancePolicy: 2, bettor, placedAt: yesterday, matchupKey: key,
    stake: 4, odds: 2, outcome: { test: 'winner', team: blue, negate: false }, void: false,
  });
  await page.click('body');
  for (const [selector, value] of [['#teamA1', red[0]], ['#teamA2', red[1]], ['#teamB1', blue[0]], ['#teamB2', blue[1]]]) {
    await page.selectOption(selector, value);
  }
  const openSheet = async () => {
    await page.locator('#betsBox button', { hasText: 'Red wins' }).click();
    await page.locator('.bet-sheet-bettor').selectOption(bettor);
  };
  await openSheet();
  await expect(page.locator('.bet-sheet-allowance')).toContainText("Today's allowance: 4 golden footballs (included when you bet)");
  await expect(page.locator('.bet-sheet-info')).toContainText('18');
  await expect(page.locator('.bet-sheet-allowance')).toContainText('2 go toward your loan, leaving 2');
  await expect(page.locator('.bet-credit')).toContainText('3 golden footballs still owed');
  await expect(page.locator('.bet-credit-borrow')).toBeHidden();
  await page.locator('.bet-sheet-stake').fill('4');
  await page.locator('.confirm-btn-ok').click();
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);
  await expect.poll(async () => {
    const response = await fetch(`${DOCS}/bets`, { headers: OWNER });
    const { documents = [] } = await response.json();
    return documents.some((d) => !d.name.includes('/allowance-e2e-') && d.fields.allowancePolicy?.integerValue === '2');
  }).toBe(true);
  await openSheet();
  await expect(page.locator('.bet-sheet-allowance')).toContainText("Today's allowance: 4 golden footballs (already included)");
  await expect(page.locator('.bet-credit')).toContainText('1 golden football still owed');
  await expect(page.locator('.bet-sheet-allowance')).toContainText('2 repaid your loan, leaving 2');
  await page.locator('.bet-sheet-stake').fill('15');
  await expect(page.locator('.confirm-btn-ok')).toBeDisabled();
  await page.locator('.bet-sheet-stake').fill('14');
  await expect(page.locator('.confirm-btn-ok')).toBeEnabled();
  await page.locator('.confirm-btn-cancel').click();
});
