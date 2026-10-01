BEGIN;

CREATE TABLE control.plugin_packages (
  application_id text NOT NULL REFERENCES control.applications (id) ON DELETE RESTRICT,
  package_id text NOT NULL CHECK (length(package_id) BETWEEN 1 AND 120),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 120),
  bundle_digest char(64) NOT NULL,
  object_key text NOT NULL UNIQUE,
  bundle_bytes integer NOT NULL CHECK (bundle_bytes BETWEEN 2 AND 16777216),
  compatible_runtime_versions text[] NOT NULL,
  required_permissions text[] NOT NULL,
  state text NOT NULL DEFAULT 'STAGED' CHECK (state IN ('STAGED', 'ACTIVE', 'REVOKED')),
  attestation_ref text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (application_id, package_id, version),
  CONSTRAINT plugin_packages_attestation_state
    CHECK (state = 'STAGED' OR attestation_ref IS NOT NULL)
);

CREATE INDEX plugin_packages_application_state
  ON control.plugin_packages (application_id, state, package_id, version);

COMMIT;
