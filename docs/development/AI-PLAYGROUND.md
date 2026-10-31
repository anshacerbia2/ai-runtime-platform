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
- A live provider call has not been made on this workstation, because no provider key is configured.
