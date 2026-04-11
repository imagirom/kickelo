/**
 * E2E test helpers for auth and screenshots.
 *
 * The Auth emulator REST API lets us create a known test user
 * without needing real credentials. The app's password gate
 * then accepts this user like any other.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const TEST_EMAIL = 'apps.imagirom@gmail.com';
const TEST_PASSWORD = 'test-password-e2e';

/** Ensure the test user exists in the Auth emulator. */
export async function ensureTestUser() {
  // Try creating the user; 400 means it already exists — that's fine.
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body?.error?.message !== 'EMAIL_EXISTS') {
      throw new Error(`Failed to create test user: ${JSON.stringify(body)}`);
    }
  }
}

/** Sign in through the app's password gate UI. */
export async function signInViaUI(page) {
  await page.goto('/');
  const gate = page.locator('#passwordGate');
  if (await gate.isVisible()) {
    await page.locator('#passwordInput').fill(TEST_PASSWORD);
    await page.locator('#passwordSubmit').click();
    // Wait for gate to disappear (auth completes)
    await gate.waitFor({ state: 'hidden', timeout: 10000 });
  }
}
