import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createBackendRuntime } from '../src/factory.js';
import { loadConfig } from '../src/config.js';
import { MemoryArtifactStorage, MemoryBackendRepository, MemoryReadyQueue } from '../src/adapters/memory.js';
import { StructuralContractValidator } from '../src/contracts.js';
import { sha256 } from '../src/crypto.js';
import type { Clock, IdFactory, TokenFactory } from '../src/types.js';
import { openApiDocument } from '../src/openapi.js';

class MutableClock implements Clock {
  constructor(private value = new Date('2026-08-03T00:00:00.000Z')) {}
  now(): Date { return new Date(this.value); }
  advanceHours(hours: number): void { this.value = new Date(this.value.getTime() + hours * 3_600_000); }
}

class SequenceIds implements IdFactory {
  private value = 0;
  create(prefix: string): string {
    this.value += 1;
    return `${prefix}_${String(this.value).padStart(6, '0')}`;
  }
}

class SequenceTokens implements TokenFactory {
  private value = 0;
  create(): string {
    this.value += 1;
    return `tok_${String(this.value).padStart(4, '0')}_${'x'.repeat(40)}`;
  }
}

async function fixture(overrides: Record<string, string> = {}) {
  const clock = new MutableClock();
  const repository = new MemoryBackendRepository();
  const config = loadConfig({
    AFFETTA_BACKEND_MODE: 'memory',
    AFFETTA_ALLOW_INSECURE_MEMORY_DEFAULTS: 'true',
    AFFETTA_BETA_ENABLED: 'true',
    AFFETTA_BETA_EXPOSE_DEV_TOKENS: 'true',
    AFFETTA_BETA_VERIFICATION_TTL_HOURS: '24',
    AFFETTA_BETA_SESSION_TTL_HOURS: '168',
    ...overrides
  });
  const queue = new MemoryReadyQueue();
  const storage = new MemoryArtifactStorage();
  const runtime = await createBackendRuntime(config, {
    repository,
    queue,
    storage,
    validator: new StructuralContractValidator(),
    clock,
    ids: new SequenceIds(),
    tokens: new SequenceTokens()
  });
  return { ...runtime, repository, queue, storage, clock };
}

const registration = {
  display_name: 'Ada Maker',
  username: 'ada.maker',
  email: 'ADA@example.test',
  phone_e164: '+393331234567',
  password: 'Una-password-lunga-2026',
  terms_accepted: true
};

async function registerVerifyLogin(context: Awaited<ReturnType<typeof fixture>>) {
  const registered = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: registration });
  assert.equal(registered.statusCode, 201);
  const token = (registered.body as { dev_verification_token: string }).dev_verification_token;
  assert.ok(token);
  const verified = await context.api.inject({ method: 'POST', path: '/v1/beta/verify-email', body: { token } });
  assert.equal(verified.statusCode, 200);
  const login = await context.api.inject({ method: 'POST', path: '/v1/beta/login', body: {
    email: registration.email,
    password: registration.password
  }});
  assert.equal(login.statusCode, 200);
  return (login.body as { access_token: string }).access_token;
}



function betaCapabilities(agentId: string) {
  return {
    schema_version: 'affetta.agent-capabilities.v1', agent_id: agentId,
    observed_at: '2026-08-03T00:00:00.000Z', status: 'online', affetta_version: '0.5.2',
    protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1'], active_jobs: 0,
    disk_free_bytes: 1_000_000_000,
    platform: { os: 'windows', arch: 'x64', node_version: 'v24.16.0', hostname_hash: 'a'.repeat(64) },
    engines: [{ id: 'orca', available: true, version: '2.3.0' }], postprocessors: [], output_formats: ['gcode'],
    printer_profiles: [{
      profile_id: 'bambu-x1c', profile_version: '2.3.1', profile_sha256: 'b'.repeat(64),
      profile_status: 'validated', output_format: 'gcode', materials: ['pla'], nozzles_mm: [0.4],
      production_ready: true, physical_validation: 'passed', fleet_unit_id: 'x1c-01'
    }], capability_sha256: 'c'.repeat(64)
  };
}

