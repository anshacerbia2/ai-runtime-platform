import type { ControlPlaneRepository } from './control-plane-repository.port.js';

export class ReadControlPlaneUseCase {
  constructor(private readonly repository: ControlPlaneRepository) {}

  async execute() {
    const [applications, connections, bindings] = await Promise.all([
      this.repository.listApplications(),
      this.repository.listConnections(),
      this.repository.listBindings(),
    ]);
    return { applications, connections, bindings };
  }
}
