import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  agentContract,
  agentRunLimits,
  AgentRunEvent,
  AgentRunRequest,
} from '@ai-runtime/contracts/http';
import { Body, Controller, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { requireAuthority } from '../../../identity/domain/principal.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import {
  RunAgentUseCase,
  type AgentRunUpdate,
} from '../../application/run-agent.use-case.js';

@Controller()
export class AgentRunsController {
  constructor(
    @Inject(RunAgentUseCase) private readonly runs: RunAgentUseCase,
  ) {}

  /** Streams one request-scoped agent run as SSE. Closing the stream cancels it. */
  @ContractRoute(agentContract.run)
  async run(
    @CurrentPrincipal() principal: Principal,
    @Body() raw: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Refuse before opening the stream so authority errors stay JSON errors.
    requireAuthority(principal, 'execution:submit');
    const body = AgentRunRequest.parse(raw);
    const runId = randomUUID();
    const cancelled = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableEnded) {
        cancelled.abort(new DOMException('Client detached.', 'AbortError'));
      }
    };
    startSse(reply, request);
    reply.raw.once('close', onClose);
    let sequence = 0;
    const emit = async (update: AgentRunUpdate) => {
      const event = AgentRunEvent.parse(toWire(runId, sequence++, update));
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        return;
      }
      const frame = `id: ${runId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      if (!reply.raw.write(frame)) {
        await once(reply.raw, 'drain');
      }
    };
    try {
      await this.runs.run(
        principal,
        {
          runId,
          profile: body.profile,
          input: body.input,
          system: body.system ?? null,
          history: body.history ?? [],
          tools: body.tools ?? null,
          maxSteps: body.max_steps ?? agentRunLimits.defaultSteps,
          maxOutputTokens:
            body.max_output_tokens ?? agentRunLimits.defaultOutputTokens,
          tokenBudget: body.token_budget ?? agentRunLimits.defaultTokenBudget,
        },
        emit,
        cancelled.signal,
      );
    } finally {
      reply.raw.off('close', onClose);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
    return undefined;
  }
}

function toWire(runId: string, sequence: number, update: AgentRunUpdate) {
  const base = {
    schema_version: '1' as const,
    run_id: runId,
    sequence,
    occurred_at: new Date().toISOString(),
  };
  switch (update.type) {
    case 'run.started':
      return {
        ...base,
        type: update.type,
        payload: {
          profile: update.profile,
          tools: update.tools,
          max_steps: update.maxSteps,
          token_budget: update.tokenBudget,
        },
      };
    case 'model.dispatched':
      return {
        ...base,
        type: update.type,
        payload: { step: update.step, execution_id: update.executionId },
      };
    case 'model.completed':
      return {
        ...base,
        type: update.type,
        payload: {
          step: update.step,
          execution_id: update.executionId,
          input_tokens: update.inputTokens,
          output_tokens: update.outputTokens,
          thought: update.thought,
          action: update.action,
        },
      };
    case 'tool.called':
      return {
        ...base,
        type: update.type,
        payload: {
          step: update.step,
          tool: update.tool.slice(0, 80),
          arguments: update.arguments,
        },
      };
    case 'tool.completed':
      return {
        ...base,
        type: update.type,
        payload: {
          step: update.step,
          tool: update.tool.slice(0, 80),
          status: update.status,
          output: update.output.slice(0, 8_000),
        },
      };
    case 'run.completed':
      return {
        ...base,
        type: update.type,
        payload: { answer: update.answer, ...totals(update.totals) },
      };
    case 'run.stopped':
      return {
        ...base,
        type: update.type,
        payload: {
          status: update.status,
          code: update.code.slice(0, 120),
          message: update.message.slice(0, 1_000),
          ...totals(update.totals),
        },
      };
  }
}

function totals(value: {
  steps: number;
  inputTokens: number;
  outputTokens: number;
}) {
  return {
    steps: value.steps,
    input_tokens: value.inputTokens,
    output_tokens: value.outputTokens,
  };
}

function startSse(reply: FastifyReply, request: FastifyRequest) {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('Cache-Control', 'no-store, no-transform');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
  reply.raw.setHeader('X-Request-ID', request.id);
  reply.raw.setHeader('X-Content-Type-Options', 'nosniff');
  reply.raw.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  reply.raw.setHeader('X-Frame-Options', 'DENY');
  reply.raw.flushHeaders();
}
