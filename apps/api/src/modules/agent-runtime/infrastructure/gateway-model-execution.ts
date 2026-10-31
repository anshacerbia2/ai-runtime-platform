import type { GatewayExecution } from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
import type { GatewayService } from '../../gateway/application/gateway.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  InferenceRef,
  ModelExecuteOptions,
  ModelExecution,
  ModelIntent,
  ModelObservation,
  ModelUsage,
} from '../application/model-execution.port.js';

/**
 * ModelExecution over the M2 gateway application boundary (ADR-0034, AR-P04).
 * Every intent becomes one admitted gateway execution under the caller's own
 * principal, keyed by the operation ID so a retried operation never runs twice.
 */
export class GatewayModelExecution implements ModelExecution {
  constructor(
    private readonly gateway: GatewayService,
    private readonly principal: Principal,
  ) {}

  async execute(
    intent: ModelIntent,
    options: ModelExecuteOptions = {},
  ): Promise<ModelObservation> {
    const ref: InferenceRef = {
      operationId: intent.identity.operationId,
      inferenceId: null,
    };
    const { signal } = options;
    const cancel = () => {
      if (ref.inferenceId) {
        void this.gateway
          .cancel(this.principal, ref.inferenceId, 'Agent run cancelled.')
          .catch(() => undefined);
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) {
        return { state: 'NO_EFFECT', ref, reason: 'CANCELLED: Run cancelled.' };
      }
      const execution = await this.gateway.execute(
        this.principal,
        {
          profile: intent.capabilityProfile,
          capability: intent.capability,
          stream: false,
          constraints: { maxOutputTokens: intent.maxOutputTokens },
          messages: intent.messages.map((message) => ({
            role: message.role,
            text: message.content,
          })),
          artifactRefs: [],
          responseSchema: intent.responseSchema
            ? { ...intent.responseSchema }
            : undefined,
          fingerprintInput: {
            agent_operation: intent.identity.operationId,
            request_digest: intent.identity.requestDigest,
          },
        },
        intent.identity.operationId,
        (event) => {
          if (event.type === 'execution.started' && !ref.inferenceId) {
            ref.inferenceId = event.execution_id;
            options.onDispatched?.({ ...ref });
            if (signal?.aborted) {
              cancel();
            }
          }
        },
      );
      ref.inferenceId = execution.executionId;
      return observe(ref, execution);
    } catch (error) {
      if (error instanceof ApplicationError) {
        const reason = `${error.code}: ${error.message}`;
        // Refused before the gateway named an execution: nothing was sent.
        return ref.inferenceId || error.executionId
          ? {
              state: 'FAILED',
              ref: {
                ...ref,
                inferenceId: ref.inferenceId ?? error.executionId ?? null,
              },
              reason,
              usage: unknownUsage,
            }
          : { state: 'NO_EFFECT', ref, reason };
      }
      return { state: 'UNKNOWN', ref };
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  async status(ref: InferenceRef): Promise<ModelObservation> {
    if (!ref.inferenceId) {
      return { state: 'UNKNOWN', ref };
    }
    return observe(
      ref,
      await this.gateway.read(this.principal, ref.inferenceId),
    );
  }

  async cancel(ref: InferenceRef, reason: string | null): Promise<void> {
    if (ref.inferenceId) {
      await this.gateway.cancel(this.principal, ref.inferenceId, reason);
    }
  }
}

const unknownUsage: ModelUsage = {
  inputTokens: null,
  outputTokens: null,
  charged: null,
  completeness: 'unknown',
};

function observe(
  ref: InferenceRef,
  execution: GatewayExecution,
): ModelObservation {
  const usage: ModelUsage = {
    inputTokens: execution.usage.inputTokens,
    outputTokens: execution.usage.outputTokens,
    charged:
      execution.usage.totalTokens === null
        ? null
        : { unit: 'tokens', amount: String(execution.usage.totalTokens) },
    completeness: execution.usage.completeness,
  };
  switch (execution.status) {
    case 'COMPLETED':
      return {
        state: 'SUCCEEDED',
        ref,
        output:
          execution.result?.kind === 'text'
            ? execution.result.text
            : JSON.stringify(execution.result?.value ?? null),
        usage,
      };
    case 'FAILED':
      return {
        state: 'FAILED',
        ref,
        reason: 'MODEL_EXECUTION_FAILED: The model execution failed.',
        usage,
      };
    case 'CANCELLED':
      return {
        state: 'FAILED',
        ref,
        reason: 'CANCELLED: The model execution was cancelled.',
        usage,
      };
    default:
      // RUNNING or RECONCILING: the outcome is not known yet.
      return { state: 'UNKNOWN', ref };
  }
}
