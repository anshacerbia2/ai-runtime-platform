BEGIN;

ALTER TABLE control.profile_revisions
  ADD COLUMN plugin_package_id text,
  ADD COLUMN plugin_version text,
  ADD COLUMN plugin_digest char(64),
  ADD COLUMN plugin_runtime_version text,
  ADD CONSTRAINT profile_plugin_complete CHECK (
    (plugin_package_id IS NULL AND plugin_version IS NULL AND plugin_digest IS NULL AND plugin_runtime_version IS NULL)
    OR
    (plugin_package_id IS NOT NULL AND plugin_version IS NOT NULL AND plugin_digest IS NOT NULL AND plugin_runtime_version IS NOT NULL AND capability = 'agent_execute')
  ),
  ADD CONSTRAINT profile_plugin_package_fk
    FOREIGN KEY (application_id, plugin_package_id, plugin_version)
    REFERENCES control.plugin_packages (application_id, package_id, version)
    ON DELETE RESTRICT;

COMMIT;
