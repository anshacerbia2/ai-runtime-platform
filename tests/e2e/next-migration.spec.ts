import { test, expect } from '@playwright/test';

test('standalone entry, real routes, browser history and local logout work through Next.js', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Open local console' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open local console' }).click();
  await expect(page).toHaveURL(/\/contract-lab$/);
  await expect(
    page.getByRole('button', { name: 'Validasi & simpan' }),
  ).toBeEnabled();
  await page.getByRole('link', { name: 'Control Plane', exact: true }).click();
  await expect(page).toHaveURL(/\/control-plane$/);
  await expect(
    page.getByRole('heading', { name: 'Application-scoped durable authority' }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/control-plane$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/contract-lab$/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth\/logged-out$/);
  expect(errors).toEqual([]);
});

test('documentation is server-rendered and reachable without client JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  try {
    const page = await context.newPage();
    const response = await page.goto('/docs/adr/0026-nextjs-bff');
    expect(response?.headers()['x-frame-options']).toBe('DENY');
    expect(response?.headers()['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    await expect(
      page.getByRole('heading', {
        name: /Next.js App Router and Backend-for-Frontend Tier/,
      }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'All documentation' }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(
      page.getByRole('heading', { name: 'Project documents' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('BFF rejects cross-origin writes, invalid paths, and login GET requests', async ({
  request,
  baseURL,
}) => {
  const response = await request.put('/api/m1/control-plane', {
    headers: { Origin: 'https://attacker.invalid' },
    data: {},
  });
  expect(response.status()).toBe(403);
  expect((await request.get('/api/arbitrary-resource')).status()).toBe(404);
  expect((await request.get('/auth/login')).status()).toBe(405);
  const page = await request.get(baseURL + '/docs/missing-document');
  expect(page.status()).toBe(404);
});
