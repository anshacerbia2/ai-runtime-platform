'use client';
import { useCallback, useId, useState, type FormEvent } from 'react';
import type {
  ConnectionUsageInput,
  ResourcePages,
} from '@ai-runtime/contracts/http';
import { controlPlaneClient } from '../../shared/api/control-plane-client';
import { useResourceQuery } from '../../shared/api/use-resource-query';
import { latestSnapshot } from '../../shared/api/query-state';
import { errorMessage } from '../../shared/api/http-error';
import {
  Panel,
  PanelHeader,
  PanelBody,
} from '../../design-system/components/panel';
import { MetricCard } from '../../design-system/components/metric-card';
import { Badge } from '../../design-system/components/badge';
import { DataTable } from '../../design-system/components/data-table';
import { EmptyState } from '../../design-system/components/empty-state';
import { Button } from '../../design-system/primitives/button';
import { UsageScopePicker, type UsageChoice } from './usage-scope-picker';
import {
  buildUsageQuery,
  formatUsageInteger,
  recentUsageWindow,
  usageQueryKey,
} from './usage-model';

export type UsageConnection = Pick<
  ResourcePages['connections']['items'][number],
  'id' | 'displayName' | 'provider' | 'status'
>;

function UsageResult({
  connectionId,
  filters,
}: {
  connectionId: string;
  filters: ConnectionUsageInput;
}) {
  const load = useCallback(
    (signal?: AbortSignal) =>
      controlPlaneClient.usage(connectionId, filters, signal),
    [connectionId, filters],
  );
  const query = useResourceQuery(load);
  const result = latestSnapshot(query.state)?.data;
  const loading =
    query.state.status === 'idle' || query.state.status === 'loading';
  const stale = !!result && query.state.status !== 'success';
  return (
    <div
      className="resource-stack"
      aria-label="Usage result"
      role="region"
      aria-busy={loading}
    >
      <Panel>
        <PanelHeader
          title="Applied usage period"
          description="Provider invocations started in this UTC interval; the end time is exclusive."
          aside={
            <Button
              type="button"
              disabled={loading}
              onClick={() => void query.refresh()}
            >
              Refresh usage
            </Button>
          }
        />
        <PanelBody>
          <p>
            {filters.from} → {filters.to}
          </p>
          <p>
            Application: {filters.applicationId ?? 'All applications'} · Ledger
            account: {filters.budgetAccountId ?? 'None selected'}
          </p>
          {loading ? (
            <p role="status">
              {result
                ? 'Refreshing usage… last successful result remains visible.'
                : 'Loading usage…'}
            </p>
          ) : null}
          {query.state.status === 'error' ? (
            <div role="alert">
              <p>Usage unavailable. {errorMessage(query.state.error)}</p>
              <Button type="button" onClick={() => void query.refresh()}>
                Retry usage
              </Button>
            </div>
          ) : null}
          {stale ? <Badge tone="warning">Last successful result</Badge> : null}
          {result ? (
            <p>
              Observed at{' '}
              <time dateTime={result.observedAt}>{result.observedAt}</time>.
              Late corrections can change historical totals.
            </p>
          ) : null}
        </PanelBody>
      </Panel>
      {result ? (
        <>
          {result.invocations.total === '0' ? (
            <EmptyState
              title="No provider invocations in this period"
              description="The platform has no matching invocation records for this account and applied filters."
            />
          ) : null}
          <section
            className="ds-metric-grid usage-metrics"
            aria-label="Invocation and token summary"
          >
            <MetricCard
              label="Provider invocations"
              value={formatUsageInteger(result.invocations.total)}
              detail="Each provider attempt is counted separately"
            />
            <MetricCard
              label="Known input tokens"
              value={formatUsageInteger(result.tokens.input.known)}
              detail={`Unavailable for ${formatUsageInteger(result.tokens.input.unknownInvocations)} invocations`}
            />
            <MetricCard
              label="Known output tokens"
              value={formatUsageInteger(result.tokens.output.known)}
              detail={`Unavailable for ${formatUsageInteger(result.tokens.output.unknownInvocations)} invocations`}
            />
            <MetricCard
              label="Unknown outcomes"
              value={formatUsageInteger(result.invocations.unknown)}
              detail="Unresolved provider outcomes"
            />
          </section>
          <Panel>
            <PanelHeader
              title="Invocation outcomes"
              description="Provider state is separate from token measurement completeness."
            />
            <DataTable label="Invocation outcomes" fit>
              <thead>
                <tr>
                  <th>State</th>
                  <th>Invocations</th>
                </tr>
              </thead>
              <tbody>
                {(['running', 'succeeded', 'failed', 'unknown'] as const).map(
                  (state) => (
                    <tr key={state}>
                      <th scope="row">{state.toUpperCase()}</th>
                      <td>{formatUsageInteger(result.invocations[state])}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </DataTable>
          </Panel>
          <Panel>
            <PanelHeader
              title="Ledger attribution"
              description="Platform accounting for this invocation cohort, not a provider invoice or vendor balance."
            />
            <PanelBody>
              {result.ledger ? (
                <>
                  <p className="usage-ledger-total">
                    {formatUsageInteger(result.ledger.attributedPostedUnits)}{' '}
                    <span>{result.ledger.unit}</span>
                  </p>
                  <p>Budget account: {result.ledger.accountId}</p>
                  <p>
                    Excluded observations:{' '}
                    {formatUsageInteger(result.ledger.excludedObservationCount)}
                    {result.ledger.excludedObservationCount !== '0'
                      ? ' · mixed coverage cannot be assigned safely to this account.'
                      : ''}
                  </p>
                  <p>
                    Includes posted corrections. Excludes holds, unmatched
                    evidence and unposted usage; this is not complete account
                    spend.
                  </p>
                </>
              ) : (
                <p>
                  Select one budget account and apply the filters to see
                  attributable postings. Budget scopes are never added together.
                </p>
              )}
            </PanelBody>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function SelectedAccountUsage({
  connection,
  onChoose,
}: {
  connection: UsageConnection;
  onChoose(): void;
}) {
  const [window, setWindow] = useState(() => recentUsageWindow());
  const [application, setApplication] = useState<UsageChoice | null>(null);
  const [budget, setBudget] = useState<UsageChoice | null>(null);
  const [applied, setApplied] = useState(() =>
    buildUsageQuery(window.from, window.to),
  );
  const [validation, setValidation] = useState<string | null>(null);
  const errorId = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setApplied(
        buildUsageQuery(window.from, window.to, application?.id, budget?.id),
      );
      setValidation(null);
    } catch {
      setValidation('Choose valid UTC times spanning at most 31 days.');
    }
  }
  return (
    <div className="resource-stack account-usage">
      <Panel>
        <PanelHeader
          title={`Usage for ${connection.displayName}`}
          description={`${connection.id} · ${connection.provider}`}
          aside={
            <Button type="button" onClick={onChoose}>
              Change account
            </Button>
          }
        />
        <PanelBody>
          <p>
            Connection configuration: <Badge>{connection.status}</Badge>
          </p>
          <p>
            Usage comes from stored platform records. Configuration status is
            not a live provider health check.
          </p>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader
          title="Usage filters"
          description="Times are UTC. Changes take effect when you apply the filters; refresh keeps the applied interval."
        />
        <PanelBody>
          <form onSubmit={submit} className="usage-filters">
            <label className="ds-field">
              <span>Start time (UTC)</span>
              <input
                type="datetime-local"
                step="0.001"
                required
                value={window.from}
                onChange={(event) =>
                  setWindow((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
                aria-invalid={!!validation}
                aria-describedby={validation ? errorId : undefined}
              />
            </label>
            <label className="ds-field">
              <span>End time (UTC, exclusive)</span>
              <input
                type="datetime-local"
                step="0.001"
                required
                value={window.to}
                onChange={(event) =>
                  setWindow((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
                aria-invalid={!!validation}
                aria-describedby={validation ? errorId : undefined}
              />
            </label>
            <UsageScopePicker
              resource="applications"
              value={application}
              onChange={setApplication}
            />
            <UsageScopePicker
              resource="budgets"
              value={budget}
              onChange={setBudget}
            />
            <div className="inline-actions">
              <Button type="submit" variant="primary">
                Apply usage filters
              </Button>
              <Button
                type="button"
                onClick={() => setWindow(recentUsageWindow())}
              >
                Set last 24 hours
              </Button>
            </div>
            {validation ? (
              <p id={errorId} role="alert">
                {validation}
              </p>
            ) : null}
          </form>
        </PanelBody>
      </Panel>
      <UsageResult
        key={usageQueryKey(connection.id, applied)}
        connectionId={connection.id}
        filters={applied}
      />
    </div>
  );
}

export function AccountUsage({
  connection,
  onChoose,
}: {
  connection: UsageConnection | null;
  onChoose(): void;
}) {
  return connection ? (
    <SelectedAccountUsage
      key={connection.id}
      connection={connection}
      onChoose={onChoose}
    />
  ) : (
    <Panel>
      <PanelBody>
        <EmptyState
          title="Choose an AI account"
          description="Open Connections and choose View usage for a registered account."
        />
        <Button type="button" onClick={onChoose}>
          Browse connections
        </Button>
      </PanelBody>
    </Panel>
  );
}
