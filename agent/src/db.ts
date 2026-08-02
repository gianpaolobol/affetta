import type { SqliteDatabase } from './sqlite-driver.js';
import { openSqlite } from './sqlite-driver.js';
import type {
  AgentStructuredError,
  JobResultV1,
  JobStage,
  JobStatus,
  LeaseEnvelope,
  StoredCredentials,
  StoredJob
} from './types.js';
import { SecretVault } from './secret-vault.js';
import { nowIso } from './time.js';

interface JobRow {
  cloud_job_id: string;
  local_job_id: string | null;
  lease_id: string;
  lease_expires_at: string;
  state: JobStatus;
  stage: JobStage;
  request_json: string;
  lease_json: string;
  input_path: string | null;
  output_path: string | null;
  output_sha256: string | null;
  result_json: string | null;
  error_json: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export class AgentDatabase {
  readonly driver: string;
  private readonly db: SqliteDatabase;
  private readonly vault: SecretVault;

  private constructor(db: SqliteDatabase, driver: string, vault: SecretVault) {
    this.db = db;
    this.driver = driver;
    this.vault = vault;
    this.migrate();
  }

  static async open(databasePath: string, secretKeyPath: string): Promise<AgentDatabase> {
    const opened = await openSqlite(databasePath);
    return new AgentDatabase(opened.database, opened.driver, new SecretVault(secretKeyPath));
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        agent_id TEXT NOT NULL,
        access_token_enc TEXT NOT NULL,
        paired_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS jobs (
        cloud_job_id TEXT PRIMARY KEY,
        local_job_id TEXT,
        lease_id TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        state TEXT NOT NULL,
        stage TEXT NOT NULL,
        request_json TEXT NOT NULL,
        lease_json TEXT NOT NULL,
        input_path TEXT,
        output_path TEXT,
        output_sha256 TEXT,
        result_json TEXT,
        error_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cloud_job_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT,
        UNIQUE (cloud_job_id, sequence),
        FOREIGN KEY (cloud_job_id) REFERENCES jobs(cloud_job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS downloads (
        artifact_id TEXT PRIMARY KEY,
        cloud_job_id TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (cloud_job_id) REFERENCES jobs(cloud_job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS uploads (
        artifact_id TEXT PRIMARY KEY,
        cloud_job_id TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (cloud_job_id) REFERENCES jobs(cloud_job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        cloud_job_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT,
        FOREIGN KEY (cloud_job_id) REFERENCES jobs(cloud_job_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, updated_at);
      CREATE INDEX IF NOT EXISTS idx_events_sync ON job_events(synced_at, id);
    `);
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(nowIso());
  }

  close(): void { this.db.close(); }

  saveCredentials(credentials: StoredCredentials): void {
    this.db.prepare(`
      INSERT INTO agent(singleton, agent_id, access_token_enc, paired_at, revoked_at)
      VALUES(1, ?, ?, ?, NULL)
      ON CONFLICT(singleton) DO UPDATE SET
        agent_id=excluded.agent_id,
        access_token_enc=excluded.access_token_enc,
        paired_at=excluded.paired_at,
        revoked_at=NULL
    `).run(credentials.agent_id, this.vault.encrypt(credentials.access_token), credentials.paired_at);
  }

  getCredentials(): StoredCredentials | null {
    const row = this.db.prepare('SELECT agent_id, access_token_enc, paired_at, revoked_at FROM agent WHERE singleton=1').get() as {
      agent_id: string;
      access_token_enc: string;
      paired_at: string;
      revoked_at: string | null;
    } | undefined;
    if (!row || row.revoked_at) return null;
    return { agent_id: row.agent_id, access_token: this.vault.decrypt(row.access_token_enc), paired_at: row.paired_at };
  }

  markRevoked(): void {
    this.db.prepare('UPDATE agent SET revoked_at=? WHERE singleton=1').run(nowIso());
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(key, value, nowIso());
  }

  upsertLease(lease: LeaseEnvelope): StoredJob {
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO jobs(
        cloud_job_id, local_job_id, lease_id, lease_expires_at, state, stage,
        request_json, lease_json, input_path, output_path, output_sha256,
        result_json, error_json, attempts, created_at, updated_at
      ) VALUES(?, NULL, ?, ?, 'leased', 'lease', ?, ?, NULL, NULL, NULL, NULL, NULL, 1, ?, ?)
      ON CONFLICT(cloud_job_id) DO UPDATE SET
        lease_id=excluded.lease_id,
        lease_expires_at=excluded.lease_expires_at,
        lease_json=excluded.lease_json,
        attempts=jobs.attempts + CASE WHEN jobs.lease_id = excluded.lease_id THEN 0 ELSE 1 END,
        updated_at=excluded.updated_at
    `).run(
      lease.job_id,
      lease.lease_id,
      lease.lease_expires_at,
      JSON.stringify(lease.request),
      JSON.stringify(lease),
      now,
      now
    );
    this.db.prepare(`
      INSERT INTO leases(lease_id, cloud_job_id, expires_at, released_at)
      VALUES(?, ?, ?, NULL)
      ON CONFLICT(lease_id) DO UPDATE SET expires_at=excluded.expires_at
    `).run(lease.lease_id, lease.job_id, lease.lease_expires_at);
    const job = this.getJob(lease.job_id);
    if (!job) throw new Error('Persistenza lease non riuscita.');
    return job;
  }

  getJob(cloudJobId: string): StoredJob | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE cloud_job_id=?').get(cloudJobId) as JobRow | undefined;
    return row ? this.mapJob(row) : null;
  }

  getRecoverableJobs(): StoredJob[] {
    const terminal = ['completed', 'cancelled', 'failed', 'expired'];
    const placeholders = terminal.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE state NOT IN (${placeholders}) ORDER BY updated_at ASC`).all(...terminal) as JobRow[];
    return rows.map((row) => this.mapJob(row));
  }

  activeJobCount(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM jobs
      WHERE state NOT IN ('completed', 'cancelled', 'failed', 'expired')
    `).get() as { count: number };
    return Number(row.count);
  }

  updateJob(cloudJobId: string, patch: {
    local_job_id?: string | null;
    lease_expires_at?: string;
    state?: JobStatus;
    stage?: JobStage;
    input_path?: string | null;
    output_path?: string | null;
    output_sha256?: string | null;
    result?: JobResultV1 | null;
    error?: AgentStructuredError | null;
  }): StoredJob {
    const current = this.getJob(cloudJobId);
    if (!current) throw new Error(`Job ${cloudJobId} non trovato.`);
    const next = {
      local_job_id: patch.local_job_id === undefined ? current.local_job_id : patch.local_job_id,
      lease_expires_at: patch.lease_expires_at ?? current.lease_expires_at,
      state: patch.state ?? current.state,
      stage: patch.stage ?? current.stage,
      input_path: patch.input_path === undefined ? current.input_path : patch.input_path,
      output_path: patch.output_path === undefined ? current.output_path : patch.output_path,
      output_sha256: patch.output_sha256 === undefined ? current.output_sha256 : patch.output_sha256,
      result: patch.result === undefined ? current.result : patch.result,
      error: patch.error === undefined ? current.error : patch.error
    };
    this.db.prepare(`
      UPDATE jobs SET
        local_job_id=?, lease_expires_at=?, state=?, stage=?, input_path=?, output_path=?,
        output_sha256=?, result_json=?, error_json=?, updated_at=?
      WHERE cloud_job_id=?
    `).run(
      next.local_job_id,
      next.lease_expires_at,
      next.state,
      next.stage,
      next.input_path,
      next.output_path,
      next.output_sha256,
      next.result ? JSON.stringify(next.result) : null,
      next.error ? JSON.stringify(next.error) : null,
      nowIso(),
      cloudJobId
    );
    const updated = this.getJob(cloudJobId);
    if (!updated) throw new Error('Aggiornamento job non riuscito.');
    return updated;
  }

  recordEvent(cloudJobId: string, eventType: string, status: JobStatus, stage: JobStage, payload: Record<string, unknown> = {}): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM job_events WHERE cloud_job_id=?').get(cloudJobId) as { sequence: number };
    this.db.prepare(`
      INSERT INTO job_events(cloud_job_id, sequence, event_type, status, stage, payload_json, created_at, synced_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(cloudJobId, row.sequence, eventType, status, stage, JSON.stringify(payload), nowIso());
    return row.sequence;
  }

  markLeaseReleased(leaseId: string): void {
    this.db.prepare('UPDATE leases SET released_at=? WHERE lease_id=?').run(nowIso(), leaseId);
  }

  saveDownload(artifactId: string, cloudJobId: string, filePath: string, sha256: string, sizeBytes: number): void {
    this.db.prepare(`
      INSERT INTO downloads(artifact_id, cloud_job_id, path, sha256, size_bytes, completed_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, sha256=excluded.sha256, size_bytes=excluded.size_bytes, completed_at=excluded.completed_at
    `).run(artifactId, cloudJobId, filePath, sha256, sizeBytes, nowIso());
  }

  saveUpload(artifactId: string, cloudJobId: string, filePath: string, sha256: string, sizeBytes: number): void {
    this.db.prepare(`
      INSERT INTO uploads(artifact_id, cloud_job_id, path, sha256, size_bytes, completed_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, sha256=excluded.sha256, size_bytes=excluded.size_bytes, completed_at=excluded.completed_at
    `).run(artifactId, cloudJobId, filePath, sha256, sizeBytes, nowIso());
  }

  hasUpload(artifactId: string, sha256: string): boolean {
    const row = this.db.prepare('SELECT sha256 FROM uploads WHERE artifact_id=?').get(artifactId) as { sha256: string } | undefined;
    return row?.sha256 === sha256;
  }

  summary(): Record<string, unknown> {
    const states = this.db.prepare('SELECT state, COUNT(*) AS count FROM jobs GROUP BY state ORDER BY state').all() as Array<{ state: string; count: number }>;
    return { driver: this.driver, active_jobs: this.activeJobCount(), jobs_by_state: states };
  }

  private mapJob(row: JobRow): StoredJob {
    return {
      cloud_job_id: row.cloud_job_id,
      local_job_id: row.local_job_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      state: row.state,
      stage: row.stage,
      request: JSON.parse(row.request_json),
      lease: JSON.parse(row.lease_json),
      input_path: row.input_path,
      output_path: row.output_path,
      output_sha256: row.output_sha256,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error_json ? JSON.parse(row.error_json) : null,
      attempts: row.attempts,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
