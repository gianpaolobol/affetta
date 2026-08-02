import type { AgentConfig } from './config.js';
import { downloadSignedFile, requestJson, uploadSignedFile } from './http.js';
import type {
  AgentCapabilitiesV1,
  AgentStructuredError,
  JobResultV1,
  JobStage,
  JobStatus,
  LeaseEnvelope,
  PairResponse,
  SignedTransfer,
  StoredCredentials
} from './types.js';

export class CloudClient {
  constructor(private readonly config: AgentConfig, private credentials: StoredCredentials | null) {}

  setCredentials(credentials: StoredCredentials): void { this.credentials = credentials; }

  private url(pathname: string): string { return `${this.config.cloudBaseUrl}${pathname}`; }
  private authHeaders(): Record<string, string> {
    return this.credentials ? { Authorization: `Bearer ${this.credentials.access_token}` } : {};
  }

  async pair(payload: Record<string, unknown>): Promise<PairResponse> {
    return requestJson<PairResponse>(this.url('/v1/agents/pair'), {
      method: 'POST', body: payload, timeoutMs: this.config.httpTimeoutMs, stage: 'pairing'
    });
  }

  async heartbeat(capabilities: AgentCapabilitiesV1): Promise<{ revoked?: boolean }> {
    if (!this.credentials) throw new Error('Agent non associato.');
    return requestJson(this.url(`/v1/agents/${encodeURIComponent(this.credentials.agent_id)}/heartbeat`), {
      method: 'POST', headers: this.authHeaders(), body: capabilities,
      timeoutMs: this.config.httpTimeoutMs, stage: 'heartbeat'
    });
  }

  async lease(): Promise<LeaseEnvelope | null> {
    if (!this.credentials) throw new Error('Agent non associato.');
    const response = await requestJson<{ lease: LeaseEnvelope | null }>(
      this.url(`/v1/agents/${encodeURIComponent(this.credentials.agent_id)}/lease`),
      {
        method: 'POST', headers: this.authHeaders(), body: { max_jobs: 1 },
        timeoutMs: this.config.httpTimeoutMs, stage: 'lease'
      }
    );
    return response.lease;
  }

  async ack(jobId: string, leaseId: string): Promise<void> {
    await requestJson(this.url(`/v1/jobs/${encodeURIComponent(jobId)}/ack`), {
      method: 'POST', headers: this.authHeaders(), body: { lease_id: leaseId },
      timeoutMs: this.config.httpTimeoutMs, stage: 'lease'
    });
  }

  async progress(jobId: string, payload: {
    lease_id: string;
    status: JobStatus;
    stage: JobStage;
    progress_percent: number;
    message: string;
  }): Promise<{ lease_expires_at?: string }> {
    return requestJson(this.url(`/v1/jobs/${encodeURIComponent(jobId)}/progress`), {
      method: 'POST', headers: this.authHeaders(), body: payload,
      timeoutMs: this.config.httpTimeoutMs, stage: payload.stage
    });
  }

  async complete(jobId: string, leaseId: string, result: JobResultV1): Promise<void> {
    await requestJson(this.url(`/v1/jobs/${encodeURIComponent(jobId)}/complete`), {
      method: 'POST', headers: this.authHeaders(), body: { lease_id: leaseId, result },
      timeoutMs: this.config.httpTimeoutMs, stage: 'complete'
    });
  }

  async fail(jobId: string, leaseId: string, error: AgentStructuredError): Promise<void> {
    await requestJson(this.url(`/v1/jobs/${encodeURIComponent(jobId)}/fail`), {
      method: 'POST', headers: this.authHeaders(), body: { lease_id: leaseId, error },
      timeoutMs: this.config.httpTimeoutMs, stage: 'complete'
    });
  }

  async uploadComplete(jobId: string, transfer: SignedTransfer, leaseId: string, metadata: {
    sha256: string;
    size_bytes: number;
  }): Promise<void> {
    await requestJson(this.url(`/v1/artifacts/${encodeURIComponent(transfer.artifact_id)}/upload-complete`), {
      method: 'POST', headers: this.authHeaders(), body: { job_id: jobId, lease_id: leaseId, ...metadata },
      timeoutMs: this.config.httpTimeoutMs, stage: 'uploading'
    });
  }

  download(transfer: SignedTransfer, destination: string, expected: { sha256: string; size_bytes: number }): Promise<{ sha256: string; size_bytes: number }> {
    return downloadSignedFile(this.config, transfer.url, destination, {
      ...(transfer.headers ? { headers: transfer.headers } : {}),
      expectedSha256: expected.sha256,
      expectedSizeBytes: expected.size_bytes
    });
  }

  upload(transfer: SignedTransfer, source: string): Promise<void> {
    return uploadSignedFile(this.config, transfer.url, source, transfer.headers);
  }
}
