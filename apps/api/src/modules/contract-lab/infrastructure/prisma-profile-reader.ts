import { Profile } from '@ai-runtime/contracts';
import type { PrismaClient } from '../../../infrastructure/database/generated/client.js';
import type { ProfileReader } from '../application/ports/contract-policy.port.js';

export class PrismaProfileReader implements ProfileReader {
  constructor(private readonly database: PrismaClient) {}

  async listOwned(applicationId: string) {
    const profiles = await this.database.profile.findMany({
      where: { applicationId },
      orderBy: { profileRef: 'asc' },
      select: { definition: true },
    });
    return profiles.map((profile) => Profile.parse(profile.definition));
  }
}
