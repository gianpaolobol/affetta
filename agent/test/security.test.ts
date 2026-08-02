import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertArtifactUrl } from '../src/config.js';
import { testConfig } from './support/test-config.js';

test('blocca host storage fuori allowlist e HTTP non locale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-security-'));
  const config = testConfig(root, 'http://127.0.0.1:10001', 'http://127.0.0.1:10002');
  assert.throws(() => assertArtifactUrl(config, 'http://example.com/file'), /HTTPS|autorizzato/);
  assert.throws(() => assertArtifactUrl(config, 'https://storage.example/file'), /autorizzato/);
  assert.equal(assertArtifactUrl(config, 'http://127.0.0.1:10001/file').host, '127.0.0.1:10001');
  fs.rmSync(root, { recursive: true, force: true });
});
