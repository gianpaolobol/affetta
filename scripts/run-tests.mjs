import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve('test');

function discover(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...discover(full));
    else if (name.endsWith('.test.js')) files.push(full);
  }
  return files;
}

const files = discover(root);
if (files.length === 0) {
  console.error('Nessun test trovato in test/**/*.test.js');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
