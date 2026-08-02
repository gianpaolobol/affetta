import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentDatabase } from '../src/db.js';

test('cifra il token e non lo lascia in chiaro nel database', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-db-'));
  const databasePath = path.join(root, 'agent.db');
  const db = await AgentDatabase.open(databasePath, path.join(root, 'secret.key'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.saveCredentials({ agent_id: 'agt_test_01', access_token: 'token-che-non-deve-apparire', paired_at: new Date().toISOString() });
  assert.equal(db.getCredentials()?.access_token, 'token-che-non-deve-apparire');
  const raw = fs.readFileSync(databasePath);
  assert.equal(raw.includes(Buffer.from('token-che-non-deve-apparire')), false);
});
