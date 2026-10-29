import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loadConfig } from '../../apps/api/src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../../apps/api/src/infrastructure/database/client.js';

test('a real registered account shows empty durable usage through browser, BFF and API without provider dispatch', async ({
  page,
  baseURL,
}) => {
  const id = 'usage-browser-' + randomUUID();
  const key = id + '-create';
  const response = await page.request.put(`/api/v1/connections/${id}`, {
    headers: { 'Idempotency-Key': key, Origin: new URL(baseURL!).origin },
    data: {
      expectedRevision: 0,
      displayName: 'Browser durable usage fixture',
      provider: 'openrouter',
      authMode: 'API_KEY',
      environment: 'local',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
      status: 'ENABLED',
    },
  });
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt.resource.id).toBe(id);
  try {
    await page.goto('/control-plane');
    await page.getByRole('tab', { name: 'Connections', exact: true }).click();
    // This case uses the real registry and usage routes; no browser route mocks.
    await page
      .getByRole('button', {
        name: 'View usage for Browser durable usage fixture',
        exact: true,
      })
      .click();
    const result = page.getByRole('region', { name: 'Usage result' });
    await expect(
      result.getByText('No provider invocations in this period', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      result.getByText('Unavailable for 0 invocations', { exact: true }),
    ).toHaveCount(2);
    await expect(result.getByText(/Select one budget account/)).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Usage for Browser durable usage fixture',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /secretRef|secret_ref|apiKey/,
    );
  } finally {
    // Only the successfully created, uniquely owned fixture is removed.
    const db = createDatabaseClient(loadConfig());
    try {
      await db.aiConnection.delete({ where: { id } });
      await db.managementReceipt.deleteMany({ where: { requestKey: key } });
      await db.auditEntry.deleteMany({ where: { resourceId: id } });
      await db.outboxEvent.deleteMany({ where: { aggregateId: id } });
    } finally {
      await db.$disconnect();
    }
  }
});
