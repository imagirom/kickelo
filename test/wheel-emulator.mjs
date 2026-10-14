// Focused server contract check; local emulators only, no browser or real account.
import assert from 'node:assert/strict';
const auth = `http://127.0.0.1:${process.env.AUTH_PORT || 9099}`;
const docs = `http://127.0.0.1:${process.env.FIRESTORE_PORT || 7070}/v1/projects/kickelo/databases/(default)/documents`;
const callable = `http://127.0.0.1:${process.env.FUNCTIONS_PORT || 5001}/kickelo/us-central1/chooseAllowance`;
const credentials = { email: 'apps.imagirom@gmail.com', password: 'test-password-e2e', returnSecureToken: true };
const request = (url, data, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
await request(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, credentials);
const login = await (await request(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, credentials)).json();
assert.ok(login.idToken, 'local test authentication');
const headers = { Authorization: `Bearer ${login.idToken}` };
const ids = new Set();
async function choose(bettor, mode) {
  const response = await request(callable, { data: { bettor, mode } }, headers);
  const json = await response.json();
  if (json.result?.id) ids.add(json.result.id);
  return json;
}
try {
  const name = `Wheel contract ${Date.now()}`;
  const [first, simultaneous] = await Promise.all([choose(name, 'wheel'), choose(name, 'wheel')]);
  assert.ok(first.result, JSON.stringify(first));
  assert.deepEqual(first, simultaneous, 'concurrent requests return the same saved spin');
  assert.equal(first.result.payout, first.result.segments[first.result.segment]);
  assert.equal(first.result.segments.reduce((a, b) => a + b, 0), 200);
  assert.deepEqual(await choose(name, 'normal'), first, 'normal choice cannot replace a saved spin');
  const normal = `${name} normal`;
  assert.equal((await choose(normal, 'normal')).result.mode, 'normal');
  assert.equal((await choose(normal, 'wheel')).error.status, 'FAILED_PRECONDITION');
  const forged = await fetch(`${docs}/bets/${first.result.id}?updateMask.fieldPaths=payout`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { payout: { integerValue: '10000' } } }),
  });
  assert.equal(forged.status, 403, 'clients cannot alter a spin result');
  console.log('PASS: concurrent/retried spins are identical, normal choice is final, and client tampering is denied.');
} finally {
  for (const id of ids) await fetch(`${docs}/bets/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}
