# Source dan Evidence Register

**Baseline date:** 20 September 2026. Source-derived requirements, authored design amendments, dan externally verified facts dipisahkan. Link dokumentasi resmi adalah referensi kemampuan/protokol, bukan sertifikasi deployment platform.

## Project sources

| ID | Source | Scope / provenance |
| --- | --- | --- |
| SRC-U | Kebutuhan user dalam percakapan ini | Agnostic platform; app owns job; direct chat; OpenRouter awal; runtime Claude/Codex/Gemini; plugin dan audit |
| SRC-P | [AUDIT.md](../../AUDIT.md), principal final sign-off | Local source terbaru dibaca via RDC; preserved unchanged; lihat bagian 1–5 |
| SRC-R | Review terakhir dalam percakapan | Empat koreksi correctness; diterjemahkan menjadi M01–M10, bukan teks principal |
| SRC-B | Git commit `376d435bf43589784b1f1a5d76f88be33b233365` | Original ARCHITECTURE/PLAN/ROADMAP; bukan current implementation |

Hash original ARCHITECTURE.md: `661b7dc0a9c4a7528d0f783424267ff6fbc563a9e6b0cdb0fcb99c3202a84751`.
Hash original PLAN.md: `31d3b09b11d42d0d4a1dda5692ab4564db32e3263788cbbbe74cd5eb1d1515b6`.
Hash original ROADMAP.md: `7ea9e3355b0f04c142e14585bcbc9dadbc4739a6cc8b091d3ee64a312fe9d720`.
Hash principal AUDIT.md: `1472b33761ceb4267b2784b7d4e7ea2111ee0f2c7ddef9c3e52351992158a46c`.

## Public primary references checked during documentation update

| ID | Primary source | Factual point supported; limits |
| --- | --- | --- |
| R01 | [OpenAI — Codex SDK](https://developers.openai.com/codex/sdk/) | Programmatic local Codex agent integration exists. Does not prove cross-runtime portability or our adapter implementation. |
| R02 | [OpenRouter — Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) | Response usage/cost and generation-ID lookup documented; missing ID/response still needs uncertainty handling. |
| R03 | [OpenRouter — Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection) and [ZDR](https://openrouter.ai/docs/guides/features/zdr) | Parameter support filtering and inference route ZDR controls; tools/plugins have separate data-policy implications. No blanket compliance conclusion. |
| R04 | [Anthropic — Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | SDK cost fields are client-side estimates, not authoritative billing; source semantics require care. |
| R05 | [Gemini CLI — Headless mode](https://geminicli.com/docs/cli/headless/) | Noninteractive integration surface documented; exact version/capabilities must be validated for chosen adapter. |
| R06 | [WHATWG — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) | SSE field/reconnect protocol; replay persistence and 410 response flow are platform design decisions. |
| R07 | [MCP — Tools, specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Tool discovery/invocation/schema protocol; no claim it supplies sandbox or receiver idempotency. |
| R08 | [AWS — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) | Dual-write mitigation and duplicate-consumer considerations. Our transaction schema still requires implementation proof. |
| R09 | [PostgreSQL — Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) | Row-level lock behavior available; no throughput guarantee or proof of accounting implementation. |
| R10 | [Redis — Distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) | Conditional value-match renewal and fencing caveats. Not a proof of cross-store atomicity. |
| R11 | [Redis — DECRBY](https://redis.io/docs/latest/commands/decrby/) | Command decrements value; rejection without compensating protocol does not undo subtraction. |
| R12 | [Mermaid — Introduction](https://mermaid.js.org/intro/) | Text-based diagram tooling; diagram parse/render checks are not system behavior tests. |

No current model prices, production availability figures, latency numbers, organizational contracts, or compliance certifications were established from these sources. Hypothetical limits/examples in this baseline are labeled accordingly. Runtime/provider versions must be reverified during implementation because interfaces and policies evolve.

## Documentation authority

Architecture explains decisions; contracts/data/reliability define operational semantics; ADR records rationale and trade-offs; diagrams visualize those documents; acceptance catalogue defines future proof. Historical source AUDIT.md is not rewritten to match corrections. Validation record reports only checks actually performed.