async function prepareBetaInput(context: Awaited<ReturnType<typeof fixture>>, access: string, content = 'solid beta cube') {
  const bytes = Buffer.from(content);
  const hash = sha256(bytes);
  const prepare = await context.api.inject({ method: 'POST', path: '/v1/beta/artifacts/prepare-upload',
    headers: { authorization: `Bearer ${access}` }, body: {
      filename: 'beta-cube.stl', format: 'stl', sha256: hash, size_bytes: bytes.length
    }});
  assert.equal(prepare.statusCode, 201);
  const artifact = (prepare.body as { artifact: { id: string; storage_key: string; retention_until: string } }).artifact;
  context.storage.put(artifact.storage_key, bytes);
  const complete = await context.api.inject({ method: 'POST', path: `/v1/beta/artifacts/${artifact.id}/upload-complete`,
    headers: { authorization: `Bearer ${access}` }, body: { sha256: hash, size_bytes: bytes.length } });
  assert.equal(complete.statusCode, 200);
  return { artifact, bytes, hash };
}

function betaJobBody(artifactId: string, idempotencyKey: string) {
  return {
    artifact_id: artifactId, idempotency_key: idempotencyKey,
    material_id: 'pla', quality_id: 'standard', strength_id: 'standard', color_id: 'random',
    quantity: 1, nozzle_mm: 0.4
  };
}

test('espone pagina beta e limiti Free senza mostrare il motore come scelta base', async () => {
  const context = await fixture();
  try {
    const page = await context.api.inject({ method: 'GET', path: '/beta/' });
    assert.equal(page.statusCode, 200);
    assert.match(String(page.body), /AFFETTA <span>BETA<\/span>/);
    assert.match(String(page.body), /nasconde motore e post-processori/);
    assert.match(String(page.body), /Nessun comando viene inviato alla stampante/);
    assert.match(String(page.body), /\bid="file"/);
    assert.match(String(page.body), /\bid="jobs"/);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');

    const limits = await context.api.inject({ method: 'GET', path: '/v1/beta/limits' });
    assert.deepEqual(limits.body, {
      plan: 'free', daily_jobs: 5, max_input_bytes: 50_000_000,
      retention_hours: 24, max_agents: 1, sla: false, enforcement_stage: 'enforced-p4.2'
    });
  } finally { await context.close(); }
});

test('registra un account personale senza esporre hash password', async () => {
  const context = await fixture();
  try {
    const response = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: registration });
    assert.equal(response.statusCode, 201);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.verification_required, true);
    assert.equal(body.verification_delivery, 'email_outbox');
    assert.match(String(body.dev_verification_token), /^tok_/);
    assert.doesNotMatch(JSON.stringify(body), /password_hash|Una-password/);
    assert.match(JSON.stringify(body), /ada@example\.test/);
  } finally { await context.close(); }
});

test('impedisce login prima della verifica e abilita sessione dopo la verifica', async () => {
  const context = await fixture();
  try {
    const registered = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: registration });
    const before = await context.api.inject({ method: 'POST', path: '/v1/beta/login', body: {
      email: registration.email, password: registration.password
    }});
    assert.equal(before.statusCode, 403);
    assert.equal((before.body as { error: { code: string } }).error.code, 'email_not_verified');

    const token = (registered.body as { dev_verification_token: string }).dev_verification_token;
    assert.equal((await context.api.inject({ method: 'POST', path: '/v1/beta/verify-email', body: { token } })).statusCode, 200);
    const login = await context.api.inject({ method: 'POST', path: '/v1/beta/login', body: {
      email: 'ada@example.test', password: registration.password
    }});
    assert.equal(login.statusCode, 200);
    const access = (login.body as { access_token: string }).access_token;
    const me = await context.api.inject({ method: 'GET', path: '/v1/beta/me', headers: { authorization: `Bearer ${access}` } });
    assert.equal(me.statusCode, 200);
    assert.match(JSON.stringify(me.body), /Ada Maker/);
  } finally { await context.close(); }
});

