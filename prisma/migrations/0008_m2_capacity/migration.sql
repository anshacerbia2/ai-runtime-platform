BEGIN;

ALTER TABLE control.applications
  ADD COLUMN gateway_max_concurrency integer NOT NULL DEFAULT 100,
  ADD COLUMN gateway_requests_per_minute integer NOT NULL DEFAULT 600,
  ADD CONSTRAINT applications_gateway_max_concurrency
    CHECK(gateway_max_concurrency BETWEEN 1 AND 10000),
  ADD CONSTRAINT applications_gateway_requests_per_minute
    CHECK(gateway_requests_per_minute BETWEEN 1 AND 1000000);

ALTER TABLE control.ai_connections
  ADD COLUMN gateway_max_concurrency integer NOT NULL DEFAULT 100,
  ADD COLUMN gateway_requests_per_minute integer NOT NULL DEFAULT 600,
  ADD CONSTRAINT connections_gateway_max_concurrency
    CHECK(gateway_max_concurrency BETWEEN 1 AND 10000),
  ADD CONSTRAINT connections_gateway_requests_per_minute
    CHECK(gateway_requests_per_minute BETWEEN 1 AND 1000000);

CREATE TABLE control.admission_rate_windows (
  scope_key text NOT NULL,
  window_start timestamptz(0) NOT NULL,
  request_count integer NOT NULL,
  PRIMARY KEY(scope_key, window_start),
  CONSTRAINT admission_rate_windows_count
    CHECK(request_count BETWEEN 1 AND 1000000)
);

CREATE INDEX admission_rate_windows_window_start_idx
  ON control.admission_rate_windows(window_start);

COMMIT;
