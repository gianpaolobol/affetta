import { BackendError } from '../errors.js';
import type {
  AgentCapabilitiesV1,
  BetaAccountSnapshot,
  BetaEmailVerificationRecord,
  BetaProfileRecord,
  BetaSessionRecord,
  BetaUserRecord,
  AgentRecord,
  ApiKeyRecord,
  ArtifactRecord,
  ArtifactStorage,
  BackendRepository,
  JobEventRecord,
  JobRecord,
  JobResultV1,
  MembershipRecord,
  EmailOutboxRecord,
  OrganizationRecord,
  PairingCodeRecord,
  ReadyQueue,
  SignedTransfer,
  StructuredError
} from '../types.js';
import { sha256 } from '../crypto.js';

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryReadyQueue implements ReadyQueue {
  private readonly scores = new Map<string, number>();

  async health(): Promise<{ ok: boolean }> { return { ok: true }; }
  async close(): Promise<void> {}

  async notifyReady(job: JobRecord): Promise<void> {
    const available = new Date(job.next_attempt_at).getTime();
    const priorityBias = Math.max(-1000, Math.min(1000, job.priority)) * 1_000_000_000;
    this.scores.set(job.id, available - priorityBias);
  }

  async candidates(limit: number, now: string): Promise<string[]> {
    const time = new Date(now).getTime();
    return [...this.scores.entries()]
      .filter(([, score]) => score <= time + 1_000_000_000_000)
      .sort((left, right) => left[1] - right[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  async remove(jobId: string): Promise<void> { this.scores.delete(jobId); }
}

export class MemoryArtifactStorage implements ArtifactStorage {
  private readonly objects = new Map<string, Buffer>();

  async health(): Promise<{ ok: boolean }> { return { ok: true }; }
  async close(): Promise<void> {}

  async prepareUpload(artifact: ArtifactRecord): Promise<SignedTransfer> {
    return {
      artifact_id: artifact.id,
      url: `https://storage.affetta.test/${encodeURIComponent(artifact.storage_key)}`,
      method: 'PUT',
      headers: { 'content-type': artifact.media_type }
    };
  }

  async prepareDownload(artifact: ArtifactRecord): Promise<SignedTransfer> {
    return {
      artifact_id: artifact.id,
      url: `https://storage.affetta.test/${encodeURIComponent(artifact.storage_key)}`,
      method: 'GET'
    };
  }

  async verify(artifact: ArtifactRecord, expected: { sha256: string; size_bytes: number }): Promise<void> {
    const object = this.objects.get(artifact.storage_key);
    if (!object) {
      throw new BackendError('artifact_not_found_in_storage', 'Artefatto non presente nello storage.', {
        statusCode: 409,
        retryable: true
      });
    }
    const actual = { sha256: sha256(object), size_bytes: object.byteLength };
    if (actual.sha256 !== expected.sha256 || actual.size_bytes !== expected.size_bytes) {
      throw new BackendError('artifact_checksum_mismatch', 'Checksum o dimensione artefatto non corrispondenti.', {
        statusCode: 422,
        details: { expected, actual }
      });
    }
  }

  put(storageKey: string, value: Buffer | string): void {
    this.objects.set(storageKey, Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value));
  }

  get(storageKey: string): Buffer | null {
    const value = this.objects.get(storageKey);
    return value ? Buffer.from(value) : null;
  }
}

export class MemoryBackendRepository implements BackendRepository {
  private readonly organizations = new Map<string, OrganizationRecord>();
  private readonly betaUsers = new Map<string, BetaUserRecord>();
  private readonly memberships = new Map<string, MembershipRecord>();
  private readonly betaProfiles = new Map<string, BetaProfileRecord>();
  private readonly betaVerifications = new Map<string, BetaEmailVerificationRecord>();
  private readonly betaSessions = new Map<string, BetaSessionRecord>();
  private readonly emailOutbox = new Map<string, EmailOutboxRecord>();
  private readonly apiKeys = new Map<string, ApiKeyRecord>();
  private readonly pairingCodes = new Map<string, PairingCodeRecord>();
  private readonly agents = new Map<string, AgentRecord>();
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly events = new Map<string, JobEventRecord[]>();

  async health(): Promise<{ ok: boolean }> { return { ok: true }; }
  async close(): Promise<void> {}

  async ensureBootstrap(input: {
    organization: OrganizationRecord;
    api_key: ApiKeyRecord;
    pairing_code?: PairingCodeRecord;
  }): Promise<void> {
    if (!this.organizations.has(input.organization.id)) this.organizations.set(input.organization.id, copy(input.organization));
    if (![...this.apiKeys.values()].some((key) => key.key_hash === input.api_key.key_hash)) {
      this.apiKeys.set(input.api_key.id, copy(input.api_key));
    }
    if (input.pairing_code && ![...this.pairingCodes.values()].some((code) => code.code_hash === input.pairing_code!.code_hash)) {
      this.pairingCodes.set(input.pairing_code.id, copy(input.pairing_code));
    }
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const record = [...this.apiKeys.values()].find((key) => key.key_hash === keyHash && !key.revoked_at);
    return record ? copy(record) : null;
  }

  async findBetaUserByEmail(email: string): Promise<BetaUserRecord | null> {
    const record = [...this.betaUsers.values()].find((user) => user.email === email);
    return record ? copy(record) : null;
  }

  async findBetaUserByUsername(username: string): Promise<BetaUserRecord | null> {
    const record = [...this.betaUsers.values()].find((user) => user.username === username);
    return record ? copy(record) : null;
  }

  async createBetaAccount(input: {
    organization: OrganizationRecord;
    user: BetaUserRecord;
    membership: MembershipRecord;
    profile: BetaProfileRecord;
    verification: BetaEmailVerificationRecord;
    outbox: EmailOutboxRecord;
  }): Promise<BetaAccountSnapshot> {
    if ([...this.betaUsers.values()].some((user) => user.email === input.user.email)) {
      throw new BackendError('beta_email_exists', 'Esiste già un account con questa email.', { statusCode: 409 });
    }
    if ([...this.betaUsers.values()].some((user) => user.username === input.user.username)) {
      throw new BackendError('beta_username_exists', 'Username già utilizzato.', { statusCode: 409 });
    }
    this.organizations.set(input.organization.id, copy(input.organization));
    this.betaUsers.set(input.user.id, copy(input.user));
    this.memberships.set(input.membership.id, copy(input.membership));
    this.betaProfiles.set(input.profile.user_id, copy(input.profile));
    this.betaVerifications.set(input.verification.id, copy(input.verification));
    this.emailOutbox.set(input.outbox.id, copy(input.outbox));
    return {
      organization: copy(input.organization), user: copy(input.user),
      membership: copy(input.membership), profile: copy(input.profile)
    };
  }

  async consumeBetaEmailVerification(tokenHash: string, now: string): Promise<BetaUserRecord | null> {
    const verification = [...this.betaVerifications.values()].find((item) => item.token_hash === tokenHash);
    if (!verification || verification.used_at || new Date(verification.expires_at) <= new Date(now)) return null;
    const user = this.betaUsers.get(verification.user_id);
    if (!user || user.status === 'disabled') return null;
    verification.used_at = now;
    user.email_verified_at = user.email_verified_at ?? now;
    user.status = 'active';
    user.updated_at = now;
    return copy(user);
  }

  async createBetaSession(record: BetaSessionRecord): Promise<BetaSessionRecord> {
    this.betaSessions.set(record.id, copy(record));
    return copy(record);
  }

  async findBetaSessionByTokenHash(tokenHash: string, now: string): Promise<BetaSessionRecord | null> {
    const session = [...this.betaSessions.values()].find((item) => item.token_hash === tokenHash);
    if (!session || session.revoked_at || new Date(session.expires_at) <= new Date(now)) return null;
    return copy(session);
  }

  async touchBetaSession(sessionId: string, now: string): Promise<void> {
    const session = this.betaSessions.get(sessionId);
    if (session && !session.revoked_at) session.last_seen_at = now;
  }

  async revokeBetaSession(sessionId: string, userId: string, now: string): Promise<boolean> {
    const session = this.betaSessions.get(sessionId);
    if (!session || session.user_id !== userId) return false;
    session.revoked_at = session.revoked_at ?? now;
    return true;
  }

  async getBetaAccount(userId: string): Promise<BetaAccountSnapshot | null> {
    const user = this.betaUsers.get(userId);
    const membership = [...this.memberships.values()].find((item) => item.user_id === userId);
    const profile = this.betaProfiles.get(userId);
    if (!user || !membership || !profile) return null;
    const organization = this.organizations.get(membership.organization_id);
    if (!organization) return null;
    return { user: copy(user), membership: copy(membership), profile: copy(profile), organization: copy(organization) };
  }

  async updateBetaProfile(userId: string, profile: BetaProfileRecord): Promise<BetaProfileRecord | null> {
    if (!this.betaUsers.has(userId)) return null;
    this.betaProfiles.set(userId, copy(profile));
    return copy(profile);
  }

  async createPairingCode(record: PairingCodeRecord): Promise<PairingCodeRecord> {
    this.pairingCodes.set(record.id, copy(record));
    return copy(record);
  }

  async consumePairingCode(codeHash: string, now: string): Promise<PairingCodeRecord | null> {
    const record = [...this.pairingCodes.values()].find((code) => code.code_hash === codeHash);
    if (!record || record.revoked_at || new Date(record.expires_at) <= new Date(now) || record.used_count >= record.max_uses) return null;
    record.used_count += 1;
    return copy(record);
  }

  async pairAgent(record: AgentRecord): Promise<AgentRecord> {
    const existing = [...this.agents.values()].find((agent) =>
      agent.organization_id === record.organization_id && agent.installation_id === record.installation_id
    );
    if (existing) {
      const updated = { ...record, id: existing.id, paired_at: existing.paired_at };
      this.agents.set(existing.id, copy(updated));
      return copy(updated);
    }
    this.agents.set(record.id, copy(record));
    return copy(record);
  }

  async findAgentByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
    const record = [...this.agents.values()].find((agent) => agent.token_hash === tokenHash);
    return record ? copy(record) : null;
  }

  async getAgent(agentId: string): Promise<AgentRecord | null> {
    const record = this.agents.get(agentId);
    return record ? copy(record) : null;
  }

  async updateAgentHeartbeat(agentId: string, capabilities: AgentCapabilitiesV1, now: string): Promise<AgentRecord | null> {
    const record = this.agents.get(agentId);
    if (!record || record.revoked_at) return null;
    record.capabilities = copy(capabilities);
    record.capability_sha256 = capabilities.capability_sha256;
    record.status = capabilities.status;
    record.last_seen_at = now;
    return copy(record);
  }

  async revokeAgent(agentId: string, organizationId: string, now: string): Promise<boolean> {
    const record = this.agents.get(agentId);
    if (!record || record.organization_id !== organizationId) return false;
    record.revoked_at = now;
    record.status = 'revoked';
    return true;
  }

  async createArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
    if (this.artifacts.has(record.id)) throw new BackendError('artifact_exists', 'Artefatto già esistente.', { statusCode: 409 });
    this.artifacts.set(record.id, copy(record));
    return copy(record);
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord | null> {
    const record = this.artifacts.get(artifactId);
    return record ? copy(record) : null;
  }

  async markArtifactVerified(artifactId: string, sha256Value: string, sizeBytes: number, now: string): Promise<ArtifactRecord | null> {
    const record = this.artifacts.get(artifactId);
    if (!record) return null;
    if (record.status === 'verified') {
      if (record.sha256 !== sha256Value || record.size_bytes !== sizeBytes) {
        throw new BackendError('artifact_verification_conflict', 'Artefatto già verificato con metadati differenti.', { statusCode: 409 });
      }
      return copy(record);
    }
    record.sha256 = sha256Value;
    record.size_bytes = sizeBytes;
    record.status = 'verified';
    record.verified_at = now;
    return copy(record);
  }

  async ensureOutputArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
    const existing = [...this.artifacts.values()].find((artifact) => artifact.job_id === record.job_id && artifact.role === 'output');
    if (existing) return copy(existing);
    this.artifacts.set(record.id, copy(record));
    const job = record.job_id ? this.jobs.get(record.job_id) : null;
    if (job) job.output_artifact_id = record.id;
    return copy(record);
  }

  async createJobIdempotent(record: JobRecord, correlationId: string): Promise<{ job: JobRecord; created: boolean }> {
    const existing = [...this.jobs.values()].find((job) =>
      job.organization_id === record.organization_id && job.idempotency_key === record.idempotency_key
    );
    if (existing) return { job: copy(existing), created: false };
    this.jobs.set(record.id, copy(record));
    this.appendEvent(record, 'created', 'created', 0, 'Job creato.', {}, correlationId, record.created_at);
    this.appendEvent(record, 'queued', 'queue', 0, 'Job inserito in coda.', {}, correlationId, record.created_at);
    return { job: copy(record), created: true };
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const record = this.jobs.get(jobId);
    return record ? copy(record) : null;
  }

  async listJobEvents(jobId: string): Promise<JobEventRecord[]> {
    return copy(this.events.get(jobId) ?? []);
  }

  async requestCancellation(jobId: string, organizationId: string, now: string, correlationId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.organization_id !== organizationId) return null;
    if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) return copy(job);
    job.cancel_requested_at = now;
    job.status = job.lease_id ? 'cancel_requested' : 'cancelled';
    job.stage = 'cancel';
    job.updated_at = now;
    this.appendEvent(job, job.status, 'cancel', null, job.status === 'cancelled' ? 'Job cancellato.' : 'Cancellazione richiesta.', {}, correlationId, now);
    return copy(job);
  }

  async requeueExpired(now: string): Promise<JobRecord[]> {
    const changed: JobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (!job.lease_expires_at || new Date(job.lease_expires_at) > new Date(now) ||
          !['leased', 'assigned', 'downloading', 'preparing', 'slicing', 'validating', 'postprocessing', 'uploading', 'cancel_requested'].includes(job.status)) continue;
      if (job.cancel_requested_at) {
        job.status = 'cancelled';
        job.stage = 'cancel';
      } else if (job.attempts >= job.max_attempts) {
        job.status = 'expired';
        job.stage = 'lease';
        job.dead_letter_at = now;
      } else {
        job.status = 'retrying';
        job.stage = 'queue';
        job.next_attempt_at = now;
      }
      job.assigned_agent_id = null;
      job.lease_id = null;
      job.lease_expires_at = null;
      job.updated_at = now;
      changed.push(copy(job));
    }
    return changed;
  }

  async findLeaseCandidates(organizationId: string, candidateIds: string[], now: string, limit: number): Promise<JobRecord[]> {
    const candidates = [...this.jobs.values()].filter((job) =>
      job.organization_id === organizationId &&
      ['queued', 'retrying'].includes(job.status) &&
      !job.cancel_requested_at &&
      new Date(job.next_attempt_at) <= new Date(now) &&
      (candidateIds.length === 0 || candidateIds.includes(job.id))
    );
    return candidates
      .sort((left, right) => right.priority - left.priority || left.created_at.localeCompare(right.created_at))
      .slice(0, limit)
      .map(copy);
  }

  async claimJob(jobId: string, agentId: string, leaseId: string, leaseExpiresAt: string, now: string, correlationId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || !['queued', 'retrying'].includes(job.status) || job.cancel_requested_at || new Date(job.next_attempt_at) > new Date(now)) return null;
    job.status = 'leased';
    job.stage = 'lease';
    job.assigned_agent_id = agentId;
    job.lease_id = leaseId;
    job.lease_expires_at = leaseExpiresAt;
    job.attempts += 1;
    job.updated_at = now;
    this.appendEvent(job, 'leased', 'lease', 0, 'Lease assegnato.', { lease_id: leaseId, agent_id: agentId }, correlationId, now);
    return copy(job);
  }

  async ackJob(jobId: string, agentId: string, leaseId: string, now: string, correlationId: string): Promise<JobRecord | null> {
    const job = this.validLease(jobId, agentId, leaseId);
    if (!job) return null;
    if (job.ack_at) return copy(job);
    job.status = 'assigned';
    job.stage = 'lease';
    job.ack_at = now;
    job.updated_at = now;
    this.appendEvent(job, 'assigned', 'lease', 1, 'Lease confermato dall’Agent.', {}, correlationId, now);
    return copy(job);
  }

  async progressJob(input: {
    job_id: string; agent_id: string; lease_id: string; status: JobRecord['status']; stage: JobRecord['stage'];
    progress_percent: number; message: string; lease_expires_at: string; now: string; correlation_id: string;
  }): Promise<JobRecord | null> {
    const job = this.validLease(input.job_id, input.agent_id, input.lease_id);
    if (!job) return null;
    job.status = input.status;
    job.stage = input.stage;
    job.lease_expires_at = input.lease_expires_at;
    job.updated_at = input.now;
    this.appendEvent(job, input.status, input.stage, input.progress_percent, input.message, {}, input.correlation_id, input.now);
    return copy(job);
  }

  async completeJob(input: {
    job_id: string; agent_id: string; lease_id: string; result: JobResultV1; now: string; correlation_id: string;
  }): Promise<{ job: JobRecord; idempotent: boolean } | null> {
    const current = this.jobs.get(input.job_id);
    if (!current) return null;
    if (current.status === 'completed' && current.result) {
      if (JSON.stringify(current.result) !== JSON.stringify(input.result)) {
        throw new BackendError('completion_conflict', 'Job già completato con un risultato differente.', { statusCode: 409 });
      }
      return { job: copy(current), idempotent: true };
    }
    const job = this.validLease(input.job_id, input.agent_id, input.lease_id);
    if (!job) return null;
    job.status = 'completed';
    job.stage = 'complete';
    job.result = copy(input.result);
    job.completed_at = input.now;
    job.updated_at = input.now;
    job.lease_expires_at = null;
    this.appendEvent(job, 'completed', 'complete', 100, 'Job completato.', {}, input.correlation_id, input.now);
    return { job: copy(job), idempotent: false };
  }

  async failJob(input: {
    job_id: string; agent_id: string; lease_id: string; error: StructuredError; retry_at: string | null;
    now: string; correlation_id: string;
  }): Promise<JobRecord | null> {
    const job = this.validLease(input.job_id, input.agent_id, input.lease_id);
    if (!job) return null;
    job.error = copy(input.error);
    job.assigned_agent_id = null;
    job.lease_id = null;
    job.lease_expires_at = null;
    if (input.retry_at && !job.cancel_requested_at) {
      job.status = 'retrying';
      job.stage = 'queue';
      job.next_attempt_at = input.retry_at;
      this.appendEvent(job, 'retrying', 'queue', null, 'Job pianificato per un nuovo tentativo.', { error: input.error }, input.correlation_id, input.now);
    } else if (job.cancel_requested_at) {
      job.status = 'cancelled';
      job.stage = 'cancel';
      this.appendEvent(job, 'cancelled', 'cancel', null, 'Job cancellato dopo l’arresto dell’Agent.', {}, input.correlation_id, input.now);
    } else {
      job.status = 'failed';
      job.stage = 'complete';
      job.dead_letter_at = input.now;
      this.appendEvent(job, 'failed', 'complete', null, 'Job fallito definitivamente.', { error: input.error }, input.correlation_id, input.now);
    }
    job.updated_at = input.now;
    return copy(job);
  }

  private validLease(jobId: string, agentId: string, leaseId: string): JobRecord | null {
    const job = this.jobs.get(jobId);
    if (!job || job.assigned_agent_id !== agentId || job.lease_id !== leaseId) return null;
    return job;
  }

  private appendEvent(job: JobRecord, status: JobRecord['status'], stage: JobRecord['stage'], progress: number | null,
    message: string, payload: Record<string, unknown>, correlationId: string, now: string): void {
    const list = this.events.get(job.id) ?? [];
    list.push({
      id: `evt_${job.id}_${list.length + 1}`,
      organization_id: job.organization_id,
      job_id: job.id,
      sequence: list.length,
      status,
      stage,
      progress_percent: progress,
      message,
      payload: copy(payload),
      correlation_id: correlationId,
      created_at: now
    });
    this.events.set(job.id, list);
  }
}
