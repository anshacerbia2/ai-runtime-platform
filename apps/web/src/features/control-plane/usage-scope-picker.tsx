'use client';
import { useCallback, useState } from 'react';
import { controlPlaneClient } from '../../shared/api/control-plane-client';
import { useResourceQuery } from '../../shared/api/use-resource-query';
import { latestSnapshot } from '../../shared/api/query-state';
import { errorMessage } from '../../shared/api/http-error';
import { Select } from '../../design-system/primitives/select';
import { Button } from '../../design-system/primitives/button';

export interface UsageChoice {
  id: string;
  label: string;
}
export function UsageScopePicker({
  resource,
  value,
  onChange,
}: {
  resource: 'applications' | 'budgets';
  value: UsageChoice | null;
  onChange(value: UsageChoice | null): void;
}) {
  const label =
    resource === 'applications' ? 'Application filter' : 'Budget account';
  const plural =
    resource === 'applications' ? 'applications' : 'budget accounts';
  const [trail, setTrail] = useState<(string | undefined)[]>([undefined]);
  const cursor = trail.at(-1);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const args = { limit: '20', ...(cursor ? { cursor } : {}) };
      if (resource === 'applications') {
        const page = await controlPlaneClient.list(
          'applications',
          args,
          signal,
        );
        return {
          cursor,
          nextCursor: page.nextCursor,
          choices: page.items.map((item) => ({
            id: item.id,
            label: `${item.displayName} · ${item.id}`,
          })),
        };
      }
      const page = await controlPlaneClient.list('budgets', args, signal);
      return {
        cursor,
        nextCursor: page.nextCursor,
        choices: page.items.map((item) => ({
          id: item.id,
          label: `${item.id} · ${item.unit}`,
        })),
      };
    },
    [resource, cursor],
  );
  const query = useResourceQuery(load);
  const data = latestSnapshot(query.state)?.data;
  const current =
    data !== undefined &&
    query.state.status === 'success' &&
    data.cursor === cursor;
  const loading = query.state.status !== 'error' && !current;
  const choices = current && data ? data.choices : [];
  const options = [
    {
      value: '',
      label:
        resource === 'applications'
          ? 'All applications'
          : 'No ledger account selected',
    },
    ...(value && !choices.some((choice) => choice.id === value.id)
      ? [{ value: value.id, label: value.label }]
      : []),
    ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
  ];
  return (
    <div className="usage-scope ds-field">
      <span>{label}</span>
      <Select
        label={label}
        value={value?.id ?? ''}
        options={options}
        disabled={loading}
        onChange={(id) =>
          onChange(
            choices.find((choice) => choice.id === id) ??
              (value?.id === id ? value : null),
          )
        }
      />
      {loading ? <p role="status">Loading {plural}…</p> : null}
      {query.state.status === 'error' ? (
        <div role="alert">
          <p>{errorMessage(query.state.error)}</p>
          <Button type="button" size="sm" onClick={() => void query.refresh()}>
            Retry {plural}
          </Button>
        </div>
      ) : null}
      {current && !choices.length ? <p>No {plural} on this page.</p> : null}
      <div className="inline-actions">
        <Button
          type="button"
          size="sm"
          disabled={loading || trail.length === 1}
          onClick={() => setTrail((pages) => pages.slice(0, -1))}
        >
          Previous {plural}
        </Button>
        <span>Page {trail.length}</span>
        <Button
          type="button"
          size="sm"
          disabled={!current || !data?.nextCursor}
          onClick={() => {
            if (data?.nextCursor) {
              setTrail((pages) => [...pages, data.nextCursor!]);
            }
          }}
        >
          Next {plural}
        </Button>
      </div>
    </div>
  );
}
