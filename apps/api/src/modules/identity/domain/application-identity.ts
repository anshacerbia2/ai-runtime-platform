/** Authenticated application identity. Never constructed from request payload fields. */
export interface ApplicationIdentity {
  readonly applicationId: string;
}