test('rifiuta duplicati email e username in modo distinto', async () => {
  const context = await fixture();
  try {
    assert.equal((await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: registration })).statusCode, 201);
    const emailDuplicate = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: {
      ...registration, username: 'altra-persona'
    }});
    assert.equal(emailDuplicate.statusCode, 409);
    assert.equal((emailDuplicate.body as { error: { code: string } }).error.code, 'beta_email_exists');

    const usernameDuplicate = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: {
      ...registration, email: 'altra@example.test'
    }});
    assert.equal(usernameDuplicate.statusCode, 409);
    assert.equal((usernameDuplicate.body as { error: { code: string } }).error.code, 'beta_username_exists');
  } finally { await context.close(); }
});

test('valida password, cellulare e accettazione termini', async () => {
  const context = await fixture();
  try {
    const shortPassword = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: { ...registration, password: 'corta' } });
    assert.equal(shortPassword.statusCode, 422);
    const phone = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: { ...registration, phone_e164: '3331234567' } });
    assert.equal((phone.body as { error: { code: string } }).error.code, 'invalid_phone');
    const terms = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: { ...registration, terms_accepted: false } });
    assert.equal((terms.body as { error: { code: string } }).error.code, 'terms_required');
  } finally { await context.close(); }
});

test('salva il profilo costi personale con valori numerici controllati', async () => {
  const context = await fixture();
  try {
    const access = await registerVerifyLogin(context);
    const updated = await context.api.inject({ method: 'PATCH', path: '/v1/beta/me/cost-profile',
      headers: { authorization: `Bearer ${access}` }, body: {
        display_name: 'Ada Service',
        cost_profile: {
          energy_eur_per_kwh: 0.42,
          machine_hour_eur: 3.5,
          labor_hour_eur: 31,
          material_markup_percent: 27.5
        }
      }});
    assert.equal(updated.statusCode, 200);
    assert.match(JSON.stringify(updated.body), /Ada Service/);
    assert.match(JSON.stringify(updated.body), /27\.5/);

    const invalid = await context.api.inject({ method: 'PATCH', path: '/v1/beta/me/cost-profile',
      headers: { authorization: `Bearer ${access}` }, body: {
        cost_profile: { energy_eur_per_kwh: -1, machine_hour_eur: 3, labor_hour_eur: 10, material_markup_percent: 20 }
      }});
    assert.equal(invalid.statusCode, 422);
    assert.equal((invalid.body as { error: { code: string } }).error.code, 'invalid_cost_profile');
  } finally { await context.close(); }
});

test('logout revoca immediatamente la sessione beta', async () => {
  const context = await fixture();
  try {
    const access = await registerVerifyLogin(context);
    const logout = await context.api.inject({ method: 'POST', path: '/v1/beta/logout', headers: { authorization: `Bearer ${access}` } });
    assert.equal(logout.statusCode, 200);
    const me = await context.api.inject({ method: 'GET', path: '/v1/beta/me', headers: { authorization: `Bearer ${access}` } });
    assert.equal(me.statusCode, 401);
    assert.equal((me.body as { error: { code: string } }).error.code, 'invalid_beta_session');
  } finally { await context.close(); }
});

