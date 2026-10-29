import {
  ConnectionUsageQuery,
  type ConnectionUsageInput,
} from '@ai-runtime/contracts/http';

function utcTimestamp(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!match) {
    throw new Error('Choose valid UTC times spanning at most 31 days.');
  }
  return `${match[1]}:${match[2] ?? '00'}.${(match[3] ?? '').padEnd(3, '0')}Z`;
}
export function buildUsageQuery(
  from: string,
  to: string,
  applicationId = '',
  budgetAccountId = '',
): ConnectionUsageInput {
  const result = ConnectionUsageQuery.safeParse({
    from: utcTimestamp(from),
    to: utcTimestamp(to),
    ...(applicationId ? { applicationId } : {}),
    ...(budgetAccountId ? { budgetAccountId } : {}),
  });
  if (!result.success) {
    throw new Error('Choose valid UTC times spanning at most 31 days.');
  }
  return result.data;
}
export function recentUsageWindow(now = Date.now()) {
  return {
    from: new Date(now - 86_400_000).toISOString().slice(0, -1),
    to: new Date(now).toISOString().slice(0, -1),
  };
}
export function usageQueryKey(
  connectionId: string,
  query: ConnectionUsageInput,
): string {
  return JSON.stringify([
    connectionId,
    query.from,
    query.to,
    query.applicationId ?? null,
    query.budgetAccountId ?? null,
  ]);
}
export function formatUsageInteger(value: string): string {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Invalid usage counter.');
  }
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
