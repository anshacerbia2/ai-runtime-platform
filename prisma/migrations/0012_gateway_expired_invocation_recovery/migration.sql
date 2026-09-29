CREATE INDEX provider_invocations_status_started
  ON control.provider_invocations(status, started_at);
