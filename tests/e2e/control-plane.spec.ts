import { test, expect } from '@playwright/test';

test('M1 control plane registry is visible without secret material', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Control Plane/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Control Plane Registry' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'm0-playground', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Belum ada AI Connection.')).toBeVisible();
  await expect(page.getByText('Belum ada binding.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('secretRef');
});
