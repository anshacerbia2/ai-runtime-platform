# Security, Privacy, dan Threat Model

**Baseline 0.2 — target controls, belum bukti security assessment.** [ADR-0011](../adr/0011-sandbox-security.md), [boundary](../architecture/BOUNDARIES.md), dan [gate](../testing/ACCEPTANCE.md).

## Current enforcement and test boundary

Source implements bearer principal separation, role/scope checks, app-owned admission/execution/artifact access, server-owned browser sessions, BFF Origin/Host and allowlist checks, projected response fields, caller-scoped management receipts, and exact runner authority. Outbox/credential resource lists exclude payload/secret reference at query time. Known stale assignment evidence is stored only in quarantine. See [HTTP catalogue](../implementation/HTTP-API.md) for exposure and [local evidence](../reviews/CONTRACT-EXECUTION.md) for actual tests.

These controls are not a complete production security assessment. Operator authorization is currently broad platform-level within one organization; resource-granular approvals, sandbox/egress containment, actual provider secret resolution and deployment IAM/network enforcement remain incomplete. Local debug source and test logs are not a promise of production logging/retention compliance. The threat matrix below is a target requirement catalogue, not an assertion that each sandbox or live dependency test has passed.

## 1. Assets dan trust boundaries

Assets: provider credentials, application identity, prompts/documents, artifacts, session checkpoints, usage evidence/ledger, operation approvals, budget accounts, host infrastructure. Trust boundaries: client/BFF -> API; API -> SoR; control plane -> supervisor; supervisor -> untrusted agent workspace; broker -> external provider/tool; public UI -> scoped stream/object grant.

Prompt, retrieved text, artifact contents, tool responses, and model output are untrusted inputs. Mereka tidak dapat mengubah system policy, grants, identity, ledger, atau approval. Plugin scripts diperlakukan sebagai executable code, bukan sekadar template.

## 2. Threat-control-test matrix

| Threat                                    | Required control                                                                                                        | Proof       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| Cross-application read atau cancel        | Token binding + per-resource authZ pada read/list/stream/cancel/artifact/session/usage                                  | G01         |
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

Default: logs contain IDs, durations, result categories, error codes, and measurements—not full prompts/output. Content capture for evaluation/debug requires explicit policy, access scope, retention, and redaction. Raw transcript archive is optional. Cache shared across applications is off by default.

## 6. Authorization of dangerous operations

Stateful tools need both identity authorization and stable operation/receiver idempotency; one does not replace the other. App grants approved actions/resources; actor approval binds to digest/operation/expiry. Broker denies expansion by prompt/plugin output. No blanket shell approval carrying arbitrary provider or domain credentials.

## 7. Operational controls

Separate admin/runtime/usage verifier identities. Audit profile/credential/grant changes and manual budget adjustments. Security kill switch revokes new dispatch and starts safe cancellation; it does not imply past remote actions were undone. Incident response preserves evidence before cleanup according to policy.

Deployment requires a named owner, threat-model review, sandbox evidence, credential agreement, data policy, and recovery plan. Production remains blocked without these controls and the applicable application-isolation evidence. See [open decisions](../decisions/OPEN-QUESTIONS.md).

## 8. External-app identity boundary dan BFF token custody

AI Runtime Platform dilayani pada public origin miliknya sendiri dan terdaftar di ATI One sebagai **external app**. ATI One tidak mem-proxy, me-mount, mem-frame, atau mengautentikasi request platform ini; katalog hanya menautkan. Konsekuensinya, portal entitlement bukan input bagi keputusan akses — seluruh keputusan akses adalah milik platform. Lihat [ADR-0025](../adr/0025-external-app-standalone-auth.md).

Entry point adalah halaman publik dengan satu aksi sign-in yang memulai OIDC **Authorization Code** ke shared Keycloak realm (login UI dilayani deployment ai-portal). Platform tidak pernah merender credential form dan tidak pernah menerima password. Direct Access Grant / ROPC ditolak.

**Token custody.** Authorization-code exchange, client secret, refresh, dan session cookie dimiliki BFF tier ([ADR-0026](../adr/0026-nextjs-bff.md)). Access dan refresh token tidak pernah mencapai browser; browser hanya memegang opaque session cookie yang `Secure`, `HttpOnly`, `SameSite=Lax`, ter-namespace ke client ini, dan ber-scope `/`. Client secret tidak boleh muncul dalam client bundle, dan ketiadaannya dibuktikan dengan pemindaian build output.

**Trust boundary hop.** Browser -> BFF diautentikasi session cookie; BFF -> API diautentikasi bearer access token milik session tersebut. API menerapkan per-operation authorization yang sama untuk semua caller, sehingga BFF adalah client tanpa privilege tambahan dan tidak dapat mengklaim identity yang tidak dibawa token. Ini menggantikan — dan lebih ketat daripada — per-app proxy credential yang dipensiunkan, karena hop kedua kini membawa principal yang dapat diverifikasi, bukan shared secret.

**Perubahan postur frame.** Karena tidak lagi di-embed portal, response menolak framing (`frame-ancestors 'none'`). Ini memulihkan proteksi clickjacking yang sebelumnya harus dilepas demi internal-app hosting.

**Shared production issuer.** Mengautentikasi ke Keycloak production dari deployment non-production adalah trade yang disengaja dengan kewajiban yang mengikat: client id dan secret berbeda per environment; redirect URI loopback/non-production tidak boleh terdaftar pada client yang dipakai production; production client secret tidak boleh berada di `.env` workstation; dan local development tetap berjalan pada mode `m0-local` tanpa menghubungi issuer production. Bila kewajiban ini tidak dapat dipenuhi, realm atau client non-production terpisah diperlukan sebelum pekerjaan nonlocal berjalan.

Platform tidak pernah membaca atau memakai ulang ATI One portal session cookie. Riwayat kontrak internal-app yang dipensiunkan ada di [ADR-0023](../adr/0023-ati-one-internal-app.md).

## 9. Application isolation, connection secrecy, dan plugin supply chain

Authorization dievaluasi pada authenticated application + profile revision + connection binding, bukan pada identifier yang dikirim caller. Mengetahui connection/plugin/runner ID tidak memberi authority.

Actual provider credential dapat berupa API key/token, OAuth/service account, cloud workload identity, atau runtime/account session yang didukung adapter; material berasal dari secret manager/workload identity atau runner-local secret store. Secret/session material tidak boleh tampil di Admin UI, logs, browser bundle, plugin manifest, registration atau heartbeat. Database dapat menyimpan secret reference internal (bukan material); resource list/API projection mengecualikan reference tersebut. Injection harus minimum-scope dan minimum-lifetime.

Plugin package wajib diverifikasi digest/status sebelum materialization. Sandbox menolak host path traversal, undeclared mounts, host secret access, dan egress di luar policy. Cross-app acceptance harus membuktikan App A tidak dapat menggunakan profile, plugin, artifact, credential instance, atau connection milik App B.

Runner registration wajib authenticated dan node identity tidak boleh diambil alih hanya dengan spoofed heartbeat. Drain/disable adalah durable operator intent; stale node tidak kembali eligible hanya karena mengirim heartbeat lama.
