import { test, expect } from '@playwright/test';
test('chat, replay, persisted history, schema explorer, and phase guide', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
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
  await page.getByRole('button', { name: 'Riwayat validasi' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Riwayat validasi' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: 'Schema explorer' }).click();
  await expect(page.getByLabel('Pilih schema')).toBeVisible();
  await page.getByRole('button', { name: 'Panduan fase' }).click();
  await expect(page.getByText('Kontrak yang bisa dicoba')).toBeVisible();
  expect(errors).toEqual([]);
});
test('structured and Scribe payloads accepted, spoofed identity rejected', async ({
  page,
}) => {
  await page.goto('/');
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
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/m0-mobile.png', fullPage: true });
});
test('desktop snapshot', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  await page.screenshot({
    path: 'test-results/m0-desktop.png',
    fullPage: true,
  });
});
