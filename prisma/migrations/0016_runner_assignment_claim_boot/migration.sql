BEGIN;

ALTER TABLE control.runner_assignments
  ADD COLUMN claim_boot_id UUID;

COMMIT;
