BEGIN;

ALTER TABLE control.plugin_packages
  DROP CONSTRAINT plugin_packages_attestation_state,
  ADD CONSTRAINT plugin_packages_attestation_state
    CHECK (state <> 'ACTIVE' OR attestation_ref IS NOT NULL);

COMMIT;
