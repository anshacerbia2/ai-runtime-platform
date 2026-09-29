ALTER TABLE control.executions
  ADD COLUMN admission_source text NOT NULL DEFAULT 'CONTROL_PLANE';

UPDATE control.executions AS execution
SET admission_source = 'GATEWAY'
WHERE EXISTS (
  SELECT 1
  FROM control.provider_invocations AS invocation
  WHERE invocation.execution_id = execution.id
);

ALTER TABLE control.executions
  ADD CONSTRAINT executions_admission_source
  CHECK (admission_source IN ('CONTROL_PLANE', 'GATEWAY'));

CREATE INDEX executions_source_status_created
  ON control.executions(admission_source, status, created_at, id);
