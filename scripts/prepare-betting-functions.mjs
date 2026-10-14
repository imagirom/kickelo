// Package the exact same pure ledger used by the browser for Cloud Functions.
// No second implementation of balances or settlement to keep in sync.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'functions/generated');
const seen = new Set();
async function copy(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = await readFile(file, 'utf8');
  const target = resolve(output, relative(root, file));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
  for (const [, dependency] of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    await copy(resolve(dirname(file), dependency));
  }
}
await copy(resolve(root, 'src/betting/ledger.js'));
await copy(resolve(root, 'src/betting/wheel.js'));
await writeFile(resolve(output, 'package.json'), '{"type":"module"}\n');
console.log(`Packaged ${seen.size} shared betting modules.`);
