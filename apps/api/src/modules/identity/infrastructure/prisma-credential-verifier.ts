import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../infrastructure/database/generated/client.js';
import type { CredentialVerifier } from '../application/credential-verifier.port.js';
import type { ApplicationIdentity } from '../domain/application-identity.js';

export class PrismaCredentialVerifier implements CredentialVerifier {
  constructor(private readonly database: PrismaClient) {}

  async verify(credential: string): Promise<ApplicationIdentity | null> {
    const tokenDigest = createHash('sha256').update(credential).digest('hex');
    const application = await this.database.application.findUnique({
      where: { tokenSha256: tokenDigest },
      select: { id: true },
    });

    if (!application) {
      return null;
    }
    const registered = await this.database.controlApplication.findUnique({
      where: { id: application.id },
      select: { status: true },
    });
    return registered?.status === 'ENABLED'
      ? { applicationId: application.id }
      : null;
  }
}
