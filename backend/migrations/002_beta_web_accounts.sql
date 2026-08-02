CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  username text NOT NULL,
  phone_e164 text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_verification','active','disabled')),
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_username_unique UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','member')),
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS beta_profiles (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  cost_profile jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_email_verifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  template text NOT NULL CHECK (template IN ('verify_beta_email')),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sent','failed')),
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS memberships_organization_idx ON memberships (organization_id);
CREATE INDEX IF NOT EXISTS beta_sessions_user_idx ON beta_sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS beta_verifications_user_idx ON beta_email_verifications (user_id, expires_at);
CREATE INDEX IF NOT EXISTS email_outbox_pending_idx ON email_outbox (status, created_at);
