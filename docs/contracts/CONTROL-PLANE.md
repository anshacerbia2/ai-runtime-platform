# Control Plane Management Contract

Dokumen ini mendefinisikan target management surface untuk satu AI Runtime Platform. Ini bukan API M0 yang sudah live.

## 1. Managed resources

- **Application** — mapping identity aplikasi, environment, status, allowed profile/policy scope.
- **Execution Profile** — immutable/revisioned execution policy.
- **AI Connection** — logical provider/runtime account atau project.
- **Credential Instance** — concrete auth binding/reference untuk sebuah AI Connection.
- **Credential Binding** — authorization application/profile terhadap connection/credential scope.
- **Plugin Package/Version** — immutable execution artifact dan compatibility metadata.
- **Runner Pool/Node** — distributed execution capacity dan capability advertisement.
- **Policy/Budget/Audit** — control, chargeback, operational evidence.

## 2. Identity separation

Keycloak identity menjawab siapa operator/app caller. AI Connection menjawab identity/credential apa yang platform gunakan ke provider/runtime. Keduanya tidak boleh dicampur.

Application caller tidak memperoleh management authority. Operator/admin route menggunakan role/permission terpisah dan semua perubahan policy/binding harus diaudit.

## 3. AI connection and credential model

Satu AI Connection dapat mempunyai banyak credential instances dan banyak runner bindings. Auth mode dapat berupa API key/token, OAuth/service account, cloud workload identity, atau runtime/account session yang secara eksplisit didukung adapter.

Actual secret/session material tidak dikembalikan oleh management API. Durable record menyimpan secret/workload-identity reference atau runner-local residency metadata.
Dedicated connection hanya dapat di-bind ke application/profile yang diizinkan. Shared connection membutuhkan explicit allow-list dan `quota_group_ref` bila instances berbagi upstream rate-limit/account quota.

## 4. Plugin and workspace controls

Plugin version memiliki artifact reference, digest/signature status, runtime compatibility, permissions, dan lifecycle state. Operator dapat publish, deprecate, atau revoke version tanpa memodifikasi artifact immutable.

Workspace policy bersifat optional per profile: `none`, `ephemeral`, atau `artifact_workspace`. MCP/remote-tool endpoint bukan mandatory property aplikasi.

## 5. Runner fleet controls

Runner self-register secara authenticated dan mengiklankan pool, runtime/capability, connection refs, version, region/environment, dan capacity. Heartbeat tidak membawa secret.

Operator dapat melakukan drain, disable, atau inspect runner. `DRAINING` menghentikan assignment baru. `OFFLINE` adalah derived liveness state; `DISABLED` adalah durable policy.

Placement engine menggunakan profile, connection/credential locality, runner capability/capacity, region/data policy, version, lifecycle state, dan upstream quota group.

## 6. Admin UI minimum views

Panel minimum: Applications, Profiles, AI Connections, Credential Bindings, Plugins, Runner Fleet/Pools, Budgets/Policies, Executions, Usage/Audit.

Connection detail menunjukkan allowed apps/profiles, auth mode tanpa secret, credential residency, runner availability, quota group, health, dan aggregate usage. Runner detail menunjukkan capabilities, bound connections, capacity, heartbeat, lifecycle, version, dan active executions.

## 7. Safety invariants

- caller tidak dapat memilih credential instance atau runner yang tidak diizinkan profile;
- mengetahui resource ID tidak memberi authority;
- secret tidak masuk browser/log/plugin manifest/heartbeat;
- app A tidak dapat menggunakan connection/profile/plugin app B;
- runner-local secret hanya membuat runner yang benar eligible;
- duplicate runner registration tidak mengambil alih identity aktif tanpa authenticated ownership protocol;
- menambah runner untuk quota group yang sama tidak memperbesar upstream quota secara asumsi.

## 8. M1 management operations

M1 mengimplementasikan operator-scoped read/mutation untuk Applications, AI Connections, Credential metadata, Bindings, Execution Profiles/aliases, Budgets, Runner Pools/Nodes, audit read, durable admission/cancel intent, usage/accounting evidence, artifact metadata, dan inbox/outbox processing. Mutations memakai revision/CAS dan menghasilkan audit evidence; application caller tidak memperoleh management authority.

Plugin management dan P3 runner placement/heartbeat execution tetap di fase berikutnya. Concrete secret-manager product, live Keycloak client registration, dan production health/rotation policy tetap deployment/open-decision work; API tidak mengembalikan secret material.

Related decisions: [ADR-0019](../adr/0019-application-connections-credentials.md), [ADR-0020](../adr/0020-plugin-registry-execution-packaging.md), [ADR-0021](../adr/0021-workspace-remote-tools.md), [ADR-0022](../adr/0022-distributed-runner-fleet.md).
