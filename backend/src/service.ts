import { BackendError } from './errors.js';
import { sha256 } from './crypto.js';
import { hashPassword, normalizeEmail, validateEmail, validatePhoneE164, validateUsername, verifyPassword } from './beta-auth.js';
import { evaluateEligibility } from './eligibility.js';
import type { BackendConfig } from './config.js';
import type { MetricsRegistry } from './metrics.js';
import type {
  AgentCapabilitiesV1,
  AgentPrincipal,
  BetaAccountSnapshot,
  BetaCostProfile,
  BetaPrincipal,
  BetaProfileRecord,
  BetaSessionRecord,
  AgentRecord,
  ApiPrincipal,
  ArtifactRecord,
  ArtifactStorage,
  BackendRepository,
  Clock,
  ContractValidator,
  IdFactory,
  JobRecord,
  JobRequestV1,
  JobResultV1,
  LeaseEnvelope,
  PairingCodeRecord,
  Principal,
  ReadyQueue,
  StructuredError,
  TokenFactory
} from './types.js';

export interface BackendDependencies {
  config: BackendConfig;
  repository: BackendRepository;
  queue: ReadyQueue;
  storage: ArtifactStorage;
  validator: ContractValidator;
  clock: Clock;
  ids: IdFactory;
  tokens: TokenFactory;
  metrics: MetricsRegistry;
}

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

function iso(date: Date): string { return date.toISOString(); }
function plusSeconds(date: Date, seconds: number): string { return new Date(date.getTime() + seconds * 1000).toISOString(); }
function plusHours(date: Date, hours: number): string { return new Date(date.getTime() + hours * 3_600_000).toISOString(); }

const DEFAULT_BETA_COST_PROFILE: BetaCostProfile = {
  currency: 'EUR', energy_eur_per_kwh: 0.30, machine_hour_eur: 1.50,
  labor_hour_eur: 25, material_markup_percent: 20
};

function safeBetaAccount(account: BetaAccountSnapshot): Record<string, unknown> {
  return {
    user: {
      id: account.user.id, email: account.user.email, username: account.user.username,
      phone_e164: account.user.phone_e164, status: account.user.status,
      email_verified_at: account.user.email_verified_at, created_at: account.user.created_at
    },
    organization: account.organization,
    membership: { role: account.membership.role },
    profile: account.profile
  };
}

function betaNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BackendError('invalid_cost_profile', `${name} non valido.`, { statusCode: 422, details: { field: name, min, max } });
  }
  return Math.round(value * 10000) / 10000;
}

function requiredString(value: unknown, name: string, min = 1, max = 500): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new BackendError('invalid_request', `${name} non valido.`, { statusCode: 422, details: { field: name } });
  }
  return value;
}

function requiredInteger(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new BackendError('invalid_request', `${name} non valido.`, { statusCode: 422, details: { field: name } });
  }
  return Number(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BackendError('invalid_request', 'Body JSON non valido.', { statusCode: 422 });
  }
  return value as Record<string, unknown>;
}

export class BackendService {
  constructor(private readonly deps: BackendDependencies) {}

  async bootstrap(): Promise<{ api_key: string | null; pairing_code: string | null }> {
    const now = this.deps.clock.now();
    const config = this.deps.config;
    const apiKey = config.bootstrapApiKey ?? (config.allowInsecureMemoryDefaults ? 'affetta-dev-api-key-change-me' : null);
    const pairingCode = config.bootstrapPairingCode ?? (config.allowInsecureMemoryDefaults ? 'AFFETTA-DEV-PAIR' : null);
    if (!apiKey) {
      throw new BackendError('bootstrap_api_key_required', 'AFFETTA_BOOTSTRAP_API_KEY è obbligatoria.', { statusCode: 500 });
    }
    await this.deps.repository.ensureBootstrap({
      organization: {
        id: config.bootstrapOrganizationId,
        name: config.bootstrapOrganizationName,
        created_at: iso(now)
      },
      api_key: {
        id: this.deps.ids.create('key'),
        organization_id: config.bootstrapOrganizationId,
        name: 'bootstrap',
        key_hash: sha256(apiKey),
        scopes: ['jobs:read', 'jobs:write', 'artifacts:write', 'agents:manage'],
        revoked_at: null,
        created_at: iso(now)
      },
      ...(pairingCode ? {
        pairing_code: {
          id: this.deps.ids.create('pair'),
          organization_id: config.bootstrapOrganizationId,
          code_hash: sha256(pairingCode),
          name: 'bootstrap',
          expires_at: plusHours(now, 24 * 365),
          max_uses: 100,
          used_count: 0,
          revoked_at: null,
          created_at: iso(now)
        }
      } : {})
    });
    return { api_key: apiKey, pairing_code: pairingCode };
  }

