import type {
  ToolEffectDigester,
  ToolEffectIntent,
  ToolEffectRecord,
  ToolEffectReceiver,
  ToolEffectRepository,
  ToolReceiverOutcome,
} from './tool-effect.port.js';

/** Unknown receiver outcomes are status-only until a human or receiver resolves them. */
export class ToolEffectService {
  constructor(
    private readonly repository: ToolEffectRepository,
    private readonly digester: ToolEffectDigester,
  ) {}

  private receiverKey(intent: ToolEffectIntent): string {
    return this.digester.digest(
      new TextEncoder().encode(
        `tool-operation/v1\n${intent.applicationId}\n${intent.operationId}`,
      ),
    );
  }

  async execute(
    intent: ToolEffectIntent,
    input: Uint8Array,
    receiver: ToolEffectReceiver,
  ): Promise<ToolEffectRecord> {
    if (
      input.byteLength > 65_536 ||
      this.digester.digest(input) !== intent.requestDigest
    ) {
      throw new Error('Tool effect input does not match its durable digest.');
    }
    const current = await this.repository.prepare(intent);
    const receiverKey = this.receiverKey(intent);
    if (current.state === 'COMMITTED' || current.state === 'NO_EFFECT') {
      return current;
    }
    if (current.state === 'PREPARED' && (await this.repository.claim(intent))) {
      let outcome: ToolReceiverOutcome;
      try {
        outcome = await receiver.invoke(
          receiverKey,
          intent.requestDigest,
          input,
        );
      } catch {
        outcome = { state: 'UNKNOWN' };
      }
      return this.repository.recordOutcome(intent, outcome);
    }
    let outcome: ToolReceiverOutcome;
    try {
      outcome = await receiver.checkStatus(receiverKey);
    } catch {
      outcome = { state: 'UNKNOWN' };
    }
    return this.repository.recordOutcome(intent, outcome);
  }
}
