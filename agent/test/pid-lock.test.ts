import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentError } from '../src/errors.js';
import { PidLock } from '../src/pid-lock.js';

test('impedisce due Agent concorrenti e sostituisce un PID stale', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-pid-'));
  const file = path.join(root, 'agent.pid');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = PidLock.acquire(file);
  assert.throws(() => PidLock.acquire(file), (error: unknown) => error instanceof AgentError && error.code === 'agent_already_running');
  lock.release();
  fs.writeFileSync(file, '2147483647\n');
  const replacement = PidLock.acquire(file);
  assert.equal(Number(fs.readFileSync(file, 'utf8').trim()), process.pid);
  replacement.release();
});