  async health(): Promise<Record<string, unknown>> {
    const [database, queue, storage] = await Promise.all([
      this.deps.repository.health(), this.deps.queue.health(), this.deps.storage.health()
    ]);
    const ok = database.ok && queue.ok && storage.ok;
    return { ok, service: 'affetta-backend', version: '0.2.0', database, queue, storage };
  }

  async authenticateApiKey(rawKey: string | undefined): Promise<ApiPrincipal> {
    if (!rawKey) throw new BackendError('api_key_required', 'API key mancante.', { statusCode: 401 });
    const record = await this.deps.repository.findApiKeyByHash(sha256(rawKey));
    if (!record || record.revoked_at) throw new BackendError('invalid_api_key', 'API key non valida.', { statusCode: 401 });
    return { kind: 'api_key', organization_id: record.organization_id, api_key_id: record.id, scopes: record.scopes };
  }

  async authenticateAgent(rawToken: string | undefined, expectedAgentId?: string): Promise<AgentPrincipal> {
    if (!rawToken) throw new BackendError('agent_token_required', 'Token Agent mancante.', { statusCode: 401 });
    const record = await this.deps.repository.findAgentByTokenHash(sha256(rawToken));
    if (!record || record.revoked_at || record.status === 'revoked') {
      throw new BackendError('agent_revoked', 'Agent non autorizzato o revocato.', { statusCode: 401 });
    }
    if (expectedAgentId && record.id !== expectedAgentId) {
      throw new BackendError('agent_identity_mismatch', 'Il token non appartiene all’Agent richiesto.', { statusCode: 403 });
    }
    return { kind: 'agent', organization_id: record.organization_id, agent_id: record.id };
  }

  requireScope(principal: ApiPrincipal, scope: string): void {
    if (!principal.scopes.includes(scope)) {
      throw new BackendError('insufficient_scope', `Scope richiesto: ${scope}.`, { statusCode: 403 });
    }
  }

  private requireBetaEnabled(): void {
    if (!this.deps.config.beta.enabled) {
      throw new BackendError('beta_disabled', 'La beta web non è attiva.', { statusCode: 404 });
    }
  }

  betaLimits(): Record<string, unknown> {
    this.requireBetaEnabled();
    return {
      plan: 'free', daily_jobs: this.deps.config.beta.freeDailyJobs,
      max_input_bytes: this.deps.config.beta.freeMaxInputBytes,
      retention_hours: this.deps.config.beta.freeRetentionHours,
      max_agents: this.deps.config.beta.freeMaxAgents,
      sla: false, enforcement_stage: 'P4.2-job-workflow'
    };
  }

  async registerBeta(body: unknown): Promise<Record<string, unknown>> {
    this.requireBetaEnabled();
    const data = asObject(body);
    const email = validateEmail(requiredString(data.email, 'email', 5, 254));
    const username = validateUsername(requiredString(data.username, 'username', 3, 32));
    const phone = validatePhoneE164(requiredString(data.phone_e164, 'phone_e164', 8, 16));
    const displayName = requiredString(data.display_name, 'display_name', 2, 120).trim();
    const password = requiredString(data.password, 'password', 12, 200);
    if (data.terms_accepted !== true) {
      throw new BackendError('terms_required', 'È necessario accettare i termini della beta.', { statusCode: 422, details: { field: 'terms_accepted' } });
    }
    if (await this.deps.repository.findBetaUserByEmail(email)) {
      throw new BackendError('beta_email_exists', 'Esiste già un account con questa email.', { statusCode: 409 });
    }
    if (await this.deps.repository.findBetaUserByUsername(username)) {
      throw new BackendError('beta_username_exists', 'Username già utilizzato.', { statusCode: 409 });
    }

    const now = this.deps.clock.now();
    const nowIso = iso(now);
    const userId = this.deps.ids.create('usr');
    const organizationId = this.deps.ids.create('org');
    const verificationToken = this.deps.tokens.create(32);
    const account = await this.deps.repository.createBetaAccount({
      organization: { id: organizationId, name: `${displayName} — spazio personale`, created_at: nowIso },
      user: {
        id: userId, email, username, phone_e164: phone, password_hash: await hashPassword(password),
        status: 'pending_verification', email_verified_at: null, created_at: nowIso, updated_at: nowIso
      },
      membership: { id: this.deps.ids.create('mbr'), user_id: userId, organization_id: organizationId, role: 'owner', created_at: nowIso },
      profile: { user_id: userId, display_name: displayName, cost_profile: { ...DEFAULT_BETA_COST_PROFILE }, created_at: nowIso, updated_at: nowIso },
      verification: {
        id: this.deps.ids.create('ver'), user_id: userId, token_hash: sha256(verificationToken),
        expires_at: plusHours(now, this.deps.config.beta.verificationTtlHours), used_at: null, created_at: nowIso
      },
      outbox: {
        id: this.deps.ids.create('mail'), user_id: userId, recipient: email, template: 'verify_beta_email',
        payload: { verification_url: `${this.deps.config.publicBaseUrl}/beta/#verify=${encodeURIComponent(verificationToken)}` },
        status: 'pending', created_at: nowIso, sent_at: null
      }
    });
    this.deps.metrics.increment('beta_registrations_total');
    return {
      account: safeBetaAccount(account), verification_required: true, verification_delivery: 'email_outbox',
      ...(this.deps.config.beta.exposeDevTokens ? { dev_verification_token: verificationToken } : {})
    };
  }

