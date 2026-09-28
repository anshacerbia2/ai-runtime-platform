import { randomUUID } from 'node:crypto';
import type {
  CircuitOutcome,
  CircuitPermit,
  CircuitRoute,
  GatewayCircuit,
} from '../application/gateway-circuit.port.js';

interface State {
  epoch: string;
  failures: number;
  openUntil: number;
  probeToken: string | null;
  probeUntil: number;
  expiresAt: number;
}

export class InMemoryGatewayCircuit implements GatewayCircuit {
  private readonly states = new Map<string, State>();
  private acquisitions = 0;

  async acquire(route: CircuitRoute, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('Provider timeout must be a positive integer.');
    }
    const key = JSON.stringify([
      route.connectionId,
      route.provider,
      route.model,
    ]);
    const now = Date.now();
    if (++this.acquisitions % 256 === 0) {
      for (const [routeKey, entry] of this.states) {
        if (entry.expiresAt <= now) {
          this.states.delete(routeKey);
        }
      }
    }
    let state = this.states.get(key);
    if (state && state.expiresAt <= now) {
      this.states.delete(key);
      state = undefined;
    }
    if (!state) {
      state = {
        epoch: randomUUID(),
        failures: 0,
        openUntil: 0,
        probeToken: null,
        probeUntil: 0,
        expiresAt: now + Math.max(timeoutMs + 60_000, 90_000),
      };
      this.states.set(key, state);
    }
    if (state.openUntil > now || (state.probeToken && state.probeUntil > now)) {
      return null;
    }
    const probe = state.failures >= 3;
    const token = randomUUID();
    state.expiresAt = now + Math.max(timeoutMs + 60_000, 90_000);
    if (probe) {
      state.probeToken = token;
      state.probeUntil = now + timeoutMs + 30_000;
    }
    return { key, epoch: state.epoch, probe, token };
  }

  async report(permit: CircuitPermit, outcome: CircuitOutcome) {
    const state = this.states.get(permit.key);
    const now = Date.now();
    if (!state || state.expiresAt <= now || state.epoch !== permit.epoch) {
      return;
    }
    if (permit.probe) {
      if (state.probeToken !== permit.token) {
        return;
      }
      state.probeToken = null;
      state.probeUntil = 0;
      if (outcome === 'success') {
        this.states.delete(permit.key);
        return;
      }
      if (outcome === 'ambiguous') {
        state.epoch = randomUUID();
        state.openUntil = now + 30_000;
      }
      state.expiresAt = now + 90_000;
      return;
    }
    if (state.probeToken || state.openUntil > now) {
      return;
    }
    if (outcome === 'success') {
      state.failures = 0;
    } else if (outcome === 'ambiguous') {
      state.failures++;
      if (state.failures >= 3) {
        state.epoch = randomUUID();
        state.openUntil = now + 30_000;
      }
    }
    state.expiresAt = now + 90_000;
  }
}
