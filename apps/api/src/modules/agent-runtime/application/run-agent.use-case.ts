import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import {
  agentSystemPrompt,
  parseAgentReply,
  stepLimitNotice,
  toolResultMessage,
} from '../domain/agent-protocol.js';
import type {
  OperationIdentity,
  TrustedCaller,
} from '../domain/operation-identity.js';
import {
  canTransitionOperation,
  type OperationState,
} from '../domain/operation-state.js';
import {
  admitsNewOperation,
  canTransitionRun,
  type RunStatus,
} from '../domain/run-lifecycle.js';
import type {
  AgentCapabilities,
  AgentToolBinding,
  CallerCapabilities,
} from './agent-capabilities.port.js';
import type { RunReservationRef } from './budget-authority.port.js';
import type { ModelMessage, ModelObservation } from './model-execution.port.js';
import type { ToolObservation } from './tool-execution.port.js';

export interface AgentRunCommand {
  runId: string;
  profile: string;
  input: string;
  system: string | null;
  history: readonly { role: 'user' | 'assistant'; text: string }[];
  // Null selects every tool in the caller's catalogue.
  tools: readonly string[] | null;
  maxSteps: number;
  maxOutputTokens: number;
  tokenBudget: number;
}

export interface AgentRunTotals {
  steps: number;
  inputTokens: number;
  outputTokens: number;
}

export type AgentStopStatus = 'FAILED' | 'CANCELLED' | 'STOPPED_BUDGET';

export type AgentRunUpdate =
  | {
      type: 'run.started';
      profile: string;
      tools: string[];
      maxSteps: number;
      tokenBudget: number;
    }
  | { type: 'model.dispatched'; step: number; executionId: string }
  | {
      type: 'model.completed';
      step: number;
      executionId: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      thought: string | null;
      action: 'tool' | 'final';
    }
  | {
      type: 'tool.called';
      step: number;
      tool: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'tool.completed';
      step: number;
      tool: string;
      status: 'SUCCEEDED' | 'FAILED';
      output: string;
    }
  | { type: 'run.completed'; answer: string; totals: AgentRunTotals }
  | {
      type: 'run.stopped';
      status: AgentStopStatus;
      code: string;
      message: string;
      totals: AgentRunTotals;
    };

export type AgentRunSink = (update: AgentRunUpdate) => void | Promise<void>;

const modelDeadlineMs = 120_000;
const toolDeadlineMs = 10_000;
const minimumStepTokens = 64;
const maxToolOutput = 4_000;

/**
 * Agent preview loop (ADR-0034 stage A2-preview): model turn, one tool call,
 * observation, repeat, within a step limit and a run token cap. The run lives
 * for one request and is not persisted; every model turn is an admitted and
 * accounted gateway execution.
 */
export class RunAgentUseCase {
  constructor(private readonly capabilities: AgentCapabilities) {}

  async run(
    principal: Principal,
    command: AgentRunCommand,
    emit: AgentRunSink,
    signal: AbortSignal,
  ): Promise<RunStatus> {
    requireAuthority(principal, 'execution:submit');
    if (!principal.applicationId) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Application scope is required.',
      );
    }
    const caps = this.capabilities.forCaller(principal);
    const tools = command.tools
      ? caps.catalogue.filter((tool) => command.tools?.includes(tool.name))
      : [...caps.catalogue];
    const caller: TrustedCaller = {
      applicationId: principal.applicationId,
      tenantId: null,
      principalSubject: principal.subject,
    };
    return new AgentRun(caps, caller, command, tools, emit, signal).execute();
  }
}

