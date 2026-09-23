import { api, successfulBody } from './api-client';
import { ApiClientError } from './http-error';

export const controlPlaneClient = {
  async snapshot(signal?: AbortSignal) {
    const snapshot = successfulBody(
      await api.controlPlane.snapshot({ fetchOptions: { signal } }),
    );
    if (!('applications' in snapshot)) {
      throw new ApiClientError({
        kind: 'http',
        status: 403,
        code: 'OPERATOR_REQUIRED',
        message: 'Operator access is required for this console.',
      });
    }
    return snapshot;
  },
};
