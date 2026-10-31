import { test, expect } from '@playwright/test';

const executionId = '7f0c2c1e-1d2b-4c3a-9a8b-0e1f2a3b4c5d';

function frame(sequence: number, type: string, payload: object) {
  const event = {
    schema_version: '1',
    id: `${executionId}:${sequence}`,
    execution_id: executionId,
    sequence,
    type,
    occurred_at: '2026-11-01T03:00:00.000Z',
    payload,
  };
  return `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

test('Playground streams a reply and shows the execution facts', async ({
  page,
}) => {
  let sent: unknown = null;
  await page.route('**/api/v1/chat', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: [
        frame(0, 'execution.started', {
          provider: 'direct-anthropic',
          model: 'claude-sonnet-5-5',
        }),
        frame(1, 'model.delta', { text: 'Hello ' }),
        frame(2, 'model.delta', { text: 'from the gateway.' }),
        frame(3, 'usage.updated', { input_tokens: 9, output_tokens: 4 }),
        frame(4, 'execution.completed', { finish_reason: 'end_turn' }),
      ].join(''),
    });
  });
  await page.goto('/playground');
  await expect(
    page.getByRole('heading', { name: 'AI Playground' }),
  ).toBeVisible();
  await page.getByLabel('Message').fill('Say hello');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Hello from the gateway.')).toBeVisible();
  await expect(page.getByText(executionId)).toBeVisible();
  await expect(page.getByText('claude-sonnet-5-5')).toBeVisible();
  await expect(page.getByText('end_turn')).toBeVisible();
  expect(sent).toMatchObject({
    profile: 'playground-chat',
    stream: true,
    input: {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
      ],
    },
  });
});

test('Playground explains an unprovisioned profile', async ({ page }) => {
  await page.route('**/api/v1/chat', (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: {
          code: 'NOT_FOUND',
          message: 'Published profile not found.',
          retryable: false,
        },
      },
    }),
  );
  await page.goto('/playground');
  await page.getByLabel('Message').fill('hi');
  await page.keyboard.press('Enter');
  const alert = page.getByRole('alert').filter({ hasText: 'NOT_FOUND' });
  await expect(alert).toContainText('NOT_FOUND');
  await expect(alert).toContainText('Published profile not found.');
  await expect(alert).toContainText('M2_ANTHROPIC_API_KEY');
});
