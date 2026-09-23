import { browserContract, initClient } from '@ai-runtime/contracts/http';
import { fetchContract } from './http-client';
import { ApiClientError } from './http-error';

/** Injected transport is useful for consumer tests; production always calls the same-origin BFF. */
export function createApiClient(transport: typeof fetch = fetch) {
  return initClient(browserContract, {
    baseUrl: '',
    credentials: 'same-origin',
    throwOnUnknownStatus: true,
    api: (args) => fetchContract(args, transport),
  });
}

export const api = createApiClient((...args) => fetch(...args));

type SuccessStatus = 200 | 201 | 202 | 204 | 205;

export function successfulBody<T extends { status: number; body: unknown }>(
  response: T,
): Extract<T, { status: SuccessStatus }>['body'] {
  if (response.status < 200 || response.status >= 300) {
    throw new ApiClientError({
      kind: 'http',
      status: response.status,
      code: 'HTTP_' + response.status,
      message: 'Request gagal.',
    });
  }
  return response.body as Extract<T, { status: SuccessStatus }>['body'];
}
