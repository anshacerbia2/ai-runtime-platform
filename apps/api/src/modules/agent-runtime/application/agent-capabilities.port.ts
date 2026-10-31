import type { Principal } from '../../identity/domain/principal.js';
import type { AgentToolDescriptor } from '../domain/agent-protocol.js';
import type { BudgetAuthority } from './budget-authority.port.js';
import type { ModelExecution } from './model-execution.port.js';
import type { ToolExecution } from './tool-execution.port.js';

export const AGENT_CAPABILITIES = Symbol('AgentCapabilities');

export interface AgentToolBinding extends AgentToolDescriptor {
  // Pinned binding passed back on every intent; model text cannot change it.
  bindingId: string;
}

// The ports one run uses, bound to the authenticated caller. Model and tool
// calls keep the caller's own authority: the agent gains no extra scope.
export interface CallerCapabilities {
  model: ModelExecution;
  tools: ToolExecution;
  budget: BudgetAuthority;
  catalogue: readonly AgentToolBinding[];
  // Canonical request digest for operation identities.
  digest(value: unknown): string;
}

export interface AgentCapabilities {
  forCaller(principal: Principal): CallerCapabilities;
}
