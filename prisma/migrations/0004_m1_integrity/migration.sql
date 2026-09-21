-- Forward repair of already-applied 0003; preserve its checksum and all M0 history.
BEGIN;
-- AlterTable
ALTER TABLE "control"."profile_aliases" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "attempts_id_execution_id_key" ON "control"."attempts"("id", "execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_id_execution_id_account_id_key" ON "control"."ledger_entries"("id", "execution_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_revisions_id_application_id_key" ON "control"."profile_revisions"("id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_observations_id_execution_id_key" ON "control"."usage_observations"("id", "execution_id");

-- AddForeignKey
ALTER TABLE "control"."credential_instances" ADD CONSTRAINT "credential_instances_runner_ref_fkey" FOREIGN KEY ("runner_ref") REFERENCES "control"."runner_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."profile_revisions" ADD CONSTRAINT "profile_revisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "control"."applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."profile_revisions" ADD CONSTRAINT "profile_revisions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "control"."ai_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."profile_aliases" ADD CONSTRAINT "profile_aliases_application_id_profile_ref_revision_fkey" FOREIGN KEY ("application_id", "profile_ref", "revision") REFERENCES "control"."profile_revisions"("application_id", "profile_ref", "revision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."budget_accounts" ADD CONSTRAINT "budget_accounts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "control"."applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."executions" ADD CONSTRAINT "executions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "control"."applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."executions" ADD CONSTRAINT "executions_profile_revision_id_application_id_fkey" FOREIGN KEY ("profile_revision_id", "application_id") REFERENCES "control"."profile_revisions"("id", "application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."reservations" ADD CONSTRAINT "reservations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "control"."budget_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."usage_observations" ADD CONSTRAINT "usage_observations_attempt_id_execution_id_fkey" FOREIGN KEY ("attempt_id", "execution_id") REFERENCES "control"."attempts"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."ledger_entries" ADD CONSTRAINT "ledger_entries_execution_id_account_id_fkey" FOREIGN KEY ("execution_id", "account_id") REFERENCES "control"."reservations"("execution_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."ledger_entries" ADD CONSTRAINT "ledger_entries_observation_id_execution_id_fkey" FOREIGN KEY ("observation_id", "execution_id") REFERENCES "control"."usage_observations"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."ledger_entries" ADD CONSTRAINT "ledger_entries_previous_entry_id_execution_id_account_id_fkey" FOREIGN KEY ("previous_entry_id", "execution_id", "account_id") REFERENCES "control"."ledger_entries"("id", "execution_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."outbox_events" ADD CONSTRAINT "outbox_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "control"."applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."inbox_receipts" ADD CONSTRAINT "inbox_receipts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "control"."outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."budget_projections" ADD CONSTRAINT "budget_projections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "control"."budget_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."audit_entries" ADD CONSTRAINT "audit_entries_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "control"."applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."runner_nodes" ADD CONSTRAINT "runner_nodes_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "control"."runner_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "control"."usage_observations_execution_id_source_event_id_source_revisi_k" RENAME TO "usage_observations_execution_id_source_event_id_source_revi_key";

-- PostgreSQL NULL uniqueness must also cover application-wide bindings.
CREATE UNIQUE INDEX credential_bindings_default_scope_key ON control.credential_bindings(application_id, connection_id) WHERE profile_ref IS NULL;

ALTER TABLE control.applications ADD CONSTRAINT applications_revision_positive CHECK(revision > 0);
ALTER TABLE control.ai_connections ADD CONSTRAINT connections_revision_positive CHECK(revision > 0),
  ADD CONSTRAINT connections_shared_quota CHECK(sharing_mode <> 'SHARED' OR quota_group_ref IS NOT NULL);
ALTER TABLE control.credential_instances ADD CONSTRAINT credentials_revision_positive CHECK(revision > 0),
  ADD CONSTRAINT credentials_residency CHECK((residency = 'RUNNER_LOCAL') = (runner_ref IS NOT NULL));
ALTER TABLE control.credential_bindings ADD CONSTRAINT bindings_revision_positive CHECK(revision > 0);
ALTER TABLE control.profile_aliases ADD CONSTRAINT aliases_version_positive CHECK(version > 0);
ALTER TABLE control.budget_accounts ADD CONSTRAINT budgets_revision_positive CHECK(revision > 0);
ALTER TABLE control.executions ADD CONSTRAINT executions_revision_positive CHECK(revision > 0),
  ADD CONSTRAINT executions_status CHECK(status IN ('ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'));
ALTER TABLE control.attempts ADD CONSTRAINT attempts_positive CHECK(number > 0 AND generation > 0),
  ADD CONSTRAINT attempts_status CHECK(status IN ('PREPARED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  ADD CONSTRAINT attempts_authority CHECK(authority IN ('UNASSIGNED', 'OWNED', 'FENCED', 'RELEASED')),
  ADD CONSTRAINT attempts_compute CHECK(compute IN ('NOT_APPLICABLE', 'RUNNING', 'STOPPED', 'UNKNOWN')),
  ADD CONSTRAINT attempts_external CHECK(external IN ('NONE', 'IN_FLIGHT', 'COMPLETE', 'UNKNOWN'));
ALTER TABLE control.reservations ADD CONSTRAINT reservations_revision_positive CHECK(revision > 0),
  ADD CONSTRAINT reservations_state CHECK(state IN ('RESERVED', 'PENDING_RECONCILIATION', 'SETTLED', 'OVERAGE_SETTLED')),
  ADD CONSTRAINT reservations_closed_hold CHECK(state NOT IN ('SETTLED', 'OVERAGE_SETTLED') OR held_units = 0);
ALTER TABLE control.usage_observations ADD CONSTRAINT usage_completeness CHECK(completeness IN ('unknown', 'partial', 'complete')),
  ADD CONSTRAINT usage_basis CHECK(cost_basis IN ('unknown', 'estimated', 'allocated', 'provider_reported')),
  ADD CONSTRAINT usage_verification CHECK(verification IN ('PENDING', 'VERIFIED', 'REJECTED', 'QUARANTINED')),
  ADD CONSTRAINT usage_unknown CHECK((cumulative_units IS NULL AND completeness = 'unknown' AND cost_basis = 'unknown' AND verification <> 'VERIFIED') OR (cumulative_units IS NOT NULL AND completeness <> 'unknown' AND cost_basis <> 'unknown')),
  ADD CONSTRAINT usage_coverage CHECK(cardinality(coverage) > 0 AND array_position(coverage, NULL) IS NULL);
ALTER TABLE control.artifact_metadata ADD CONSTRAINT artifact_status CHECK(status IN ('PENDING', 'READY', 'QUARANTINED'));
ALTER TABLE control.outbox_events ADD CONSTRAINT outbox_revision_positive CHECK(revision > 0);
ALTER TABLE control.audit_entries ADD CONSTRAINT audit_revision_positive CHECK(revision > 0);
ALTER TABLE control.budget_projections ADD CONSTRAINT projection_revision_positive CHECK(revision > 0);
ALTER TABLE control.runner_pools ADD CONSTRAINT pools_revision_positive CHECK(revision > 0),
  ADD CONSTRAINT pools_status CHECK(status IN ('ENABLED', 'DISABLED'));
ALTER TABLE control.runner_nodes ADD CONSTRAINT nodes_revision_positive CHECK(revision > 0),
  ADD CONSTRAINT nodes_status CHECK(status IN ('RUNNING', 'DRAINING', 'DISABLED', 'OFFLINE'));

-- Registry revisions and economic evidence cannot be rewritten. Retention deletes
-- remain explicit administration; no deletion endpoint is provided in M1.
CREATE FUNCTION control.reject_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable history cannot be updated' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER profile_revision_immutable BEFORE UPDATE ON control.profile_revisions FOR EACH ROW EXECUTE FUNCTION control.reject_history_update();
CREATE TRIGGER usage_observation_immutable BEFORE UPDATE ON control.usage_observations FOR EACH ROW EXECUTE FUNCTION control.reject_history_update();
CREATE TRIGGER ledger_entry_immutable BEFORE UPDATE ON control.ledger_entries FOR EACH ROW EXECUTE FUNCTION control.reject_history_update();
CREATE TRIGGER audit_entry_immutable BEFORE UPDATE ON control.audit_entries FOR EACH ROW EXECUTE FUNCTION control.reject_history_update();
COMMIT;
