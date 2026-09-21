import test from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult } from '@ai-runtime/contracts';
import { AuthenticateApplication } from '../../src/modules/identity/application/authenticate-application.js';
import { ValidateContractUseCase } from '../../src/modules/contract-lab/application/validate-contract.use-case.js';
import { ReadHistoryUseCase } from '../../src/modules/contract-lab/application/read-history.use-case.js';
import { GetLabHealthUseCase } from '../../src/modules/contract-lab/application/get-lab-health.use-case.js';
import type { ValidationRepository } from '../../src/modules/contract-lab/application/ports/validation-repository.port.js';
import type {
  ValidationDraft,
  ValidationRecord,
} from '../../src/modules/contract-lab/domain/validation-record.js';
import { ApplicationError } from '../../src/shared/domain/application-error.js';

const identity = { applicationId: 'unit-test' };
const report: CheckResult = {
  valid: true,
  issues: [],
  profile: null,
  capability: 'chat',
  warnings: [],
  contract_version: '1.0.0-m0',
};
const record: ValidationRecord = {
  id: 'record-unit',
  applicationId: identity.applicationId,
  kind: 'chat',
  valid: true,
  contractVersion: report.contract_version,
  requestDigest: 'digest',
  requestSummary: {},
  report,
  createdAt: new Date(0),
};

function repository(
  overrides: Partial<ValidationRepository> = {},
): ValidationRepository {
  return {
    saveIdempotent: async () => ({ record, replayed: false }),
    findOwned: async () => record,
    listOwned: async () => ({ items: [record], nextId: null }),
    countOwned: async () => 1,
    ...overrides,
  };
}

test('authentication use case does not need NestJS or a database', async () => {
  const useCase = new AuthenticateApplication({ verify: async () => identity });
  assert.deepEqual(await useCase.execute('synthetic'), identity);
});

test('missing credentials fail before verifier invocation', async () => {
  let invoked = false;
  const useCase = new AuthenticateApplication({
    verify: async () => {
      invoked = true;
      return identity;
    },
  });
  await assert.rejects(useCase.execute(undefined), { code: 'UNAUTHENTICATED' });
  assert.equal(invoked, false);
});

test('unrecognized credentials are rejected', async () => {
  const useCase = new AuthenticateApplication({ verify: async () => null });
  await assert.rejects(useCase.execute('synthetic'), {
    code: 'UNAUTHENTICATED',
  });
});

test('validation persists prepared metadata rather than raw input', async () => {
  let received: ValidationDraft | undefined;
  const useCase = new ValidateContractUseCase(
    repository({
      saveIdempotent: async (draft) => {
        received = draft;
        return { record, replayed: false };
      },
    }),
    {
      listOwned: async (applicationId) => {
        assert.equal(applicationId, identity.applicationId);
        return [];
      },
    },
    {
      prepare: () => ({
        report,
        requestDigest: 'digest',
        requestSummary: { prompt_characters: 6 },
      }),
    },
  );
  await useCase.execute({
    identity,
    kind: 'chat',
    payload: { prompt: 'SECRET' },
    idempotencyKey: 'unit-key',
  });
  assert.equal(received?.applicationId, identity.applicationId);
  assert.equal(JSON.stringify(received).includes('SECRET'), false);
  assert.equal(Object.hasOwn(received!, 'payload'), false);
});

test('invalid idempotency key is rejected before persistence', async () => {
  let invoked = false;
  const useCase = new ValidateContractUseCase(
    repository({
      saveIdempotent: async () => {
        invoked = true;
        return { record, replayed: false };
      },
    }),
    { listOwned: async () => [] },
    {
      prepare: () => ({ report, requestDigest: 'digest', requestSummary: {} }),
    },
  );
  await assert.rejects(
    useCase.execute({
      identity,
      kind: 'chat',
      payload: {},
      idempotencyKey: '',
    }),
    { code: 'INVALID_REQUEST' },
  );
  assert.equal(invoked, false);
});

test('policy failure cannot be presented as a saved validation', async () => {
  const useCase = new ValidateContractUseCase(
    repository(),
    { listOwned: async () => [] },
    {
      prepare: () => {
        throw new ApplicationError('INVALID_REQUEST', 'Invalid payload');
      },
    },
  );
  await assert.rejects(
    useCase.execute({
      identity,
      kind: 'chat',
      payload: {},
      idempotencyKey: 'unit-key',
    }),
    { code: 'INVALID_REQUEST' },
  );
});

test('repository idempotent replay semantics survive the use case', async () => {
  const useCase = new ValidateContractUseCase(
    repository({ saveIdempotent: async () => ({ record, replayed: true }) }),
    { listOwned: async () => [] },
    {
      prepare: () => ({ report, requestDigest: 'digest', requestSummary: {} }),
    },
  );
  assert.equal(
    (
      await useCase.execute({
        identity,
        kind: 'chat',
        payload: {},
        idempotencyKey: 'unit-key',
      })
    ).replayed,
    true,
  );
});

test('history preserves scope and rejects an unowned cursor', async () => {
  const useCase = new ReadHistoryUseCase(
    repository({
      findOwned: async (scope) => {
        assert.equal(scope, identity.applicationId);
        return null;
      },
    }),
  );
  await assert.rejects(useCase.list(identity, 20, 'other-record'), {
    code: 'INVALID_REQUEST',
  });
  await assert.rejects(useCase.get(identity, 'other-record'), {
    code: 'NOT_FOUND',
  });
});

test('history bounds are checked without an HTTP server', async () => {
  const useCase = new ReadHistoryUseCase(repository());
  for (const limit of [0, -1, 1.5, 101, Number.NaN]) {
    await assert.rejects(useCase.list(identity, limit), {
      code: 'INVALID_REQUEST',
    });
  }
});

test('health is based on the database port, not a hardcoded green flag', async () => {
  const useCase = new GetLabHealthUseCase(
    {
      check: async () => {
        throw new Error('Database offline');
      },
    },
    repository(),
  );
  await assert.rejects(useCase.execute(identity), /Database offline/);
});
