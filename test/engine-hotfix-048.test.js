import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../src/providers/command-slicer.js', import.meta.url), 'utf8');
const selftest = fs.readFileSync(new URL('../scripts/engine-selftest.mjs', import.meta.url), 'utf8');
const profileTest = fs.readFileSync(new URL('../scripts/profile-asset-selftest.mjs', import.meta.url), 'utf8');
const verifier = fs.readFileSync(new URL('../scripts/verify-engines-windows.ps1', import.meta.url), 'utf8');
const version = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
const escapedVersion = version.replaceAll('.', '\\.');

test('Snapmaker U1 usa comando e risorse dello stesso bundle Orca', () => {
  assert.match(router, /install\s*=\s*\{\s*\.\.\.standardOrca,/s);
  assert.match(router, /orca-2\.4\.2-with-bundled-snapmaker-u1-profiles/);
  assert.doesNotMatch(router, /\.\.\.install,\s*command:\s*standardOrca\.command/);
});

test('self-test Snapmaker verifica i profili Orca effettivamente usati', () => {
  assert.match(selftest, /runtimeEngine\s*=\s*engine\s*===\s*'snapmaker_orca'\s*\?\s*'orca'/);
  assert.match(profileTest, /runtimeEngine\s*=\s*item\.engine\s*===\s*'snapmaker_orca'\s*\?\s*'orca'/);
});

test('report motori è JSON puro e il verificatore rifiuta report vecchi', () => {
  assert.doesNotMatch(selftest, /Tutti i percorsi di produzione hanno superato/);
  assert.match(selftest, /report\.summary/);
  assert.match(verifier, new RegExp(`engineReport\\.version\\s+-ne\\s+'${escapedVersion}'`));
  assert.match(verifier, /ConvertFrom-Json/);
});
