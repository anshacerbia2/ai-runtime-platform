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

const runId = '0b8a4c1e-2d3f-4a5b-8c9d-0e1f2a3b4c5d';

function agentFrame(sequence: number, type: string, payload: object) {
  const event = {
    schema_version: '1',
    run_id: runId,
    sequence,
    type,
    occurred_at: '2026-11-01T03:00:00.000Z',
    payload,
  };
  return `id: ${runId}:${sequence}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

test('Agent mode shows tool steps and the final answer', async ({ page }) => {
  let sent: unknown = null;
  await page.route('**/api/v1/agent/runs', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: [
        agentFrame(0, 'run.started', {
          profile: 'playground-chat',
          tools: ['current_time', 'calculate', 'execution_lookup'],
          max_steps: 6,
          token_budget: 50000,
        }),
        agentFrame(1, 'model.dispatched', {
          step: 1,
          execution_id: executionId,
        }),
        agentFrame(2, 'model.completed', {
          step: 1,
          execution_id: executionId,
          input_tokens: 120,
          output_tokens: 24,
          thought: 'Use the calculator for an exact product.',
          action: 'tool',
        }),
        agentFrame(3, 'tool.called', {
          step: 1,
          tool: 'calculate',
          arguments: { expression: '17*23' },
        }),
        agentFrame(4, 'tool.completed', {
          step: 1,
          tool: 'calculate',
          status: 'SUCCEEDED',
          output: '{"expression":"17*23","result":391}',
        }),
        agentFrame(5, 'run.completed', {
          answer: '17 × 23 = 391.',
          steps: 2,
          input_tokens: 260,
          output_tokens: 40,
        }),
      ].join(''),
    });
  });
  await page.goto('/playground');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Message').fill('What is 17 * 23?');
  await page.getByRole('button', { name: 'Run agent' }).click();

  await expect(page.getByText('17 × 23 = 391.')).toBeVisible();
  const steps = page.getByRole('list', { name: 'Agent steps' });
  await expect(steps).toContainText('Use the calculator for an exact product.');
  await expect(steps).toContainText('calculate({"expression":"17*23"})');
  await expect(steps).toContainText('succeeded');
  await expect(page.getByText(runId)).toBeVisible();
  expect(sent).toMatchObject({
    profile: 'playground-chat',
    input: 'What is 17 * 23?',
    tools: ['current_time', 'calculate', 'execution_lookup'],
    max_steps: 6,
  });
});

test('Agent mode explains a stopped run', async ({ page }) => {
  await page.route('**/api/v1/agent/runs', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: [
        agentFrame(0, 'run.started', {
          profile: 'playground-chat',
          tools: [],
          max_steps: 6,
          token_budget: 50000,
        }),
        agentFrame(1, 'run.stopped', {
          status: 'FAILED',
          code: 'NOT_FOUND',
          message: 'Published profile not found.',
          steps: 0,
          input_tokens: 0,
          output_tokens: 0,
        }),
      ].join(''),
    }),
  );
  await page.goto('/playground');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByLabel('Message').fill('hi');
  await page.keyboard.press('Enter');
  const alert = page.getByRole('alert').filter({ hasText: 'NOT_FOUND' });
  await expect(alert).toContainText('Published profile not found.');
  await expect(alert).toContainText('M2_ANTHROPIC_API_KEY');
});
