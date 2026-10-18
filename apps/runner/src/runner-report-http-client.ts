import type { UsageCommand } from '@ai-runtime/contracts';
import {
  apiContract,
  Assignment,
  EvidenceReceipt,
  LateEvidence,
  RunnerLeaseCommand,
  RunnerReport,
} from '@ai-runtime/contracts/http';
import {
  RunnerHttpError,
  RunnerHttpTransport,
  type RunnerHttpOptions,
} from './runner-http-transport.js';

export type RunnerResultProposal = Extract<
  RunnerReport,
  { type: 'result.proposed' }
>['proposal'];

function checked<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new RunnerHttpError('INVALID');
  }
}

/** Result authority and late evidence intentionally use separate protocol paths. */
export class RunnerReportHttpClient {
  private readonly command: RunnerLeaseCommand;
  private readonly transport: RunnerHttpTransport;
  constructor(
    command: RunnerLeaseCommand,
    private readonly ownerSubject: string,
    http: RunnerHttpOptions,
  ) {
    this.command = checked(() => RunnerLeaseCommand.parse(command));
    if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
      throw new Error('Runner owner is required.');
    }
    this.transport = new RunnerHttpTransport(http);
  }

  async propose(
    proposal: RunnerResultProposal,
    signal?: AbortSignal,
  ): Promise<void> {
    const { token, ...lease } = this.command;
    const message = checked(() =>
      RunnerReport.parse({ type: 'result.proposed', token, lease, proposal }),
    );
    const value = await this.transport.post(
      apiContract.runner.report.path,
      message,
      signal,
    );
    checked(() => {
      const ack = Assignment.parse(value);
      if (
        ack.state !== 'RESULT_PROPOSED' ||
        ack.ownerSubject !== this.ownerSubject ||
        (Object.keys(token) as (keyof typeof token)[]).some(
          (key) => ack[key] !== token[key],
        )
      ) {
        throw new Error();
      }
    });
  }

  async evidence(
    evidence: UsageCommand,
    signal?: AbortSignal,
  ): Promise<EvidenceReceipt> {
    const message = checked(() => {
      const parsed = LateEvidence.parse({
        token: this.command.token,
        evidence,
      });
      if (
        parsed.evidence.executionId !== parsed.token.executionId ||
        parsed.evidence.attemptId !== parsed.token.attemptId
      ) {
        throw new Error();
      }
      return parsed;
    });
    const value = await this.transport.post(
      apiContract.runner.evidence.path,
      message,
      signal,
      202,
    );
    return checked(() => EvidenceReceipt.parse(value));
  }
}
