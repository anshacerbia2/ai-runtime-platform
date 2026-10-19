BEGIN;

-- Do not infer historical process revisions from the runner's current revision.
ALTER TABLE control.runner_assignments
  ADD COLUMN claim_registration_revision INTEGER,
  ADD CONSTRAINT runner_assignment_claim_revision_valid
    CHECK (claim_registration_revision IS NULL OR
           claim_registration_revision BETWEEN 1 AND 2147483646);

CREATE TABLE control.runner_stop_receipts (
  id UUID PRIMARY KEY,
  assignment_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  boot_id UUID NOT NULL,
  registration_revision INTEGER NOT NULL CHECK (registration_revision BETWEEN 1 AND 2147483646),
  evidence_state TEXT NOT NULL,
  termination_method TEXT,
  digest CHAR(64) NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'QUARANTINED' CHECK (state = 'QUARANTINED'),
  received_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT runner_stop_receipt_identity_key UNIQUE (assignment_id, boot_id, registration_revision),
  CONSTRAINT runner_stop_receipt_evidence_valid CHECK (
    (evidence_state = 'UNCONFIRMED' AND termination_method IS NULL) OR
    (evidence_state = 'TERMINATED' AND termination_method IS NOT NULL AND
     termination_method IN ('GRACEFUL', 'FORCED', 'OBSERVED'))
  ),
  CONSTRAINT runner_stop_receipts_assignment_scope_fkey
    FOREIGN KEY (assignment_id, execution_id, attempt_id)
    REFERENCES control.runner_assignments(id, execution_id, attempt_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX runner_stop_receipts_execution_id_state_idx ON control.runner_stop_receipts(execution_id, state);

COMMIT;
