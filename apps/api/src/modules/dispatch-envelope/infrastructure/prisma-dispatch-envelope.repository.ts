import { Prisma } from '../../../infrastructure/database/generated/client.js';
import type { DispatchEnvelope } from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type {
  DispatchEnvelopeRepository,
  StageDispatchEnvelopeRecord,
  StoredDispatchEnvelope,
} from '../application/dispatch-envelope.ports.js';
import { DISPATCH_ENVELOPE_MAX_RETENTION_MS } from '../application/dispatch-envelope.ports.js';
import { DispatchEnvelopeError } from '../application/dispatch-envelope.service.js';

function stored(row: DispatchEnvelope): StoredDispatchEnvelope {
  return {
    envelopeId: row.id,
    applicationId: row.applicationId,
    executionBindingId: row.executionBindingId,
    executionId: row.executionId,
    profileRevisionId: row.profileRevisionId,
    inputDigest: row.inputDigest,
    objectKey: row.objectKey,
    plaintextSha256: row.plaintextSha256,
    ciphertextSha256: row.ciphertextSha256,
    plaintextBytes: Number(row.plaintextBytes),
    ciphertextBytes: Number(row.ciphertextBytes),
    encryptionAlgorithm: 'AES-256-GCM',
    keyProvider: row.keyProvider,
    keyReference: row.keyReference,
    wrappedDataKey: Uint8Array.from(row.wrappedDataKey),
    nonce: Uint8Array.from(row.nonce),
    authenticationTag: Uint8Array.from(row.authenticationTag),
    state: row.state,
    revision: row.revision,
    createdAt: row.createdAt,
    committedAt: row.committedAt,
    consumedAt: row.consumedAt,
    expiresAt: row.expiresAt,
    deleteClaimedAt: row.deleteClaimedAt,
    expiredAt: row.expiredAt,
  };
}

function prismaCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function conflict(message: string): never {
  throw new DispatchEnvelopeError('ENVELOPE_CONFLICT', message);
}

export class PrismaDispatchEnvelopeRepository implements DispatchEnvelopeRepository {
  constructor(private readonly database: DatabaseService) {}

  async createStaged(
    record: StageDispatchEnvelopeRecord,
  ): Promise<StoredDispatchEnvelope> {
    if (
      !Number.isSafeInteger(record.retentionMs) ||
      record.retentionMs < 1_000 ||
      record.retentionMs > DISPATCH_ENVELOPE_MAX_RETENTION_MS
    ) {
      throw new DispatchEnvelopeError(
        'INVALID_ENVELOPE',
        'Dispatch envelope retention is outside the supported bound.',
      );
    }
    try {
      return this.database.$transaction(async (transaction) => {
        const profile = await transaction.profileRevision.findUnique({
          where: {
            id_applicationId: {
              id: record.profileRevisionId,
              applicationId: record.applicationId,
            },
          },
          select: { capability: true },
        });
        if (!profile || profile.capability !== 'agent_execute') {
          throw new DispatchEnvelopeError(
            'INVALID_ENVELOPE',
            'Dispatch envelopes require an agent_execute profile revision.',
          );
        }
        const clock = await transaction.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        const databaseNow = clock[0]?.now;
        if (!databaseNow) {
          throw new Error('PostgreSQL did not return its authoritative clock.');
        }
        return stored(
          await transaction.dispatchEnvelope.create({
            data: {
              id: record.envelopeId,
              applicationId: record.applicationId,
              executionBindingId: record.executionBindingId,
              profileRevisionId: record.profileRevisionId,
              inputDigest: record.inputDigest,
              objectKey: record.objectKey,
              plaintextSha256: record.plaintextSha256,
              ciphertextSha256: record.ciphertextSha256,
              plaintextBytes: BigInt(record.plaintextBytes),
              ciphertextBytes: BigInt(record.ciphertextBytes),
              encryptionAlgorithm: record.encryptionAlgorithm,
              keyProvider: record.keyProvider,
              keyReference: record.keyReference,
              wrappedDataKey: new Uint8Array(record.wrappedDataKey),
              nonce: new Uint8Array(record.nonce),
              authenticationTag: new Uint8Array(record.authenticationTag),
              expiresAt: new Date(databaseNow.getTime() + record.retentionMs),
            },
          }),
        );
      });
    } catch (error) {
      if (prismaCode(error, 'P2002')) {
        conflict('Dispatch envelope ID or object key already exists.');
      }
      throw error;
    }
  }

