import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { firstValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import {
  apiContract,
  initContract,
  ContractNoBody,
} from '@ai-runtime/contracts/http';
import {
  ContractInterceptor,
  ResponseContractError,
} from '../../src/shared/presentation/contract-route.js';

const health = {
  backend: 'ready',
  database: 'PostgreSQL',
  mode: 'contract-only',
  application_id: 'test',
  saved_checks: 1,
  provider_calls: 0,
  contract_version: 'test',
  framework: 'NestJS',
  persistence: 'Prisma',
};
function context(statusCode = 200): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: {}, query: {}, headers: {} }),
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

test('provider projects and validates DTOs without invoking JSON roundtrip hooks', async () => {
  const value = {
    ...health,
    privateField: 'do-not-send',
    toJSON() {
      throw new Error('Roundtrip invoked');
    },
  };
  const output = await firstValueFrom(
    new ContractInterceptor(apiContract.lab.health).intercept(context(), {
      handle: () => of(value),
    }),
  );
  assert.deepEqual(output, health);
});

test('provider rejects missing known fields and undeclared success statuses', async () => {
  const interceptor = new ContractInterceptor(apiContract.lab.health);
  await assert.rejects(
    firstValueFrom(
      interceptor.intercept(context(), {
        handle: () => of({ backend: 'ready' }),
      }),
    ),
    ResponseContractError,
  );
  await assert.rejects(
    firstValueFrom(
      interceptor.intercept(context(202), { handle: () => of(health) }),
    ),
    ResponseContractError,
  );
});

test('provider no-body response is explicit and rejects accidental payloads', async () => {
  const route = initContract().query({
    method: 'GET',
    path: '/test',
    responses: { 204: ContractNoBody },
  });
  const interceptor = new ContractInterceptor(route);
  assert.equal(
    await firstValueFrom(
      interceptor.intercept(context(204), { handle: () => of(undefined) }),
    ),
    undefined,
  );
  await assert.rejects(
    firstValueFrom(
      interceptor.intercept(context(204), {
        handle: () => of({ secret: true }),
      }),
    ),
    ResponseContractError,
  );
});
