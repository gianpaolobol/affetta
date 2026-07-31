import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const prepare = fs.readFileSync(new URL('../scripts/prepare-bundled-engines-windows.ps1', import.meta.url), 'utf8');
const verify = fs.readFileSync(new URL('../scripts/verify-engines-windows.ps1', import.meta.url), 'utf8');

test('PowerShell engine scripts resolve executable paths safely', () => {
  assert.match(prepare, /function Resolve-ExecutablePath/);
  assert.match(verify, /function Resolve-ExecutablePath/);
  assert.doesNotMatch(prepare, /if \(\$Node\.FullName\)/);
  assert.doesNotMatch(verify, /if \(\$node\.FullName\)/);
});

test('verifier runs profile and engine self-tests', () => {
  assert.match(verify, /profile-asset-selftest\.mjs/);
  assert.match(verify, /engine-selftest\.mjs/);
});
