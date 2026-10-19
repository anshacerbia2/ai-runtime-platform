import { createHash } from 'node:crypto';
import { canonicalJson } from '@ai-runtime/contracts';
import {
  apiContract,
  RunnerOutcomeBinding,
  RunnerStopReport,
  RunnerStopReceipt,
  RunnerReport,
  RunnerResultReconciliationRequest,
  RunnerResultReconciliation,
} from '@ai-runtime/contracts/http';
import {
  RunnerHttpError,
  RunnerHttpTransport,
  type RunnerHttpOptions,
} from './runner-http-transport.js';
import type { RunnerResultProposal } from './runner-report-http-client.js';
import type { StopEvidence } from './sandbox-supervisor.js';

function checked<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new RunnerHttpError('INVALID');
  }
}

/** Explicit old-process observations only. It cannot send result proposals or retire journals. */
export class RunnerOutcomeHttpClient {
  private readonly binding: RunnerOutcomeBinding;
  private readonly transport: RunnerHttpTransport;
  constructor(binding: RunnerOutcomeBinding, http: RunnerHttpOptions) {
    this.binding = checked(() => RunnerOutcomeBinding.parse(binding));
    this.transport = new RunnerHttpTransport(http);
  }

  async stop(
    evidence: StopEvidence,
    signal?: AbortSignal,
  ): Promise<RunnerStopReceipt> {
    const message = checked(() =>
      RunnerStopReport.parse({ ...this.binding, evidence }),
    );
    const value = await this.transport.post(
      apiContract.runner.stop.path,
      message,
      signal,
      202,
    );
    return checked(() => {
      const receipt = RunnerStopReceipt.parse(value);
      this.checkBinding(receipt.binding);
      if (canonicalJson(receipt.evidence) !== canonicalJson(message.evidence)) {
        throw new Error();
      }
      return receipt;
    });
  }

  async reconcileResult(
    proposal: RunnerResultProposal,
    signal?: AbortSignal,
  ): Promise<RunnerResultReconciliation> {
    const message = checked(() => {
      const report = RunnerReport.parse({
        type: 'result.proposed',
        token: this.binding.token,
        proposal,
      });
      if (report.type !== 'result.proposed') {
        throw new Error();
      }
      return RunnerResultReconciliationRequest.parse({
        ...this.binding,
        proposalDigest: createHash('sha256')
          .update(canonicalJson(report.proposal))
          .digest('hex'),
      });
    });
    const value = await this.transport.post(
      apiContract.runner.reconcileResult.path,
      message,
      signal,
    );
    return checked(() => {
      const receipt = RunnerResultReconciliation.parse(value);
      this.checkBinding(receipt.binding);
      if (receipt.proposalDigest !== message.proposalDigest) {
        throw new Error();
      }
      return receipt;
    });
  }

  private checkBinding(binding: RunnerOutcomeBinding): void {
    if (canonicalJson(binding) !== canonicalJson(this.binding)) {
      throw new Error();
    }
  }
}
