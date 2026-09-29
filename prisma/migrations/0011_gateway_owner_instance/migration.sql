ALTER TABLE control.attempts
  ADD COLUMN owner_instance_id uuid;

CREATE INDEX attempts_owner_instance_id_idx
  ON control.attempts(owner_instance_id);
