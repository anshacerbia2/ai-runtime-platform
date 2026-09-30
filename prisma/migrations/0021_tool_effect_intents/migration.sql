BEGIN;

CREATE TABLE control.tool_effects (
  operation_id uuid NOT NULL,
  application_id text NOT NULL,
  execution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  epoch integer NOT NULL CHECK (epoch > 0),
  tool_ref text NOT NULL CHECK (length(tool_ref) BETWEEN 1 AND 120),
  request_digest char(64) NOT NULL,
  state text NOT NULL CHECK (state IN ('PREPARED', 'DISPATCHING', 'UNKNOWN', 'COMMITTED', 'NO_EFFECT')),
  receipt_ref text,
  receipt_digest char(64),
  receiver_retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (application_id, operation_id),
  CONSTRAINT tool_effects_execution_scope
    FOREIGN KEY (execution_id, application_id)
    REFERENCES control.executions (id, application_id) ON DELETE RESTRICT,
  CONSTRAINT tool_effects_assignment_scope
    FOREIGN KEY (assignment_id, execution_id, attempt_id)
    REFERENCES control.runner_assignments (id, execution_id, attempt_id) ON DELETE RESTRICT,
  CONSTRAINT tool_effects_receipt_shape
    CHECK ((state IN ('COMMITTED', 'NO_EFFECT')) = (receipt_ref IS NOT NULL AND receipt_digest IS NOT NULL))
);

CREATE INDEX tool_effects_execution_state
  ON control.tool_effects (execution_id, state);

COMMIT;
