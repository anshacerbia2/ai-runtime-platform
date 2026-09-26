BEGIN;

ALTER TABLE control.profile_revisions
  ADD COLUMN fallback_connection_id text,
  ADD COLUMN fallback_provider_adapter text,
  ADD COLUMN fallback_model text,
  ADD CONSTRAINT profile_fallback_all_or_none CHECK(
    (fallback_connection_id IS NULL
      AND fallback_provider_adapter IS NULL
      AND fallback_model IS NULL)
    OR
    (fallback_connection_id IS NOT NULL
      AND fallback_provider_adapter IS NOT NULL
      AND fallback_model IS NOT NULL)
  );

ALTER TABLE control.profile_revisions
  ADD CONSTRAINT profile_revisions_fallback_connection_id_fkey
  FOREIGN KEY (fallback_connection_id)
  REFERENCES control.ai_connections(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX profile_revisions_fallback_connection_idx
  ON control.profile_revisions(fallback_connection_id)
  WHERE fallback_connection_id IS NOT NULL;

COMMIT;
