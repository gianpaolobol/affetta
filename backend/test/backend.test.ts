import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackendRuntime } from '../src/factory.js';
import { loadConfig } from '../src/config.js';
import { MemoryArtifactStorage, MemoryBackendRepository, MemoryReadyQueue } from '../src/adapters/memory.js';
import { StructuralContractValidator } from '../src/contracts.js';
import { sha256 } from '../src/crypto.js';
import type { Clock, IdFactory, TokenFactory } from '../src/types.js';

class MutableClock implements Clock {
  constructor(private value = new Date('2026-08-02T18:00:00.000Z')) {}
  now(): Date { return new Date(this.value); }
  advance(seconds: number): void { this.value = new Date(this.value.getTime() + seconds * 1000); }
}
class SequenceFactory implements IdFactory, TokenFactory {
  private value = 0;
  create(prefixOrBytes?: string | number): string {
    this.value += 1;
    return typeof prefixOrBytes === 'string' ? `${prefixOrBytes}_${String(this.value).padStart(4, '0')}` : `token_${String(this.value).padStart(4, '0')}`;
  }
}

async function fixture() {
  const clock = new MutableClock();
  const sequence = new SequenceFactory();
  const repository = new MemoryBackendRepository();
  const queue = new MemoryReadyQueue();
  const storage = new MemoryArtifactStorage();
  const config = loadConfig({
    AFFETTA_BACKEND_MODE: 'memory',
    AFFETTA_ALLOW_INSECURE_MEMORY_DEFAULTS: 'true',
    AFFETTA_JOB_MAX_ATTEMPTS: '2',
    AFFETTA_RETRY_BASE_SECONDS: '30'
  });
  const runtime = await createBackendRuntime(config, {
    repository, queue, storage, validator: new StructuralContractValidator(), clock, ids: sequence, tokens: sequence
  });
  return { ...runtime, repository, queue, storage, clock, apiKey: 'affetta-dev-api-key-change-me', pairingCode: 'AFFETTA-DEV-PAIR' };
}

function capabilities(agentId: string, productionReady = true) {
  return {
    schema_version: 'affetta.agent-capabilities.v1',
    agent_id: agentId,
    observed_at: '2026-08-02T18:00:00.000Z',
    status: 'online',
    affetta_version: '0.5.2',
    protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1'],
    active_jobs: 0,
    disk_free_bytes: 1000000000,
    platform: { os: 'windows', arch: 'x64', node_version: 'v24.16.0', hostname_hash: 'a'.repeat(64) },
    engines: [{ id: 'orca', available: true, version: '2.3.0' }, { id: 'cura', available: true, version: '5.13.0' }],
    postprocessors: [{ id: 'gpx', available: true, version: '2.6.8' }],
    output_formats: ['gcode', 'x3g'],
    printer_profiles: [{
      profile_id: 'bambu-x1c-04', profile_version: '2.3.1', profile_sha256: 'b'.repeat(64),
      profile_status: 'validated', output_format: 'gcode', materials: ['petg'], nozzles_mm: [0.4],
      production_ready: productionReady, physical_validation: productionReady ? 'passed' : 'pending', fleet_unit_id: 'x1c-01'
    }],
    capability_sha256: 'c'.repeat(64)
  };
}

async function pairAndHeartbeat(context: Awaited<ReturnType<typeof fixture>>, installation = 'install_test_01') {
  const pair = await context.api.inject({ method: 'POST', path: '/v1/agents/pair', body: {
    pairing_code: context.pairingCode, installation_id: installation, name: 'Agent test',
    hostname_hash: 'd'.repeat(64), platform: { os: 'win32', arch: 'x64', node_version: 'v24.16.0' },
    protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1']
  }});
  assert.equal(pair.statusCode, 200);
  const paired = pair.body as { agent_id: string; access_token: string };
  const heartbeat = await context.api.inject({ method: 'POST', path: `/v1/agents/${paired.agent_id}/heartbeat`,
    headers: { authorization: `Bearer ${paired.access_token}` }, body: capabilities(paired.agent_id) });
  assert.equal(heartbeat.statusCode, 200);
  return paired;
}

async function createVerifiedInput(context: Awaited<ReturnType<typeof fixture>>, content = 'solid cube') {
  const buffer = Buffer.from(content);
  const hash = sha256(buffer);
  const prepare = await context.api.inject({ method: 'POST', path: '/v1/artifacts/prepare-upload',
    headers: { 'x-api-key': context.apiKey }, body: {
      filename: 'cube.stl', format: 'stl', type: 'model', sha256: hash, size_bytes: buffer.length,
      media_type: 'model/stl'
    }});
  assert.equal(prepare.statusCode, 201);
  const artifact = (prepare.body as { artifact: { id: string; storage_key: string } }).artifact;
  context.storage.put(artifact.storage_key, buffer);
  const complete = await context.api.inject({ method: 'POST', path: `/v1/artifacts/${artifact.id}/upload-complete`,
    headers: { 'x-api-key': context.apiKey }, body: { sha256: hash, size_bytes: buffer.length } });
  assert.equal(complete.statusCode, 200);
  return { artifactId: artifact.id, sha256: hash, sizeBytes: buffer.length };
}

