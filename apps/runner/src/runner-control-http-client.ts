import {
  apiContract,
  Assignment,
  RunnerDispatchClaimResult,
  RunnerHeartbeat,
  RunnerHeartbeatAck,
  RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import {
  RunnerHttpError,
  RunnerHttpTransport,
  type RunnerHttpOptions,
} from './runner-http-transport.js';

function checked<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new RunnerHttpError('INVALID');
  }
}

/** Machine-only heartbeat, pull claim and STARTED report for one process boot. */
export class RunnerControlHttpClient {
  private readonly identity: RunnerHeartbeat;
  private readonly transport: RunnerHttpTransport;

  constructor(
    identity: RunnerHeartbeat,
    private readonly ownerSubject: string,
    options: RunnerHttpOptions,
  ) {
    this.identity = RunnerHeartbeat.parse(identity);
    if (!ownerSubject.trim()) {
      throw new Error('Runner owner is required.');
    }
    this.transport = new RunnerHttpTransport(options);
  }

  async heartbeat(signal?: AbortSignal): Promise<RunnerHeartbeatAck> {
    const value = await this.transport.post(
      apiContract.runner.heartbeat.path,
      this.identity,
      signal,
    );
    return checked(() => {
      const ack = RunnerHeartbeatAck.parse(value);
      if (
        ack.runnerId !== this.identity.runnerId ||
        ack.bootId !== this.identity.bootId ||
        ack.registrationRevision !== this.identity.registrationRevision
      ) {
        throw new Error();
      }
      return ack;
    });
  }

  async claim(signal?: AbortSignal): Promise<RunnerDispatchClaimResult> {
    const value = await this.transport.post(
      apiContract.runner.claimDispatch.path,
      this.identity,
      signal,
    );
    return checked(() => {
      const result = RunnerDispatchClaimResult.parse(value);
      if (
        result.grant &&
        (result.grant.runnerId !== this.identity.runnerId ||
          result.grant.ownerSubject !== this.ownerSubject)
      ) {
        throw new Error();
      }
      return result;
    });
  }

  async reportStarted(
    command: RunnerLeaseCommand,
    signal?: AbortSignal,
  ): Promise<void> {
    const captured = checked(() => {
      const value = RunnerLeaseCommand.parse(command);
      if (
        value.bootId !== this.identity.bootId ||
        value.registrationRevision !== this.identity.registrationRevision ||
        value.token.runnerId !== this.identity.runnerId
      ) {
        throw new Error();
      }
      return value;
    });
    const value = await this.transport.post(
      apiContract.runner.report.path,
      {
        type: 'started',
        token: captured.token,
        lease: {
          bootId: captured.bootId,
          registrationRevision: captured.registrationRevision,
          nonce: captured.nonce,
        },
      },
      signal,
    );
    checked(() => {
      const ack = Assignment.parse(value);
      if (
        ack.ownerSubject !== this.ownerSubject ||
        ack.state !== 'STARTED' ||
        (Object.keys(captured.token) as (keyof typeof captured.token)[]).some(
          (key) => ack[key] !== captured.token[key],
        )
      ) {
        throw new Error();
      }
    });
  }
}
