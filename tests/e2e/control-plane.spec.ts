import { test, expect } from '@playwright/test';

test('M1 control plane admin console exposes durable resources without secret material', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Control Plane/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Control Plane' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Application-scoped durable authority' }),
  ).toBeVisible();
  await expect(page.getByText('M1 local complete').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Applications' }).click();
  await expect(
    page.getByRole('cell', { name: 'm0-playground', exact: true }).first(),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Connections' }).click();
  await expect(page.getByText('No AI connections configured')).toBeVisible();
  await expect(page.getByText('No credential metadata')).toBeVisible();
  await expect(page.getByText('No bindings configured')).toBeVisible();

  await page.getByRole('tab', { name: 'Profiles' }).click();
  await expect(page.getByText('No M1 profiles published')).toBeVisible();

  await expect(page.locator('body')).not.toContainText(
    /secretRef|secret_ref|vault:\/\//,
  );
});
