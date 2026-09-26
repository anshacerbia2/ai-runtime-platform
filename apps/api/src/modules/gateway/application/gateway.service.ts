import type {
  GatewayExecution,
  GatewayStreamEvent,
  GatewayUsage,
} from '@ai-runtime/contracts/http';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import type { GatewayControl } from './gateway-control.port.js';
import type {
  GatewayClaim,
  GatewayRepository,
} from './gateway-repository.port.js';
import type {
  ProviderAdapter,
  ProviderId,
  ProviderMessage,
  ProviderRequest,
} from './provider-adapter.port.js';
import { ProviderError } from './provider-adapter.port.js';
import type { ReplayStore } from './replay-store.port.js';
import type { RequestFingerprint } from './request-fingerprint.port.js';
import type { StructuredOutputValidator } from './structured-output.port.js';

export interface GatewayCommand {
  profile: string;
  capability: 'chat' | 'generate' | 'structured_generate';
  stream: boolean;
  constraints?: {
    maxOutputTokens?: number;
    timeoutMs?: number;
  };
  messages: ProviderMessage[];
  artifactRefs: string[];
  responseSchema?: Record<string, unknown>;
  fingerprintInput: unknown;
}

type EventSink = (event: GatewayStreamEvent) => void | Promise<void>;

interface ActiveExecution {
  controller: AbortController;
  claim: GatewayClaim;
}
export class GatewayService {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly breaker = new Map<
    string,
    { failures: number; openUntil: number }
  >();

  constructor(
    private readonly control: GatewayControl,
    private readonly repository: GatewayRepository,
    private readonly providers: readonly ProviderAdapter[],
    private readonly replay: ReplayStore,
    private readonly fingerprint: RequestFingerprint,
    private readonly structured: StructuredOutputValidator,
  ) {}

