# Security, Privacy, dan Threat Model

**Baseline 0.2 — target controls, belum bukti security assessment.** [ADR-0011](../adr/0011-sandbox-security.md), [boundary](../architecture/BOUNDARIES.md), dan [gate](../testing/ACCEPTANCE.md).

## 1. Assets dan trust boundaries

Assets: provider credentials, application identity, prompts/documents, artifacts, session checkpoints, usage evidence/ledger, operation approvals, budget accounts, host infrastructure. Trust boundaries: client/BFF -> API; API -> SoR; control plane -> supervisor; supervisor -> untrusted agent workspace; broker -> external provider/tool; public UI -> scoped stream/object grant.

Prompt, retrieved text, artifact contents, tool responses, and model output are untrusted inputs. Mereka tidak dapat mengubah system policy, grants, identity, ledger, atau approval. Plugin scripts diperlakukan sebagai executable code, bukan sekadar template.

## 2. Threat-control-test matrix

| Threat                                    | Required control                                                                                                        | Proof       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| Cross-app/tenant read atau cancel         | Token binding + per-resource authZ pada read/list/stream/cancel/artifact/session/usage                                  | G01         |
| Credential theft dari sandbox             | No control-plane env; scoped short-lived grants; separate secret broker; no shared consumer config dir                  | G18         |
| Host traversal/socket access              | Nonprivileged sandbox, no host mounts/sockets, filesystem policy, symlink validation                                    | G18/G19     |
| SSRF/metadata exfiltration                | Egress allowlist, DNS/redirect/IP revalidation, block metadata/private control ranges kecuali explicitly approved route | G18         |
| Prompt injection requesting tools         | Broker evaluates immutable policy/approval, not model claims                                                            | G13/G18     |
| Stale/compromised worker changing outcome | Generation/revision checks; no direct DB writes; separate evidence intake                                               | G04/G05/G12 |
| Forged/duplicate financial evidence       | Source identity, bounded intake, verification, dedup/adjustment                                                         | G12/G15     |
| Resource exhaustion/noisy neighbor        | Request/schema/file/log/token/process/memory/time limits, isolated queues/pools                                         | G22/G25     |
| Supply-chain package/runtime change       | Version pinning, digest/provenance review, test and controlled rollout                                                  | G03/G18     |
| Excess data retention                     | Classification, access/retention policy, deletion propagation and backup handling                                       | G24         |

## 3. Sandbox baseline

Agent code runs outside control-plane process, under non-root identity where runtime permits, isolated filesystem/process/network boundaries, readonly base image, writable bounded workspace, restricted capabilities/syscalls, CPU/memory/process/disk/time limits, and no inherited host/provider-wide credentials.

Container alone is not a universal guarantee. Candidate hardened container/gVisor/microVM must match actual threat model and pass host/metadata/egress tests. Principal technology examples are options, not proof of implementation. Agent SDK permission prompts complement OS/broker controls, not replace them.

`/proc/1/environ` inside a container may refer to that container, not host; test must prove host/control-plane secrets are absent, not merely look for one Permission Denied string. No host PID namespace or docker/containerd socket. Test IPv4/IPv6, redirects, DNS changes, and explicit private tool routes.

## 4. Credentials

Provider credentials never arrive from arbitrary untrusted request body. Credential binding approved server-side; no secret value in profile/event/trace. Worker receives only workload-scoped auth required by its adapter, preferably brokered/tokenized and short-lived. Grant max scope/lifetime, redaction, revocation, and rotation are documented per binding.

Do not pool consumer subscription login directories as an implicit production credential model. Each vendor runtime/API auth mode and organizational agreement must be reviewed; this baseline does not certify terms/legal compliance. Raw credential values never enter repository, artifact, prompt, or diagram.

## 5. Data policy

Data-class policy covers allowed provider/model route, region, retention/ZDR, plugin/tool destinations, encryption, logging, and deletion. OpenRouter documents ZDR/routing controls (R03), but a configured route/plugin set and organizational agreement still need review. No blanket claim that an aggregator guarantees or prevents compliance.

Default: logs contain IDs, durations, result categories, error codes, and measurements—not full prompts/output. Content capture for evaluation/debug requires explicit policy, access scope, retention, and redaction. Raw transcript archive is optional. Cache shared across app/tenant is off by default.

## 6. Authorization of dangerous operations

Stateful tools need both identity authorization and stable operation/receiver idempotency; one does not replace the other. App grants approved actions/resources; actor approval binds to digest/operation/expiry. Broker denies expansion by prompt/plugin output. No blanket shell approval carrying arbitrary provider or domain credentials.

## 7. Operational controls

Separate admin/runtime/usage verifier identities. Audit profile/credential/grant changes and manual budget adjustments. Security kill switch revokes new dispatch and starts safe cancellation; it does not imply past remote actions were undone. Incident response preserves evidence before cleanup according to policy.

Deployment requires a named owner, threat-model review, sandbox evidence, credential agreement, data policy, and recovery plan. Multi-tenant production remains blocked without these. See [open decisions](../decisions/OPEN-QUESTIONS.md).

## 8. Application isolation, connection secrecy, dan plugin supply chain

Authorization dievaluasi pada authenticated application + profile revision + connection binding, bukan pada identifier yang dikirim caller. Mengetahui connection/plugin/runner ID tidak memberi authority.

Actual provider credential dapat berupa API key/token, OAuth/service account, cloud workload identity, atau runtime/account session yang didukung adapter; material berasal dari secret manager/workload identity atau runner-local secret store. Secret/session tidak tampil di Admin UI, logs, database metadata, browser bundle, plugin manifest, registration, atau heartbeat. Injection harus minimum-scope dan minimum-lifetime.

Plugin package wajib diverifikasi digest/status sebelum materialization. Sandbox menolak host path traversal, undeclared mounts, host secret access, dan egress di luar policy. Cross-app acceptance harus membuktikan App A tidak dapat menggunakan profile, plugin, artifact, credential instance, atau connection milik App B.

Runner registration wajib authenticated dan node identity tidak boleh diambil alih hanya dengan spoofed heartbeat. Drain/disable adalah durable operator intent; stale node tidak kembali eligible hanya karena mengirim heartbeat lama.
