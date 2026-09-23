import {
  apiContract,
  browserContract,
  initClient,
  type ServerInferResponseBody,
} from '../src/http/index.js';

const client = initClient(browserContract, { baseUrl: '' });
declare const health: ServerInferResponseBody<
  typeof apiContract.lab.health,
  200
>;
const count: number = health.saved_checks;
void count;
// A misspelt/renamed wire field must not become an unchecked `any`.
// @ts-expect-error savedChecks is not the canonical field.
void health.savedChecks;
// @ts-expect-error The health response is not a string.
const wrongCount: string = health.saved_checks;
void wrongCount;
// @ts-expect-error Unknown endpoint names fail before runtime.
client.lab.unknownEndpoint();
// @ts-expect-error Required idempotency header is not optional.
client.lab.validate({ body: { kind: 'chat', payload: {} } });
// @ts-expect-error The browser cannot register runners.
client.controlPlane.registerRunner({ body: {} });
// @ts-expect-error Missing required response field is a provider compile error.
const incomplete: ServerInferResponseBody<typeof apiContract.lab.health, 200> =
  { backend: 'ready' };
void incomplete;