  async execute(
    principal: Principal,
    command: GatewayCommand,
    idempotencyKey: string,
    sink?: EventSink,
  ): Promise<GatewayExecution> {
    requireAuthority(principal, 'execution:submit');
    const applicationId = principal.applicationId;
    if (!applicationId) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Application scope is required.',
      );
    }
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(idempotencyKey)) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'A valid Idempotency-Key is required.',
      );
    }
    if (command.artifactRefs.length) {
      throw new ApplicationError(
        'VERSION_UNSUPPORTED',
        'Gateway artifact input is not enabled in M2.',
      );
    }
    if (command.responseSchema) {
      this.structured.validateSchema(command.responseSchema);
    }
    const inputDigest = this.fingerprint.digest({
      version: 1,
      profile: command.profile,
      capability: command.capability,
      input: command.fingerprintInput,
      constraints: command.constraints ?? null,
    });
    const admission = await this.control.admit(
      principal,
      command.profile,
      inputDigest,
      idempotencyKey,
    );
    const claimed = await this.repository.claim(
      applicationId,
      admission.execution.id,
      inputDigest,
    );
    if (claimed.state === 'terminal') {
      if (claimed.errorCode) {
        throw storedFailure(claimed.errorCode, claimed.execution.executionId);
      }
      return { ...claimed.execution, replayed: true };
    }
    let claim = claimed.claim;
    if (claim.capability !== command.capability) {
      await this.repository.fail(
        claim,
        'PROFILE_CAPABILITY_MISMATCH',
        false,
        false,
      );
      throw new ApplicationError(
        'POLICY_DENIED',
        'Request capability does not match the admitted profile.',
        claim.executionId,
      );
    }
    if (command.stream && !claim.streaming) {
      await this.repository.fail(claim, 'STREAMING_NOT_ALLOWED', false, false);
      throw new ApplicationError(
        'POLICY_DENIED',
        'Profile does not allow streaming.',
        claim.executionId,
      );
    }
    const maxOutputTokens =
      command.constraints?.maxOutputTokens ?? claim.maxOutputTokens;
    const timeoutMs = command.constraints?.timeoutMs ?? claim.timeoutMs;
    if (
      maxOutputTokens > claim.maxOutputTokens ||
      timeoutMs > claim.timeoutMs
    ) {
      await this.repository.fail(claim, 'PROFILE_LIMIT_EXCEEDED', false, false);
      throw new ApplicationError(
        'POLICY_DENIED',
        'Caller constraints may only reduce profile limits.',
        claim.executionId,
      );
    }
    let adapter = this.providers.find((item) => item.id === claim.provider);
    if (!adapter) {
      await this.repository.fail(
        claim,
        'PROVIDER_ADAPTER_UNAVAILABLE',
        false,
        false,
      );
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Configured provider adapter is unavailable.',
        claim.executionId,
      );
    }
    if (this.circuitOpen(claim.provider, claim.model)) {
      await this.repository.fail(claim, 'DEPENDENCY_UNAVAILABLE', false, false);
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Provider route is temporarily unavailable.',
        claim.executionId,
      );
    }

    const controller = new AbortController();
    this.active.set(claim.executionId, { controller, claim });
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([controller.signal, timeout]);
    let sequence = 0;
    let sinkAttached = Boolean(sink);
    let requestId: string | null = null;
    let finishReason: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let text = '';
    let bytes = 0;
    let providerStarted = false;
    let providerCompleted = false;

    const publish = async (
      type: GatewayStreamEvent['type'],
      payload: Record<string, unknown>,
    ) => {
      const event: GatewayStreamEvent = {
        schema_version: '1',
        id: claim.executionId + ':' + sequence,
        execution_id: claim.executionId,
        sequence,
        type,
        occurred_at: new Date().toISOString(),
        payload,
      };
      sequence++;
      this.replay.append(event);
      if (sinkAttached && sink) {
        try {
          await sink(event);
        } catch {
          // Browser/network detachment never cancels paid provider work.
          sinkAttached = false;
        }
      }
    };
    try {
      await publish('execution.started', {
        provider: claim.provider,
        model: claim.model,
        request_id: null,
      });
      for (;;) {
        const selected = adapter;
        if (!selected) {
          throw new ApplicationError(
            'DEPENDENCY_UNAVAILABLE',
            'Configured provider adapter is unavailable.',
            claim.executionId,
          );
        }
        const request: ProviderRequest = {
          capability: command.capability,
          model: claim.model,
          credentialRef: claim.credentialRef,
          messages: command.messages,
          responseSchema: command.responseSchema,
          maxOutputTokens,
          timeoutMs,
        };
        try {
          for await (const event of selected.stream(request, signal)) {
            if (event.type === 'started') {
              providerStarted = true;
              requestId = event.requestId ?? requestId;
            } else if (event.type === 'delta') {
              const chunkBytes = new TextEncoder().encode(
                event.text,
              ).byteLength;
              bytes += chunkBytes;
              if (bytes > 2_097_152) {
                throw new ApplicationError(
                  'RESOURCE_EXHAUSTED',
                  'Provider output exceeds the bounded result envelope.',
                  claim.executionId,
                );
              }
              text += event.text;
              await publish('model.delta', { text: event.text });
            } else if (event.type === 'usage') {
              inputTokens = event.inputTokens ?? inputTokens;
              outputTokens = event.outputTokens ?? outputTokens;
              await publish('usage.updated', {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
              });
            } else {
              providerCompleted = true;
              requestId = event.requestId ?? requestId;
              finishReason = event.finishReason;
            }
          }
          break;
        } catch (cause) {
          const safeFallback =
            cause instanceof ProviderError &&
            cause.outcome === 'not-sent' &&
            !providerStarted &&
            !providerCompleted &&
            bytes === 0 &&
            text.length === 0 &&
            inputTokens === null &&
            outputTokens === null &&
            claim.fallback !== null;
          if (!safeFallback) {
            throw cause;
          }
          claim = await this.repository.beginFallback(claim, cause.code);
          this.active.set(claim.executionId, { controller, claim });
          adapter = this.providers.find((item) => item.id === claim.provider);
          if (!adapter || this.circuitOpen(claim.provider, claim.model)) {
            throw new ApplicationError(
              'DEPENDENCY_UNAVAILABLE',
              'Policy-approved fallback route is unavailable.',
              claim.executionId,
            );
          }
          requestId = null;
          finishReason = null;
          providerStarted = false;
          providerCompleted = false;
        }
      }
      const usage = usageView(inputTokens, outputTokens);
      const result =
        command.capability === 'structured_generate'
          ? {
              kind: 'structured' as const,
              value: this.structured.parseAndValidate(
                command.responseSchema!,
                text,
              ),
            }
          : { kind: 'text' as const, text };
      const completed = await this.repository.complete(
        claim,
        result,
        usage,
        requestId,
        finishReason,
      );
      try {
        await this.control.recordUsage(
          claim,
          requestId,
          inputTokens,
          outputTokens,
        );
      } catch {
        // Result completion is independent from financial reconciliation.
      }
      this.resetCircuit(claim.provider, claim.model);
      await publish('execution.completed', {
        provider: claim.provider,
        model: claim.model,
        request_id: requestId,
        finish_reason: finishReason,
      });
      return completed;
    } catch (cause) {
      const cancelled = controller.signal.aborted;
      const providerError = cause instanceof ProviderError ? cause : undefined;
      const ambiguous =
        cancelled ||
        timeout.aborted ||
        (!providerCompleted && providerStarted) ||
        providerError?.outcome === 'unknown';
      const code = failureCode(cause, timeout.aborted, cancelled);
      const usage = usageView(inputTokens, outputTokens);
      await this.repository.fail(
        claim,
        code,
        ambiguous,
        cancelled,
        usage,
        requestId,
        providerCompleted,
      );
      try {
        await this.control.recordUsage(
          claim,
          requestId,
          inputTokens,
          outputTokens,
        );
      } catch {
        // Unknown/incomplete usage remains held for reconciliation.
      }
      if (ambiguous && !cancelled) {
        this.recordCircuitFailure(claim.provider, claim.model);
      }
      await publish(cancelled ? 'execution.cancelled' : 'execution.failed', {
        code,
      });
      if (cancelled) {
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Execution was cancelled.',
          claim.executionId,
        );
      }
      throw publicFailure(cause, code, claim.executionId);
    } finally {
      this.active.delete(claim.executionId);
    }
  }
  async read(principal: Principal, executionId: string) {
    requireAuthority(principal, 'execution:read');
    if (!principal.applicationId) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Application scope is required.',
      );
    }
    return this.repository.read(principal.applicationId, executionId);
  }

  async cancel(
    principal: Principal,
    executionId: string,
    reason: string | null,
  ) {
    requireAuthority(principal, 'execution:cancel');
    if (!principal.applicationId) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Application scope is required.',
      );
    }
    const current = await this.repository.read(
      principal.applicationId,
      executionId,
    );
    if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
      return current;
    }
    await this.control.cancel(principal, executionId, reason);
    const active = this.active.get(executionId);
    if (active) {
      // The durable cancel intent linearizes first. Provider termination is
      // asynchronous; execute() owns the single terminal transition after abort.
      active.controller.abort(
        new DOMException('Execution cancelled.', 'AbortError'),
      );
    }
    return this.repository.read(principal.applicationId, executionId);
  }

  async events(principal: Principal, executionId: string, after?: string) {
    requireAuthority(principal, 'execution:read');
    if (!principal.applicationId) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Application scope is required.',
      );
    }
    const current = await this.repository.read(
      principal.applicationId,
      executionId,
    );
    return this.replay.watch(executionId, after, current.status === 'RUNNING');
  }
  private circuitOpen(providerId: ProviderId, model: string) {
    const entry = this.breaker.get(providerId + ':' + model);
    return Boolean(entry && entry.openUntil > Date.now());
  }

  private recordCircuitFailure(providerId: ProviderId, model: string) {
    const key = providerId + ':' + model;
    const current = this.breaker.get(key) ?? { failures: 0, openUntil: 0 };
    const failures = current.failures + 1;
    this.breaker.set(key, {
      failures,
      openUntil: failures >= 3 ? Date.now() + 30_000 : 0,
    });
  }

  private resetCircuit(providerId: ProviderId, model: string) {
    this.breaker.delete(providerId + ':' + model);
  }
}