  async verifyBetaEmail(body: unknown): Promise<Record<string, unknown>> {
    this.requireBetaEnabled();
    const data = asObject(body);
    const token = requiredString(data.token, 'token', 16, 500);
    const user = await this.deps.repository.consumeBetaEmailVerification(sha256(token), iso(this.deps.clock.now()));
    if (!user) throw new BackendError('invalid_verification_token', 'Token di verifica non valido o scaduto.', { statusCode: 422 });
    const account = await this.deps.repository.getBetaAccount(user.id);
    if (!account) throw new BackendError('beta_account_not_found', 'Account beta non trovato.', { statusCode: 404 });
    this.deps.metrics.increment('beta_email_verifications_total');
    return { verified: true, account: safeBetaAccount(account) };
  }

  async loginBeta(body: unknown): Promise<Record<string, unknown>> {
    this.requireBetaEnabled();
    const data = asObject(body);
    const email = validateEmail(requiredString(data.email, 'email', 5, 254));
    const password = requiredString(data.password, 'password', 1, 200);
    const user = await this.deps.repository.findBetaUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new BackendError('invalid_credentials', 'Email o password non corretti.', { statusCode: 401 });
    }
    if (user.status === 'disabled') throw new BackendError('beta_account_disabled', 'Account disabilitato.', { statusCode: 403 });
    if (!user.email_verified_at || user.status !== 'active') {
      throw new BackendError('email_not_verified', 'Verificare l’email prima di accedere.', { statusCode: 403 });
    }
    const account = await this.deps.repository.getBetaAccount(user.id);
    if (!account) throw new BackendError('beta_account_not_found', 'Account beta non trovato.', { statusCode: 404 });
    const now = this.deps.clock.now();
    const accessToken = this.deps.tokens.create(32);
    const session: BetaSessionRecord = {
      id: this.deps.ids.create('ses'), user_id: user.id, organization_id: account.organization.id,
      token_hash: sha256(accessToken), expires_at: plusHours(now, this.deps.config.beta.sessionTtlHours),
      revoked_at: null, created_at: iso(now), last_seen_at: iso(now)
    };
    await this.deps.repository.createBetaSession(session);
    this.deps.metrics.increment('beta_logins_total');
    return { access_token: accessToken, token_type: 'Bearer', expires_at: session.expires_at, account: safeBetaAccount(account) };
  }

  async authenticateBeta(rawToken: string | undefined): Promise<BetaPrincipal> {
    this.requireBetaEnabled();
    if (!rawToken) throw new BackendError('beta_session_required', 'Sessione beta mancante.', { statusCode: 401 });
    const now = iso(this.deps.clock.now());
    const session = await this.deps.repository.findBetaSessionByTokenHash(sha256(rawToken), now);
    if (!session) throw new BackendError('invalid_beta_session', 'Sessione beta non valida o scaduta.', { statusCode: 401 });
    const account = await this.deps.repository.getBetaAccount(session.user_id);
    if (!account || account.user.status !== 'active') throw new BackendError('beta_account_disabled', 'Account beta non attivo.', { statusCode: 403 });
    await this.deps.repository.touchBetaSession(session.id, now);
    return { kind: 'beta_user', organization_id: session.organization_id, user_id: session.user_id, session_id: session.id };
  }

  async betaMe(principal: BetaPrincipal): Promise<Record<string, unknown>> {
    const account = await this.deps.repository.getBetaAccount(principal.user_id);
    if (!account || account.organization.id !== principal.organization_id) {
      throw new BackendError('beta_account_not_found', 'Account beta non trovato.', { statusCode: 404 });
    }
    return { account: safeBetaAccount(account), limits: this.betaLimits() };
  }

  async updateBetaCostProfile(principal: BetaPrincipal, body: unknown): Promise<Record<string, unknown>> {
    const data = asObject(body);
    const account = await this.deps.repository.getBetaAccount(principal.user_id);
    if (!account) throw new BackendError('beta_account_not_found', 'Account beta non trovato.', { statusCode: 404 });
    const source = asObject(data.cost_profile);
    const now = iso(this.deps.clock.now());
    const profile: BetaProfileRecord = {
      ...account.profile,
      display_name: data.display_name === undefined ? account.profile.display_name : requiredString(data.display_name, 'display_name', 2, 120).trim(),
      cost_profile: {
        currency: 'EUR',
        energy_eur_per_kwh: betaNumber(source.energy_eur_per_kwh, 'energy_eur_per_kwh', 0, 10),
        machine_hour_eur: betaNumber(source.machine_hour_eur, 'machine_hour_eur', 0, 1000),
        labor_hour_eur: betaNumber(source.labor_hour_eur, 'labor_hour_eur', 0, 1000),
        material_markup_percent: betaNumber(source.material_markup_percent, 'material_markup_percent', 0, 1000)
      },
      updated_at: now
    };
    const updated = await this.deps.repository.updateBetaProfile(principal.user_id, profile);
    if (!updated) throw new BackendError('beta_account_not_found', 'Account beta non trovato.', { statusCode: 404 });
    this.deps.metrics.increment('beta_profiles_updated_total');
    return { profile: updated };
  }

  async logoutBeta(principal: BetaPrincipal): Promise<{ logged_out: true }> {
    await this.deps.repository.revokeBetaSession(principal.session_id, principal.user_id, iso(this.deps.clock.now()));
    return { logged_out: true };
  }

  async createPairingCode(principal: ApiPrincipal, body: unknown): Promise<{ pairing_code: string; record: PairingCodeRecord }> {
    this.requireScope(principal, 'agents:manage');
    const data = asObject(body);
    const now = this.deps.clock.now();
    const code = this.deps.tokens.create(18);
    const ttlSeconds = data.ttl_seconds === undefined ? 3600 : requiredInteger(data.ttl_seconds, 'ttl_seconds', 60, 604800);
    const record: PairingCodeRecord = {
      id: this.deps.ids.create('pair'),
      organization_id: principal.organization_id,
      code_hash: sha256(code),
      name: typeof data.name === 'string' ? data.name.slice(0, 120) : 'agent-pairing',
      expires_at: plusSeconds(now, ttlSeconds),
      max_uses: data.max_uses === undefined ? 1 : requiredInteger(data.max_uses, 'max_uses', 1, 1000),
      used_count: 0,
      revoked_at: null,
      created_at: iso(now)
    };
    return { pairing_code: code, record: await this.deps.repository.createPairingCode(record) };
  }

  async pairAgent(body: unknown): Promise<{ agent_id: string; access_token: string; paired_at: string }> {
    const data = asObject(body);
    const pairingCode = requiredString(data.pairing_code, 'pairing_code', 6, 500);
    const installationId = requiredString(data.installation_id, 'installation_id', 6, 200);
    const name = requiredString(data.name, 'name', 1, 160);
    const hostnameHash = requiredString(data.hostname_hash, 'hostname_hash', 32, 128);
    const platform = asObject(data.platform);
    const protocolVersions = Array.isArray(data.protocol_versions) ? data.protocol_versions.map(String) : [];
    const now = this.deps.clock.now();
    const pairing = await this.deps.repository.consumePairingCode(sha256(pairingCode), iso(now));
    if (!pairing) throw new BackendError('invalid_pairing_code', 'Codice di pairing non valido, scaduto o già consumato.', { statusCode: 401 });
    const token = this.deps.tokens.create(32);
    const record: AgentRecord = {
      id: this.deps.ids.create('agt'),
      organization_id: pairing.organization_id,
      installation_id: installationId,
      name,
      hostname_hash: hostnameHash,
      platform,
      protocol_versions: protocolVersions,
      token_hash: sha256(token),
      status: 'offline',
      capabilities: null,
      capability_sha256: null,
      paired_at: iso(now),
      last_seen_at: null,
      revoked_at: null
    };
    const agent = await this.deps.repository.pairAgent(record);
    return { agent_id: agent.id, access_token: token, paired_at: agent.paired_at };
  }

  async heartbeat(principal: AgentPrincipal, body: unknown): Promise<{ revoked: false; server_time: string }> {
    this.deps.validator.validateAgentCapabilities(body);
    if (body.status === 'revoked') throw new BackendError('invalid_agent_status', 'Lo stato revoked può essere impostato solo dal backend.', { statusCode: 422 });
    if (body.agent_id !== principal.agent_id) {
      throw new BackendError('agent_identity_mismatch', 'agent_id delle capability non coerente.', { statusCode: 403 });
    }
    const now = iso(this.deps.clock.now());
    const updated = await this.deps.repository.updateAgentHeartbeat(principal.agent_id, body, now);
    this.deps.metrics.increment('agent_heartbeats_total');
    if (!updated) throw new BackendError('agent_revoked', 'Agent revocato.', { statusCode: 401 });
    return { revoked: false, server_time: now };
  }

  async revokeAgent(principal: ApiPrincipal, agentId: string): Promise<{ revoked: boolean }> {
    this.requireScope(principal, 'agents:manage');
    const revoked = await this.deps.repository.revokeAgent(agentId, principal.organization_id, iso(this.deps.clock.now()));
    if (!revoked) throw new BackendError('agent_not_found', 'Agent non trovato.', { statusCode: 404 });
    return { revoked: true };
  }

  async prepareArtifactUpload(principal: ApiPrincipal, body: unknown): Promise<{ artifact: ArtifactRecord; upload: Awaited<ReturnType<ArtifactStorage['prepareUpload']>> }> {
    this.requireScope(principal, 'artifacts:write');
    const data = asObject(body);
    const now = this.deps.clock.now();
    const id = this.deps.ids.create('art');
    const format = requiredString(data.format, 'format', 1, 32).toLowerCase();
    const record: ArtifactRecord = {
      id,
      organization_id: principal.organization_id,
      job_id: null,
      role: data.role === 'diagnostic' ? 'diagnostic' : 'input',
      type: typeof data.type === 'string' ? data.type : format,
      format,
      storage_key: `${principal.organization_id}/uploads/${id}/${requiredString(data.filename, 'filename', 1, 240).replace(/[^A-Za-z0-9._-]/g, '_')}`,
      sha256: requiredString(data.sha256, 'sha256', 64, 64).toLowerCase(),
      size_bytes: requiredInteger(data.size_bytes, 'size_bytes', 1, 5_000_000_000),
      media_type: typeof data.media_type === 'string' ? data.media_type.slice(0, 160) : 'application/octet-stream',
      status: 'pending',
      retention_until: plusHours(now, this.deps.config.retentionHours),
      created_at: iso(now),
      verified_at: null
    };
    const artifact = await this.deps.repository.createArtifact(record);
    return { artifact, upload: await this.deps.storage.prepareUpload(artifact) };
  }

  async completeArtifactUpload(principal: Principal, artifactId: string, body: unknown): Promise<{ artifact: ArtifactRecord }> {
    const data = asObject(body);
    const artifact = await this.deps.repository.getArtifact(artifactId);
    if (!artifact || artifact.organization_id !== principal.organization_id) {
      throw new BackendError('artifact_not_found', 'Artefatto non trovato.', { statusCode: 404 });
    }
    if (principal.kind === 'agent') {
      const jobId = requiredString(data.job_id, 'job_id', 6, 200);
      const leaseId = requiredString(data.lease_id, 'lease_id', 6, 200);
      const job = await this.deps.repository.getJob(jobId);
      if (!job || job.assigned_agent_id !== principal.agent_id || job.lease_id !== leaseId || artifact.job_id !== jobId) {
        throw new BackendError('invalid_lease', 'Lease non valido per l’artefatto.', { statusCode: 409 });
      }
    } else {
      this.requireScope(principal, 'artifacts:write');
    }
    const expected = {
      sha256: requiredString(data.sha256, 'sha256', 64, 64).toLowerCase(),
      size_bytes: requiredInteger(data.size_bytes, 'size_bytes', 1, 5_000_000_000)
    };
    if (artifact.sha256 && artifact.sha256 !== expected.sha256) {
      throw new BackendError('artifact_metadata_mismatch', 'SHA-256 diverso da quello dichiarato in preparazione.', { statusCode: 422 });
    }
    if (artifact.size_bytes && artifact.size_bytes !== expected.size_bytes) {
      throw new BackendError('artifact_metadata_mismatch', 'Dimensione diversa da quella dichiarata in preparazione.', { statusCode: 422 });
    }
    await this.deps.storage.verify(artifact, expected);
    const verified = await this.deps.repository.markArtifactVerified(artifact.id, expected.sha256, expected.size_bytes, iso(this.deps.clock.now()));
    if (!verified) throw new BackendError('artifact_not_found', 'Artefatto non trovato.', { statusCode: 404 });
    return { artifact: verified };
  }

  async createJob(principal: ApiPrincipal, body: unknown, correlationId: string): Promise<{ job: JobRecord; created: boolean }> {
    this.requireScope(principal, 'jobs:write');
    this.deps.validator.validateJobRequest(body);
    const request = body;
    const inputArtifact = await this.deps.repository.getArtifact(request.input.artifact_id);
    if (!inputArtifact || inputArtifact.organization_id !== principal.organization_id || inputArtifact.status !== 'verified') {
      throw new BackendError('input_artifact_not_verified', 'Artefatto di input assente o non verificato.', { statusCode: 409 });
    }
    if (inputArtifact.sha256 !== request.input.sha256 || inputArtifact.size_bytes !== request.input.size_bytes || inputArtifact.format !== request.input.format) {
      throw new BackendError('input_artifact_contract_mismatch', 'I metadati dell’artefatto non corrispondono alla richiesta.', { statusCode: 422 });
    }
    const now = this.deps.clock.now();
    const job: JobRecord = {
      id: this.deps.ids.create('job'),
      organization_id: principal.organization_id,
      request_id: request.request_id,
      idempotency_key: request.idempotency_key,
      source: request.source,
      operation: request.operation,
      request,
      status: 'queued',
      stage: 'queue',
      priority: 0,
      attempts: 0,
      max_attempts: this.deps.config.maxAttempts,
      next_attempt_at: iso(now),
      assigned_agent_id: null,
      lease_id: null,
      lease_expires_at: null,
      ack_at: null,
      result: null,
      error: null,
      cancel_requested_at: null,
      completed_at: null,
      dead_letter_at: null,
      output_artifact_id: null,
      created_at: iso(now),
      updated_at: iso(now)
    };
    const result = await this.deps.repository.createJobIdempotent(job, correlationId);
    if (result.created) {
      await this.deps.queue.notifyReady(result.job);
      this.deps.metrics.increment('jobs_created_total');
      this.deps.metrics.increment('jobs_queued_total');
    } else {
      this.deps.metrics.increment('jobs_idempotent_replays_total');
    }
    return result;
  }

  async getJob(principal: ApiPrincipal, jobId: string): Promise<{ job: JobRecord; events: Awaited<ReturnType<BackendRepository['listJobEvents']>> }> {
    this.requireScope(principal, 'jobs:read');
    const job = await this.deps.repository.getJob(jobId);
    if (!job || job.organization_id !== principal.organization_id) throw new BackendError('job_not_found', 'Job non trovato.', { statusCode: 404 });
    return { job, events: await this.deps.repository.listJobEvents(job.id) };
  }

  async cancelJob(principal: ApiPrincipal, jobId: string, correlationId: string): Promise<{ job: JobRecord }> {
    this.requireScope(principal, 'jobs:write');
    const job = await this.deps.repository.requestCancellation(jobId, principal.organization_id, iso(this.deps.clock.now()), correlationId);
    if (!job) throw new BackendError('job_not_found', 'Job non trovato.', { statusCode: 404 });
    if (job.status === 'cancelled') await this.deps.queue.remove(job.id);
    return { job };
  }

  async lease(principal: AgentPrincipal, body: unknown, correlationId: string): Promise<{ lease: LeaseEnvelope | null }> {
    const data = asObject(body);
    const maxJobs = data.max_jobs === undefined ? 1 : requiredInteger(data.max_jobs, 'max_jobs', 1, 1);
    if (maxJobs !== 1) throw new BackendError('unsupported_max_jobs', 'Questa versione assegna un job per richiesta.', { statusCode: 422 });
    const agent = await this.deps.repository.getAgent(principal.agent_id);
    if (!agent?.capabilities || agent.revoked_at) throw new BackendError('agent_capabilities_required', 'Heartbeat con capability richiesto prima del lease.', { statusCode: 409 });
    const now = this.deps.clock.now();
    const expired = await this.deps.repository.requeueExpired(iso(now));
    for (const job of expired) {
      if (job.status === 'retrying') await this.deps.queue.notifyReady(job);
      else await this.deps.queue.remove(job.id);
    }
    const queuedIds = await this.deps.queue.candidates(50, iso(now));
    const candidates = await this.deps.repository.findLeaseCandidates(principal.organization_id, queuedIds, iso(now), 50);
    for (const candidate of candidates) {
      const eligibility = evaluateEligibility(candidate.request, agent.capabilities);
      if (!eligibility.eligible) continue;
      const leaseId = this.deps.ids.create('lease');
      const expires = plusSeconds(now, this.deps.config.leaseSeconds);
      const claimed = await this.deps.repository.claimJob(candidate.id, principal.agent_id, leaseId, expires, iso(now), correlationId);
      if (!claimed) continue;
      await this.deps.queue.remove(claimed.id);
      this.deps.metrics.increment('leases_granted_total');
      const input = await this.deps.repository.getArtifact(claimed.request.input.artifact_id);
      if (!input) throw new BackendError('input_artifact_missing', 'Artefatto input mancante dopo il lease.', { statusCode: 500 });
      const outputFormat = claimed.request.print_intent.requested_output_format ?? 'gcode';
      const output = await this.deps.repository.ensureOutputArtifact({
        id: this.deps.ids.create('art'),
        organization_id: claimed.organization_id,
        job_id: claimed.id,
        role: 'output',
        type: outputFormat,
        format: outputFormat,
        storage_key: `${claimed.organization_id}/jobs/${claimed.id}/output.${outputFormat}`,
        sha256: null,
        size_bytes: null,
        media_type: outputFormat === 'x3g' ? 'application/octet-stream' : 'text/x.gcode',
        status: 'pending',
        retention_until: plusHours(now, this.deps.config.retentionHours),
        created_at: iso(now),
        verified_at: null
      });
      return {
        lease: {
          lease_id: leaseId,
          lease_expires_at: expires,
          job_id: claimed.id,
          request: claimed.request,
          input_download: await this.deps.storage.prepareDownload(input),
          output_upload: await this.deps.storage.prepareUpload(output)
        }
      };
    }
    return { lease: null };
  }

  async ack(principal: AgentPrincipal, jobId: string, body: unknown, correlationId: string): Promise<{ acknowledged: true }> {
    const data = asObject(body);
    const leaseId = requiredString(data.lease_id, 'lease_id', 6, 200);
    const job = await this.deps.repository.ackJob(jobId, principal.agent_id, leaseId, iso(this.deps.clock.now()), correlationId);
    if (!job) throw new BackendError('invalid_lease', 'Lease non valido o scaduto.', { statusCode: 409 });
    return { acknowledged: true };
  }

  async progress(principal: AgentPrincipal, jobId: string, body: unknown, correlationId: string): Promise<{ lease_expires_at: string }> {
    const data = asObject(body);
    const now = this.deps.clock.now();
    const leaseExpiresAt = plusSeconds(now, this.deps.config.leaseRenewSeconds);
    const status = requiredString(data.status, 'status', 2, 40) as JobRecord['status'];
    const stage = requiredString(data.stage, 'stage', 2, 40) as JobRecord['stage'];
    const allowedStatuses: JobRecord['status'][] = ['assigned','downloading','preparing','slicing','validating','postprocessing','uploading','cancel_requested'];
    const allowedStages: JobRecord['stage'][] = ['lease','download','prepare','slice','validate','postprocess','upload_result','cancel'];
    if (!allowedStatuses.includes(status) || !allowedStages.includes(stage)) {
      throw new BackendError('invalid_progress_transition', 'Stato o stage di avanzamento non consentito.', { statusCode: 422, details: { status, stage } });
    }
    const job = await this.deps.repository.progressJob({
      job_id: jobId,
      agent_id: principal.agent_id,
      lease_id: requiredString(data.lease_id, 'lease_id', 6, 200),
      status,
      stage,
      progress_percent: requiredInteger(data.progress_percent, 'progress_percent', 0, 100),
      message: requiredString(data.message, 'message', 1, 1000),
      lease_expires_at: leaseExpiresAt,
      now: iso(now),
      correlation_id: correlationId
    });
    if (!job) throw new BackendError('invalid_lease', 'Lease non valido o scaduto.', { statusCode: 409 });
    return { lease_expires_at: leaseExpiresAt };
  }

  async complete(principal: AgentPrincipal, jobId: string, body: unknown, correlationId: string): Promise<{ completed: true; idempotent: boolean }> {
    const data = asObject(body);
    const leaseId = requiredString(data.lease_id, 'lease_id', 6, 200);
    this.deps.validator.validateJobResult(data.result);
    const result: JobResultV1 = data.result;
    if (result.job_id !== jobId) throw new BackendError('job_result_identity_mismatch', 'job_id del risultato non coerente.', { statusCode: 422 });
    const job = await this.deps.repository.getJob(jobId);
    if (!job || job.organization_id !== principal.organization_id) throw new BackendError('job_not_found', 'Job non trovato.', { statusCode: 404 });
    const outputId = job.output_artifact_id;
    const output = outputId ? await this.deps.repository.getArtifact(outputId) : null;
    if (!output || output.status !== 'verified') throw new BackendError('output_artifact_not_verified', 'Artefatto output non verificato.', { statusCode: 409 });
    const resultArtifact = result.result.artifacts.find((artifact) => artifact.artifact_id === output.id);
    if (!resultArtifact || resultArtifact.sha256 !== output.sha256 || resultArtifact.size_bytes !== output.size_bytes) {
      throw new BackendError('output_artifact_result_mismatch', 'Artefatto nel risultato non coerente con lo storage verificato.', { statusCode: 422 });
    }
    const completed = await this.deps.repository.completeJob({
      job_id: jobId,
      agent_id: principal.agent_id,
      lease_id: leaseId,
      result,
      now: iso(this.deps.clock.now()),
      correlation_id: correlationId
    });
    if (!completed) throw new BackendError('invalid_lease', 'Lease non valido o scaduto.', { statusCode: 409 });
    await this.deps.queue.remove(jobId);
    if (!completed.idempotent) this.deps.metrics.increment('jobs_completed_total');
    return { completed: true, idempotent: completed.idempotent };
  }

  async fail(principal: AgentPrincipal, jobId: string, body: unknown, correlationId: string): Promise<{ status: JobRecord['status']; retry_at: string | null }> {
    const data = asObject(body);
    const leaseId = requiredString(data.lease_id, 'lease_id', 6, 200);
    const errorData = asObject(data.error);
    const error: StructuredError = {
      code: requiredString(errorData.code, 'error.code', 1, 160),
      message: requiredString(errorData.message, 'error.message', 1, 2000),
      stage: requiredString(errorData.stage, 'error.stage', 1, 80),
      retryable: errorData.retryable === true,
      details: typeof errorData.details === 'object' && errorData.details !== null && !Array.isArray(errorData.details)
        ? errorData.details as Record<string, unknown> : {},
      ...(typeof errorData.correlation_id === 'string' ? { correlation_id: errorData.correlation_id } : {})
    };
    const current = await this.deps.repository.getJob(jobId);
    if (!current) throw new BackendError('job_not_found', 'Job non trovato.', { statusCode: 404 });
    const now = this.deps.clock.now();
    const canRetry = error.retryable && current.attempts < current.max_attempts && !current.cancel_requested_at;
    const delay = this.deps.config.retryBaseSeconds * Math.max(1, 2 ** Math.max(0, current.attempts - 1));
    const retryAt = canRetry ? plusSeconds(now, delay) : null;
    const updated = await this.deps.repository.failJob({
      job_id: jobId,
      agent_id: principal.agent_id,
      lease_id: leaseId,
      error,
      retry_at: retryAt,
      now: iso(now),
      correlation_id: correlationId
    });
    if (!updated) throw new BackendError('invalid_lease', 'Lease non valido o scaduto.', { statusCode: 409 });
    if (updated.status === 'retrying') {
      await this.deps.queue.notifyReady(updated);
      this.deps.metrics.increment('jobs_retried_total');
    } else {
      await this.deps.queue.remove(updated.id);
      if (updated.status === 'failed') this.deps.metrics.increment('jobs_failed_total');
      if (updated.status === 'cancelled') this.deps.metrics.increment('jobs_cancelled_total');
    }
    return { status: updated.status, retry_at: retryAt };
  }
}
