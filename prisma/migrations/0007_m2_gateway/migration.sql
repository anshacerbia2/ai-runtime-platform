BEGIN;

ALTER TABLE control.profile_revisions
  ADD COLUMN provider_adapter text NOT NULL DEFAULT 'UNCONFIGURED',
  ADD COLUMN model text NOT NULL DEFAULT 'UNCONFIGURED',
  ADD COLUMN max_output_tokens integer NOT NULL DEFAULT 2048,
  ADD COLUMN timeout_ms integer NOT NULL DEFAULT 30000,
  ADD COLUMN streaming boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT profile_gateway_limits CHECK(
    max_output_tokens BETWEEN 1 AND 32768
    AND timeout_ms BETWEEN 1 AND 3600000
  );

ALTER TABLE control.executions
  ADD COLUMN status_reason text,
  ADD COLUMN completed_at timestamptz;

ALTER TABLE control.executions DROP CONSTRAINT executions_status;
ALTER TABLE control.executions ADD CONSTRAINT executions_status
  CHECK(status IN (
    'ACCEPTED','RUNNING','RECONCILING','COMPLETED',
    'SUCCEEDED','FAILED','CANCELLED'
  ));CREATE TABLE control.execution_results (
  execution_id uuid PRIMARY KEY
    REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  kind text NOT NULL CHECK(kind IN ('text','structured')),
  payload jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  finish_reason text,
  provider_request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_result_size CHECK(octet_length(payload::text) <= 2097152)
);

CREATE TABLE control.provider_invocations (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL
    REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  attempt_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('openrouter','direct-anthropic')),
  model text NOT NULL,
  status text NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
  request_digest char(64) NOT NULL,
  upstream_request_id text,
  input_tokens bigint CHECK(input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK(output_tokens IS NULL OR output_tokens >= 0),  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY(attempt_id, execution_id)
    REFERENCES control.attempts(id, execution_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX provider_invocations_execution_started_idx
  ON control.provider_invocations(execution_id, started_at);

COMMIT;
