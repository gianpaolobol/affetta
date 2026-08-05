#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo-root') out.repoRoot = argv[++i];
    if (argv[i] === '--manifest') out.manifest = argv[++i];
  }
  return out;
}

const options = args(process.argv.slice(2));
if (!options.repoRoot || !options.manifest) throw new Error('--repo-root e --manifest obbligatori');
const repoRoot = resolve(options.repoRoot);
const adapterPath = join(repoRoot, 'server-lite', 'src', 'adapters', 'octobridge.js');
const { OctoBridgeAdapter } = await import(pathToFileURL(adapterPath).href);
const manifest = JSON.parse(await readFile(resolve(options.manifest), 'utf8'));
assert.equal(manifest.nodes.length, 12);
const adapter = new OctoBridgeAdapter({ timeoutMs: 5000, transferTimeoutMs: 15000, actionTimeoutMs: 8000 });

console.log('[TEST] probe Server Lite parallelo su 12 bridge');
const snapshots = await Promise.all(manifest.nodes.map(async (node) => {
  const printer = { id: node.id, endpoint: node.endpoint, api_key: node.token };
  const snapshot = await adapter.probe(printer);
  assert.equal(snapshot.connection_status, 'connected', node.id);
  assert.equal(snapshot.job_status, 'printing', node.id);
  assert.equal(snapshot.progress_percent, node.progress_percent, node.id);
  assert.equal(snapshot.active_file, node.active_file, node.id);
  assert.equal(snapshot.raw.bridge_id, node.bridge_id, node.id);
  assert.equal(snapshot.raw.bridge_production_ready, false, node.id);
  return snapshot;
}));
assert.equal(new Set(snapshots.map((item) => item.raw.bridge_id)).size, 12);

console.log('[TEST] token di un nodo non autorizza il nodo vicino');
for (let i = 0; i < manifest.nodes.length; i += 1) {
  const node = manifest.nodes[i];
  const wrong = manifest.nodes[(i + 1) % manifest.nodes.length];
  await assert.rejects(
    () => adapter.probe({ id: node.id, endpoint: node.endpoint, api_key: wrong.token }),
    (error) => error?.code === 'authentication_failed',
    node.id
  );
}
console.log('[OK] Feed dashboard Server Lite isolato per 12 nodi.');
