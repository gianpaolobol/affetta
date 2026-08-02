CREATE TABLE IF NOT EXISTS beta_daily_usage (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  jobs_created integer NOT NULL DEFAULT 0 CHECK (jobs_created >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, usage_date)
);

CREATE INDEX IF NOT EXISTS jobs_organization_created_idx
  ON jobs (organization_id, created_at DESC);
