import type { RunnerLeaseStore } from '../application/runner-lease-store.port.js';

export class UnavailableRunnerLeaseStore implements RunnerLeaseStore {
  async install(): Promise<never> {
    throw new Error('Runner coordination Redis is not configured.');
  }
  async inspect(): Promise<never> {
    throw new Error('Runner coordination Redis is not configured.');
  }
  async renew(): Promise<never> {
    throw new Error('Runner coordination Redis is not configured.');
  }
  async release(): Promise<never> {
    throw new Error('Runner coordination Redis is not configured.');
  }
}
