import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from './config.js';
import type { AgentDatabase } from './db.js';
import { AgentError, normalizeAgentError } from './errors.js';
import { sha256File } from './hash.js';
import type { CloudClient } from './cloud-client.js';
import type { LocalAffettaClient } from './local-affetta-client.js';
import type { Logger } from './logger.js';
import { buildJobResult } from './result-builder.js';
import type { JobStage, JobStatus, LeaseEnvelope, LocalJob, OutputArtifact, OutputFormat, StoredJob } from './types.js';
import { sleep } from './time.js';

function safeName(value: string): string {
  return path.basename(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160) || 'model.stl';
}

function mapLocalState(job: LocalJob): { status: JobStatus; stage: JobStage; progress: number } {
  const phase = String(job.phase || '').toLowerCase();
  if (job.status === 'queued') return { status: 'queued', stage: 'queue', progress: Number(job.progress || 5) };
  if (phase.includes('postprocess')) return { status: 'postprocessing', stage: 'postprocess', progress: Number(job.progress || 92) };
  if (phase.includes('validate')) return { status: 'validating', stage: 'validate', progress: Number(job.progress || 82) };
  if (phase.includes('slice') || job.status === 'running') return { status: 'slicing', stage: 'slice', progress: Number(job.progress || 20) };
  return { status: 'preparing', stage: 'prepare', progress: Number(job.progress || 10) };
}

export class JobRunner {
  constructor(
    private readonly config: AgentConfig,
    private readonly db: AgentDatabase,
    private readonly cloud: CloudClient,
    private readonly local: LocalAffettaClient,
    private readonly logger: Logger
  ) {}

  async runLease(lease: LeaseEnvelope): Promise<void> {
    let job = this.db.upsertLease(lease);
    let current = { status: job.state, stage: job.stage, progress: 0, message: 'Lease acquisito' };
    let renewing = false;
    let renewalStopped = false;
    let renewalInFlight: Promise<void> | null = null;
    const renew = async (): Promise<void> => {
      if (renewalStopped || renewing) return;
      renewing = true;
      try {
        const response = await this.cloud.progress(job.cloud_job_id, {
          lease_id: job.lease_id,
          status: current.status,
          stage: current.stage,
          progress_percent: current.progress,
          message: current.message
        });
        if (response.lease_expires_at) {
          job = this.db.updateJob(job.cloud_job_id, { lease_expires_at: response.lease_expires_at });
        }
      } catch (error) {
        this.logger.warn('lease_renew_failed', { job_id: job.cloud_job_id, error: normalizeAgentError(error, current.stage) });
      } finally {
        renewing = false;
      }
    };
    const renewalTimer = setInterval(() => {
      if (renewalStopped || renewalInFlight) return;
      renewalInFlight = renew().finally(() => { renewalInFlight = null; });
    }, this.config.leaseRenewMs);
    const report = async (status: JobStatus, stage: JobStage, progress: number, message: string): Promise<void> => {
      current = { status, stage, progress, message };
      job = this.db.updateJob(job.cloud_job_id, { state: status, stage, error: null });
      const sequence = this.db.recordEvent(job.cloud_job_id, 'state_changed', status, stage, { progress_percent: progress, message });
      const response = await this.cloud.progress(job.cloud_job_id, {
        lease_id: job.lease_id,
        status, stage, progress_percent: progress, message
      });
      if (response.lease_expires_at) job = this.db.updateJob(job.cloud_job_id, { lease_expires_at: response.lease_expires_at });
      this.logger.info('job_progress', { job_id: job.cloud_job_id, sequence, status, stage, progress });
    };

    try {
      await this.cloud.ack(job.cloud_job_id, job.lease_id);
      await report('assigned', 'lease', 1, 'Job assegnato all’Agent');
      const inputPath = await this.ensureInput(job, report);
      job = this.db.getJob(job.cloud_job_id) || job;
      const localJob = await this.ensureLocalJob(job, inputPath, report);
      job = this.db.getJob(job.cloud_job_id) || job;
      const output = await this.ensureOutput(job, localJob, report);
      job = this.db.getJob(job.cloud_job_id) || job;
      await report('uploading', 'upload_result', 96, 'Caricamento artefatto verificato');
      if (!this.db.hasUpload(job.lease.output_upload.artifact_id, output.artifact.sha256)) {
        await this.cloud.upload(job.lease.output_upload, output.path);
        await this.cloud.uploadComplete(job.cloud_job_id, job.lease.output_upload, job.lease_id, {
          sha256: output.artifact.sha256,
          size_bytes: output.artifact.size_bytes
        });
        this.db.saveUpload(job.lease.output_upload.artifact_id, job.cloud_job_id, output.path, output.artifact.sha256, output.artifact.size_bytes);
      }
      const result = job.result || await buildJobResult({
        local: this.local,
        cloudJobId: job.cloud_job_id,
        request: job.request,
        localJob,
        artifact: output.artifact
      });
      job = this.db.updateJob(job.cloud_job_id, { result, output_path: output.path, output_sha256: output.artifact.sha256 });
      await this.cloud.complete(job.cloud_job_id, job.lease_id, result);
      this.db.updateJob(job.cloud_job_id, { state: 'completed', stage: 'complete', error: null });
      this.db.recordEvent(job.cloud_job_id, 'state_changed', 'completed', 'complete', { progress_percent: 100 });
      this.db.markLeaseReleased(job.lease_id);
      this.cleanupCompleted(job);
      this.logger.info('job_completed', { job_id: job.cloud_job_id, local_job_id: job.local_job_id, output_sha256: output.artifact.sha256 });
    } catch (error) {
      const normalized = normalizeAgentError(error, current.stage);
      const state: JobStatus = normalized.retryable ? 'retrying' : 'failed';
      this.db.updateJob(job.cloud_job_id, { state, stage: current.stage, error: normalized });
      this.db.recordEvent(job.cloud_job_id, 'warning', state, current.stage, { error: normalized });
      try { await this.cloud.fail(job.cloud_job_id, job.lease_id, normalized); }
      catch (reportError) {
        this.logger.error('job_failure_report_failed', { job_id: job.cloud_job_id, error: normalizeAgentError(reportError, 'complete') });
      }
      this.logger.error('job_failed', { job_id: job.cloud_job_id, error: normalized });
    } finally {
      renewalStopped = true;
      clearInterval(renewalTimer);
      if (renewalInFlight) await renewalInFlight;
    }
  }

