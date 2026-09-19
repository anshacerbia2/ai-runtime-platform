# AI Runtime Platform — Architecture

## Purpose
AI Runtime Platform is a shared, provider-agnostic and runtime-agnostic platform for applications that need AI capabilities.

It supports:
- direct chat / completion;
- structured generation;
- agent execution;
- tool / plugin execution;
- usage, token, and cost auditing.

## Core Principle
> The application owns the job and business workflow. The AI Runtime Platform owns AI execution.

Applications send AI work plus correlation context. The platform executes it, returns normalized results/events, and records usage. The platform must not become the business workflow engine for every application.

## High-Level Model
```text
Application
  |
  | prompt/input + context + requested capability
  v
AI Runtime Platform
  +-- Model Gateway
  |     +-- OpenRouter
  |     +-- future direct providers
  +-- Agent Runtime
  |     +-- Claude
  |     +-- Codex
  |     +-- Gemini
  |     +-- tools/plugins
  +-- Usage Ledger / Audit
  |
  v
Normalized result / events

Application decides what happens next.
```

## Application Ownership
Each application remains responsible for:
- business jobs and state;
- workflow sequencing;
- domain validation;
- business retries;
- final acceptance of AI output;
- publication or other domain side effects.

Examples:
- Scribe owns document-generation jobs and publication flow.
- Farexlate owns translation / verify / repair flow.
- RAG applications own retrieval and domain authorization.
- A direct-chat application may have no long-running job at all.

## Platform Responsibilities
The platform owns:
- application authentication and authorization;
- stable AI execution contracts;
- provider and runtime adapters;
- execution policy and routing;
- credentials to AI providers;
- runtime execution lifecycle;
- normalized streaming events;
- token / usage capture and cost attribution;
- audit records;
- tool / plugin permissions.

## Capability-Oriented Contract
Applications request a capability, not a vendor implementation.

Initial capabilities:
- `chat`
- `generate`
- `structured_generate`
- `agent_execute`

Future capabilities may include `embed`, `rerank`, `vision`, and `transcribe`.

## Model Gateway
Used for workloads that only need model inference.

Initial path:
```text
Application -> AI Runtime API -> Model Gateway -> OpenRouter
```

Responsibilities:
- request/response normalization;
- streaming;
- structured output;
- provider error normalization;
- usage extraction;
- timeout handling.

Direct inference must not be forced through an agent runtime.

## Agent Runtime
Used when work requires an agent execution environment, tools, plugins, workspace access, or multi-step autonomous execution.

Runtime adapters:
- Claude;
- Codex;
- Gemini.

Conceptual adapter:
```text
AgentRuntimeAdapter
  start()
  streamEvents()
  cancel()
  getResult()
  getUsage()
```

The implementation can be CLI-, SDK-, or API-based without changing the application contract.

## Tool / Plugin Layer
Tools/plugins are execution capabilities, not business workflows.

The platform controls approved capability versions, runtime compatibility, permissions, and exposure to an execution. A plugin is not assumed to behave identically across Claude, Codex, and Gemini; compatibility must be explicit and tested.

## Shared Execution Context
```text
application
  -> process/job (optional)
      -> step (optional)
          -> execution
              -> attempt
                  -> model/tool invocation
```

Simple direct chat may only need:
```text
application -> conversation -> execution
```

## Conceptual Request
```json
{
  "context": {
    "process_id": "job-123",
    "step_id": "generate-document"
  },
  "capability": "agent_execute",
  "input": {
    "prompt": "..."
  },
  "execution": {
    "profile": "scribe-document-generation"
  }
}
```

Application identity is derived from authenticated credentials, not trusted from body fields.

## Execution Profiles
Applications should normally reference server-managed profiles instead of sending unrestricted runtime/provider/tool configuration.

Example:
```text
scribe-document-generation
  capability: agent_execute
  allowed runtimes: [claude, codex]
  allowed tools: [...]
  model policy: ...
  runtime limits: ...
```

## API Shape
Initial logical operations:
```text
POST /v1/chat
POST /v1/generate
POST /v1/executions
GET  /v1/executions/{execution_id}
GET  /v1/executions/{execution_id}/events
POST /v1/executions/{execution_id}/cancel
```

Exact schemas may evolve. The invariant is that application contracts stay independent from provider/runtime contracts.

## Usage Ledger
Every execution must be attributable to the application context that caused it.

Capture where available:
- application_id;
- process_id / job_id;
- step_id;
- conversation_id;
- execution_id;
- attempt_id;
- provider;
- resolved model;
- runtime;
- input/output/cache tokens;
- provider-reported cost;
- estimated cost;
- measurement status;
- timestamps;
- outcome.

> Unknown usage is not zero usage.

Observed usage, estimated cost, and provider-reported cost must remain distinguishable.

## Execution Semantics
### Idempotency
The same logical request with the same idempotency key must not accidentally create duplicate logical executions. Internal retries are recorded as separate attempts.

### Streaming
Normalized events may include:
- `execution.started`
- `model.started`
- `model.delta`
- `tool.started`
- `tool.completed`
- `usage.updated`
- `execution.completed`
- `execution.failed`
- `execution.cancelled`

### Cancellation
```text
running -> cancel_requested -> cancelled
```

Client disconnect does not automatically mean execution cancellation.

## Security Boundaries
Minimum requirements:
- identity per calling application;
- no single shared caller credential for all applications;
- server-side authorization of execution profiles;
- provider credentials hidden from applications;
- least-privilege tool/plugin permissions;
- isolated agent workspaces;
- controlled environment variables and network access;
- application/tenant-scoped artifacts;
- auditable execution history.

Agent execution requires a stronger isolation boundary than direct model inference.

## Persistence
Initial durable entities:
- applications;
- execution_profiles;
- executions;
- execution_attempts;
- usage_records;
- execution_events;
- capability_versions;
- artifact metadata/references.

PostgreSQL is the preferred initial system of record. Large artifacts belong in object storage.

## Deployment Shape
Do not begin with unnecessary microservices.

```text
AI Runtime API / Control Plane
  +-- Model Gateway
  +-- Policy / Usage modules
  +-- Agent Worker(s)
        +-- Claude adapter
        +-- Codex adapter
        +-- Gemini adapter
```

Agent workers may be isolated from the API/control plane because their security and resource profile is different.

## Architectural Invariants
1. Application owns business workflow.
2. Platform owns AI execution.
3. Direct inference does not require an agent.
4. Provider/runtime details stay behind adapters.
5. Platform contracts are capability-oriented.
6. Every execution is auditable.
7. Every provider/runtime must pass the same contract tests.
8. Security policy is enforced server-side.
9. New capabilities evolve without breaking existing application integrations.
