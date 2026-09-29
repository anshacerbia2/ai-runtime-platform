export interface GatewayCancelSignal {
  listen(
    ownerInstanceId: string,
    onSignal: (executionId: string) => void,
  ): Promise<void>;
  notify(ownerInstanceId: string, executionId: string): Promise<void>;
}

export const GATEWAY_CANCEL_SIGNAL = Symbol('GatewayCancelSignal');

export const noopGatewayCancelSignal: GatewayCancelSignal = {
  async listen() {},
  async notify() {},
};