test('token email e sessioni scadono secondo configurazione', async () => {
  const context = await fixture({ AFFETTA_BETA_VERIFICATION_TTL_HOURS: '1', AFFETTA_BETA_SESSION_TTL_HOURS: '1' });
  try {
    const registered = await context.api.inject({ method: 'POST', path: '/v1/beta/register', body: registration });
    const verifyToken = (registered.body as { dev_verification_token: string }).dev_verification_token;
    context.clock.advanceHours(2);
    const expiredVerify = await context.api.inject({ method: 'POST', path: '/v1/beta/verify-email', body: { token: verifyToken } });
    assert.equal(expiredVerify.statusCode, 422);
  } finally { await context.close(); }

  const sessionContext = await fixture({ AFFETTA_BETA_SESSION_TTL_HOURS: '1' });
  try {
    const access = await registerVerifyLogin(sessionContext);
    sessionContext.clock.advanceHours(2);
    const expired = await sessionContext.api.inject({ method: 'GET', path: '/v1/beta/me', headers: { authorization: `Bearer ${access}` } });
    assert.equal(expired.statusCode, 401);
  } finally { await sessionContext.close(); }
});

test('produzione non espone token di verifica salvo opt-in esplicito', () => {
  const config = loadConfig({
    AFFETTA_BACKEND_MODE: 'production', DATABASE_URL: 'postgresql://example', REDIS_URL: 'redis://example',
    S3_ACCESS_KEY_ID: 'access', S3_SECRET_ACCESS_KEY: 'secret', AFFETTA_BOOTSTRAP_API_KEY: 'secret-api'
  });
  assert.equal(config.beta.exposeDevTokens, false);
});


test('OpenAPI pubblica gli endpoint beta e il bearer separato', () => {
  assert.ok(openApiDocument.components.securitySchemes.BetaBearer);
  assert.ok(openApiDocument.paths['/v1/beta/register']);
  assert.ok(openApiDocument.paths['/v1/beta/me/cost-profile']);
  assert.ok(openApiDocument.paths['/v1/beta/artifacts/prepare-upload']);
  assert.ok(openApiDocument.paths['/v1/beta/jobs']);
  assert.ok(openApiDocument.paths['/v1/beta/jobs/{id}/download']);
  assert.ok(openApiDocument.paths['/v1/beta/agents/pairing-code']);
});


test('applica dimensione massima e quota giornaliera Free senza contare i replay idempotenti', async () => {
  const context = await fixture({ AFFETTA_BETA_FREE_DAILY_JOBS: '1', AFFETTA_BETA_FREE_MAX_INPUT_BYTES: '100' });
  try {
    const access = await registerVerifyLogin(context);
    const oversized = await context.api.inject({ method: 'POST', path: '/v1/beta/artifacts/prepare-upload',
      headers: { authorization: `Bearer ${access}` }, body: {
        filename: 'large.stl', format: 'stl', sha256: 'a'.repeat(64), size_bytes: 101
      }});
    assert.equal(oversized.statusCode, 413);
    assert.equal((oversized.body as { error: { code: string } }).error.code, 'free_input_size_limit');

    const firstInput = await prepareBetaInput(context, access, 'first');
    const first = await context.api.inject({ method: 'POST', path: '/v1/beta/jobs',
      headers: { authorization: `Bearer ${access}` }, body: betaJobBody(firstInput.artifact.id, 'beta-idem-0001') });
    assert.equal(first.statusCode, 201);
    assert.deepEqual((first.body as { usage: unknown }).usage, {
      usage_date: '2026-08-03', jobs_used: 1, jobs_remaining: 0
    });

    const replay = await context.api.inject({ method: 'POST', path: '/v1/beta/jobs',
      headers: { authorization: `Bearer ${access}` }, body: betaJobBody(firstInput.artifact.id, 'beta-idem-0001') });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    assert.equal((replay.body as { usage: { jobs_used: number } }).usage.jobs_used, 1);

    const secondInput = await prepareBetaInput(context, access, 'second');
    const blocked = await context.api.inject({ method: 'POST', path: '/v1/beta/jobs',
      headers: { authorization: `Bearer ${access}` }, body: betaJobBody(secondInput.artifact.id, 'beta-idem-0002') });
    assert.equal(blocked.statusCode, 429);
    assert.equal((blocked.body as { error: { code: string } }).error.code, 'free_daily_job_limit');
  } finally { await context.close(); }
});


