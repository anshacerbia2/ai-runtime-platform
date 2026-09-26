import { once } from 'node:events';
import {
  ChatRequest,
  GenerateRequest,
  ExecutionRequest,
  CancelRequest,
} from '@ai-runtime/contracts';
import {
  apiContract,
  GatewayExecution,
  type GatewayStreamEvent,
} from '@ai-runtime/contracts/http';
import { Body, Controller, Headers, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { ApplicationError } from '../../../../shared/domain/application-error.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import {
  GatewayService,
  type GatewayCommand,
} from '../../application/gateway.service.js';

@Controller()
export class GatewayController {
  constructor(private readonly gateway: GatewayService) {}

  @ContractRoute(apiContract.gateway.chat)
  async chat(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string,
    @Body() raw: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const body = ChatRequest.parse(raw);
    const command = chatCommand(body);
    return body.stream
      ? this.stream(principal, command, key, request, reply)
      : GatewayExecution.parse(
          await this.gateway.execute(principal, command, key),
        );
  }
  @ContractRoute(apiContract.gateway.generate)
  async generate(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string,
    @Body() raw: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const body = GenerateRequest.parse(raw);
    const command = generateCommand(body);
    return body.stream
      ? this.stream(principal, command, key, request, reply)
      : GatewayExecution.parse(
          await this.gateway.execute(principal, command, key),
        );
  }

  @ContractRoute(apiContract.gateway.submit)
  async submit(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string,
    @Body() raw: unknown,
  ) {
    const body = ExecutionRequest.parse(raw);
    if (body.capability === 'agent_execute') {
      throw new ApplicationError(
        'VERSION_UNSUPPORTED',
        'Agent execution is not enabled in the M2 gateway.',
      );
    }
    return GatewayExecution.parse(
      await this.gateway.execute(principal, executionCommand(body), key),
    );
  }

  @ContractRoute(apiContract.gateway.execution)
  execution(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.gateway.read(principal, id);
  }

  @ContractRoute(apiContract.gateway.cancel)
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const body = CancelRequest.parse(raw);
    return this.gateway.cancel(principal, id, body.reason ?? null);
  }

  @ContractRoute(apiContract.gateway.events)
  async events(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('last-event-id') after: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const watch = await this.gateway.events(principal, id, after);
    if (watch.page.expired) {
      watch.close();
      throw new ApplicationError(
        'STREAM_RESUME_EXPIRED',
        'Replay cursor is no longer retained; read the execution snapshot.',
        id,
      );
    }
    startSse(reply, request);
    const disconnected = new AbortController();
    const onClose = () =>
      disconnected.abort(
        new DOMException('SSE client detached.', 'AbortError'),
      );
    reply.raw.once('close', onClose);
    try {
      for (const event of watch.page.events) {
        await writeSse(reply, event);
        if (terminalStreamEvent(event)) {
          return undefined;
        }
      }
      while (!reply.raw.destroyed && !reply.raw.writableEnded) {
        let event: GatewayStreamEvent | null;
        try {
          event = await watch.next(disconnected.signal);
        } catch {
          if (disconnected.signal.aborted) {
            break;
          }
          throw new Error('Replay watch failed.');
        }
        if (!event) {
          break;
        }
        await writeSse(reply, event);
        if (terminalStreamEvent(event)) {
          break;
        }
      }
      return undefined;
    } finally {
      watch.close();
      reply.raw.off('close', onClose);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  }

  private async stream(
    principal: Principal,
    command: GatewayCommand,
    key: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    let started = false;
    const sink = async (event: GatewayStreamEvent) => {
      if (!started) {
        startSse(reply, request);
        started = true;
      }
      await writeSse(reply, event);
    };
    try {
      const result = await this.gateway.execute(principal, command, key, sink);
      if (!started) {
        // A same-key replay may observe an already-running/terminal execution.
        // Return its JSON snapshot instead of reopening or fabricating a stream.
        return GatewayExecution.parse(result);
      }
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
      return undefined;
    } catch (error) {
      if (!started) {
        throw error;
      }
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
      return undefined;
    }
  }
}

