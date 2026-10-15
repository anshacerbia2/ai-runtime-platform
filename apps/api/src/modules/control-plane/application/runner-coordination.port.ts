export interface RunnerCoordinationState {
  epoch: number;
  state: 'ACTIVE' | 'PAUSED';
  marker: string | null;
}

export interface RunnerCoordinationStore {
  read(): Promise<string | null>;
  write(marker: string): Promise<void>;
}

export interface RunnerCoordinationAuthority {
  read(): Promise<RunnerCoordinationState>;
  pauseIfCurrent(current: RunnerCoordinationState): Promise<boolean>;
  resume(store: RunnerCoordinationStore): Promise<boolean>;
}
