ALTER TABLE control.executions ADD COLUMN assignment_generation integer NOT NULL DEFAULT 0 CHECK(assignment_generation>=0), ADD COLUMN coordination_epoch integer NOT NULL DEFAULT 1 CHECK(coordination_epoch>0);
CREATE TABLE control.runner_assignments (
 id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 attempt_id uuid NOT NULL, runner_id text NOT NULL REFERENCES control.runner_nodes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 owner_subject text NOT NULL, generation integer NOT NULL CHECK(generation>0), epoch integer NOT NULL CHECK(epoch>0),
 state text NOT NULL CHECK(state IN ('GRANTED','STARTED','RESULT_PROPOSED','FENCED')),
 protocol_version text NOT NULL CHECK(protocol_version='1'), proposal jsonb, proposal_digest char(64),
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,execution_id) REFERENCES control.attempts(id,execution_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT runner_assignments_execution_id_generation_key UNIQUE(execution_id,generation),
 CONSTRAINT runner_assignments_id_execution_id_attempt_id_key UNIQUE(id,execution_id,attempt_id),
 CHECK(proposal IS NULL OR octet_length(proposal::text)<=65536)
);
CREATE INDEX runner_assignments_runner_id_state_idx ON control.runner_assignments(runner_id,state);
CREATE TABLE control.runner_evidence (
 id uuid PRIMARY KEY, assignment_id uuid NOT NULL,
 execution_id uuid NOT NULL REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE, attempt_id uuid NOT NULL,
 source_event_id text NOT NULL, source_revision integer NOT NULL CHECK(source_revision>0), digest char(64) NOT NULL,
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=65536), state text NOT NULL DEFAULT 'QUARANTINED' CHECK(state IN ('QUARANTINED','VERIFIED','REJECTED')),
 received_at timestamptz(6) NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,execution_id) REFERENCES control.attempts(id,execution_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY(assignment_id,execution_id,attempt_id) REFERENCES control.runner_assignments(id,execution_id,attempt_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT runner_evidence_assignment_id_source_event_id_source_revision_key UNIQUE(assignment_id,source_event_id,source_revision)
);
CREATE INDEX runner_evidence_execution_id_state_idx ON control.runner_evidence(execution_id,state);
