# AI Playground

**1 November 2026.** The console's AI Playground (`/playground`) sends a chat through the same gateway path an application uses: admission, budget reservation, provider streaming, durable result and usage settlement. It is the first console surface that makes a real model call.

## Turn it on locally

1. Put one provider key in `.env`: `M2_ANTHROPIC_API_KEY` (preferred when both are set) or `M2_OPENROUTER_API_KEY`.
2. Optional: set `M2_PLAYGROUND_MODEL`. Defaults are `claude-sonnet-5-5` for Anthropic and `openrouter/auto` for OpenRouter.
3. Run `npm run db:migrate`, then restart `npm run dev`. The seed prints which provider and model the `playground-chat` profile uses.
4. Open **AI Playground** in the console and send a message.

Seeding provisions only in `m0-local` mode and only for the primary local application. It creates:

- a connection with a credential reference to the legacy local key;
- an application binding;
- a local token budget of 1,000,000 tokens;
- the `playground-chat` profile: chat, streaming, up to 4,096 output tokens, 16,384 tokens held per execution.

Changing the provider or model publishes the next immutable profile revision and moves the alias to it. Nonlocal deployments are unaffected and still provision resources through the Control Plane.

## Behaviour

- Each turn is one gateway execution with its own idempotency key. The whole conversation, with the optional system prompt first, is the input.
- Replies stream token by token. The side panel shows execution ID, provider, model, token counts and finish reason. Unknown usage shows as `unknown`, never `0`.
- **Stop** aborts the browser stream and records a durable cancel intent. The provider call stops asynchronously; charges already incurred remain.
- Errors show the gateway code and message. For an unprovisioned profile (`NOT_FOUND`), the page shows the setup steps above.

## Agent mode

Switch the conversation panel to **Agent** to give the model a task it may solve with tools. Example tasks: "What is 18% of 2,450 AUD?" or "What time is it in Jakarta and in Sydney?".

- The model replies with one JSON object per step: either a tool call or a final answer. The Playground shows each step's reasoning note, the tool call with its arguments, the tool's status and output, and then the answer.
- Tools are read-only and run with the application's own authority:
  - `current_time`: the date and time, optionally in a time zone;
  - `calculate`: exact arithmetic through a bounded parser, never `eval`;
  - `execution_lookup`: status and token usage of one of this application's gateway executions.
- You can choose the tools, the maximum steps (default 6, at most 8) and the output tokens per step. Each run also has a 50,000-token cap by default.
- Every model step is a separate gateway execution, admitted and charged against the profile's budget like a chat turn. The **Last run** panel shows the run ID, step count and total tokens.
- **Stop** closes the stream, which cancels the run and the model step in progress.
- A run lives only for the request. It is not saved and cannot be resumed. This is ADR-0034's [stage A2-preview](../adr/0034-agent-runtime-model-inference-separation.md#stage-a2-preview-request-scoped-agent-runs-1-november-2026). The durable run with whole-run accounting is still stage A2.

The same provider key and `playground-chat` profile serve both modes. Run the agent with up to 4,096 output tokens per step; the profile refuses a higher value with `POLICY_DENIED`.

## Gateway errors through the BFF

Before this change, the browser gateway contract declared only success responses, so the BFF turned every gateway error into `502 INVALID_UPSTREAM_RESPONSE`. Examples include `404` for a missing profile, `402` for an exhausted budget and `429` for a rate limit. The browser gateway routes now carry the shared error responses that every other API route already had, and `contracts/bff.openapi.json` is regenerated. Success responses are unchanged.

## Evidence

- `apps/api/test/local-playground.integration.test.ts` runs on real PostgreSQL with a fixture provider:
  - provisioning applies only in local mode with a key;
  - a second seed publishes nothing new;
  - a chat through the provisioned profile completes with 18 tokens posted and no hold left;
  - a model change publishes revision 2.
- `apps/web/test/playground-stream.test.ts` covers SSE frame reassembly, the request body, streamed updates and gateway error surfacing.
- `tests/e2e/ai-playground.spec.ts` covers a streamed reply with execution facts, and the setup hint for an unprovisioned profile.
- Agent mode: `apps/api/test/unit/agent-run.test.ts` (loop, limits, cancel, parsing, calculator); `apps/api/test/agent-run.integration.test.ts` (an agent run on real PostgreSQL: a calculator call between two completed gateway executions, 100 tokens posted, none held; a missing profile stops with `NOT_FOUND`); `apps/web/test/playground-agent.test.ts`; two agent cases in `tests/e2e/ai-playground.spec.ts`.
- A live provider call has not been made on this workstation, because no provider key is configured.
