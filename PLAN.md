# AI Runtime Platform — Plan

## Goal
Build a shared AI execution platform that can serve existing and future applications without coupling them to a specific model provider or agent runtime.

The first usable version must support:
- direct AI access through OpenRouter;
- Claude-based agent execution;
- shared execution context;
- per-application/process usage auditing;
- stable contracts that allow Codex and Gemini to be added later.

## Non-Goals
The platform will not:
- own application business workflows;
- replace application job state;
- become a generic workflow engine;
- force every AI request through an agent;
- support every provider/runtime in the first release;
- standardize every plugin format prematurely.

## Phase 0 — Contract First
Define the smallest stable concepts before implementation.

Deliverables:
- execution context model;
- capability model;
- execution/result/error contracts;
- event contract;
- usage record contract;
- idempotency semantics;
- cancellation semantics;
- execution-profile model.

Exit criteria:
- Scribe agent execution can be expressed without Claude-specific fields.
- A direct-chat app can be expressed without inventing a fake job.
- Farexlate-style AI steps can be expressed without agent semantics.

## Phase 1 — Control Plane Foundation
Deliverables:
- application identity;
- authorization;
- execution profiles;
- execution persistence;
- attempt persistence;
- usage ledger;
- normalized status model;
- basic audit queries.

Preferred initial persistence: PostgreSQL.

Exit criteria:
- every execution has an immutable `execution_id`;
- every attempt is traceable;
- unknown usage is represented as unknown, never silently as zero.

## Phase 2 — Model Gateway + OpenRouter
Deliverables:
- OpenRouter adapter;
- chat;
- generate;
- structured generation;
- streaming;
- normalized provider errors;
- usage capture;
- model/provider resolution metadata.

Exit criteria:
- an app can perform direct chat without knowing OpenRouter details;
- structured generation uses the same shared platform;
- usage is attributable to application/process context.

## Phase 3 — Claude Agent Runtime
Evolve the existing Claude Runner into the first Agent Runtime adapter.

Deliverables:
- Claude runtime adapter;
- isolated execution workspace;
- event normalization;
- cancellation;
- runtime timeout / limits;
- plugin/tool policy;
- durable execution state;
- usage capture.

Exit criteria:
- Scribe keeps its ownership model:
  `job in Scribe -> prompt + job id to platform -> result back to Scribe`;
- platform restart or stream disconnect does not silently redefine business job state;
- provider/runtime credentials are not exposed to Scribe.

## Phase 4 — Migrate First Applications
Recommended order:
1. Scribe agent path;
2. one simple direct-inference workload;
3. Farexlate-style inference;
4. selected RAG model calls.

For each migration:
- preserve application workflow;
- keep rollback path;
- compare output quality;
- compare latency;
- compare usage/cost;
- verify idempotency and failure behavior.

## Phase 5 — Codex Runtime Adapter
Deliverables:
- adapter;
- event mapping;
- tool/plugin compatibility matrix;
- usage mapping;
- runtime acceptance tests.

Exit criteria:
- application contract requires no Codex-specific change;
- at least one real workload passes the same acceptance criteria used for Claude.

## Phase 6 — Gemini Runtime Adapter
Deliverables and exit criteria mirror Codex.

## Phase 7 — Hardening
Focus areas:
- worker isolation;
- concurrency controls;
- quotas/budgets;
- provider fallback policy;
- execution reconciliation;
- artifact access boundaries;
- tenant isolation;
- usage reconciliation;
- operational dashboards;
- SLOs and alerts.

## Engineering Principles
- Contract-first, implementation-second.
- Prefer modular control plane before microservices.
- Extract services only when scaling or isolation requires it.
- Keep adapters thin.
- Keep application domain logic outside the platform.
- Treat usage accounting as product data, not only observability.
- Add runtime/provider support only with contract and acceptance tests.
- Preserve rollback paths during migrations.
