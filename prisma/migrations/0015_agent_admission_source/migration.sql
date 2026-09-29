BEGIN;

ALTER TABLE control.executions
  DROP CONSTRAINT executions_admission_source,
  ADD CONSTRAINT executions_admission_source
    CHECK (admission_source IN ('CONTROL_PLANE', 'GATEWAY', 'AGENT'));

COMMIT;