function jobRequest(input: { artifactId: string; sha256: string; sizeBytes: number }, key = 'idem-001') {
  return {
    schema_version: 'affetta.job.v1', request_id: `req_${key}`, idempotency_key: key,
    source: 'stampa3dbologna', operation: 'slice',
    input: { artifact_id: input.artifactId, filename: 'cube.stl', format: 'stl', sha256: input.sha256, size_bytes: input.sizeBytes },
    print_intent: { material_id: 'petg', quality_id: 'standard', strength_id: 'strong', color_id: 'black', quantity: 1, nozzle_mm: 0.4, requested_output_format: 'gcode' },
    routing: { mode: 'automatic', require_production_ready: true }
  };
}

async function createJob(context: Awaited<ReturnType<typeof fixture>>, key = 'idem-001') {
  const input = await createVerifiedInput(context, `model-${key}`);
  const response = await context.api.inject({ method: 'POST', path: '/v1/jobs', headers: { 'x-api-key': context.apiKey }, body: jobRequest(input, key) });
  assert.equal(response.statusCode, 201);
  return (response.body as { job: { id: string } }).job.id;
}

test('pairing, heartbeat, lease e completamento G-code sono compatibili con Agent P2', async () => {
  const context = await fixture();
  try {
    const agent = await pairAndHeartbeat(context);
    const jobId = await createJob(context);
    const leaseResponse = await context.api.inject({ method: 'POST', path: `/v1/agents/${agent.agent_id}/lease`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { max_jobs: 1 } });
    assert.equal(leaseResponse.statusCode, 200);
    const lease = (leaseResponse.body as { lease: { lease_id: string; output_upload: { artifact_id: string } } }).lease;
    assert.ok(lease);

    assert.equal((await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/ack`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { lease_id: lease.lease_id } })).statusCode, 200);
    assert.equal((await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/progress`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: {
        lease_id: lease.lease_id, status: 'slicing', stage: 'slice', progress_percent: 50, message: 'Slicing'
      } })).statusCode, 200);

    const output = await context.repository.getArtifact(lease.output_upload.artifact_id);
    assert.ok(output);
    const bytes = Buffer.from('G1 X10 Y10\n');
    context.storage.put(output.storage_key, bytes);
    const outputHash = sha256(bytes);
    assert.equal((await context.api.inject({ method: 'POST', path: `/v1/artifacts/${output.id}/upload-complete`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: {
        job_id: jobId, lease_id: lease.lease_id, sha256: outputHash, size_bytes: bytes.length
      } })).statusCode, 200);

    const result = {
      schema_version: 'affetta.result.v1', job_id: jobId,
      request_id: 'req_idem-001', idempotency_key: 'idem-001',
      status: 'completed', updated_at: context.clock.now().toISOString(),
      result: {
        printer_profile_id: 'bambu-x1c-04', printer_profile_version: '2.3.1', printer_profile_sha256: 'b'.repeat(64),
        profile_status: 'validated', fleet_unit_id: 'x1c-01', engine: { id: 'orca', version: '2.3.0' },
        output_format: 'gcode', time_seconds: 120, filament: { grams: 5, millimeters: 1700 },
        validation: { valid: true, warnings: [], observed: {} },
        artifacts: [{ artifact_id: output.id, type: 'gcode', format: 'gcode', sha256: outputHash, size_bytes: bytes.length, media_type: 'text/x.gcode' }]
      }
    };
    const complete = await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/complete`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { lease_id: lease.lease_id, result } });
    assert.equal(complete.statusCode, 200);
    assert.deepEqual(complete.body, { completed: true, idempotent: false });
    const duplicate = await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/complete`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { lease_id: lease.lease_id, result } });
    assert.deepEqual(duplicate.body, { completed: true, idempotent: true });
  } finally { await context.close(); }
});

test('creazione job è idempotente per organizzazione e idempotency_key', async () => {
  const context = await fixture();
  try {
    const input = await createVerifiedInput(context);
    const request = jobRequest(input, 'same-key');
    const first = await context.api.inject({ method: 'POST', path: '/v1/jobs', headers: { 'x-api-key': context.apiKey }, body: request });
    const second = await context.api.inject({ method: 'POST', path: '/v1/jobs', headers: { 'x-api-key': context.apiKey }, body: request });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal((first.body as { job: { id: string } }).job.id, (second.body as { job: { id: string } }).job.id);
    assert.equal(second.headers['idempotency-replayed'], 'true');
  } finally { await context.close(); }
});

test('due Agent concorrenti non ricevono lo stesso job', async () => {
  const context = await fixture();
  try {
    const first = await pairAndHeartbeat(context, 'install_a');
    const second = await pairAndHeartbeat(context, 'install_b');
    await createJob(context, 'race');
    const leases = await Promise.all([first, second].map((agent) => context.api.inject({ method: 'POST', path: `/v1/agents/${agent.agent_id}/lease`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { max_jobs: 1 } })));
    const nonNull = leases.filter((item) => (item.body as { lease: unknown }).lease !== null);
    assert.equal(nonNull.length, 1);
  } finally { await context.close(); }
});