function chatCommand(
  body: ReturnType<typeof ChatRequest.parse>,
): GatewayCommand {
  const artifactRefs: string[] = [];
  const messages = body.input.messages.map((message) => ({
    role: message.role,
    text: message.content
      .map((part) => {
        if (part.type === 'artifact') {
          artifactRefs.push(part.artifact_ref);
          return '';
        }
        return part.text;
      })
      .filter(Boolean)
      .join('\n'),
  }));
  return {
    profile: body.profile,
    capability: 'chat',
    stream: body.stream ?? false,
    constraints: {
      maxOutputTokens: body.constraints?.max_output_tokens,
      timeoutMs: body.constraints?.timeout_ms,
    },
    messages,
    artifactRefs,
    fingerprintInput: {
      input: body.input,
      context: body.context ?? null,
      session_ref: body.session_ref ?? null,
    },
  };
}

function generateCommand(
  body: ReturnType<typeof GenerateRequest.parse>,
): GatewayCommand {
  return {
    profile: body.profile,
    capability: body.capability,
    stream: body.stream ?? false,
    constraints: {
      maxOutputTokens: body.constraints?.max_output_tokens,
      timeoutMs: body.constraints?.timeout_ms,
    },
    messages: [{ role: 'user', text: body.input.prompt }],
    artifactRefs: body.input.artifact_refs ?? [],
    responseSchema:
      body.capability === 'structured_generate'
        ? body.input.response_schema
        : undefined,
    fingerprintInput: {
      input: body.input,
      context: body.context ?? null,
      session_ref: body.session_ref ?? null,
    },
  };
}
function executionCommand(
  body: Exclude<
    ReturnType<typeof ExecutionRequest.parse>,
    { capability: 'agent_execute' }
  >,
): GatewayCommand {
  if (body.capability === 'chat') {
    const artifactRefs: string[] = [];
    return {
      profile: body.profile,
      capability: 'chat',
      stream: false,
      constraints: {
        maxOutputTokens: body.constraints?.max_output_tokens,
        timeoutMs: body.constraints?.timeout_ms,
      },
      messages: body.input.messages.map((message) => ({
        role: message.role,
        text: message.content
          .map((part) => {
            if (part.type === 'artifact') {
              artifactRefs.push(part.artifact_ref);
              return '';
            }
            return part.text;
          })
          .filter(Boolean)
          .join('\n'),
      })),
      artifactRefs,
      fingerprintInput: {
        capability: body.capability,
        input: body.input,
        context: body.context ?? null,
        session_ref: body.session_ref ?? null,
      },
    };
  }
  return {
    profile: body.profile,
    capability: body.capability,
    stream: false,
    constraints: {
      maxOutputTokens: body.constraints?.max_output_tokens,
      timeoutMs: body.constraints?.timeout_ms,
    },
    messages: [{ role: 'user', text: body.input.prompt }],
    artifactRefs: body.input.artifact_refs ?? [],
    responseSchema:
      body.capability === 'structured_generate'
        ? body.input.response_schema
        : undefined,
    fingerprintInput: {
      capability: body.capability,
      input: body.input,
      context: body.context ?? null,
      session_ref: body.session_ref ?? null,
    },
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

function terminalStreamEvent(event: GatewayStreamEvent) {
  return [
    'execution.completed',
    'execution.failed',
    'execution.cancelled',
    'stream.reset_required',
  ].includes(event.type);
}

async function writeSse(reply: FastifyReply, event: GatewayStreamEvent) {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    throw new Error('SSE subscriber detached.');
  }
  const frame =
    'id: ' +
    event.id +
    '\n' +
    'event: ' +
    event.type +
    '\n' +
    'data: ' +
    JSON.stringify(event) +
    '\n\n';
  if (!reply.raw.write(frame)) {
    await once(reply.raw, 'drain');
  }
}
