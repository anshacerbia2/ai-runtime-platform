import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { ControlPlaneRepository } from '../application/control-plane-repository.port.js';

export class PrismaControlPlaneRepository implements ControlPlaneRepository {
  constructor(private readonly database: DatabaseService) {}

  async listApplications() {
    return this.database.controlApplication.findMany({
      orderBy: [{ environment: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        displayName: true,
        environment: true,
        keycloakClientId: true,
        status: true,
      },
    });
  }

  async listConnections() {
    const items = await this.database.aiConnection.findMany({
      orderBy: [{ environment: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        displayName: true,
        provider: true,
        authMode: true,
        environment: true,
        sharingMode: true,
        quotaGroupRef: true,
        status: true,
        _count: { select: { credentials: true } },
      },
    });
    return items.map(({ _count, ...item }) => ({
      ...item,
      credentialInstances: _count.credentials,
    }));
  }
  async listBindings() {
    return this.database.credentialBinding.findMany({
      orderBy: [{ applicationId: 'asc' }, { connectionId: 'asc' }],
      select: {
        id: true,
        applicationId: true,
        connectionId: true,
        profileRef: true,
        status: true,
      },
    });
  }
}