class AgentRun {
  private status: RunStatus = 'CREATED';
  private readonly totals: AgentRunTotals = {
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  private spent = 0;
  private readonly messages: ModelMessage[];

  constructor(
    private readonly caps: CallerCapabilities,
    private readonly caller: TrustedCaller,
    private readonly command: AgentRunCommand,
    private readonly tools: readonly AgentToolBinding[],
    private readonly emit: AgentRunSink,
    private readonly signal: AbortSignal,
  ) {
    this.messages = [
      {
        role: 'system',
        content: agentSystemPrompt(tools, command.system),
      },
      ...command.history.map((turn) => ({
        role: turn.role,
        content: turn.text,
      })),
      { role: 'user', content: command.input },
    ];
  }

  async execute(): Promise<RunStatus> {
    await this.emit({
      type: 'run.started',
      profile: this.command.profile,
      tools: this.tools.map((tool) => tool.name),
      maxSteps: this.command.maxSteps,
      tokenBudget: this.command.tokenBudget,
    });
    let reservation: RunReservationRef | null = null;
    try {
      reservation = await this.caps.budget.reserveRun({
        runId: this.command.runId,
        caller: this.caller,
        submissionKey: this.command.runId,
        requestDigest: this.caps.digest(this.command),
        envelope: { unit: 'tokens', amount: String(this.command.tokenBudget) },
      });
      this.move('RUNNING');
      for (let step = 1; step <= this.command.maxSteps; step += 1) {
        const done = await this.step(step, reservation);
        if (done) {
          return this.status;
        }
      }
      return await this.stop(
        'FAILED',
        'STEP_LIMIT',
        'The agent did not answer within the step limit.',
      );
    } catch (error) {
      if (this.signal.aborted) {
        return await this.stop('CANCELLED', 'CANCELLED', 'Run cancelled.');
      }
      return await this.stop(
        'FAILED',
        error instanceof ApplicationError ? error.code : 'AGENT_RUN_FAILED',
        error instanceof ApplicationError
          ? error.message
          : 'The agent run failed unexpectedly.',
      );
    } finally {
      if (reservation) {
        await this.caps.budget
          .releaseRun(reservation, this.status)
          .catch(() => undefined);
      }
    }
  }

  /** Returns true once the run has reached a terminal status. */
  private async step(
    step: number,
    reservation: RunReservationRef,
  ): Promise<boolean> {
    if (!admitsNewOperation(this.status, this.signal.aborted)) {
      await this.stop('CANCELLED', 'CANCELLED', 'Run cancelled.');
      return true;
    }
    const remaining = this.command.tokenBudget - this.spent;
    if (remaining < minimumStepTokens) {
      await this.stop(
        'STOPPED_BUDGET',
        'RUN_TOKEN_BUDGET_EXHAUSTED',
        `The run used ${this.spent} of its ${this.command.tokenBudget} token budget.`,
      );
      return true;
    }
    const last = step === this.command.maxSteps;
    if (last && step > 1) {
      this.messages.push({ role: 'user', content: stepLimitNotice() });
    }
    const maxOutputTokens = Math.min(this.command.maxOutputTokens, remaining);
    const identity = this.identity(step, 'model', this.messages);
    const allocation = await this.caps.budget.allocateOperation({
      reservation,
      identity,
      ceiling: { unit: 'tokens', amount: String(maxOutputTokens) },
    });
    const dispatching = advance('PREPARED', 'DISPATCHING');
    let executionId: string | null = null;
    let observation: ModelObservation;
    try {
      observation = await this.caps.model.execute(
        {
          identity,
          capabilityProfile: this.command.profile,
          capability: 'chat',
          messages: [...this.messages],
          maxOutputTokens,
          deadlineMs: modelDeadlineMs,
          allocation,
        },
        {
          signal: this.signal,
          onDispatched: (ref) => {
            executionId = ref.inferenceId;
            if (ref.inferenceId) {
              void this.emit({
                type: 'model.dispatched',
                step,
                executionId: ref.inferenceId,
              });
            }
          },
        },
      );
    } finally {
      await this.caps.budget
        .releaseOperation(allocation, 'model turn resolved')
        .catch(() => undefined);
    }
    advance(dispatching, observation.state);
    // A step refused before dispatch (NO_EFFECT) never reached a model.
    if (observation.state !== 'NO_EFFECT') {
      this.totals.steps = step;
    }
    executionId = observation.ref.inferenceId ?? executionId;
    if (observation.state === 'SUCCEEDED' || observation.state === 'FAILED') {
      const { inputTokens, outputTokens } = observation.usage;
      this.totals.inputTokens += inputTokens ?? 0;
      this.totals.outputTokens += outputTokens ?? 0;
      // Unknown output is charged at the step ceiling, never as zero.
      this.spent += (inputTokens ?? 0) + (outputTokens ?? maxOutputTokens);
    }
    if (observation.state !== 'SUCCEEDED') {
      if (this.signal.aborted) {
        await this.stop('CANCELLED', 'CANCELLED', 'Run cancelled.');
        return true;
      }
      const failure = describeFailure(observation);
      await this.stop('FAILED', failure.code, failure.message);
      return true;
    }
    const action = parseAgentReply(observation.output);
    await this.emit({
      type: 'model.completed',
      step,
      executionId,
      inputTokens: observation.usage.inputTokens,
      outputTokens: observation.usage.outputTokens,
      thought: action.thought,
      action: action.kind,
    });
    this.messages.push({ role: 'assistant', content: observation.output });
    if (action.kind === 'final') {
      this.move('COMPLETED');
      await this.emit({
        type: 'run.completed',
        answer: action.answer,
        totals: { ...this.totals },
      });
      return true;
    }
    if (last) {
      await this.stop(
        'FAILED',
        'STEP_LIMIT',
        'The agent asked for another tool after its last step.',
      );
      return true;
    }
    await this.emit({
      type: 'tool.called',
      step,
      tool: action.tool,
      arguments: action.arguments,
    });
    this.move('WAITING_TOOL');
    const result = await this.invokeTool(step, action.tool, action.arguments);
    await this.emit({
      type: 'tool.completed',
      step,
      tool: action.tool,
      ...result,
    });
    this.move('RUNNING');
    this.messages.push({
      role: 'user',
      content: toolResultMessage(action.tool, result.status, result.output),
    });
    return false;
  }

  private async invokeTool(
    step: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ status: 'SUCCEEDED' | 'FAILED'; output: string }> {
    const binding = this.tools.find((tool) => tool.name === name);
    if (!binding) {
      return {
        status: 'FAILED',
        output: `Unknown tool "${name.slice(0, 80)}". Available: ${
          this.tools.map((tool) => tool.name).join(', ') || 'none'
        }.`,
      };
    }
    let observation: ToolObservation;
    try {
      observation = await this.caps.tools.invoke({
        identity: this.identity(step, 'tool', { name, args }),
        bindingId: binding.bindingId,
        operation: binding.name,
        arguments: args,
        deadlineMs: toolDeadlineMs,
        allocation: null,
      });
    } catch {
      return { status: 'FAILED', output: 'The tool call failed.' };
    }
    switch (observation.state) {
      case 'SUCCEEDED':
        return {
          status: 'SUCCEEDED',
          output: truncate(
            typeof observation.result === 'string'
              ? observation.result
              : JSON.stringify(observation.result),
          ),
        };
      case 'FAILED':
      case 'NO_EFFECT':
        return { status: 'FAILED', output: truncate(observation.reason) };
      case 'UNKNOWN':
        return { status: 'FAILED', output: 'The tool outcome is unknown.' };
    }
  }

  private identity(
    step: number,
    kind: 'model' | 'tool',
    request: unknown,
  ): OperationIdentity {
    return {
      runId: this.command.runId,
      turnId: `step-${step}`,
      operationId: `${this.command.runId}:${kind}:${step}`,
      caller: this.caller,
      requestDigest: this.caps.digest(request),
    };
  }

  private move(to: RunStatus) {
    if (!canTransitionRun(this.status, to)) {
      throw new Error(`Illegal run transition ${this.status} -> ${to}.`);
    }
    this.status = to;
  }

  private async stop(
    status: AgentStopStatus,
    code: string,
    message: string,
  ): Promise<RunStatus> {
    if (canTransitionRun(this.status, status)) {
      this.status = status;
    }
    await this.emit({
      type: 'run.stopped',
      status,
      code,
      message,
      totals: { ...this.totals },
    });
    return this.status;
  }
}

function advance(from: OperationState, to: OperationState): OperationState {
  if (!canTransitionOperation(from, to)) {
    throw new Error(`Illegal operation transition ${from} -> ${to}.`);
  }
  return to;
}

function describeFailure(
  observation: Exclude<ModelObservation, { state: 'SUCCEEDED' }>,
): { code: string; message: string } {
  if (observation.state === 'UNKNOWN') {
    return {
      code: 'MODEL_OUTCOME_UNKNOWN',
      message: 'The model step outcome is unknown; it may still be charged.',
    };
  }
  const match = /^([A-Z][A-Z0-9_]{1,80}): ([\s\S]+)$/.exec(observation.reason);
  return match?.[1] && match[2]
    ? { code: match[1], message: match[2].slice(0, 1_000) }
    : {
        code: 'MODEL_STEP_FAILED',
        message: observation.reason.slice(0, 1_000),
      };
}

function truncate(value: string): string {
  return value.length > maxToolOutput
    ? value.slice(0, maxToolOutput) + '… [truncated]'
    : value;
}
