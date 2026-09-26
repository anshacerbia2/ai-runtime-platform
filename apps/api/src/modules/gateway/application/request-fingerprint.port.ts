export const REQUEST_FINGERPRINT = Symbol('GatewayRequestFingerprint');

export interface RequestFingerprint {
  digest(value: unknown): string;
}
