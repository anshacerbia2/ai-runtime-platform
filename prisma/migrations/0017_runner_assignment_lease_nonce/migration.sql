BEGIN;

ALTER TABLE control.runner_assignments
  ADD COLUMN lease_nonce_digest CHAR(64);

COMMIT;
