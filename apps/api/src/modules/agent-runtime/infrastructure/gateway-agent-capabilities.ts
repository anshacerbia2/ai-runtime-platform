import { createHash } from 'node:crypto';
import { canonicalJson } from '@ai-runtime/contracts';
import type { Principal } from '../../identity/domain/principal.js';
import type { GatewayService } from '../../gateway/application/gateway.service.js';
import type {
  AgentCapabilities,
  CallerCapabilities,
} from '../application/agent-capabilities.port.js';
import { BuiltinToolExecution, builtinToolCatalogue } from './builtin-tools.js';
import { GatewayModelExecution } from './gateway-model-execution.js';
import { InProcessRunBudget } from './in-process-run-budget.js';

export class GatewayAgentCapabilities implements AgentCapabilities {
  constructor(private readonly gateway: GatewayService) {}

  forCaller(principal: Principal): CallerCapabilities {
    return {
      model: new GatewayModelExecution(this.gateway, principal),
      tools: new BuiltinToolExecution(this.gateway, principal),
      budget: new InProcessRunBudget(),
      catalogue: builtinToolCatalogue,
      digest: (value) =>
        createHash('sha256').update(canonicalJson(value)).digest('hex'),
    };
  }
}
