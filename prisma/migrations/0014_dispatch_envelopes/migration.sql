BEGIN;

CREATE TYPE control."DispatchEnvelopeState" AS ENUM (
  'STAGED',
  'COMMITTED',
  'CONSUMED',
  'DELETE_PENDING',
  'EXPIRED'
);

ALTER TABLE control.executions
  ADD CONSTRAINT executions_id_application_id_key UNIQUE(id, application_id);

CREATE TABLE control.dispatch_envelopes (
  id uuid PRIMARY KEY,
  application_id text NOT NULL,
  execution_binding_id uuid NOT NULL,
  execution_id uuid,
  profile_revision_id uuid NOT NULL,
  input_digest char(64) NOT NULL,
  object_key text NOT NULL UNIQUE,
  plaintext_sha256 char(64) NOT NULL,
  ciphertext_sha256 char(64) NOT NULL,
  plaintext_bytes bigint NOT NULL CHECK(plaintext_bytes > 0 AND plaintext_bytes <= 1048576),
  ciphertext_bytes bigint NOT NULL CHECK(ciphertext_bytes > 0 AND ciphertext_bytes <= 1048576),
  encryption_algorithm text NOT NULL CHECK(encryption_algorithm = 'AES-256-GCM'),
  key_provider text NOT NULL CHECK(length(key_provider) BETWEEN 1 AND 128),
  key_reference text NOT NULL CHECK(length(key_reference) BETWEEN 1 AND 512),
  wrapped_data_key bytea NOT NULL CHECK(octet_length(wrapped_data_key) BETWEEN 1 AND 4096),
  nonce bytea NOT NULL CHECK(octet_length(nonce) = 12),
  authentication_tag bytea NOT NULL CHECK(octet_length(authentication_tag) = 16),
  state control."DispatchEnvelopeState" NOT NULL DEFAULT 'STAGED',
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  committed_at timestamptz(6),
  consumed_at timestamptz(6),
  expires_at timestamptz(6) NOT NULL,
  delete_claimed_at timestamptz(6),
  expired_at timestamptz(6),
  CONSTRAINT dispatch_envelopes_application_fkey
    FOREIGN KEY(application_id) REFERENCES control.applications(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT dispatch_envelopes_profile_fkey
    FOREIGN KEY(profile_revision_id, application_id)
    REFERENCES control.profile_revisions(id, application_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT dispatch_envelopes_execution_fkey
    FOREIGN KEY(execution_id, application_id)
    REFERENCES control.executions(id, application_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT dispatch_envelopes_digest_format CHECK(
    input_digest ~ '^[0-9a-f]{64}$' AND
    plaintext_sha256 ~ '^[0-9a-f]{64}$' AND
    ciphertext_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT dispatch_envelopes_expiry_after_creation CHECK(expires_at > created_at),
  CONSTRAINT dispatch_envelopes_lifecycle CHECK(
    (state = 'STAGED' AND execution_id IS NULL AND committed_at IS NULL AND consumed_at IS NULL AND delete_claimed_at IS NULL AND expired_at IS NULL) OR
    (state = 'COMMITTED' AND execution_id = execution_binding_id AND committed_at IS NOT NULL AND consumed_at IS NULL AND delete_claimed_at IS NULL AND expired_at IS NULL) OR
    (state = 'CONSUMED' AND execution_id = execution_binding_id AND committed_at IS NOT NULL AND consumed_at IS NOT NULL AND delete_claimed_at IS NULL AND expired_at IS NULL) OR
    (state = 'DELETE_PENDING' AND delete_claimed_at IS NOT NULL AND expired_at IS NULL) OR
    (state = 'EXPIRED' AND delete_claimed_at IS NOT NULL AND expired_at IS NOT NULL)
  )
);

CREATE INDEX dispatch_envelopes_state_expiry
  ON control.dispatch_envelopes(state, expires_at, id);
CREATE INDEX dispatch_envelopes_application_created
  ON control.dispatch_envelopes(application_id, created_at, id);
CREATE UNIQUE INDEX dispatch_envelopes_execution_id_application_id_key
  ON control.dispatch_envelopes(execution_id, application_id);

COMMENT ON TABLE control.dispatch_envelopes IS
  'Authority metadata for encrypted dispatch input. Raw input and plaintext data keys are prohibited.';

COMMIT;
