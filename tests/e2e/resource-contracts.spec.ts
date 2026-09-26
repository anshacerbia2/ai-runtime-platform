import { test, expect } from '@playwright/test';

test('control plane paginates independent collections without calling the legacy snapshot', async ({
  page,
}) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const item = (id: string) => ({
    id,
    displayName: id,
    environment: 'local',
    keycloakClientId: id,
    gatewayMaxConcurrency: 100,
    gatewayRequestsPerMinute: 600,
    status: 'ENABLED',
    revision: 1,
  });
  await page.route('**/api/v1/applications*', (route) => {
    const next =
      new URL(route.request().url()).searchParams.get('cursor') === 'page-two';
    return route.fulfill({
      json: {
        items: [item(next ? 'page-two-app' : 'page-one-app')],
        nextCursor: next ? null : 'page-two',
        limit: 20,
        consistency: 'live-keyset',
      },
    });
  });
  await page.goto('/control-plane');
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'page-one-app', exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Next applications', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: 'page-two-app', exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Next applications', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Previous applications', exact: true })
    .click();
  await expect(
    page.getByRole('cell', { name: 'page-one-app', exact: true }).first(),
  ).toBeVisible();
  expect(urls.some((url) => url.includes('/api/m1/control-plane'))).toBe(false);
});

test('one collection failure does not overwrite independently loaded resource data', async ({
  page,
}) => {
  await page.route('**/api/v1/connections*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'connection-fixture',
            displayName: 'Independent connection',
            provider: 'fixture',
            authMode: 'API_KEY',
            environment: 'local',
            sharingMode: 'DEDICATED',
            quotaGroupRef: null,
            gatewayMaxConcurrency: 100,
            gatewayRequestsPerMinute: 600,
            status: 'ENABLED',
            revision: 1,
          },
        ],
        nextCursor: null,
        limit: 20,
        consistency: 'live-keyset',
      },
    }),
  );
  await page.route('**/api/v1/credentials*', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'TEMPORARY',
          message: 'Credential collection unavailable',
        },
      },
    }),
  );
  await page.goto('/control-plane');
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'Independent connection', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry credentials', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Credential bindings', exact: true }),
  ).toBeVisible();
});

test('real durable save survives a lost acknowledgement via automatic same-key replay', async ({
  page,
}) => {
  const requests: { key: string | undefined; body: string | null }[] = [];
  const ids: string[] = [];
  await page.route('**/api/m0/validations', async (route) => {
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    expect([200, 201]).toContain(response.status());
    const result = await response.json();
    ids.push(result.id);
    if (requests.length === 1) {
      await route.abort('failed');
    } else {
      await route.fulfill({ response });
    }
  });
  await page.goto('/contract-lab');
  await expect(page.getByTestId('saved-count')).toHaveText(/^\d+$/);
  const before = Number(await page.getByTestId('saved-count').textContent());
  await page
    .getByRole('button', { name: 'Validasi & simpan', exact: true })
    .click();
  await expect(
    page.getByText('Replay · tidak membuat record baru'),
  ).toBeVisible();
  await expect(page.locator('[data-mutation-state]')).toHaveAttribute(
    'data-mutation-state',
    'success',
  );
  await expect(page.getByTestId('saved-count')).toHaveText(String(before + 1));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(new Set(ids).size).toBe(1);
});
