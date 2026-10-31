// Identity carried by every port command. Scope comes from trusted identity
// policy, never from a request body; IDs alone are not authorization.
export interface TrustedCaller {
  applicationId: string;
  // Null until Tenant enforcement exists; admission must fail closed for a
  // Definition that requires it.
  tenantId: string | null;
  principalSubject: string;
}

export interface OperationIdentity {
  runId: string;
  // Null for Run-level operations such as the whole-run reservation.
  turnId: string | null;
  operationId: string;
  caller: TrustedCaller;
  // Canonical digest of the immutable request; one digest per operationId.
  requestDigest: string;
}

// Fixed-integer amount in an explicit unit, as a decimal string so no
// floating-point rounding is possible. Unknown amounts are null, never zero.
export interface Units {
  unit: string;
  amount: string;
}
