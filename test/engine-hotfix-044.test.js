import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const orca = fs.readFileSync(new URL('../src/providers/engines/orca.js', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('../src/providers/engine-registry.js', import.meta.url), 'utf8');

test('Orca ensure-on-bed non riceve un valore che sarebbe interpretato come file', () => {
  assert.match(orca, /'--arrange', '1',[\s\S]*'--ensure-on-bed'/);
  assert.doesNotMatch(orca, /'--ensure-on-bed', '1'/);
});

test('Cura cerca ricorsivamente le definizioni estratte dal pacchetto MSI', () => {
  assert.match(registry, /findDirectoryRecursive/);
  assert.match(registry, /fdmprinter\.def\.json/);
  assert.match(registry, /runtime', 'engines', 'cura/);
});
