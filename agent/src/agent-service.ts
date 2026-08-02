import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { AgentConfig } from './config.js';
import type { AgentDatabase } from './db.js';
import { AgentError, normalizeAgentError } from './errors.js';
import type { CloudClient } from './cloud-client.js';
import type { LocalAffettaClient } from './local-affetta-client.js';
import type { Logger } from './logger.js';
import { collectCapabilities } from './capabilities.js';
import { JobRunner } from './job-runner.js';
import type { StoredCredentials } from './types.js';
import { sleep } from './time.js';

export class AgentService {
  private credentials: StoredCredentials | null;
  private stopped = false;
  private lastHeartbeatAt = 0;

  constructor(
    private readonly config: AgentConfig,
    private readonly db: AgentDatabase,
    private readonly cloud: CloudClient,
    private readonly local: LocalAffettaClient,
    private readonly logger: Logger
  ) {
    this.credentials = db.getCredentials();
  }

  stop(): void { this.stopped = true; }

  async start(options: { once?: boolean } = {}): Promise<void> {
    await this.ensurePaired();
    if (!this.credentials) throw new Error('Pairing non riuscito.');
    const runner = new JobRunner(this.config, this.db, this.cloud, this.local, this.logger);
    this.logger.info('agent_started', { agent_id: this.credentials.agent_id, once: Boolean(options.once), sqlite_driver: this.db.driver });

    const recoverable = this.db.getRecoverableJobs();
    for (const job of recoverable) {
      if (this.stopped) break;
      if (new Date(job.lease_expires_at).getTime() <= Date.now()) {
        this.logger.warn('recovery_skipped_expired_lease', { job_id: job.cloud_job_id, lease_id: job.lease_id });
        continue;
      }
      this.logger.info('job_recovery_started', { job_id: job.cloud_job_id, local_job_id: job.local_job_id });
      await runner.runLease(job.lease);
    }

    do {
      try {
        await this.heartbeatIfDue(true);
        const lease = await this.cloud.lease();
        if (lease) await runner.runLease(lease);
      } catch (error) {
        if (error instanceof AgentError && [401, 403].includes(error.statusCode || 0)) {
          this.db.markRevoked();
          this.logger.error('agent_revoked', { error: normalizeAgentError(error, 'authorization') });
          throw error;
        }
        this.logger.error('agent_loop_error', { error: normalizeAgentError(error, 'agent_loop') });
        if (options.once) throw error;
      }
      if (options.once) break;
      await sleep(this.config.pollMs);
      await this.heartbeatIfDue(false);
    } while (!this.stopped);
    this.logger.info('agent_stopped', {});
  }

  private async ensurePaired(): Promise<void> {
    if (this.credentials) {
      this.cloud.setCredentials(this.credentials);
      return;
    }
    if (!this.config.pairingCode) {
      throw new AgentError('pairing_required', 'AFFETTA_PAIRING_CODE è obbligatorio al primo avvio.', { stage: 'pairing' });
    }
    let installationId = this.db.getSetting('installation_id');
    if (!installationId) {
      installationId = `install_${randomUUID()}`;
      this.db.setSetting('installation_id', installationId);
    }
    const response = await this.cloud.pair({
      pairing_code: this.config.pairingCode,
      installation_id: installationId,
      name: this.config.agentName,
      hostname_hash: await import('./hash.js').then(({ sha256Buffer }) => sha256Buffer(os.hostname().toLowerCase())),
      platform: { os: process.platform, arch: process.arch, node_version: process.version },
      protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1']
    });
    this.credentials = {
      agent_id: response.agent_id,
      access_token: response.access_token,
      paired_at: response.paired_at
    };
    this.db.saveCredentials(this.credentials);
    this.cloud.setCredentials(this.credentials);
    this.logger.info('agent_paired', { agent_id: response.agent_id, paired_at: response.paired_at });
  }

  private async heartbeatIfDue(force: boolean): Promise<void> {
    if (!this.credentials) return;
    if (!force && Date.now() - this.lastHeartbeatAt < this.config.heartbeatMs) return;
    const capabilities = await collectCapabilities(this.config, this.db, this.local, this.credentials.agent_id);
    const response = await this.cloud.heartbeat(capabilities);
    if (response.revoked) {
      this.db.markRevoked();
      throw new AgentError('agent_revoked', 'Agent revocato dal backend.', { stage: 'heartbeat', statusCode: 401 });
    }
    this.lastHeartbeatAt = Date.now();
    this.logger.info('heartbeat_sent', {
      agent_id: this.credentials.agent_id,
      capability_sha256: capabilities.capability_sha256,
      active_jobs: capabilities.active_jobs,
      status: capabilities.status
    });
  }
}