test('errore retryable torna in coda e al secondo fallimento entra in dead letter', async () => {
  const context = await fixture();
  try {
    const agent = await pairAndHeartbeat(context);
    const jobId = await createJob(context, 'retry');
    const firstLease = (await context.api.inject({ method: 'POST', path: `/v1/agents/${agent.agent_id}/lease`, headers: { authorization: `Bearer ${agent.access_token}` }, body: { max_jobs: 1 } })).body as { lease: { lease_id: string } };
    const failed = await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/fail`, headers: { authorization: `Bearer ${agent.access_token}` }, body: {
      lease_id: firstLease.lease.lease_id, error: { code: 'engine_busy', message: 'Busy', stage: 'slicing', retryable: true, details: {} }
    }});
    assert.equal((failed.body as { status: string }).status, 'retrying');
    context.clock.advance(31);
    const secondLease = (await context.api.inject({ method: 'POST', path: `/v1/agents/${agent.agent_id}/lease`, headers: { authorization: `Bearer ${agent.access_token}` }, body: { max_jobs: 1 } })).body as { lease: { lease_id: string } };
    assert.ok(secondLease.lease);
    const final = await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/fail`, headers: { authorization: `Bearer ${agent.access_token}` }, body: {
      lease_id: secondLease.lease.lease_id, error: { code: 'validation_failed', message: 'Invalid', stage: 'validating', retryable: false, details: {} }
    }});
    assert.equal((final.body as { status: string }).status, 'failed');
    assert.ok((await context.repository.getJob(jobId))?.dead_letter_at);
  } finally { await context.close(); }
});

test('job non assegnato viene cancellato immediatamente', async () => {
  const context = await fixture();
  try {
    const jobId = await createJob(context, 'cancel');
    const cancelled = await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/cancel`, headers: { 'x-api-key': context.apiKey }, body: {} });
    assert.equal((cancelled.body as { job: { status: string } }).job.status, 'cancelled');
  } finally { await context.close(); }
});

test('checksum errato impedisce la verifica artefatto', async () => {
  const context = await fixture();
  try {
    const bytes = Buffer.from('correct');
    const prepare = await context.api.inject({ method: 'POST', path: '/v1/artifacts/prepare-upload', headers: { 'x-api-key': context.apiKey }, body: {
      filename: 'bad.stl', format: 'stl', sha256: sha256(bytes), size_bytes: bytes.length
    }});
    const artifact = (prepare.body as { artifact: { id: string; storage_key: string } }).artifact;
    context.storage.put(artifact.storage_key, 'wrong!!');
    const result = await context.api.inject({ method: 'POST', path: `/v1/artifacts/${artifact.id}/upload-complete`, headers: { 'x-api-key': context.apiKey }, body: {
      sha256: sha256(bytes), size_bytes: bytes.length
    }});
    assert.equal(result.statusCode, 422);
    assert.equal((result.body as { error: { code: string } }).error.code, 'artifact_checksum_mismatch');
  } finally { await context.close(); }
});

test('profilo non production_ready viene escluso quando richiesto', async () => {
  const context = await fixture();
  try {
    const pair = await pairAndHeartbeat(context);
    await context.api.inject({ method: 'POST', path: `/v1/agents/${pair.agent_id}/heartbeat`, headers: { authorization: `Bearer ${pair.access_token}` }, body: capabilities(pair.agent_id, false) });
    await createJob(context, 'not-ready');
    const lease = await context.api.inject({ method: 'POST', path: `/v1/agents/${pair.agent_id}/lease`, headers: { authorization: `Bearer ${pair.access_token}` }, body: { max_jobs: 1 } });
    assert.equal((lease.body as { lease: unknown }).lease, null);
  } finally { await context.close(); }
});

test('revoca Agent invalida immediatamente il bearer token', async () => {
  const context = await fixture();
  try {
    const pair = await pairAndHeartbeat(context);
    const revoked = await context.api.inject({ method: 'POST', path: `/v1/agents/${pair.agent_id}/revoke`, headers: { 'x-api-key': context.apiKey }, body: {} });
    assert.equal(revoked.statusCode, 200);
    const heartbeat = await context.api.inject({ method: 'POST', path: `/v1/agents/${pair.agent_id}/heartbeat`, headers: { authorization: `Bearer ${pair.access_token}` }, body: capabilities(pair.agent_id) });
    assert.equal(heartbeat.statusCode, 401);
  } finally { await context.close(); }
});

test('configura endpoint S3 interno e pubblico separati', () => {
  const config = loadConfig({
    AFFETTA_BACKEND_MODE: 'production',
    DATABASE_URL: 'postgresql://affetta:secret@postgres:5432/affetta',
    REDIS_URL: 'redis://redis:6379',
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    AFFETTA_BOOTSTRAP_API_KEY: 'api-key'
  });
  assert.equal(config.s3.endpoint, 'http://minio:9000');
  assert.equal(config.s3.publicEndpoint, 'http://127.0.0.1:9000');
});
