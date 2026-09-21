-- Baseline of the existing M0 schema. Existing data is marked applied, never reset.
CREATE SCHEMA IF NOT EXISTS m0;
CREATE TABLE m0.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- Dedicated M0 namespace: real local PostgreSQL, NOT the M1 execution/budget ledger.
CREATE TABLE m0.applications (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  token_sha256 char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE m0.profiles (
  application_id text NOT NULL REFERENCES m0.applications(id),
  profile_ref text NOT NULL,
  definition jsonb NOT NULL,
  digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(application_id,profile_ref)
);
CREATE TABLE m0.contract_checks (
  id uuid PRIMARY KEY,
  application_id text NOT NULL REFERENCES m0.applications(id),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 160),
  request_digest char(64) NOT NULL,
  contract_version text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('chat','generate','execution')),
  valid boolean NOT NULL,
  request_summary jsonb NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id,idempotency_key)
);
CREATE INDEX contract_checks_scope_time ON m0.contract_checks(application_id,created_at DESC,id DESC);
COMMENT ON TABLE m0.contract_checks IS 'Contract-only metadata. No provider execution, business jobs, raw prompts, financial reservations, or billing.';

INSERT INTO m0.schema_migrations(version, checksum) VALUES ('0001', '7163e98cf821070b87cb142ca609f6904ecc8287407e9e1b40c0ed5137e7fe1e');