test('il job beta costruito dal backend rispetta lo schema JSON affetta.job.v1', async () => {
  const context = await fixture();
  try {
    const access = await registerVerifyLogin(context);
    const input = await prepareBetaInput(context, access, 'schema-contract');
    const created = await context.api.inject({ method: 'POST', path: '/v1/beta/jobs',
      headers: { authorization: `Bearer ${access}` }, body: betaJobBody(input.artifact.id, 'beta-schema-0001') });
    assert.equal(created.statusCode, 201);
    const jobId = (created.body as { job: { id: string } }).job.id;
    const stored = await context.repository.getJob(jobId);
    assert.ok(stored);
    const commonSchema = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../schemas/common-v1.schema.json'), 'utf8')) as {
      $defs: { source: { enum: string[] } }
    };
    assert.ok(commonSchema.$defs.source.enum.includes(stored.request.source));
    assert.equal(stored.request.source, 'beta-web');
    assert.equal(stored.request.routing.mode, 'automatic');
    assert.equal(stored.request.routing.require_production_ready, true);
    assert.equal(stored.request.print_intent.requested_output_format, 'gcode');
  } finally { await context.close(); }
});

test('pairing beta rispetta il limite di un Agent e consente revoca dal tenant personale', async () => {
  const context = await fixture();
  try {
    const access = await registerVerifyLogin(context);
    const auth = { authorization: `Bearer ${access}` };
    const pairing = await context.api.inject({ method: 'POST', path: '/v1/beta/agents/pairing-code', headers: auth, body: {} });
    assert.equal(pairing.statusCode, 201);
    const code = (pairing.body as { pairing_code: string }).pairing_code;
    const pair = await context.api.inject({ method: 'POST', path: '/v1/agents/pair', body: {
      pairing_code: code, installation_id: 'beta_install_01', name: 'Agent beta', hostname_hash: 'd'.repeat(64),
      platform: { os: 'win32', arch: 'x64', node_version: 'v24.16.0' },
      protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1']
    }});
    assert.equal(pair.statusCode, 200);
    const paired = pair.body as { agent_id: string; access_token: string };

    const blocked = await context.api.inject({ method: 'POST', path: '/v1/beta/agents/pairing-code', headers: auth, body: {} });
    assert.equal(blocked.statusCode, 409);
    assert.equal((blocked.body as { error: { code: string } }).error.code, 'free_agent_limit');

    const listed = await context.api.inject({ method: 'GET', path: '/v1/beta/agents', headers: auth });
    assert.equal((listed.body as { agents: unknown[] }).agents.length, 1);
    assert.doesNotMatch(JSON.stringify(listed.body), /access_token|token_hash/);

    const revoked = await context.api.inject({ method: 'POST', path: `/v1/beta/agents/${paired.agent_id}/revoke`, headers: auth, body: {} });
    assert.equal(revoked.statusCode, 200);
    const after = await context.api.inject({ method: 'POST', path: '/v1/beta/agents/pairing-code', headers: auth, body: {} });
    assert.equal(after.statusCode, 201);
  } finally { await context.close(); }
});

