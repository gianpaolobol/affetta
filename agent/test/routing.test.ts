import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalAffettaClient } from '../src/local-affetta-client.js';
import { AgentError } from '../src/errors.js';
import type { JobRequestV1 } from '../src/types.js';
import { startMockLocal } from './support/mocks.js';
import { testConfig } from './support/test-config.js';

function request(overrides: Partial<JobRequestV1> = {}): JobRequestV1 {
  return {
    schema_version: 'affetta.job.v1', request_id: 'req_route_01', idempotency_key: 'route-key-01',
    source: 'test', operation: 'slice',
    input: { artifact_id: 'art_route_01', filename: 'cubo.stl', format: 'stl', sha256: 'a'.repeat(64), size_bytes: 4 },
    print_intent: { material_id: 'pla', quality_id: 'standard', strength_id: 'standard', color_id: 'black', quantity: 1 },
    routing: { mode: 'manual', require_production_ready: false, printer_profile_id: 'thing-o-matic', fleet_unit_id: 'thing-o-matic-01' },
    ...overrides
  };
}

test('blocca una unità sperimentale quando require_production_ready è true', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-routing-'));
  const local = await startMockLocal();
  t.after(async () => { await local.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const client = new LocalAffettaClient(testConfig(root, 'http://127.0.0.1:9', local.baseUrl));
  const input = path.join(root, 'cubo.stl');
  fs.writeFileSync(input, 'test');
  await assert.rejects(
    client.createJob(request({ routing: { mode: 'manual', require_production_ready: true, printer_profile_id: 'thing-o-matic', fleet_unit_id: 'thing-o-matic-01' } }), input),
    (error: unknown) => error instanceof AgentError && error.code === 'fleet_unit_not_production_ready'
  );
  assert.equal(local.createCount(), 0);
});

test('rifiuta formati non supportati dall’adapter locale 0.5.2', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-format-'));
  const local = await startMockLocal();
  t.after(async () => { await local.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const client = new LocalAffettaClient(testConfig(root, 'http://127.0.0.1:9', local.baseUrl));
  const input = path.join(root, 'modello.obj');
  fs.writeFileSync(input, 'test');
  const base = request();
  await assert.rejects(
    client.createJob({ ...base, input: { ...base.input, filename: 'modello.obj', format: 'obj' } }, input),
    (error: unknown) => error instanceof AgentError && error.code === 'local_input_format_unsupported'
  );
});
