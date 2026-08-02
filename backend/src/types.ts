export type JobStatus =
  | 'created' | 'uploaded' | 'queued' | 'leased' | 'assigned' | 'downloading'
  | 'preparing' | 'slicing' | 'validating' | 'postprocessing' | 'uploading'
  | 'completed' | 'retrying' | 'manual_review' | 'cancel_requested' | 'cancelled'
  | 'failed' | 'expired';

export type JobStage =
  | 'created' | 'upload' | 'queue' | 'lease' | 'download' | 'prepare' | 'slice'
  | 'validate' | 'postprocess' | 'upload_result' | 'complete' | 'cancel' | 'unknown';

export type OutputFormat = 'gcode' | 'x3g';
export type EngineId = 'kiri' | 'cura' | 'prusa' | 'orca' | 'snapmaker_orca' | 'mock';

export interface JobRequestV1 {
  schema_version: 'affetta.job.v1';
  request_id: string;
  idempotency_key: string;
  source: string;
  operation: 'slice';
  created_at?: string;
  input: {
    artifact_id: string;
    filename: string;
    format: 'stl' | 'obj' | 'amf' | '3mf' | 'step';
    sha256: string;
    size_bytes: number;
    units?: 'millimeter';
  };
  print_intent: {
    material_id: string;
    quality_id: string;
    strength_id: string;
    color_id: string;
    quantity: number;
    nozzle_mm?: number;
    requested_output_format?: OutputFormat;
  };
  routing: {
    mode: 'automatic' | 'manual';
    require_production_ready: boolean;
    printer_profile_id?: string;
    fleet_unit_id?: string;
    preferred_engine?: EngineId;
  };
  extensions?: Record<string, unknown>;
}

export interface AgentCapabilitiesV1 {
  schema_version: 'affetta.agent-capabilities.v1';
  agent_id: string;
  observed_at: string;
  status: 'online' | 'degraded' | 'offline' | 'revoked';
  affetta_version: string;
  protocol_versions: Array<'affetta.job.v1' | 'affetta.result.v1' | 'affetta.event.v1'>;
  active_jobs: number;
  disk_free_bytes: number;
  platform: {
    os: 'windows' | 'linux' | 'macos';
    arch: 'x64' | 'arm64';
    node_version: string;
    hostname_hash: string;
  };
  engines: Array<{ id: EngineId; available: boolean; version?: string; diagnostic?: string }>;
  postprocessors: Array<{ id: 'gpx'; available: boolean; version?: string; diagnostic?: string }>;
  output_formats: OutputFormat[];
  printer_profiles: Array<{
    profile_id: string;
    profile_version: string;
    profile_sha256: string;
    profile_status: 'draft' | 'experimental' | 'validated' | 'verified' | 'deprecated';
    output_format: OutputFormat;
    materials: string[];
    nozzles_mm: number[];
    production_ready: boolean;
    physical_validation: 'pending' | 'passed' | 'failed' | 'not_required';
    fleet_unit_id?: string;
  }>;
  capability_sha256: string;
  extensions?: Record<string, unknown>;
}

export interface StructuredError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  details: Record<string, unknown>;
  correlation_id?: string;
}

export interface JobResultV1 {
  schema_version: 'affetta.result.v1';
  job_id: string;
  request_id: string;
  idempotency_key: string;
  status: 'completed';
  updated_at: string;
  result: {
    printer_profile_id: string;
    printer_profile_version: string;
    printer_profile_sha256: string;
    profile_status: 'draft' | 'experimental' | 'validated' | 'verified' | 'deprecated';
    fleet_unit_id?: string;
    engine: { id: EngineId; version: string };
    postprocessors?: Array<{ id: 'gpx'; version: string }>;
    output_format: OutputFormat;
    time_seconds: number;
    filament?: { grams: number; millimeters: number };
    validation: { valid: boolean; warnings: string[]; observed: Record<string, unknown> };
    artifacts: Array<{
      artifact_id: string;
      type: OutputFormat;
      format: OutputFormat;
      sha256: string;
      size_bytes: number;
      media_type: string;
    }>;
  };
}

