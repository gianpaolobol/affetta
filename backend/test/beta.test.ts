import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackendRuntime } from '../src/factory.js';
import { loadConfig } from '../src/config.js';
import { MemoryArtifactStorage, MemoryBackendRepository, MemoryReadyQueue } from '../src/adapters/memory.js';
import { StructuralContractValidator } from '../src/contracts.js';
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
  const runtime = await createBackendRuntime(config, {
    repository,
    queue: new MemoryReadyQueue(),
    storage: new MemoryArtifactStorage(),
    validator: new StructuralContractValidator(),
    clock,
    ids: new SequenceIds(),
    tokens: new SequenceTokens()
  });
  return { ...runtime, repository, clock };
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

test('espone pagina beta e limiti Free senza mostrare il motore come scelta base', async () => {
  const context = await fixture();
  try {
    const page = await context.api.inject({ method: 'GET', path: '/beta/' });
    assert.equal(page.statusCode, 200);
    assert.match(String(page.body), /AFFETTA <span>BETA<\/span>/);
    assert.match(String(page.body), /Il pannello base non mostra Cura, Orca, Prusa o GPX/);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');

    const limits = await context.api.inject({ method: 'GET', path: '/v1/beta/limits' });
    assert.deepEqual(limits.body, {
      plan: 'free', daily_jobs: 5, max_input_bytes: 50_000_000,
      retention_hours: 24, max_agents: 1, sla: false, enforcement_stage: 'P4.2-job-workflow'
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
});
