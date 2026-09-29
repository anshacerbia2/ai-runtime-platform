BEGIN;

DROP INDEX control.runner_assignments_recovery_scan;

CREATE INDEX runner_assignments_recovery_scan
  ON control.runner_assignments (state, id)
  WHERE state IN ('GRANTED', 'STARTED', 'RESULT_PROPOSED');

COMMIT;
