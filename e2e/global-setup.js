// e2e/global-setup.js
// Load the working-tree firestore.rules into the (possibly reused) emulator: its file-watch
// reload logs "Rules updated" but has been seen to keep evaluating the rules it started with.
import fs from 'node:fs';

export default async function globalSetup() {
  const content = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const res = await fetch('http://127.0.0.1:7070/emulator/v1/projects/kickelo:securityRules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) throw new Error(`Loading firestore.rules into the emulator failed: ${await res.text()}`);
}
