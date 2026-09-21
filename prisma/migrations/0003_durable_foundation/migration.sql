-- Additive M1 foundation. 0001/0002 and all existing M0 history are retained.
BEGIN;
ALTER TABLE control.applications ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE control.ai_connections ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE control.credential_instances ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE control.credential_bindings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE control.profile_revisions (
 id UUID PRIMARY KEY, application_id TEXT NOT NULL, profile_ref TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision > 0), connection_id TEXT NOT NULL,
 capability TEXT NOT NULL, hold_units BIGINT NOT NULL CHECK (hold_units >= 0),
 account_ids TEXT[] NOT NULL, digest CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX profile_revisions_application_id_profile_ref_revision_key ON control.profile_revisions(application_id, profile_ref, revision);
CREATE TABLE control.profile_aliases (
 application_id TEXT NOT NULL, profile_ref TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision > 0), enabled BOOLEAN NOT NULL DEFAULT true,
 PRIMARY KEY(application_id, profile_ref)
);
CREATE TABLE control.budget_accounts (
 id TEXT PRIMARY KEY, application_id TEXT, quota_group_ref TEXT, unit TEXT NOT NULL,
 period TEXT NOT NULL, limit_units BIGINT NOT NULL CHECK(limit_units >= 0),
 held_units BIGINT NOT NULL DEFAULT 0 CHECK(held_units >= 0),
 posted_units BIGINT NOT NULL DEFAULT 0 CHECK(posted_units >= 0),
 revision INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT budget_scope CHECK ((application_id IS NULL) <> (quota_group_ref IS NULL))
);
CREATE TABLE control.executions (
 id UUID PRIMARY KEY, application_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 request_digest CHAR(64) NOT NULL, profile_revision_id UUID NOT NULL,
 profile_snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'ACCEPTED',
 revision INTEGER NOT NULL DEFAULT 1, cancel_requested_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT execution_key_length CHECK(length(idempotency_key) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX executions_application_id_idempotency_key_key ON control.executions(application_id, idempotency_key);
CREATE INDEX executions_application_id_created_at_id_idx ON control.executions(application_id, created_at, id);
CREATE TABLE control.attempts (
 id UUID PRIMARY KEY, execution_id UUID NOT NULL, number INTEGER NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'PREPARED',
 authority TEXT NOT NULL DEFAULT 'UNASSIGNED', compute TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
 external TEXT NOT NULL DEFAULT 'NONE',
 CONSTRAINT attempts_execution_id_fkey FOREIGN KEY(execution_id) REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX attempts_execution_id_number_key ON control.attempts(execution_id, number);
CREATE TABLE control.reservations (
 execution_id UUID NOT NULL, account_id TEXT NOT NULL,
 original_units BIGINT NOT NULL CHECK(original_units >= 0),
 held_units BIGINT NOT NULL CHECK(held_units >= 0),
 posted_units BIGINT NOT NULL DEFAULT 0 CHECK(posted_units >= 0),
 state TEXT NOT NULL DEFAULT 'RESERVED', revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(execution_id, account_id),
 CONSTRAINT reservations_execution_id_fkey FOREIGN KEY(execution_id) REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE control.usage_observations (
 id UUID PRIMARY KEY, execution_id UUID NOT NULL, attempt_id UUID NOT NULL,
 source_event_id TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision > 0),
 digest CHAR(64) NOT NULL, coverage TEXT[] NOT NULL,
 cumulative_units BIGINT CHECK(cumulative_units >= 0), completeness TEXT NOT NULL,
 cost_basis TEXT NOT NULL, verification TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT usage_observations_execution_id_fkey FOREIGN KEY(execution_id) REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX usage_observations_execution_id_source_event_id_source_revisi_key ON control.usage_observations(execution_id, source_event_id, source_revision);
CREATE TABLE control.ledger_entries (
 id UUID PRIMARY KEY, execution_id UUID NOT NULL, account_id TEXT NOT NULL,
 observation_id UUID NOT NULL, command_id TEXT NOT NULL, delta_units BIGINT NOT NULL,
 previous_entry_id UUID, created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ledger_entries_execution_id_fkey FOREIGN KEY(execution_id) REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX ledger_entries_account_id_command_id_key ON control.ledger_entries(account_id, command_id);
CREATE TABLE control.outbox_events (
 id UUID PRIMARY KEY, application_id TEXT, topic TEXT NOT NULL, aggregate_id TEXT NOT NULL,
 revision INTEGER NOT NULL, payload JSONB NOT NULL, delivered_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX outbox_events_topic_aggregate_id_revision_key ON control.outbox_events(topic, aggregate_id, revision);
CREATE TABLE control.inbox_receipts (
 consumer TEXT NOT NULL, event_id UUID NOT NULL,
 received_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(consumer, event_id)
);
CREATE TABLE control.budget_projections (
 account_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, snapshot JSONB NOT NULL
);
CREATE TABLE control.audit_entries (
 id UUID PRIMARY KEY, application_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL,
 resource_id TEXT NOT NULL, revision INTEGER NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_entries_application_id_created_at_id_idx ON control.audit_entries(application_id, created_at, id);
CREATE TABLE control.artifact_metadata (
 id UUID PRIMARY KEY, execution_id UUID NOT NULL, name TEXT NOT NULL, digest CHAR(64) NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes >= 0), media_type TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING',
 CONSTRAINT artifact_metadata_execution_id_fkey FOREIGN KEY(execution_id) REFERENCES control.executions(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE control.runner_pools (
 id TEXT PRIMARY KEY, environment TEXT NOT NULL, region TEXT NOT NULL,
 minimum_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ENABLED', revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE control.runner_nodes (
 id TEXT PRIMARY KEY, owner_subject TEXT NOT NULL, pool_id TEXT NOT NULL, version TEXT NOT NULL,
 capabilities TEXT[] NOT NULL, connection_ids TEXT[] NOT NULL, capacity INTEGER NOT NULL CHECK(capacity > 0),
 status TEXT NOT NULL DEFAULT 'RUNNING', revision INTEGER NOT NULL DEFAULT 1,
 last_heartbeat_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMIT;
