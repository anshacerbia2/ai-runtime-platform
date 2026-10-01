BEGIN;

CREATE FUNCTION control.guard_plugin_package_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.application_id, NEW.package_id, NEW.version, NEW.bundle_digest,
         NEW.object_key, NEW.bundle_bytes, NEW.compatible_runtime_versions,
         NEW.required_permissions)
     IS DISTINCT FROM
     ROW(OLD.application_id, OLD.package_id, OLD.version, OLD.bundle_digest,
         OLD.object_key, OLD.bundle_bytes, OLD.compatible_runtime_versions,
         OLD.required_permissions) THEN
    RAISE EXCEPTION 'Plugin package metadata is immutable';
  END IF;
  IF (OLD.state = 'ACTIVE' AND NEW.state NOT IN ('ACTIVE', 'REVOKED'))
     OR (OLD.state = 'REVOKED' AND NEW.state <> 'REVOKED') THEN
    RAISE EXCEPTION 'Plugin package revocation is final';
  END IF;
  IF NEW.state <> OLD.state AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Plugin package state change requires revision increment';
  END IF;
  IF OLD.state <> 'STAGED' AND NEW.attestation_ref IS DISTINCT FROM OLD.attestation_ref THEN
    RAISE EXCEPTION 'Plugin package attestation is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_package_update_guard
  BEFORE UPDATE ON control.plugin_packages
  FOR EACH ROW EXECUTE FUNCTION control.guard_plugin_package_update();

COMMIT;
