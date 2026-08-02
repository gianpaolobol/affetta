import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveMigrationsDirectory } from '../src/migration-path.js';

test('risolve le migrazioni dalla root runtime del backend', () => {
  const root = path.resolve('C:/affetta/backend');
  assert.equal(resolveMigrationsDirectory(root, ''), path.resolve(root, 'migrations'));
});

test('AFFETTA_MIGRATIONS_DIR sovrascrive il percorso predefinito', () => {
  const override = path.resolve('D:/affetta/sql');
  assert.equal(resolveMigrationsDirectory('C:/ignored', override), override);
});