  private async ensureInput(
    job: StoredJob,
    report: (status: JobStatus, stage: JobStage, progress: number, message: string) => Promise<void>
  ): Promise<string> {
    const destination = job.input_path || path.join(this.config.downloadDir, `${safeName(job.cloud_job_id)}-${safeName(job.request.input.filename)}`);
    if (fs.existsSync(destination)) {
      const observed = await sha256File(destination);
      if (observed.sha256 === job.request.input.sha256 && observed.size_bytes === job.request.input.size_bytes) {
        this.db.updateJob(job.cloud_job_id, { input_path: destination });
        return destination;
      }
      fs.rmSync(destination, { force: true });
    }
    await report('downloading', 'download', 5, 'Download e verifica SHA-256 del modello');
    const observed = await this.cloud.download(job.lease.input_download, destination, {
      sha256: job.request.input.sha256,
      size_bytes: job.request.input.size_bytes
    });
    this.db.saveDownload(job.request.input.artifact_id, job.cloud_job_id, destination, observed.sha256, observed.size_bytes);
    this.db.updateJob(job.cloud_job_id, { input_path: destination });
    return destination;
  }

  private async ensureLocalJob(
    job: StoredJob,
    inputPath: string,
    report: (status: JobStatus, stage: JobStage, progress: number, message: string) => Promise<void>
  ): Promise<LocalJob> {
    let localJob: LocalJob;
    if (job.local_job_id) {
      localJob = await this.local.getJob(job.local_job_id);
    } else {
      await report('preparing', 'prepare', 10, 'Invio del modello ad Affetta locale');
      localJob = await this.local.createJob(job.request, inputPath);
      if (!localJob.id) throw new AgentError('local_job_id_missing', 'Affetta locale non ha restituito il job_id.', { stage: 'preparing' });
      this.db.updateJob(job.cloud_job_id, { local_job_id: localJob.id, state: 'slicing', stage: 'slice' });
      this.db.recordEvent(job.cloud_job_id, 'state_changed', 'slicing', 'slice', { local_job_id: localJob.id });
    }
    const startedAt = Date.now();
    let lastSignature = '';
    while (localJob.status !== 'completed') {
      if (localJob.status === 'failed' || localJob.error) {
        throw new AgentError(
          localJob.error?.code || 'local_slice_failed',
          localJob.error?.message || 'Slicing locale non riuscito.',
          {
            stage: localJob.error?.stage || 'slicing',
            retryable: false,
            details: { local_job_id: localJob.id }
          }
        );
      }
      if (Date.now() - startedAt > this.config.localJobTimeoutMs) {
        throw new AgentError('local_job_timeout', 'Il job locale ha superato il timeout.', {
          stage: 'slicing', retryable: true, details: { local_job_id: localJob.id }
        });
      }
      const mapped = mapLocalState(localJob);
      const signature = `${mapped.status}:${mapped.stage}:${Math.round(mapped.progress)}:${localJob.message || ''}`;
      if (signature !== lastSignature) {
        await report(mapped.status, mapped.stage, Math.max(10, Math.min(94, mapped.progress)), localJob.message || 'Slicing in corso');
        lastSignature = signature;
      }
      await sleep(Math.min(this.config.pollMs, 2000));
      localJob = await this.local.getJob(localJob.id);
    }
    return localJob;
  }