  async find(id: string): Promise<StoredDispatchEnvelope | null> {
    const row = await this.database.dispatchEnvelope.findUnique({
      where: { id },
    });
    return row ? stored(row) : null;
  }

  async findCommitted(
    id: string,
    applicationId: string,
  ): Promise<StoredDispatchEnvelope | null> {
    const rows = await this.database.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM control.dispatch_envelopes
      WHERE id = ${id}::uuid
        AND application_id = ${applicationId}
        AND state = 'COMMITTED'::control."DispatchEnvelopeState"
        AND expires_at > clock_timestamp()`;
    return rows.length === 1 ? this.find(id) : null;
  }

  async consume(
    id: string,
    applicationId: string,
    expectedRevision: number,
  ): Promise<StoredDispatchEnvelope> {
    const updated = await this.database.$executeRaw`
      UPDATE control.dispatch_envelopes
      SET state = 'CONSUMED'::control."DispatchEnvelopeState",
          consumed_at = clock_timestamp(),
          revision = revision + 1
      WHERE id = ${id}::uuid
        AND application_id = ${applicationId}
        AND state = 'COMMITTED'::control."DispatchEnvelopeState"
        AND revision = ${expectedRevision}
        AND expires_at > clock_timestamp()`;
    if (updated !== 1) {
      conflict('Dispatch envelope consume precondition failed.');
    }
    return stored(
      await this.database.dispatchEnvelope.findUniqueOrThrow({
        where: { id },
      }),
    );
  }

  async claimExpired(limit: number): Promise<StoredDispatchEnvelope[]> {
    return this.database.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          WITH candidates AS (
            SELECT id
            FROM control.dispatch_envelopes
            WHERE
              state = 'DELETE_PENDING'::control."DispatchEnvelopeState"
              OR (
                state IN (
                  'STAGED'::control."DispatchEnvelopeState",
                  'CONSUMED'::control."DispatchEnvelopeState"
                )
                AND expires_at <= clock_timestamp()
              )
            ORDER BY expires_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
          )
          UPDATE control.dispatch_envelopes AS envelope
          SET
            state = 'DELETE_PENDING'::control."DispatchEnvelopeState",
            delete_claimed_at = COALESCE(
              envelope.delete_claimed_at,
              clock_timestamp()
            ),
            revision = CASE
              WHEN envelope.state = 'DELETE_PENDING'::control."DispatchEnvelopeState"
                THEN envelope.revision
              ELSE envelope.revision + 1
            END
          FROM candidates
          WHERE envelope.id = candidates.id
          RETURNING envelope.id
        `,
      );
      if (claimed.length === 0) {
        return [];
      }
      const rows = await transaction.dispatchEnvelope.findMany({
        where: { id: { in: claimed.map((item) => item.id) } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(stored);
    });
  }

  async markExpired(id: string, expectedRevision: number): Promise<boolean> {
    const result = await this.database.$executeRaw`
      UPDATE control.dispatch_envelopes
      SET state = 'EXPIRED'::control."DispatchEnvelopeState",
          expired_at = clock_timestamp(),
          revision = revision + 1
      WHERE id = ${id}::uuid
        AND state = 'DELETE_PENDING'::control."DispatchEnvelopeState"
        AND revision = ${expectedRevision}`;
    return result === 1;
  }

  async existingObjectKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) {
      return new Set();
    }
    const rows = await this.database.dispatchEnvelope.findMany({
      where: { objectKey: { in: keys } },
      select: { objectKey: true },
    });
    return new Set(rows.map((row) => row.objectKey));
  }
}
