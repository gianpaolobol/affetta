export type EngineId = 'kiri' | 'cura' | 'prusa' | 'orca' | 'snapmaker_orca' | 'mock';
export type OutputFormat = 'gcode' | 'x3g';
export type ProfileStatus = 'draft' | 'experimental' | 'validated' | 'verified' | 'deprecated';
export type JobStatus =
  | 'created' | 'uploaded' | 'queued' | 'leased' | 'assigned' | 'downloading'
  | 'preparing' | 'slicing' | 'validating' | 'postprocessing' | 'uploading'
  | 'completed' | 'retrying' | 'manual_review' | 'cancel_requested' | 'cancelled'
  | 'failed' | 'expired';
export type JobStage =
  | 'created' | 'upload' | 'queue' | 'lease' | 'download' | 'prepare' | 'slice'
  | 'validate' | 'postprocess' | 'upload_result' | 'complete' | 'cancel' | 'unknown';

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

export interface SignedTransfer {
  artifact_id: string;
  url: string;
  method?: 'GET' | 'PUT';
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

export interface PairResponse {
  agent_id: string;
  access_token: string;
  paired_at: string;
}

export interface StoredCredentials {
  agent_id: string;
  access_token: string;
  paired_at: string;
}

export interface AgentStructuredError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  details: Record<string, unknown>;
  correlation_id?: string;
}

export interface OutputArtifact {
  artifact_id: string;
  type: OutputFormat;
  format: OutputFormat;
  sha256: string;
  size_bytes: number;
  media_type: string;
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
    profile_status: ProfileStatus;
    fleet_unit_id?: string;
    engine: { id: EngineId; version: string };
    postprocessors?: Array<{ id: 'gpx'; version: string }>;
    output_format: OutputFormat;
    time_seconds: number;
    filament?: { grams: number; millimeters: number };
    validation: { valid: boolean; warnings: string[]; observed: Record<string, unknown> };
    artifacts: OutputArtifact[];
  };
}

export interface LocalHealth {
  success: boolean;
  service: string;
  version: string;
  api_version: string;
  instance_id?: string;
}

export interface LocalJob {
  id: string;
  status: string;
  phase?: string;
  progress?: number;
  message?: string;
  artifact_url?: string | null;
  output_format?: OutputFormat;
  printer?: {
    id: string;
    profile_status?: string;
    fleet_unit_id?: string | null;
  } | null;
  result?: {
    provider?: string;
    output_format?: OutputFormat;
    postprocessor?: { engine?: string; machine?: string } | null;
    time_seconds?: number;
    filament_g?: number;
    filament_length_mm?: number;
    validation?: {
      valid?: boolean;
      warnings?: string[];
      errors?: string[];
      observed?: Record<string, unknown>;
    };
    profile_status?: string;
    applied_profile?: Record<string, unknown>;
    print_ready?: boolean;
    demo_only?: boolean;
  } | null;
  error?: { code?: string; message?: string; stage?: string } | null;
}

export interface AgentCapabilitiesV1 {
  schema_version: 'affetta.agent-capabilities.v1';
  agent_id: string;
  observed_at: string;
  status: 'online' | 'degraded' | 'offline' | 'revoked';
  affetta_version: string;
  protocol_versions: readonly ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1'];
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
    profile_status: ProfileStatus;
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

export interface StoredJob {
  cloud_job_id: string;
  local_job_id: string | null;
  lease_id: string;
  lease_expires_at: string;
  state: JobStatus;
  stage: JobStage;
  request: JobRequestV1;
  lease: LeaseEnvelope;
  input_path: string | null;
  output_path: string | null;
  output_sha256: string | null;
  result: JobResultV1 | null;
  error: AgentStructuredError | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}
