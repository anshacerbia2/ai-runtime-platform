# AI Runtime Platform — Roadmap

## North Star
One stable application-facing AI execution platform that supports both direct model access and agent execution while remaining provider- and runtime-agnostic.

```text
Apps
  -> AI Runtime Platform
      -> Direct Model Gateway
      -> Agent Runtime
      -> Usage / Audit
```

Business workflow remains in each application.

## Milestone 1 — Foundation
Status: planned

Scope:
- architecture baseline;
- shared execution context;
- capability contracts;
- result/error/event contracts;
- usage ledger schema;
- application identity model;
- execution profiles.

Outcome: common vocabulary and stable boundaries before implementation.

## Milestone 2 — Direct AI MVP
Status: planned

Scope:
- AI Runtime API;
- Model Gateway;
- OpenRouter adapter;
- chat;
- generate;
- structured generation;
- streaming;
- usage accounting.

Outcome: apps can use direct AI/chat through the platform without integrating OpenRouter directly.

## Milestone 3 — Agent Runtime MVP
Status: planned

Scope:
- evolve Claude Runner into Claude Agent Runtime adapter;
- durable execution lifecycle;
- workspace isolation;
- tool/plugin policy;
- event streaming;
- cancellation;
- usage accounting.

Outcome: Scribe uses the shared platform while continuing to own its own jobs and workflow.

## Milestone 4 — First Application Migrations
Status: planned

Scope:
- Scribe;
- one direct-chat/simple-inference consumer;
- Farexlate candidate paths;
- selected RAG model calls.

Outcome: validate that one platform contract serves materially different application patterns.

## Milestone 5 — Multi-Runtime
Status: planned

Scope:
- Codex adapter;
- Gemini adapter;
- shared runtime acceptance suite;
- runtime/plugin compatibility matrix.

Outcome: applications can use approved agent runtimes without being coupled to one vendor.

## Milestone 6 — Production Hardening
Status: planned

Scope:
- quotas and budgets;
- concurrency isolation;
- worker reconciliation;
- provider fallback;
- artifact authorization;
- tenant isolation;
- operational metrics;
- SLOs;
- billing/usage reconciliation.

Outcome: production-ready shared platform for multiple applications and workloads.

## Milestone 7 — Expansion
Status: future

Potential scope:
- direct provider adapters beyond OpenRouter;
- embeddings;
- reranking;
- vision;
- transcription;
- richer capability registry;
- policy-based routing;
- cost/quality routing;
- standardized SDKs for application teams.

These are added only when real workloads justify them.

## Success Criteria
The roadmap is successful when:
- apps do not contain provider-specific integration unless intentionally exempted;
- apps continue to own business workflow;
- direct chat does not require an agent runtime;
- agent workloads can move between supported runtimes without redesigning app contracts;
- every AI execution can be attributed to the responsible app/process;
- usage uncertainty is explicit;
- adding a provider/runtime is an adapter concern, not an application rewrite.
