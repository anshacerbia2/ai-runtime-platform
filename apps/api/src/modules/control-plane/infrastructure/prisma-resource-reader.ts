import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  PageQuery,
  ResourcePageSchemas,
  page,
  type PageInput,
  type ResourceName,
  type ResourcePages,
  type Overview,
} from '@ai-runtime/contracts/http';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { Principal } from '../../identity/domain/principal.js';
import type { ResourceReader } from '../application/resource-read.port.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
const Cursor = z
  .object({
    v: z.literal(1),
    resource: z.string(),
    scope: z.string(),
    after: z.array(z.string().min(1).max(160)).min(1).max(2),
  })
  .strict();
export class PrismaResourceReader implements ResourceReader {
  constructor(private readonly db: DatabaseService) {}
  async list<R extends ResourceName>(
    principal: Principal,
    resource: R,
    raw: PageInput,
  ): Promise<ResourcePages[R]> {
    const parsed = PageQuery.safeParse(raw);
    if (!parsed.success) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Invalid pagination query.',
      );
    }
    const query = parsed.data;
    const limit = Number(query.limit ?? 20);
    const take = limit + 1;
    const scope = createHash('sha256')
      .update(principal.kind + ':' + principal.subject)
      .digest('hex');
    let after: string[] = [];
    if (query.cursor) {
      try {
        const cursor = Cursor.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
        if (
          cursor.resource !== resource ||
          cursor.scope !== scope ||
          cursor.after.length !== (resource === 'aliases' ? 2 : 1)
        ) {
          throw new Error('Cursor scope mismatch');
        }
        after = cursor.after;
      } catch {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Invalid or cross-scope page cursor.',
        );
      }
    }
    if (
      after.length &&
      ['bindings', 'profiles', 'audit', 'outbox'].includes(resource) &&
      !z.uuid().safeParse(after[0]).success
    ) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Invalid UUID page cursor.',
      );
    }
    const where = after.length ? { id: { gt: after[0]! } } : {};
    let rows: Record<string, unknown>[];
    switch (resource) {
      case 'applications':
        rows = await this.db.controlApplication.findMany({
          where,
          take,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            displayName: true,
            environment: true,
            keycloakClientId: true,
            gatewayMaxConcurrency: true,
            gatewayRequestsPerMinute: true,
            status: true,
            revision: true,
          },
        });
        break;
      case 'connections':
        rows = await this.db.aiConnection.findMany({
          where,
          take,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            displayName: true,
            provider: true,
            authMode: true,
            environment: true,
            sharingMode: true,
            quotaGroupRef: true,
            gatewayMaxConcurrency: true,
            gatewayRequestsPerMinute: true,
            status: true,
            revision: true,
          },
        });
        break;
      case 'credentials':
        rows = await this.db.credentialInstance.findMany({
          where,
          take,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            connectionId: true,
            residency: true,
            runnerRef: true,
            status: true,
            revision: true,
          },
        });
        break;
      case 'bindings':
        rows = await this.db.credentialBinding.findMany({
          where,
          take,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            applicationId: true,
            connectionId: true,
            profileRef: true,
            status: true,
            revision: true,
          },
        });
        break;
      case 'profiles':
        rows = (
          await this.db.profileRevision.findMany({
            where,
            take,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              applicationId: true,
              profileRef: true,
              revision: true,
              connectionId: true,
              capability: true,
              providerAdapter: true,
              model: true,
              fallbackConnectionId: true,
              fallbackProviderAdapter: true,
              fallbackModel: true,
              maxOutputTokens: true,
              timeoutMs: true,
              streaming: true,
              holdUnits: true,
              accountIds: true,
              digest: true,
              createdAt: true,
            },
          })
        ).map((r) => ({
          ...r,
          holdUnits: r.holdUnits.toString(),
          createdAt: r.createdAt.toISOString(),
        }));
        break;
      case 'budgets':
        rows = (
          await this.db.budgetAccount.findMany({
            where,
            take,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              applicationId: true,
              quotaGroupRef: true,
              unit: true,
              period: true,
              limitUnits: true,
              heldUnits: true,
              postedUnits: true,
              revision: true,
            },
          })
        ).map((r) => ({
          ...r,
          limitUnits: r.limitUnits.toString(),
          heldUnits: r.heldUnits.toString(),
          postedUnits: r.postedUnits.toString(),
        }));
        break;
      case 'pools':
        rows = await this.db.runnerPool.findMany({
          where,
          take,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            environment: true,
            region: true,
            minimumVersion: true,
            status: true,
            revision: true,
          },
        });
        break;
      case 'runners':
        rows = (
          await this.db.runnerNode.findMany({
            where,
            take,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              ownerSubject: true,
              poolId: true,
              version: true,
              capabilities: true,
              connectionIds: true,
              capacity: true,
              status: true,
              revision: true,
              lastHeartbeatAt: true,
            },
          })
        ).map((r) => ({
          ...r,
          lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
        }));
        break;
      case 'audit':
        rows = (
          await this.db.auditEntry.findMany({
            where,
            take,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              applicationId: true,
              actor: true,
              action: true,
              resourceId: true,
              revision: true,
              createdAt: true,
            },
          })
        ).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
        break;
      case 'outbox':
        rows = (
          await this.db.outboxEvent.findMany({
            where,
            take,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              applicationId: true,
              topic: true,
              aggregateId: true,
              revision: true,
              createdAt: true,
              deliveredAt: true,
            },
          })
        ).map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          deliveredAt: r.deliveredAt?.toISOString() ?? null,
        }));
        break;
      case 'aliases':
        rows = await this.db.profileAlias.findMany({
          where: after.length
            ? {
                OR: [
                  { applicationId: { gt: after[0]! } },
                  { applicationId: after[0]!, profileRef: { gt: after[1]! } },
                ],
              }
            : {},
          take,
          orderBy: [{ applicationId: 'asc' }, { profileRef: 'asc' }],
          select: {
            applicationId: true,
            profileRef: true,
            revision: true,
            enabled: true,
            version: true,
          },
        });
        break;
      default:
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Unsupported resource collection.',
        );
    }
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              resource,
              scope,
              after:
                resource === 'aliases'
                  ? [last.applicationId, last.profileRef]
                  : [last.id],
            }),
          ).toString('base64url')
        : null;
    const result = page(ResourcePageSchemas[resource]).parse({
      items,
      nextCursor,
      limit,
      consistency: 'live-keyset',
    });
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 1048576) {
      throw new ApplicationError(
        'RESOURCE_EXHAUSTED',
        'Resource page exceeds its response budget.',
      );
    }
    return result as ResourcePages[R];
  }
  async overview(_principal: Principal): Promise<Overview> {
    const [
      applications,
      connections,
      credentials,
      bindings,
      profiles,
      aliases,
      budgets,
      pools,
      runners,
    ] = await Promise.all([
      this.db.controlApplication.count(),
      this.db.aiConnection.count(),
      this.db.credentialInstance.count(),
      this.db.credentialBinding.count(),
      this.db.profileRevision.count(),
      this.db.profileAlias.count(),
      this.db.budgetAccount.count(),
      this.db.runnerPool.count(),
      this.db.runnerNode.count(),
    ]);
    return {
      observedAt: new Date().toISOString(),
      consistency: 'independent-observations',
      counts: {
        applications,
        connections,
        credentials,
        bindings,
        profiles,
        aliases,
        budgets,
        pools,
        runners,
      },
    };
  }
}
