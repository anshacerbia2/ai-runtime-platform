import { test, expect, type Page } from '@playwright/test';

const account = (id: string, displayName: string) => ({
  id,
  displayName,
  provider: 'openrouter',
  authMode: 'API_KEY',
  environment: 'local',
  sharingMode: 'DEDICATED',
  quotaGroupRef: null,
  gatewayMaxConcurrency: 100,
  gatewayRequestsPerMinute: 600,
  status: 'ENABLED',
  revision: 1,
});
const pageOf = (items: unknown[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  limit: 20,
  consistency: 'live-keyset',
});
function summary(url: URL, known = '9007199254740993', empty = false) {
  const budget = url.searchParams.get('budgetAccountId');
  return {
    connectionId: url.pathname.split('/').at(-2),
    applicationId: url.searchParams.get('applicationId'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    observedAt: '2026-10-29T07:00:00.000Z',
    consistency: 'repeatable-read',
    invocations: {
      total: empty ? '0' : '2',
      running: '0',
      succeeded: empty ? '0' : '1',
      failed: '0',
      unknown: empty ? '0' : '1',
    },
    tokens: {
      input: { known: empty ? '0' : known, unknownInvocations: '0' },
      output: { known: '0', unknownInvocations: empty ? '0' : '2' },
    },
    ledger: budget
      ? {
          accountId: budget,
          unit: 'tokens',
          attributedPostedUnits: '35',
          excludedObservationCount: '1',
        }
      : null,
  };
}
async function registry(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/connections') {
      return route.fulfill({
        json: pageOf([
          account('account-a', 'Account Alpha'),
          account('account-b', 'Account Beta'),
        ]),
      });
    }
    if (url.pathname === '/api/v1/applications') {
      const next = url.searchParams.has('cursor');
      const id = next ? 'app-b' : 'app-a';
      return route.fulfill({
        json: pageOf(
          [
            {
              id,
              displayName: next ? 'Application Beta' : 'Application Alpha',
              environment: 'local',
              keycloakClientId: id,
              gatewayMaxConcurrency: 100,
              gatewayRequestsPerMinute: 600,
              status: 'ENABLED',
              revision: 1,
            },
          ],
          next ? null : 'next-app',
        ),
      });
    }
    if (url.pathname === '/api/v1/budgets') {
      const next = url.searchParams.has('cursor');
      return route.fulfill({
        json: pageOf(
          [
            {
              id: next ? 'budget-b' : 'budget-a',
              applicationId: null,
              quotaGroupRef: 'shared',
              unit: 'tokens',
              period: 'fixture',
              limitUnits: '10000',
              heldUnits: '0',
              postedUnits: '0',
              revision: 1,
            },
          ],
          next ? null : 'next-budget',
        ),
      });
    }
    if (url.pathname === '/api/v1/overview') {
      return route.fulfill({
        json: {
          observedAt: '2026-10-29T07:00:00.000Z',
          consistency: 'independent-observations',
          counts: {
            applications: 2,
            connections: 2,
            credentials: 0,
            bindings: 0,
            profiles: 0,
            aliases: 0,
            budgets: 2,
            pools: 0,
            runners: 0,
          },
        },
      });
    }
    return route.fulfill({ json: pageOf([]) });
  });
}
async function choose(page: Page, name = 'Account Alpha') {
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page
    .getByRole('button', { name: `View usage for ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: `Usage for ${name}`, exact: true }),
  ).toBeVisible();
}

test('account usage shows exact unknown-aware data and applies paginated filters with UTC boundaries', async ({
  page,
}, testInfo) => {
  await registry(page);
  const calls: URL[] = [];
  await page.route(/\/api\/v1\/connections\/[^/]+\/usage\?/, (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    return route.fulfill({ json: summary(url) });
  });
  await page.goto('/control-plane');
  await page.getByRole('tab', { name: 'Account usage', exact: true }).click();
  await expect(page.getByText('Choose an AI account')).toBeVisible();
  await page.getByRole('button', { name: 'Browse connections' }).click();
  await page
    .getByRole('button', { name: 'View usage for Account Alpha', exact: true })
    .click();
  const result = page.getByRole('region', { name: 'Usage result' });
  await expect(
    result.getByText('9,007,199,254,740,993', { exact: true }),
  ).toBeVisible();
  await expect(
    result.getByText('Unavailable for 2 invocations', { exact: true }),
  ).toBeVisible();
  await expect(result.getByText(/Select one budget account/)).toBeVisible();
  const before = calls.length;
  await page
    .getByLabel('Start time (UTC)', { exact: true })
    .fill('2026-10-01T00:00');
  await page
    .getByLabel('End time (UTC, exclusive)', { exact: true })
    .fill('2026-10-02T00:00');
  await page
    .getByRole('button', { name: 'Next applications', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Application filter' }).click();
  await page
    .getByRole('option', { name: 'Application Beta · app-b', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Next budget accounts', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Budget account', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'budget-b · tokens', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Previous budget accounts', exact: true })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Budget account', exact: true }),
  ).toContainText('budget-b');
  expect(calls).toHaveLength(before);
  await page.getByRole('button', { name: 'Apply usage filters' }).click();
  await expect(
    result.getByText('Budget account: budget-b', { exact: true }),
  ).toBeVisible();
  const applied = calls.at(-1)!;
  expect(Object.fromEntries(applied.searchParams)).toEqual({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
    applicationId: 'app-b',
    budgetAccountId: 'budget-b',
  });
  await expect(result.getByText(/Excluded observations: 1/)).toBeVisible();
  await expect(result.getByText(/not complete account spend/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('account-usage-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.ds-sidebar')
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page
        .locator('.ds-app-main')
        .evaluate((element) => element.getBoundingClientRect().left),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('button', { name: 'Apply usage filters' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const element of [
    page.locator('.usage-filters'),
    page.getByRole('region', { name: 'Usage result' }),
  ]) {
    const bounds = await element.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  const outcomes = result.getByRole('region', { name: 'Invocation outcomes' });
  expect(
    await outcomes.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('account-usage-mobile.png'),
    fullPage: true,
  });
  const count = calls.length;
  await page
    .getByLabel('End time (UTC, exclusive)', { exact: true })
    .fill('2026-11-02T00:00');
  await page.getByRole('button', { name: 'Apply usage filters' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: /at most 31 days/ }),
  ).toBeVisible();
  expect(calls).toHaveLength(count);
});

test('usage errors keep marked previous data while account and filter changes discard stale results and late responses', async ({
  page,
}) => {
  await registry(page);
  let fail = false;
  let release!: () => void;
  let delayed = false;
  let delayedCompleted = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/v1\/connections\/[^/]+\/usage\?/, async (route) => {
    const url = new URL(route.request().url());
    const isDelayed =
      url.pathname.includes('account-a') &&
      url.searchParams.get('from') === '2026-10-01T00:00:00.000Z';
    if (isDelayed) {
      delayed = true;
      await gate;
    }
    if (fail) {
      return route.fulfill({
        status: 503,
        json: {
          error: { code: 'UNAVAILABLE', message: 'fixture unavailable' },
        },
      });
    }
    await route
      .fulfill({
        json: summary(
          url,
          url.pathname.includes('account-b') ? '22' : undefined,
        ),
      })
      .catch(() => {
        /* Changing account can abort the owned request. */
      });
    if (isDelayed) {
      delayedCompleted = true;
    }
  });
  try {
    await page.goto('/control-plane');
    await choose(page);
    const result = page.getByRole('region', { name: 'Usage result' });
    await expect(
      result.getByText('9,007,199,254,740,993', { exact: true }),
    ).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: 'Refresh usage' }).click();
    await expect(
      result.getByText('Usage unavailable.', { exact: false }),
    ).toBeVisible();
    await expect(
      result.getByText('Last successful result', { exact: true }),
    ).toBeVisible();
    await expect(
      result.getByText('9,007,199,254,740,993', { exact: true }),
    ).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry usage' }).click();
    await expect(
      result.getByText('Last successful result', { exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel('Start time (UTC)', { exact: true })
      .fill('2026-10-01T00:00');
    await page
      .getByLabel('End time (UTC, exclusive)', { exact: true })
      .fill('2026-10-02T00:00');
    await page.getByRole('button', { name: 'Apply usage filters' }).click();
    await expect.poll(() => delayed).toBe(true);
    await expect(
      result.getByText('9,007,199,254,740,993', { exact: true }),
    ).toHaveCount(0);
    await expect(
      result.getByText('Loading usage…', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Change account' }).click();
    await page
      .getByRole('button', { name: 'View usage for Account Beta', exact: true })
      .click();
    await expect(result.getByText('22', { exact: true })).toBeVisible();
    release();
    await expect.poll(() => delayedCompleted).toBe(true);
    await expect(
      page.getByRole('heading', {
        name: 'Usage for Account Beta',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      result.getByText('9,007,199,254,740,993', { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test('a failed budget picker does not turn a valid empty usage result into a fake failure or balance', async ({
  page,
}) => {
  await registry(page);
  await page.route('**/api/v1/budgets*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'fixture unavailable' } },
    }),
  );
  await page.route(/\/api\/v1\/connections\/[^/]+\/usage\?/, (route) =>
    route.fulfill({ json: summary(new URL(route.request().url()), '0', true) }),
  );
  await page.goto('/control-plane');
  await choose(page);
  await expect(
    page.getByRole('button', { name: 'Retry budget accounts' }),
  ).toBeVisible();
  await expect(
    page.getByText('No provider invocations in this period', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Usage result' })
      .getByText(/Select one budget account/),
  ).toBeVisible();
});
