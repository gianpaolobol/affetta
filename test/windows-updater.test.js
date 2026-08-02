import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('aggiornamento Windows preserva configurazione, dati, runtime e dipendenze', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'apply-update-windows.ps1'), 'utf8');
  for (const name of ['.env', 'data', 'runtime', 'node_modules']) assert.match(script, new RegExp(name.replace('.', '\\.')));
  assert.match(script, /AFFETTA_BACKUP_PRE_0501/);
  assert.match(script, /last-update-backup\.txt/);
  assert.match(script, /VERSION diversa da 0\.5\.1/);
});

test('rollback usa il backup registrato e non elimina runtime o data', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'rollback-update-windows.ps1'), 'utf8');
  assert.match(script, /last-update-backup\.txt/);
  assert.match(script, /Le cartelle data, runtime e node_modules non sono state eliminate/);
  assert.doesNotMatch(script, /Remove-Item[^\n]+runtime/);
  assert.doesNotMatch(script, /Remove-Item[^\n]+data/);
});