  private async ensureOutput(
    job: StoredJob,
    localJob: LocalJob,
    report: (status: JobStatus, stage: JobStage, progress: number, message: string) => Promise<void>
  ): Promise<{ path: string; artifact: OutputArtifact }> {
    const outputFormat: OutputFormat = localJob.result?.output_format || localJob.output_format || job.request.print_intent.requested_output_format || 'gcode';
    const requestedFormat = job.request.print_intent.requested_output_format;
    if (requestedFormat && requestedFormat !== outputFormat) {
      throw new AgentError('output_format_mismatch', 'Affetta locale ha prodotto un formato diverso da quello richiesto.', {
        stage: 'validating', details: { requested_output_format: requestedFormat, observed_output_format: outputFormat }
      });
    }
    const destination = job.output_path || path.join(this.config.uploadDir, `${safeName(job.cloud_job_id)}.${outputFormat}`);
    let observed: { sha256: string; size_bytes: number };
    if (fs.existsSync(destination) && job.output_sha256) {
      observed = await sha256File(destination);
      if (observed.sha256 !== job.output_sha256) {
        fs.rmSync(destination, { force: true });
        observed = await this.local.downloadArtifact(localJob, destination);
      }
    } else {
      await report(outputFormat === 'x3g' ? 'postprocessing' : 'validating', outputFormat === 'x3g' ? 'postprocess' : 'validate', 94, 'Recupero artefatto locale');
      observed = await this.local.downloadArtifact(localJob, destination);
    }
    if (observed.size_bytes <= 0) throw new AgentError('empty_output_artifact', 'Artefatto locale vuoto.', { stage: 'validating' });
    this.db.updateJob(job.cloud_job_id, { output_path: destination, output_sha256: observed.sha256 });
    return {
      path: destination,
      artifact: {
        artifact_id: job.lease.output_upload.artifact_id,
        type: outputFormat,
        format: outputFormat,
        sha256: observed.sha256,
        size_bytes: observed.size_bytes,
        media_type: outputFormat === 'x3g' ? 'application/octet-stream' : 'text/x-gcode'
      }
    };
  }

  private cleanupCompleted(job: StoredJob): void {
    for (const file of [job.input_path, job.output_path]) {
      if (!file) continue;
      try { fs.rmSync(file, { force: true }); }
      catch (error) { this.logger.warn('job_cleanup_failed', { job_id: job.cloud_job_id, file, error: String(error) }); }
    }
    this.db.updateJob(job.cloud_job_id, { input_path: null, output_path: null });
  }
}
