import type { Principal } from '../../identity/domain/principal.js';
import type { GatewayService } from '../../gateway/application/gateway.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { AgentToolBinding } from '../application/agent-capabilities.port.js';
import type {
  ToolExecution,
  ToolIntent,
  ToolObservation,
  ToolRef,
} from '../application/tool-execution.port.js';
import { calculate, CalculationError } from './calculator.js';

// Read-only built-in tools for the agent preview. They run with the caller's
// own authority: execution_lookup reads through the gateway, which scopes it
// to the caller's application and checks execution:read.
export const builtinToolCatalogue: readonly AgentToolBinding[] = [
  {
    bindingId: 'builtin:current_time:v1',
    name: 'current_time',
    arguments: '{"timezone"?: IANA time zone such as "Asia/Jakarta"}',
    description: 'Current date and time, optionally in a time zone.',
  },
  {
    bindingId: 'builtin:calculate:v1',
    name: 'calculate',
    arguments: '{"expression": string}',
    description:
      'Exact arithmetic: + - * / % ^, parentheses, sqrt, abs, round, floor, ceil, ln, log10, pi, e.',
  },
  {
    bindingId: 'builtin:execution_lookup:v1',
    name: 'execution_lookup',
    arguments: '{"execution_id": UUID}',
    description:
      "Status, provider, model, token usage and finish reason of one of this application's gateway executions.",
  },
];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BuiltinToolExecution implements ToolExecution {
  constructor(
    private readonly gateway: GatewayService,
    private readonly principal: Principal,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async invoke(intent: ToolIntent): Promise<ToolObservation> {
    const ref: ToolRef = {
      operationId: intent.identity.operationId,
      receiptId: null,
    };
    const binding = builtinToolCatalogue.find(
      (tool) => tool.bindingId === intent.bindingId,
    );
    if (!binding || binding.name !== intent.operation) {
      return { state: 'NO_EFFECT', ref, reason: 'Tool binding is not known.' };
    }
    try {
      return {
        state: 'SUCCEEDED',
        ref,
        result: await this.run(binding.name, intent.arguments),
      };
    } catch (error) {
      if (
        error instanceof ToolInputError ||
        error instanceof CalculationError
      ) {
        return { state: 'FAILED', ref, reason: error.message };
      }
      if (error instanceof ApplicationError) {
        return {
          state: 'FAILED',
          ref,
          reason: `${error.code}: ${error.message}`,
        };
      }
      return { state: 'FAILED', ref, reason: 'The tool call failed.' };
    }
  }

  // Built-in tools answer synchronously; there is no detached operation.
  status(ref: ToolRef): Promise<ToolObservation> {
    return Promise.resolve({ state: 'UNKNOWN', ref });
  }

  private async run(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    switch (name) {
      case 'current_time':
        return this.currentTime(args.timezone);
      case 'calculate': {
        if (typeof args.expression !== 'string') {
          throw new ToolInputError('"expression" must be a string.');
        }
        return {
          expression: args.expression,
          result: calculate(args.expression),
        };
      }
      case 'execution_lookup': {
        const id = args.execution_id;
        if (typeof id !== 'string' || !uuid.test(id)) {
          throw new ToolInputError('"execution_id" must be a UUID.');
        }
        const execution = await this.gateway.read(this.principal, id);
        return {
          executionId: execution.executionId,
          status: execution.status,
          provider: execution.provider,
          model: execution.model,
          usage: execution.usage,
          finishReason: execution.finishReason,
        };
      }
      default:
        throw new ToolInputError(`Tool "${name}" is not implemented.`);
    }
  }

  private currentTime(timezone: unknown) {
    const now = this.clock();
    const zone =
      typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
    let local: string;
    try {
      local = new Intl.DateTimeFormat('en-AU', {
        timeZone: zone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
    } catch {
      throw new ToolInputError(`Unknown time zone "${zone.slice(0, 80)}".`);
    }
    return { utc: now.toISOString(), timezone: zone, local };
  }
}

class ToolInputError extends Error {}
