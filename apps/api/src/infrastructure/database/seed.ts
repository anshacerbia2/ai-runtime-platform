import { createHash } from 'node:crypto';
import { canonicalJson, profiles } from '@ai-runtime/contracts';
import type { LocalConfig } from '../config/local-config.js';
import type { PrismaClient } from './generated/client.js';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export async function seedDatabase(
  database: PrismaClient,
  config: LocalConfig,
) {
  await database.$transaction(
    async (transaction) => {
      // One-time tooling coordination, not a periodic worker heartbeat.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${621408321})`;
      for (const application of config.applications) {
        await transaction.application.upsert({
          where: { id: application.id },
          create: {
            id: application.id,
            displayName: application.name,
            tokenSha256: digest(application.token),
          },
          update: {
            displayName: application.name,
            tokenSha256: digest(application.token),
          },
        });
        for (const profile of profiles) {
          const checksum = digest(canonicalJson(profile));
          await transaction.profile.createMany({
            data: [
              {
                applicationId: application.id,
                profileRef: profile.profile,
                definition: profile,
                digest: checksum,
              },
            ],
            skipDuplicates: true,
          });
          const stored = await transaction.profile.findUniqueOrThrow({
            where: {
              applicationId_profileRef: {
                applicationId: application.id,
                profileRef: profile.profile,
              },
            },
            select: { digest: true },
          });
          if (stored.digest !== checksum) {
            throw new Error(
              'Immutable profile changed. Publish a new revision.',
            );
          }
        }
      }
    },
    { maxWait: 5000, timeout: 15000 },
  );
}
