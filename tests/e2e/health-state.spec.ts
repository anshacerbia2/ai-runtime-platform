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

test('format error and dismiss cannot mark a healthy API offline', async ({
  page,
}) => {
  await page.route('**/api/m0/health', (route) =>
    route.fulfill({ json: health }),
  );
  await page.goto('/contract-lab');
  const status = page.getByRole('region', { name: 'Local platform status' });
  await expect(page.getByTestId('saved-count')).toHaveText('41');
  await page.getByRole('textbox', { name: 'Payload JSON' }).fill('{broken');
  await page.getByRole('button', { name: /Format JSON/ }).click();
  await expect(page.getByText('JSON belum valid.')).toBeVisible();
  await expect(status.getByText('Healthy', { exact: true })).toBeVisible();
  await expect(status.getByText('Offline', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tutup error' }).click();
  await expect(status.getByText('Healthy', { exact: true })).toBeVisible();
});

test('catalogue error keeps independently verified health and offers an actual retry', async ({
  page,
}) => {
  await page.route('**/api/m0/health', (route) =>
    route.fulfill({ json: health }),
  );
  await page.route('**/api/m0/contracts', (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: 'DENIED', message: 'Catalogue denied' } },
    }),
  );
  await page.goto('/contract-lab');
  await expect(page.getByTestId('saved-count')).toHaveText('41');
  await expect(
    page.getByRole('button', { name: 'Retry catalogue' }),
  ).toBeVisible();
  await expect(page.getByText('Healthy', { exact: true })).toBeVisible();
  await page.unroute('**/api/m0/contracts');
  await page.getByRole('button', { name: 'Retry catalogue' }).click();
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
});

test('durable save stays successful when the subsequent health refresh fails', async ({
  page,
}) => {
  let probes = 0;
  await page.route('**/api/m0/health', (route) => {
    probes++;
    return probes === 1
      ? route.fulfill({ json: health })
      : route.fulfill({
          status: 503,
          json: {
            error: { code: 'UNAVAILABLE', message: 'Health unavailable' },
          },
        });
  });
  await page.goto('/contract-lab');
  await expect(page.getByTestId('saved-count')).toHaveText('41');
  await page.getByRole('button', { name: 'Validasi & simpan' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('Kontrak valid');
  await expect(page.getByText('Unconfirmed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('saved-count')).toHaveText('41');
  await expect(
    page.getByText('Last known', { exact: true }).first(),
  ).toBeVisible();
});
