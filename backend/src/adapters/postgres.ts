import { BackendError } from '../errors.js';
import type {
  AgentCapabilitiesV1,
  AgentRecord,
  ApiKeyRecord,
  ArtifactRecord,
  BackendRepository,
  JobEventRecord,
  JobRecord,
  JobResultV1,
  OrganizationRecord,
  PairingCodeRecord,
  StructuredError
} from '../types.js';

interface QueryResult<T> { rows: T[]; rowCount: number | null; }
interface PgClientLike {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}
interface PgPoolLike {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

type Row = Record<string, unknown>;

function dateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function jobFromRow(row: Row): JobRecord {
  return {
    id: String(row.id), organization_id: String(row.organization_id), request_id: String(row.request_id),
    idempotency_key: String(row.idempotency_key), source: String(row.source), operation: 'slice',
    request: row.request as JobRecord['request'], status: row.status as JobRecord['status'], stage: row.stage as JobRecord['stage'],
    priority: Number(row.priority), attempts: Number(row.attempts), max_attempts: Number(row.max_attempts),
    next_attempt_at: dateString(row.next_attempt_at)!, assigned_agent_id: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    lease_id: row.lease_id ? String(row.lease_id) : null, lease_expires_at: dateString(row.lease_expires_at),
    ack_at: dateString(row.ack_at), result: row.result as JobResultV1 | null, error: row.error as StructuredError | null,
    cancel_requested_at: dateString(row.cancel_requested_at), completed_at: dateString(row.completed_at),
    dead_letter_at: dateString(row.dead_letter_at), output_artifact_id: row.output_artifact_id ? String(row.output_artifact_id) : null,
    created_at: dateString(row.created_at)!, updated_at: dateString(row.updated_at)!
  };
}

function artifactFromRow(row: Row): ArtifactRecord {
  return {
    id: String(row.id), organization_id: String(row.organization_id), job_id: row.job_id ? String(row.job_id) : null,
    role: row.role as ArtifactRecord['role'], type: String(row.type), format: String(row.format), storage_key: String(row.storage_key),
    sha256: row.sha256 ? String(row.sha256) : null, size_bytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    media_type: String(row.media_type), status: row.status as ArtifactRecord['status'], retention_until: dateString(row.retention_until)!,
    created_at: dateString(row.created_at)!, verified_at: dateString(row.verified_at)
  };
}

function agentFromRow(row: Row): AgentRecord {
  return {
    id: String(row.id), organization_id: String(row.organization_id), installation_id: String(row.installation_id), name: String(row.name),
    hostname_hash: String(row.hostname_hash), platform: row.platform as Record<string, unknown>, protocol_versions: row.protocol_versions as string[],
    token_hash: String(row.token_hash), status: row.status as AgentRecord['status'], capabilities: row.capabilities as AgentCapabilitiesV1 | null,
    capability_sha256: row.capability_sha256 ? String(row.capability_sha256) : null, paired_at: dateString(row.paired_at)!,
    last_seen_at: dateString(row.last_seen_at), revoked_at: dateString(row.revoked_at)
  };
}

function apiKeyFromRow(row: Row): ApiKeyRecord {
  return {
    id: String(row.id), organization_id: String(row.organization_id), name: String(row.name), key_hash: String(row.key_hash),
    scopes: row.scopes as string[], revoked_at: dateString(row.revoked_at), created_at: dateString(row.created_at)!
  };
}

function pairingFromRow(row: Row): PairingCodeRecord {
  return {
    id: String(row.id), organization_id: String(row.organization_id), code_hash: String(row.code_hash), name: String(row.name),
    expires_at: dateString(row.expires_at)!, max_uses: Number(row.max_uses), used_count: Number(row.used_count),
    revoked_at: dateString(row.revoked_at), created_at: dateString(row.created_at)!
  };
}

function eventFromRow(row: Row): JobEventRecord {
  return {
    id: String(row.id), organization_id: String(row.organization_id), job_id: String(row.job_id), sequence: Number(row.sequence),
    status: row.status as JobEventRecord['status'], stage: row.stage as JobEventRecord['stage'],
    progress_percent: row.progress_percent === null || row.progress_percent === undefined ? null : Number(row.progress_percent),
    message: String(row.message), payload: row.payload as Record<string, unknown>, correlation_id: String(row.correlation_id),
    created_at: dateString(row.created_at)!
  };
}

export class PgBackendRepository implements BackendRepository {
  private constructor(private readonly pool: PgPoolLike) {}