test('flusso beta completo crea job, viene lavorato da Agent e restituisce download firmato', async () => {
  const context = await fixture();
  try {
    const access = await registerVerifyLogin(context);
    const auth = { authorization: `Bearer ${access}` };
    const pairing = await context.api.inject({ method: 'POST', path: '/v1/beta/agents/pairing-code', headers: auth, body: {} });
    const pairingCode = (pairing.body as { pairing_code: string }).pairing_code;
    const pair = await context.api.inject({ method: 'POST', path: '/v1/agents/pair', body: {
      pairing_code: pairingCode, installation_id: 'beta_worker_01', name: 'Worker beta', hostname_hash: 'e'.repeat(64),
      platform: { os: 'win32', arch: 'x64', node_version: 'v24.16.0' },
      protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1']
    }});
    const agent = pair.body as { agent_id: string; access_token: string };
    assert.equal((await context.api.inject({ method: 'POST', path: `/v1/agents/${agent.agent_id}/heartbeat`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: betaCapabilities(agent.agent_id) })).statusCode, 200);

    const input = await prepareBetaInput(context, access);
    const created = await context.api.inject({ method: 'POST', path: '/v1/beta/jobs', headers: auth,
      body: betaJobBody(input.artifact.id, 'beta-full-0001') });
    assert.equal(created.statusCode, 201);
    const jobId = (created.body as { job: { id: string } }).job.id;

    const earlyDownload = await context.api.inject({ method: 'GET', path: `/v1/beta/jobs/${jobId}/download`, headers: auth });
    assert.equal(earlyDownload.statusCode, 409);

    const leased = await context.api.inject({ method: 'POST', path: `/v1/agents/${agent.agent_id}/lease`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { max_jobs: 1 } });
    const lease = (leased.body as { lease: {
      lease_id: string; request: { request_id: string; idempotency_key: string };
      output_upload: { artifact_id: string }
    } }).lease;
    assert.ok(lease);
    assert.equal((await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/ack`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { lease_id: lease.lease_id } })).statusCode, 200);

    const output = await context.repository.getArtifact(lease.output_upload.artifact_id);
    assert.ok(output);
    assert.equal(output.retention_until, '2026-08-04T00:00:00.000Z');
    const gcode = Buffer.from('G28\nG1 X10 Y10\n');
    const outputHash = sha256(gcode);
    context.storage.put(output.storage_key, gcode);
    assert.equal((await context.api.inject({ method: 'POST', path: `/v1/artifacts/${output.id}/upload-complete`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: {
        job_id: jobId, lease_id: lease.lease_id, sha256: outputHash, size_bytes: gcode.length
      }})).statusCode, 200);

    const result = {
      schema_version: 'affetta.result.v1', job_id: jobId, request_id: lease.request.request_id,
      idempotency_key: lease.request.idempotency_key, status: 'completed', updated_at: context.clock.now().toISOString(),
      result: {
        printer_profile_id: 'bambu-x1c', printer_profile_version: '2.3.1', printer_profile_sha256: 'b'.repeat(64),
        profile_status: 'validated', fleet_unit_id: 'x1c-01', engine: { id: 'orca', version: '2.3.0' },
        output_format: 'gcode', time_seconds: 60, filament: { grams: 2, millimeters: 600 },
        validation: { valid: true, warnings: [], observed: {} },
        artifacts: [{ artifact_id: output.id, type: 'gcode', format: 'gcode', sha256: outputHash, size_bytes: gcode.length, media_type: 'text/x.gcode' }]
      }
    };
    const completed = await context.api.inject({ method: 'POST', path: `/v1/jobs/${jobId}/complete`,
      headers: { authorization: `Bearer ${agent.access_token}` }, body: { lease_id: lease.lease_id, result } });
    assert.equal(completed.statusCode, 200);

    const status = await context.api.inject({ method: 'GET', path: `/v1/beta/jobs/${jobId}`, headers: auth });
    assert.equal((status.body as { job: { status: string; download_ready: boolean } }).job.status, 'completed');
    assert.equal((status.body as { job: { download_ready: boolean } }).job.download_ready, true);
    assert.doesNotMatch(JSON.stringify(status.body), /lease_id|assigned_agent_id/);

    const download = await context.api.inject({ method: 'GET', path: `/v1/beta/jobs/${jobId}/download`, headers: auth });
    assert.equal(download.statusCode, 200);
    assert.equal((download.body as { sha256: string }).sha256, outputHash);
    assert.match((download.body as { filename: string }).filename, /beta-cube\.gcode$/);
    assert.match((download.body as { download: { url: string } }).download.url, /^https:\/\/storage\.affetta\.test\//);
  } finally { await context.close(); }
});