export interface OrganizationRecord {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiKeyRecord {
  id: string;
  organization_id: string;
  name: string;
  key_hash: string;
  scopes: string[];
  revoked_at: string | null;
  created_at: string;
}

export interface PairingCodeRecord {
  id: string;
  organization_id: string;
  code_hash: string;
  name: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  revoked_at: string | null;
  created_at: string;
}

export interface AgentRecord {
  id: string;
  organization_id: string;
  installation_id: string;
  name: string;
  hostname_hash: string;
  platform: Record<string, unknown>;
  protocol_versions: string[];
  token_hash: string;
  status: 'online' | 'degraded' | 'offline' | 'revoked';
  capabilities: AgentCapabilitiesV1 | null;
  capability_sha256: string | null;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface ArtifactRecord {
  id: string;
  organization_id: string;
  job_id: string | null;
  role: 'input' | 'output' | 'diagnostic';
  type: string;
  format: string;
  storage_key: string;
  sha256: string | null;
  size_bytes: number | null;
  media_type: string;
  status: 'pending' | 'uploaded' | 'verified' | 'expired' | 'rejected';
  retention_until: string;
  created_at: string;
  verified_at: string | null;
}

export interface JobRecord {
  id: string;
  organization_id: string;
  request_id: string;
  idempotency_key: string;
  source: string;
  operation: 'slice';
  request: JobRequestV1;
  status: JobStatus;
  stage: JobStage;
  priority: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  assigned_agent_id: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  ack_at: string | null;
  result: JobResultV1 | null;
  error: StructuredError | null;
  cancel_requested_at: string | null;
  completed_at: string | null;
  dead_letter_at: string | null;
  output_artifact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEventRecord {
  id: string;
  organization_id: string;
  job_id: string;
  sequence: number;
  status: JobStatus;
  stage: JobStage;
  progress_percent: number | null;
  message: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  created_at: string;
}

export interface SignedTransfer {
  artifact_id: string;
  url: string;
  method: 'GET' | 'PUT';
  headers?: Record<string, string>;
}

export interface LeaseEnvelope {
  lease_id: string;
  lease_expires_at: string;
  job_id: string;
  request: JobRequestV1;
  input_download: SignedTransfer;
  output_upload: SignedTransfer;
}

export interface ApiPrincipal {
  kind: 'api_key';
  organization_id: string;
  api_key_id: string;
  scopes: string[];
}

export interface AgentPrincipal {
  kind: 'agent';
  organization_id: string;
  agent_id: string;
}

export type Principal = ApiPrincipal | AgentPrincipal;

export interface ContractValidator {
  validateJobRequest(value: unknown): asserts value is JobRequestV1;
  validateJobResult(value: unknown): asserts value is JobResultV1;
  validateAgentCapabilities(value: unknown): asserts value is AgentCapabilitiesV1;
}

export interface BackendRepository {
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
  ensureBootstrap(input: {
    organization: OrganizationRecord;
    api_key: ApiKeyRecord;
    pairing_code?: PairingCodeRecord;
  }): Promise<void>;
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  createPairingCode(record: PairingCodeRecord): Promise<PairingCodeRecord>;
  consumePairingCode(codeHash: string, now: string): Promise<PairingCodeRecord | null>;
  pairAgent(record: AgentRecord): Promise<AgentRecord>;
  findAgentByTokenHash(tokenHash: string): Promise<AgentRecord | null>;
  getAgent(agentId: string): Promise<AgentRecord | null>;
  updateAgentHeartbeat(agentId: string, capabilities: AgentCapabilitiesV1, now: string): Promise<AgentRecord | null>;
  revokeAgent(agentId: string, organizationId: string, now: string): Promise<boolean>;

  createArtifact(record: ArtifactRecord): Promise<ArtifactRecord>;
  getArtifact(artifactId: string): Promise<ArtifactRecord | null>;
  markArtifactVerified(artifactId: string, sha256: string, sizeBytes: number, now: string): Promise<ArtifactRecord | null>;
  ensureOutputArtifact(record: ArtifactRecord): Promise<ArtifactRecord>;

  createJobIdempotent(record: JobRecord, correlationId: string): Promise<{ job: JobRecord; created: boolean }>;
  getJob(jobId: string): Promise<JobRecord | null>;
  listJobEvents(jobId: string): Promise<JobEventRecord[]>;
  requestCancellation(jobId: string, organizationId: string, now: string, correlationId: string): Promise<JobRecord | null>;
  requeueExpired(now: string): Promise<JobRecord[]>;
  findLeaseCandidates(organizationId: string, candidateIds: string[], now: string, limit: number): Promise<JobRecord[]>;
  claimJob(jobId: string, agentId: string, leaseId: string, leaseExpiresAt: string, now: string, correlationId: string): Promise<JobRecord | null>;
  ackJob(jobId: string, agentId: string, leaseId: string, now: string, correlationId: string): Promise<JobRecord | null>;
  progressJob(input: {
    job_id: string;
    agent_id: string;
    lease_id: string;
    status: JobStatus;
    stage: JobStage;
    progress_percent: number;
    message: string;
    lease_expires_at: string;
    now: string;
    correlation_id: string;
  }): Promise<JobRecord | null>;
  completeJob(input: {
    job_id: string;
    agent_id: string;
    lease_id: string;
    result: JobResultV1;
    now: string;
    correlation_id: string;
  }): Promise<{ job: JobRecord; idempotent: boolean } | null>;
  failJob(input: {
    job_id: string;
    agent_id: string;
    lease_id: string;
    error: StructuredError;
    retry_at: string | null;
    now: string;
    correlation_id: string;
  }): Promise<JobRecord | null>;
}

export interface ReadyQueue {
  health(): Promise<{ ok: boolean; detail?: string }>;
  notifyReady(job: JobRecord): Promise<void>;
  candidates(limit: number, now: string): Promise<string[]>;
  remove(jobId: string): Promise<void>;
  close(): Promise<void>;
}

export interface ArtifactStorage {
  health(): Promise<{ ok: boolean; detail?: string }>;
  prepareUpload(artifact: ArtifactRecord): Promise<SignedTransfer>;
  prepareDownload(artifact: ArtifactRecord): Promise<SignedTransfer>;
  verify(artifact: ArtifactRecord, expected: { sha256: string; size_bytes: number }): Promise<void>;
  close(): Promise<void>;
}

export interface Clock { now(): Date; }
export interface IdFactory { create(prefix: string): string; }
export interface TokenFactory { create(bytes?: number): string; }
