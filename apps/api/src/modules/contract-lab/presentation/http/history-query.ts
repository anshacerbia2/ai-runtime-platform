import { z } from 'zod';
import { HistoryQuery } from '@ai-runtime/contracts/http';
import { ApplicationError } from '../../../../shared/domain/application-error.js';

const recordId = z.string().uuid();
const cursorSchema = z.strictObject({ version: z.literal(1), id: recordId });
const querySchema = HistoryQuery;

export function parseRecordId(value: string) {
  if (!recordId.safeParse(value).success) {
    throw new ApplicationError('NOT_FOUND', 'Record not found.');
  }
  return value;
}

export function parseHistoryQuery(query: unknown) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    throw new ApplicationError('INVALID_REQUEST', 'Invalid history query.');
  }
  let afterId: string | undefined;
  if (parsed.data.cursor) {
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(parsed.data.cursor, 'base64url').toString('utf8'),
      );
      afterId = cursorSchema.parse(decoded).id;
    } catch {
      throw new ApplicationError('INVALID_REQUEST', 'Invalid page cursor.');
    }
  }
  return { limit: Number(parsed.data.limit ?? 20), afterId };
}

export function encodeHistoryCursor(id: string | null) {
  return id
    ? Buffer.from(JSON.stringify({ version: 1, id })).toString('base64url')
    : null;
}