  static async connect(databaseUrl: string): Promise<PgBackendRepository> {
    const moduleName = 'pg';
    const imported = await import(moduleName) as { Pool: new (options: Record<string, unknown>) => PgPoolLike };
    return new PgBackendRepository(new imported.Pool({ connectionString: databaseUrl, max: 10 }));
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> { await this.pool.end(); }

  private async tx<T>(run: (client: PgClientLike) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendEvent(client: PgClientLike, job: JobRecord, status: JobRecord['status'], stage: JobRecord['stage'],
    progress: number | null, message: string, payload: Record<string, unknown>, correlationId: string, now: string): Promise<void> {
    await client.query(`
      INSERT INTO job_events (organization_id, job_id, sequence, status, stage, progress_percent, message, payload, correlation_id, created_at)
      VALUES ($1, $2, COALESCE((SELECT MAX(sequence) + 1 FROM job_events WHERE job_id = $2), 0), $3, $4, $5, $6, $7::jsonb, $8, $9)
    `, [job.organization_id, job.id, status, stage, progress, message, JSON.stringify(payload), correlationId, now]);
  }

  async ensureBootstrap(input: { organization: OrganizationRecord; api_key: ApiKeyRecord; pairing_code?: PairingCodeRecord }): Promise<void> {
    await this.tx(async (client) => {
      await client.query(`INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [input.organization.id, input.organization.name, input.organization.created_at]);
      await client.query(`INSERT INTO api_keys (id, organization_id, name, key_hash, scopes, revoked_at, created_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT (key_hash) DO NOTHING`, [
        input.api_key.id, input.api_key.organization_id, input.api_key.name, input.api_key.key_hash,
        JSON.stringify(input.api_key.scopes), input.api_key.revoked_at, input.api_key.created_at
      ]);
      if (input.pairing_code) {
        await client.query(`INSERT INTO pairing_codes (id, organization_id, code_hash, name, expires_at, max_uses, used_count, revoked_at, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code_hash) DO NOTHING`, [
          input.pairing_code.id, input.pairing_code.organization_id, input.pairing_code.code_hash, input.pairing_code.name,
          input.pairing_code.expires_at, input.pairing_code.max_uses, input.pairing_code.used_count,
          input.pairing_code.revoked_at, input.pairing_code.created_at
        ]);
      }
    });
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const result = await this.pool.query<Row>('SELECT * FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL LIMIT 1', [keyHash]);
    return result.rows[0] ? apiKeyFromRow(result.rows[0]) : null;
  }

  async createPairingCode(record: PairingCodeRecord): Promise<PairingCodeRecord> {
    const result = await this.pool.query<Row>(`INSERT INTO pairing_codes
      (id, organization_id, code_hash, name, expires_at, max_uses, used_count, revoked_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [record.id, record.organization_id, record.code_hash,
      record.name, record.expires_at, record.max_uses, record.used_count, record.revoked_at, record.created_at]);
    return pairingFromRow(result.rows[0]!);
  }

  async consumePairingCode(codeHash: string, now: string): Promise<PairingCodeRecord | null> {
    const result = await this.pool.query<Row>(`UPDATE pairing_codes SET used_count=used_count+1
      WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at>$2 AND used_count<max_uses RETURNING *`, [codeHash, now]);
    return result.rows[0] ? pairingFromRow(result.rows[0]) : null;
  }

  async pairAgent(record: AgentRecord): Promise<AgentRecord> {
    const result = await this.pool.query<Row>(`INSERT INTO agents
      (id, organization_id, installation_id, name, hostname_hash, platform, protocol_versions, token_hash, status,
       capabilities, capability_sha256, paired_at, last_seen_at, revoked_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14)
      ON CONFLICT (organization_id, installation_id) DO UPDATE SET
        name=EXCLUDED.name, hostname_hash=EXCLUDED.hostname_hash, platform=EXCLUDED.platform,
        protocol_versions=EXCLUDED.protocol_versions, token_hash=EXCLUDED.token_hash, status='offline',
        capabilities=NULL, capability_sha256=NULL, last_seen_at=NULL, revoked_at=NULL
      RETURNING *`, [record.id, record.organization_id, record.installation_id, record.name, record.hostname_hash,
      JSON.stringify(record.platform), JSON.stringify(record.protocol_versions), record.token_hash, record.status,
      JSON.stringify(record.capabilities), record.capability_sha256, record.paired_at, record.last_seen_at, record.revoked_at]);
    return agentFromRow(result.rows[0]!);
  }

  async findAgentByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
    const result = await this.pool.query<Row>('SELECT * FROM agents WHERE token_hash=$1 LIMIT 1', [tokenHash]);
    return result.rows[0] ? agentFromRow(result.rows[0]) : null;
  }

  async getAgent(agentId: string): Promise<AgentRecord | null> {
    const result = await this.pool.query<Row>('SELECT * FROM agents WHERE id=$1 LIMIT 1', [agentId]);
    return result.rows[0] ? agentFromRow(result.rows[0]) : null;
  }

  async updateAgentHeartbeat(agentId: string, capabilities: AgentCapabilitiesV1, now: string): Promise<AgentRecord | null> {
    const result = await this.pool.query<Row>(`UPDATE agents SET capabilities=$2::jsonb, capability_sha256=$3,
      status=$4, last_seen_at=$5 WHERE id=$1 AND revoked_at IS NULL RETURNING *`, [agentId, JSON.stringify(capabilities),
      capabilities.capability_sha256, capabilities.status, now]);
    return result.rows[0] ? agentFromRow(result.rows[0]) : null;
  }

  async revokeAgent(agentId: string, organizationId: string, now: string): Promise<boolean> {
    const result = await this.pool.query('UPDATE agents SET revoked_at=$3,status=\'revoked\' WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL',
      [agentId, organizationId, now]);
    return (result.rowCount ?? 0) > 0;
  }

  async createArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
    const result = await this.pool.query<Row>(`INSERT INTO artifacts
      (id, organization_id, job_id, role, type, format, storage_key, sha256, size_bytes, media_type, status,
       retention_until, created_at, verified_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [record.id, record.organization_id,
      record.job_id, record.role, record.type, record.format, record.storage_key, record.sha256, record.size_bytes,
      record.media_type, record.status, record.retention_until, record.created_at, record.verified_at]);
    return artifactFromRow(result.rows[0]!);
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord | null> {
    const result = await this.pool.query<Row>('SELECT * FROM artifacts WHERE id=$1 LIMIT 1', [artifactId]);
    return result.rows[0] ? artifactFromRow(result.rows[0]) : null;
  }

  async markArtifactVerified(artifactId: string, sha256Value: string, sizeBytes: number, now: string): Promise<ArtifactRecord | null> {
    const result = await this.pool.query<Row>(`UPDATE artifacts SET sha256=$2,size_bytes=$3,status='verified',verified_at=$4
      WHERE id=$1 AND (status<>'verified' OR (sha256=$2 AND size_bytes=$3)) RETURNING *`, [artifactId, sha256Value, sizeBytes, now]);
    return result.rows[0] ? artifactFromRow(result.rows[0]) : null;
  }

  async ensureOutputArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
    return this.tx(async (client) => {
      const existing = await client.query<Row>("SELECT * FROM artifacts WHERE job_id=$1 AND role='output' LIMIT 1", [record.job_id]);
      if (existing.rows[0]) return artifactFromRow(existing.rows[0]);
      const inserted = await client.query<Row>(`INSERT INTO artifacts
        (id, organization_id, job_id, role, type, format, storage_key, sha256, size_bytes, media_type, status,
         retention_until, created_at, verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
        record.id, record.organization_id, record.job_id, record.role, record.type, record.format, record.storage_key,
        record.sha256, record.size_bytes, record.media_type, record.status, record.retention_until, record.created_at, record.verified_at
      ]);
      await client.query('UPDATE jobs SET output_artifact_id=$2 WHERE id=$1', [record.job_id, record.id]);
      return artifactFromRow(inserted.rows[0]!);
    });
  }

  async createJobIdempotent(record: JobRecord, correlationId: string): Promise<{ job: JobRecord; created: boolean }> {
    return this.tx(async (client) => {
      const inserted = await client.query<Row>(`INSERT INTO jobs
        (id,organization_id,request_id,idempotency_key,source,operation,request,status,stage,priority,attempts,max_attempts,
         next_attempt_at,assigned_agent_id,lease_id,lease_expires_at,ack_at,result,error,cancel_requested_at,completed_at,
         dead_letter_at,output_artifact_id,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$25)
        ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING *`, [record.id, record.organization_id,
        record.request_id, record.idempotency_key, record.source, record.operation, JSON.stringify(record.request), record.status,
        record.stage, record.priority, record.attempts, record.max_attempts, record.next_attempt_at, record.assigned_agent_id,
        record.lease_id, record.lease_expires_at, record.ack_at, JSON.stringify(record.result), JSON.stringify(record.error),
        record.cancel_requested_at, record.completed_at, record.dead_letter_at, record.output_artifact_id, record.created_at, record.updated_at]);
      if (inserted.rows[0]) {
        const job = jobFromRow(inserted.rows[0]);
        await this.appendEvent(client, job, 'created', 'created', 0, 'Job creato.', {}, correlationId, record.created_at);
        await this.appendEvent(client, job, 'queued', 'queue', 0, 'Job inserito in coda.', {}, correlationId, record.created_at);
        return { job, created: true };
      }
      const existing = await client.query<Row>('SELECT * FROM jobs WHERE organization_id=$1 AND idempotency_key=$2',
        [record.organization_id, record.idempotency_key]);
      return { job: jobFromRow(existing.rows[0]!), created: false };
    });
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const result = await this.pool.query<Row>('SELECT * FROM jobs WHERE id=$1 LIMIT 1', [jobId]);
    return result.rows[0] ? jobFromRow(result.rows[0]) : null;
  }

  async listJobEvents(jobId: string): Promise<JobEventRecord[]> {
    const result = await this.pool.query<Row>('SELECT * FROM job_events WHERE job_id=$1 ORDER BY sequence', [jobId]);
    return result.rows.map(eventFromRow);
  }

  async requestCancellation(jobId: string, organizationId: string, now: string, correlationId: string): Promise<JobRecord | null> {
    return this.tx(async (client) => {
      const result = await client.query<Row>(`UPDATE jobs SET cancel_requested_at=COALESCE(cancel_requested_at,$3),
        status=CASE WHEN lease_id IS NULL THEN 'cancelled' ELSE 'cancel_requested' END,
        stage='cancel',updated_at=$3 WHERE id=$1 AND organization_id=$2 RETURNING *`, [jobId, organizationId, now]);
      if (!result.rows[0]) return null;
      const job = jobFromRow(result.rows[0]);
      await this.appendEvent(client, job, job.status, 'cancel', null, job.status === 'cancelled' ? 'Job cancellato.' : 'Cancellazione richiesta.', {}, correlationId, now);
      return job;
    });
  }

  async requeueExpired(now: string): Promise<JobRecord[]> {
    return this.tx(async (client) => {
      const result = await client.query<Row>(`UPDATE jobs SET
        status=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' WHEN attempts>=max_attempts THEN 'expired' ELSE 'retrying' END,
        stage=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancel' WHEN attempts>=max_attempts THEN 'lease' ELSE 'queue' END,
        next_attempt_at=CASE WHEN attempts<max_attempts AND cancel_requested_at IS NULL THEN $1 ELSE next_attempt_at END,
        dead_letter_at=CASE WHEN attempts>=max_attempts AND cancel_requested_at IS NULL THEN $1 ELSE dead_letter_at END,
        assigned_agent_id=NULL,lease_id=NULL,lease_expires_at=NULL,updated_at=$1
        WHERE lease_expires_at<$1 AND status = ANY($2::text[]) RETURNING *`, [now,
        ['leased','assigned','downloading','preparing','slicing','validating','postprocessing','uploading','cancel_requested']]);
      return result.rows.map(jobFromRow);
    });
  }

  async findLeaseCandidates(organizationId: string, candidateIds: string[], now: string, limit: number): Promise<JobRecord[]> {
    const result = await this.pool.query<Row>(`SELECT * FROM jobs WHERE organization_id=$1
      AND status = ANY($2::text[]) AND cancel_requested_at IS NULL AND next_attempt_at<=$3
      AND ($4::text[] = '{}'::text[] OR id=ANY($4::text[]))
      ORDER BY priority DESC, created_at ASC LIMIT $5`, [organizationId, ['queued','retrying'], now, candidateIds, limit]);
    return result.rows.map(jobFromRow);
  }

  async claimJob(jobId: string, agentId: string, leaseId: string, leaseExpiresAt: string, now: string, correlationId: string): Promise<JobRecord | null> {
    return this.tx(async (client) => {
      const result = await client.query<Row>(`UPDATE jobs SET status='leased',stage='lease',assigned_agent_id=$2,lease_id=$3,
        lease_expires_at=$4,attempts=attempts+1,updated_at=$5 WHERE id=$1 AND status=ANY($6::text[])
        AND cancel_requested_at IS NULL AND next_attempt_at<=$5 AND lease_id IS NULL RETURNING *`,
      [jobId, agentId, leaseId, leaseExpiresAt, now, ['queued','retrying']]);
      if (!result.rows[0]) return null;
      const job = jobFromRow(result.rows[0]);
      await this.appendEvent(client, job, 'leased', 'lease', 0, 'Lease assegnato.', { lease_id: leaseId, agent_id: agentId }, correlationId, now);
      return job;
    });
  }

  async ackJob(jobId: string, agentId: string, leaseId: string, now: string, correlationId: string): Promise<JobRecord | null> {
    return this.tx(async (client) => {
      const current = await client.query<Row>('SELECT * FROM jobs WHERE id=$1 AND assigned_agent_id=$2 AND lease_id=$3 FOR UPDATE', [jobId, agentId, leaseId]);
      if (!current.rows[0]) return null;
      let job = jobFromRow(current.rows[0]);
      if (job.ack_at) return job;
      const updated = await client.query<Row>("UPDATE jobs SET status='assigned',stage='lease',ack_at=$4,updated_at=$4 WHERE id=$1 AND assigned_agent_id=$2 AND lease_id=$3 RETURNING *", [jobId, agentId, leaseId, now]);
      job = jobFromRow(updated.rows[0]!);
      await this.appendEvent(client, job, 'assigned', 'lease', 1, 'Lease confermato dall’Agent.', {}, correlationId, now);
      return job;
    });
  }

  async progressJob(input: { job_id: string; agent_id: string; lease_id: string; status: JobRecord['status']; stage: JobRecord['stage']; progress_percent: number; message: string; lease_expires_at: string; now: string; correlation_id: string }): Promise<JobRecord | null> {
    return this.tx(async (client) => {
      const result = await client.query<Row>(`UPDATE jobs SET status=$4,stage=$5,lease_expires_at=$6,updated_at=$7
        WHERE id=$1 AND assigned_agent_id=$2 AND lease_id=$3 RETURNING *`, [input.job_id,input.agent_id,input.lease_id,
        input.status,input.stage,input.lease_expires_at,input.now]);
      if (!result.rows[0]) return null;
      const job = jobFromRow(result.rows[0]);
      await this.appendEvent(client, job, input.status, input.stage, input.progress_percent, input.message, {}, input.correlation_id, input.now);
      return job;
    });
  }

  async completeJob(input: { job_id: string; agent_id: string; lease_id: string; result: JobResultV1; now: string; correlation_id: string }): Promise<{ job: JobRecord; idempotent: boolean } | null> {
    return this.tx(async (client) => {
      const current = await client.query<Row>('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [input.job_id]);
      if (!current.rows[0]) return null;
      const existing = jobFromRow(current.rows[0]);
      if (existing.status === 'completed' && existing.result) {
        if (JSON.stringify(existing.result) !== JSON.stringify(input.result)) throw new BackendError('completion_conflict', 'Job già completato con un risultato differente.', { statusCode: 409 });
        return { job: existing, idempotent: true };
      }
      if (existing.assigned_agent_id !== input.agent_id || existing.lease_id !== input.lease_id) return null;
      const updated = await client.query<Row>(`UPDATE jobs SET status='completed',stage='complete',result=$4::jsonb,
        completed_at=$5,updated_at=$5,lease_expires_at=NULL WHERE id=$1 AND assigned_agent_id=$2 AND lease_id=$3 RETURNING *`,
      [input.job_id,input.agent_id,input.lease_id,JSON.stringify(input.result),input.now]);
      const job = jobFromRow(updated.rows[0]!);
      await this.appendEvent(client, job, 'completed', 'complete', 100, 'Job completato.', {}, input.correlation_id, input.now);
      return { job, idempotent: false };
    });
  }

  async failJob(input: { job_id: string; agent_id: string; lease_id: string; error: StructuredError; retry_at: string | null; now: string; correlation_id: string }): Promise<JobRecord | null> {
    return this.tx(async (client) => {
      const result = await client.query<Row>(`UPDATE jobs SET error=$4::jsonb,
        status=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' WHEN $5::timestamptz IS NOT NULL THEN 'retrying' ELSE 'failed' END,
        stage=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancel' WHEN $5::timestamptz IS NOT NULL THEN 'queue' ELSE 'complete' END,
        next_attempt_at=COALESCE($5,next_attempt_at),dead_letter_at=CASE WHEN $5::timestamptz IS NULL AND cancel_requested_at IS NULL THEN $6 ELSE dead_letter_at END,
        assigned_agent_id=NULL,lease_id=NULL,lease_expires_at=NULL,updated_at=$6
        WHERE id=$1 AND assigned_agent_id=$2 AND lease_id=$3 RETURNING *`, [input.job_id,input.agent_id,input.lease_id,
        JSON.stringify(input.error),input.retry_at,input.now]);
      if (!result.rows[0]) return null;
      const job = jobFromRow(result.rows[0]);
      await this.appendEvent(client, job, job.status, job.stage, null,
        job.status === 'retrying' ? 'Job pianificato per un nuovo tentativo.' : job.status === 'cancelled' ? 'Job cancellato.' : 'Job fallito definitivamente.',
        { error: input.error }, input.correlation_id, input.now);
      return job;
    });
  }
}
