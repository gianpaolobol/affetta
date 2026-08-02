import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/test/', import.meta.url));
const files = readdirSync(root)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(root, name));

if (files.length === 0) {
  console.error(`Nessun test backend compilato trovato in ${root}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
