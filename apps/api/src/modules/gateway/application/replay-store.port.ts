import type { GatewayStreamEvent } from '@ai-runtime/contracts/http';

export const REPLAY_STORE = Symbol('GatewayReplayStore');

export interface ReplayPage {
  expired: boolean;
  events: GatewayStreamEvent[];
}

export interface ReplayWatch {
  page: ReplayPage;
  next(signal?: AbortSignal): Promise<GatewayStreamEvent | null>;
  close(): void;
}

export interface ReplayStore {
  append(event: GatewayStreamEvent): void | Promise<void>;
  read(executionId: string, after?: string): ReplayPage | Promise<ReplayPage>;
  watch(
    executionId: string,
    after?: string,
    live?: boolean,
  ): ReplayWatch | Promise<ReplayWatch>;
  clear(executionId: string): void | Promise<void>;
}
