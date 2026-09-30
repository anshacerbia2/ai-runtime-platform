export type ToolEffectState =
  'PREPARED' | 'DISPATCHING' | 'UNKNOWN' | 'COMMITTED' | 'NO_EFFECT';

export interface ToolEffectIntent {
  applicationId: string;
  operationId: string;
  executionId: string;
  assignmentId: string;
  attemptId: string;
  generation: number;
  epoch: number;
  toolRef: string;
  requestDigest: string;
  receiverRetentionUntil: Date;
}

export interface ToolEffectRecord extends ToolEffectIntent {
  state: ToolEffectState;
  receiptRef: string | null;
  receiptDigest: string | null;
}

export interface ToolEffectRepository {
  prepare(intent: ToolEffectIntent): Promise<ToolEffectRecord>;
  claim(intent: ToolEffectIntent): Promise<boolean>;
  recordOutcome(
    intent: ToolEffectIntent,
    outcome: ToolReceiverOutcome,
  ): Promise<ToolEffectRecord>;
}

export type ToolReceiverOutcome =
  | { state: 'COMMITTED'; receiptRef: string; receiptDigest: string }
  | { state: 'NO_EFFECT'; receiptRef: string; receiptDigest: string }
  | { state: 'UNKNOWN' };

export interface ToolEffectReceiver {
  invoke(
    idempotencyKey: string,
    requestDigest: string,
    input: Uint8Array,
  ): Promise<ToolReceiverOutcome>;
  checkStatus(idempotencyKey: string): Promise<ToolReceiverOutcome>;
}

export interface ToolEffectDigester {
  digest(input: Uint8Array): string;
}