function usageView(
  inputTokens: number | null,
  outputTokens: number | null,
): GatewayUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens === null || outputTokens === null
        ? null
        : inputTokens + outputTokens,
    completeness:
      inputTokens === null || outputTokens === null ? 'unknown' : 'complete',
  };
}
function failureCode(cause: unknown, timedOut: boolean, cancelled: boolean) {
  if (cancelled) {
    return 'CANCELLED_BY_CALLER';
  }
  if (timedOut) {
    return 'DEPENDENCY_UNAVAILABLE';
  }
  if (cause instanceof ApplicationError) {
    return cause.code;
  }
  if (cause instanceof ProviderError) {
    if (cause.status === 429) {
      return 'UPSTREAM_RATE_LIMITED';
    }
    if (cause.outcome === 'rejected') {
      return 'UPSTREAM_REJECTED';
    }
    return 'DEPENDENCY_UNAVAILABLE';
  }
  return 'DEPENDENCY_UNAVAILABLE';
}

function publicFailure(
  cause: unknown,
  code: string,
  executionId: string,
): ApplicationError {
  if (cause instanceof ApplicationError) {
    return new ApplicationError(cause.code, cause.message, executionId);
  }
  if (cause instanceof ProviderError) {
    if (cause.status === 429) {
      return new ApplicationError(
        'UPSTREAM_RATE_LIMITED',
        'Provider rate limit rejected the request.',
        executionId,
      );
    }
    if (cause.outcome === 'rejected') {
      return new ApplicationError(
        'UPSTREAM_REJECTED',
        'Provider rejected the request.',
        executionId,
      );
    }
  }
  return new ApplicationError(
    'DEPENDENCY_UNAVAILABLE',
    'Provider outcome is not confirmed; reconcile the execution before retrying.',
    executionId,
  );
}

function storedFailure(code: string, executionId: string) {
  if (code === 'CANCELLED_BY_CALLER') {
    return new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Execution was cancelled.',
      executionId,
    );
  }
  return new ApplicationError(
    code === 'UPSTREAM_RATE_LIMITED'
      ? 'UPSTREAM_RATE_LIMITED'
      : code === 'STRUCTURED_OUTPUT_INVALID'
        ? 'STRUCTURED_OUTPUT_INVALID'
        : 'DEPENDENCY_UNAVAILABLE',
    'Execution previously ended without a successful result.',
    executionId,
  );
}
