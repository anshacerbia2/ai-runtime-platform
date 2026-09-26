# ADR-0011 — Isolated compute dan server-side policy

**Tanggal:** 20 September 2026  
**Status:** design adopted for baseline 0.2; current implementation coverage is stated below, not a blanket production verification.\
**Dasar:** execution boundary [ADR-0002](0002-managed-envelope.md) dan pre-production verification [ADR-0013](0013-evolution-gates.md). Review baseline tetap dilacak melalui O11.

## Implementation reconciliation — 24 September 2026

API/BFF authentication, authorization, bounded transport and secret projection have local coverage. Sandbox containment, runtime egress controls and host escape tests remain planned. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

Agent tools can execute code/read files/network. Workspace directory and runtime prompts do not establish host/application isolation.

## Decision

Out-of-control-plane sandbox with approved image/package digest, least privilege, no host socket/mount secrets, scoped grants, egress policy, resource caps. Per-application auth on every resource. Credential/data policy reviewed before live use. Untrusted content cannot grant permissions. Sandbox technology selected and tested via threat model.

## Alternatives considered

API-process plugin execution and caller arbitrary pluginDir ditolak. Container-name as proof of security ditolak. Shared broad credentials in every worker ditolak.

## Consequences and trade-offs

Operational/security complexity increases but matches threat surface. Some runtimes need constrained feature support. Privacy retention and trace capture must be deliberately configured.

## Verification

G01/G18/G19/G24; [SECURITY](../security/SECURITY.md).

## Evolution / revisit trigger

Any host integration or expanded egress/credential scope requires review and repeating affected gates.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
