import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(root, 'scripts', 'start-windows.ps1'), 'utf8');

test('launcher Windows verifica il server prima di aprire il browser', () => {
  const healthIndex = script.indexOf('$Health = Test-AffettaHealth $BaseUrl');
  const browserIndex = script.indexOf('Start-Process $BaseUrl', healthIndex);
  assert.ok(healthIndex >= 0, 'controllo health mancante');
  assert.ok(browserIndex > healthIndex, 'il browser deve aprirsi dopo il controllo health');
});

test('launcher Windows non dipende da npm', () => {
  assert.equal(/\bnpm(?:\.cmd)?\b/i.test(script), false);
  assert.match(script, /\$NodeVersion = '24\.18\.1'/);
  assert.match(script, /node-v\$NodeVersion-win-x64/);
  assert.match(script, /Get-FileHash -Algorithm SHA256/);
});

const installer = fs.readFileSync(path.join(root, 'scripts', 'prepare-bundled-engines-windows.ps1'), 'utf8');

test('preparatore motori usa esclusivamente i pacchetti verificati inclusi', () => {
  assert.match(installer, /runtime\\packages/i);
  assert.match(installer, /runtime\\engines/i);
  assert.match(installer, /PrusaSlicer-2\.9\.6-setup\.exe/);
  assert.match(installer, /OrcaSlicer_Windows_V2\.4\.2_x64_portable\.zip/);
  assert.match(installer, /Snapmaker_Orca_Windows_V2\.3\.5_portable\.zip/);
  assert.match(installer, /UltiMaker-Cura-5\.13\.0-win64-X64\.msi/);
  assert.match(installer, /Get-FileHash -Algorithm SHA256/);
  assert.match(installer, /Expand-Archive/);
  assert.match(installer, /msiexec\.exe/);
  assert.match(installer, /engine-selftest\.mjs/);
});

test('preparatore motori non modifica il core o i profili Affetta', () => {
  assert.equal(/config\\printers\.json|src\\providers/i.test(installer), false);
  assert.doesNotMatch(installer, /Set-Content[^\n]*(?:config|src)[\\/]/i);
  assert.match(installer, /runtime\\engines/);
});
