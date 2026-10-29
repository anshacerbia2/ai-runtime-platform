import type {
  ConnectionUsageInput,
  ConnectionUsageSummary,
} from '@ai-runtime/contracts/http';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { ConnectionUsageReader } from '../application/connection-usage.port.js';

export class PrismaConnectionUsageReader implements ConnectionUsageReader {
  constructor(private readonly db: DatabaseService) {}
  async read(
    connectionId: string,
    query: ConnectionUsageInput,
  ): Promise<ConnectionUsageSummary | null> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', '3000', true)`;
        const connection = await tx.aiConnection.findUnique({
          where: { id: connectionId },
          select: { id: true },
        });
        if (!connection) {
          return null;
        }
        if (
          query.applicationId &&
          !(await tx.controlApplication.findUnique({
            where: { id: query.applicationId },
            select: { id: true },
          }))
        ) {
          return null;
        }
        const account = query.budgetAccountId
          ? await tx.budgetAccount.findUnique({
              where: { id: query.budgetAccountId },
              select: { id: true, unit: true },
            })
          : null;
        if (query.budgetAccountId && !account) {
          return null;
        }
        const from = new Date(query.from);
        const to = new Date(query.to);
        const applicationId = query.applicationId ?? null;
        const [row] = await tx.$queryRaw<
          Array<{
            observedAt: Date;
            total: string;
            running: string;
            succeeded: string;
            failed: string;
            unknown: string;
            inputKnown: string;
            inputUnknown: string;
            outputKnown: string;
            outputUnknown: string;
          }>
        >`
        SELECT transaction_timestamp() AS "observedAt", count(*)::text AS total,
          count(*) FILTER (WHERE i.status = 'RUNNING')::text AS running,
          count(*) FILTER (WHERE i.status = 'SUCCEEDED')::text AS succeeded,
          count(*) FILTER (WHERE i.status = 'FAILED')::text AS failed,
          count(*) FILTER (WHERE i.status = 'UNKNOWN')::text AS unknown,
          COALESCE(sum(i.input_tokens), 0)::text AS "inputKnown",
          count(*) FILTER (WHERE i.input_tokens IS NULL)::text AS "inputUnknown",
          COALESCE(sum(i.output_tokens), 0)::text AS "outputKnown",
          count(*) FILTER (WHERE i.output_tokens IS NULL)::text AS "outputUnknown"
        FROM control.provider_invocations i JOIN control.executions e ON e.id = i.execution_id
        WHERE i.connection_id = ${connectionId} AND i.started_at >= ${from} AND i.started_at < ${to}
          AND (${applicationId}::text IS NULL OR e.application_id = ${applicationId})`;
        let ledger: ConnectionUsageSummary['ledger'] = null;
        if (query.budgetAccountId) {
          const [posting] = await tx.$queryRaw<
            Array<{
              attributedPostedUnits: string;
              excludedObservationCount: string;
            }>
          >`
          SELECT COALESCE(sum(CASE WHEN cardinality(o.coverage) = 1 THEN l.delta_units ELSE 0 END), 0)::text AS "attributedPostedUnits",
            count(DISTINCT o.id) FILTER (WHERE cardinality(o.coverage) <> 1)::text AS "excludedObservationCount"
          FROM control.ledger_entries l
          JOIN control.usage_observations o ON o.id = l.observation_id AND o.execution_id = l.execution_id
          WHERE l.account_id = ${query.budgetAccountId} AND EXISTS (
            SELECT 1 FROM control.provider_invocations i JOIN control.executions e ON e.id = i.execution_id
            WHERE i.connection_id = ${connectionId} AND i.started_at >= ${from} AND i.started_at < ${to}
              AND (${applicationId}::text IS NULL OR e.application_id = ${applicationId})
              AND i.execution_id = o.execution_id AND i.attempt_id = o.attempt_id AND i.id::text = ANY(o.coverage))`;
          ledger = {
            accountId: query.budgetAccountId,
            unit: account!.unit,
            ...posting!,
          };
        }
        return {
          connectionId,
          applicationId,
          from: from.toISOString(),
          to: to.toISOString(),
          observedAt: row!.observedAt.toISOString(),
          consistency: 'repeatable-read',
          invocations: {
            total: row!.total,
            running: row!.running,
            succeeded: row!.succeeded,
            failed: row!.failed,
            unknown: row!.unknown,
          },
          tokens: {
            input: {
              known: row!.inputKnown,
              unknownInvocations: row!.inputUnknown,
            },
            output: {
              known: row!.outputKnown,
              unknownInvocations: row!.outputUnknown,
            },
          },
          ledger,
        };
      },
      { isolationLevel: 'RepeatableRead', maxWait: 1000, timeout: 5000 },
    );
  }
}
