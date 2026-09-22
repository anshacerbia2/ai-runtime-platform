import { expect, test } from '@playwright/test';

test('custom select: keyboard, type-ahead, outside click', async ({ page }) => {
  await page.goto('/contract-lab');
  const trigger = page.getByRole('combobox', { name: 'Jenis kontrak' });
  await expect(trigger).toHaveText(/chat/);

  // Opens on Enter and exposes a listbox.
  await trigger.focus();
  await page.keyboard.press('Enter');
  const list = page.getByRole('listbox', { name: 'Jenis kontrak' });
  await expect(list).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  // ArrowDown moves the active descendant, Enter commits it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText(/generate/);
  await expect(list).toBeHidden();

  // Escape cancels without changing the value.
  await page.keyboard.press('ArrowDown');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(trigger).toHaveText(/generate/);

  // Type-ahead while open jumps to a matching option.
  await page.keyboard.press('Enter');
  await page.keyboard.press('P');
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();

  // Home/End bounds.
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText(/executions/);

  // Pointer selection.
  await trigger.click();
  await page.getByRole('option', { name: /v1\/chat/ }).click();
  await expect(trigger).toHaveText(/chat/);

  // Outside click dismisses without committing the highlight.
  await trigger.click();
  await expect(list).toBeVisible();
  await page.getByRole('heading', { name: 'Contract Lab' }).click();
  await expect(list).toBeHidden();
  await expect(trigger).toHaveText(/chat/);

  // The payload still drives validation after selecting through the primitive.
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
});
