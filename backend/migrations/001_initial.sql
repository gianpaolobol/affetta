CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  name text NOT NULL,
  hostname_hash text NOT NULL,
  platform jsonb NOT NULL,
  protocol_versions jsonb NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('online','degraded','offline','revoked')),
  capabilities jsonb,
  capability_sha256 text,
  paired_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (organization_id, installation_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text,
  role text NOT NULL CHECK (role IN ('input','output','diagnostic')),
  type text NOT NULL,
  format text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text,
  size_bytes bigint,
  media_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','uploaded','verified','expired','rejected')),
  retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  source text NOT NULL,
  operation text NOT NULL CHECK (operation='slice'),
  request jsonb NOT NULL,
  status text NOT NULL,
  stage text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL,
  assigned_agent_id text REFERENCES agents(id),
  lease_id text,
  lease_expires_at timestamptz,
  ack_at timestamptz,
  result jsonb,
  error jsonb,
  cancel_requested_at timestamptz,
  completed_at timestamptz,
  dead_letter_at timestamptz,
  output_artifact_id text REFERENCES artifacts(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

DO $$ BEGIN
  ALTER TABLE artifacts ADD CONSTRAINT artifacts_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS job_events (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  status text NOT NULL,
  stage text NOT NULL,
  progress_percent integer CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (job_id, sequence)
);

CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs (organization_id, status, next_attempt_at, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS jobs_lease_expiry_idx ON jobs (lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS artifacts_job_idx ON artifacts (job_id, role);
CREATE INDEX IF NOT EXISTS agents_last_seen_idx ON agents (organization_id, last_seen_at);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events (job_id, sequence);
