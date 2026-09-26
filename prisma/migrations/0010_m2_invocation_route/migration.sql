BEGIN;

ALTER TABLE control.provider_invocations
  ADD COLUMN connection_id text;

UPDATE control.provider_invocations pi
SET connection_id = p.connection_id
FROM control.executions e
JOIN control.profile_revisions p ON p.id = e.profile_revision_id
WHERE e.id = pi.execution_id;

ALTER TABLE control.provider_invocations
  ALTER COLUMN connection_id SET NOT NULL,
  ADD CONSTRAINT provider_invocations_connection_id_fkey
    FOREIGN KEY (connection_id)
    REFERENCES control.ai_connections(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX provider_invocations_connection_status_idx
  ON control.provider_invocations(connection_id, status);

COMMIT;
