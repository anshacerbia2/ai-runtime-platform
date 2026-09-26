import { test, expect } from '@playwright/test';

const health = {
  backend: 'ready',
  database: 'PostgreSQL',
  mode: 'contract-only',
  application_id: 'browser-fixture',
  saved_checks: 41,
  provider_calls: 0,
  contract_version: 'test',
  framework: 'NestJS + Fastify',
  persistence: 'Prisma',
};
const record = {
  id: '10000000-0000-4000-8000-000000000001',
  application_id: 'browser-fixture',
  kind: 'chat',
  valid: true,
  report: {
    valid: true,
    issues: [],
    profile: null,
    capability: 'chat',
    warnings: [],
    contract_version: 'test',
  },
  created_at: '2026-09-24T00:00:00.000Z',
  request_summary: {},
  request_digest: 'fixture-digest',
  contract_version: 'test',
  replayed: false,
  mode: 'contract-only',
  execution_created: false,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('confirmed save is successful and no longer pending while secondary health is slow', async ({
  page,
}) => {
  const gate = deferred();
  let probes = 0;
  await page.route('**/api/m0/health', async (route) => {
    if (++probes > 1) {
      await gate.promise;
    }
    await route.fulfill({ json: health });
  });
  await page.route('**/api/m0/validations', (route) =>
    route.fulfill({ status: 201, json: record }),
  );
  try {
    await page.goto('/contract-lab');
    await expect(page.getByTestId('saved-count')).toHaveText('41');
    await page.getByRole('button', { name: 'Validasi & simpan' }).click();
    await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
      'data-mutation-state',
      'success',
    );
    await expect(page.getByTestId('verdict')).toHaveText('Kontrak valid');
    await expect(
      page.getByRole('button', { name: 'Validasi & simpan' }),
    ).toBeEnabled();
    await expect(page.getByText('Checking', { exact: true })).toBeVisible();
  } finally {
    gate.resolve();
  }
});

test('a late response from an old scenario cannot overwrite a newer successful mutation', async ({
  page,
}) => {
  const gate = deferred();
  const oldFinished = deferred();
  let writes = 0;
  const newer = {
    ...record,
    id: '20000000-0000-4000-8000-000000000002',
    kind: 'execution',
  };
  await page.route('**/api/m0/health', (route) =>
    route.fulfill({ json: health }),
  );
  await page.route('**/api/m0/validations', async (route) => {
    if (++writes === 1) {
      await gate.promise;
      try {
        await route.fulfill({ status: 201, json: record });
      } catch {
        /* The browser may have already cancelled the superseded request. */
      } finally {
        oldFinished.resolve();
      }
    } else {
      await route.fulfill({ status: 201, json: newer });
    }
  });
  try {
    await page.goto('/contract-lab');
    await page.getByRole('button', { name: 'Validasi & simpan' }).click();
    await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
      'data-mutation-state',
      'pending',
    );
    await expect.poll(() => writes).toBe(1);
    await page.getByRole('button', { name: /Scribe agent/ }).click();
    await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
      'data-mutation-state',
      'idle',
    );
    await expect(
      page.getByText(/pembatalan koneksi bukan rollback/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Validasi & simpan' }).click();
    await expect(page.getByText(newer.id, { exact: true })).toBeVisible();
    gate.resolve();
    await oldFinished.promise;
    await expect(page.getByText(record.id, { exact: true })).toHaveCount(0);
    await expect(page.getByText(newer.id, { exact: true })).toBeVisible();
    await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
      'data-mutation-state',
      'success',
    );
  } finally {
    gate.resolve();
  }
});

for (const target of ['payload', 'key'] as const) {
  test(
    'editing ' +
      target +
      ' invalidates a pending result without leaving a stuck spinner',
    async ({ page }) => {
      const gate = deferred();
      const finished = deferred();
      const started = deferred();
      await page.route('**/api/m0/health', (route) =>
        route.fulfill({ json: health }),
      );
      await page.route('**/api/m0/validations', async (route) => {
        started.resolve();
        await gate.promise;
        try {
          await route.fulfill({ status: 201, json: record });
        } catch {
          /* Expected when the superseded browser request was cancelled. */
        } finally {
          finished.resolve();
        }
      });
      try {
        await page.goto('/contract-lab');
        await page.getByRole('button', { name: 'Validasi & simpan' }).click();
        await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
          'data-mutation-state',
          'pending',
        );
        await started.promise;
        if (target === 'payload') {
          await page.getByRole('textbox', { name: 'Payload JSON' }).fill('{}');
        } else {
          await page
            .getByRole('textbox', { name: 'Idempotency-Key', exact: true })
            .fill('new-key');
        }
        gate.resolve();
        await finished.promise;
        await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
          'data-mutation-state',
          'idle',
        );
        await expect(page.getByTestId('verdict')).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: 'Validasi & simpan' }),
        ).toBeEnabled();
      } finally {
        gate.resolve();
      }
    },
  );
}

test('unknown write outcome is explicit; manual replay preserves key and payload', async ({
  page,
}) => {
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route('**/api/m0/health', (route) =>
    route.fulfill({ json: health }),
  );
  await page.route('**/api/m0/validations', (route) => {
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    });
    return requests.length <= 3
      ? route.abort('failed')
      : route.fulfill({ status: 200, json: { ...record, replayed: true } });
  });
  await page.goto('/contract-lab');
  await page.getByRole('button', { name: 'Validasi & simpan' }).click();
  await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
    'data-mutation-state',
    'unknown',
  );
  await expect(
    page.getByText(/Hasil penyimpanan belum diketahui/),
  ).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.getByText('Healthy', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  await page.getByRole('button', { name: 'Validasi & simpan' }).click();
  await expect(
    page.getByText('Replay · tidak membuat record baru'),
  ).toBeVisible();
  await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
    'data-mutation-state',
    'success',
  );
  expect(requests).toHaveLength(4);
  for (const request of requests.slice(1)) {
    expect(request).toEqual(requests[0]);
  }
});

test('unexpected transport abort cannot turn last-known failed health into healthy', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (...args) => {
      if (
        Reflect.get(window, 'auditAbortHealth') === true &&
        String(args[0]).includes('/api/m0/health')
      ) {
        return Promise.reject(
          new DOMException('Unexpected upstream abort', 'AbortError'),
        );
      }
      return original(...args);
    };
  });
  let unavailable = false;
  await page.route('**/api/m0/health', (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
        })
      : route.fulfill({ json: health }),
  );
  await page.goto('/contract-lab');
  await expect(page.getByText('Healthy', { exact: true })).toBeVisible();
  unavailable = true;
  await page.getByRole('button', { name: 'Check health', exact: true }).click();
  await expect(page.getByText('Unconfirmed', { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'auditAbortHealth', true));
  await page.getByRole('button', { name: 'Retry health', exact: true }).click();
  await expect(page.getByText(/REQUEST_ABORTED/)).toBeVisible();
  await expect(page.getByText('Healthy', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Unconfirmed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('saved-count')).toHaveText('41');
});
