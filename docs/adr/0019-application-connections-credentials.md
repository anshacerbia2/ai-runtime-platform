# ADR-0019 — Application Registry, AI Connections, dan Credential Binding

**Tanggal:** 21 September 2026 (Asia/Jakarta)

**Status:** adopted in documentation; implementation mulai P1.

## Context

Platform harus melayani banyak aplikasi tanpa membiarkan caller memilih provider credential, akun AI, atau secret secara bebas. Semua aplikasi menggunakan Keycloak untuk identity, tetapi identity caller dan identity yang dipakai platform ke provider AI adalah dua trust boundary berbeda.

## Decision

AI Runtime Platform memiliki Application Registry, AI Connection Registry, dan server-side Credential Binding. Keycloak menjawab siapa caller; AI Connection menjawab dengan account/credential apa platform mengakses provider/runtime.

Satu logical AI Connection dapat memiliki banyak credential instance dan banyak runner binding. Connection boleh dedicated ke satu application/profile atau shared melalui explicit allow-list. Sharing tidak pernah implicit.

Actual secret tidak disimpan sebagai plaintext di PostgreSQL. Durable metadata menyimpan secret reference atau workload-identity reference; material credential berasal dari Vault/Secret Manager/KMS-backed mechanism atau runner-local store. Auth mode dapat berupa API key/token, OAuth/service account, cloud workload identity, atau runtime/account session yang secara eksplisit didukung adapter; browser-style SSO/session tidak dianggap portable credential secara otomatis.

Caller hanya meminta capability/profile. Provider, model policy, AI connection, credential instance, dan runner dipilih server-side berdasarkan authenticated application, profile, policy, locality, health, dan capacity.

## Consequences

App A tidak dapat menggunakan connection App B walaupun mengetahui identifier-nya. Admin UI menampilkan applications, connections, bindings, credential residency, health, dan audit tanpa menampilkan secret. Credential dapat central-managed atau runner-local. Logical account yang sama dapat tersedia di beberapa server melalui credential instance berbeda.

## Verification

Acceptance mencakup cross-app denial, profile/connection denial, secret non-disclosure, disabled binding, credential rotation, runner-local locality, dan shared-upstream quota accounting.

## Revisit trigger

Revisit bila organisasi mengganti IAM, secret manager, atau provider menawarkan workload identity yang menghilangkan long-lived credential.
