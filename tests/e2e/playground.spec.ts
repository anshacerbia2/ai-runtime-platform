import { test, expect } from '@playwright/test';

test('chat, replay, persisted history, schema catalogue, and delivery plan', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/contract-lab');
  await expect(
    page.getByRole('heading', { name: 'Contract Lab' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  await expect(page.getByTestId('saved-count')).toHaveText(/^\d+$/);

  const previous = Number(await page.getByTestId('saved-count').textContent());
  await page.getByRole('button', { name: 'Validasi & simpan' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('Kontrak valid');
  await expect(page.getByTestId('saved-count')).toHaveText(
    String(previous + 1),
  );

  const count = String(previous + 1);
  await page.getByRole('button', { name: 'Validasi & simpan' }).click();
  await expect(
    page.getByText('Replay · tidak membuat record baru'),
  ).toBeVisible();
  await expect(page.getByTestId('saved-count')).toHaveText(count);

  await page.getByRole('link', { name: /Validation History/ }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: /Validation History/ }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  await page.getByRole('link', { name: /Schema Explorer/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Contract catalogue' }),
  ).toBeVisible();

  await page.getByRole('link', { name: /Delivery Plan/ }).click();
  await expect(page.getByText('Contract baseline')).toBeVisible();
  await expect(page.getByText('Durable foundation')).toBeVisible();
  expect(errors).toEqual([]);
});

test('structured and Scribe payloads accepted, spoofed identity rejected', async ({
  page,
}) => {
  await page.goto('/contract-lab');
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  for (const name of ['Structured output', 'Scribe agent']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: 'Validasi & simpan' }).click();
    await expect(page.getByTestId('verdict')).toHaveText('Kontrak valid');
  }
  await page.getByRole('button', { name: /Identity spoofing/ }).click();
  await page.getByRole('button', { name: 'Validasi & simpan' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('Kontrak ditolak');
});

test('phone layout has no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/contract-lab');
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Below 1024px the rail is an off-canvas drawer, so navigation goes through
  // the header trigger; choosing a destination dismisses the drawer again.
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: /Control Plane/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Control Plane' }),
  ).toBeVisible();
  await expect(page.locator('.ds-sidebar')).toHaveClass(/is-collapsed/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/platform-mobile.png',
    fullPage: true,
  });
});

test('desktop snapshot', async ({ page }) => {
  await page.goto('/contract-lab');
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  await page.screenshot({
    path: 'test-results/platform-desktop.png',
    fullPage: true,
  });
});
