BEGIN;

ALTER TABLE control.attempts
  DROP CONSTRAINT attempts_status,
  ADD CONSTRAINT attempts_status
    CHECK(status IN ('PREPARED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'ORPHAN_SUSPENDED'));

CREATE INDEX runner_assignments_recovery_scan
  ON control.runner_assignments (state, id)
  WHERE state IN ('GRANTED', 'STARTED');

COMMIT;
