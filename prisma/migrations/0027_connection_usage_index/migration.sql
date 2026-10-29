-- Supports bounded per-connection invocation cohorts for operator usage reads.
CREATE INDEX CONCURRENTLY provider_invocations_connection_started
  ON control.provider_invocations (connection_id, started_at);
