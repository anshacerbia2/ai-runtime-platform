# ADR-0011 — Isolated compute dan server-side policy

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** execution boundary [ADR-0002](0002-managed-envelope.md) dan pre-production verification [ADR-0013](0013-evolution-gates.md). Review baseline tetap dilacak melalui O11.

## Context
Agent tools can execute code/read files/network. Workspace directory and runtime prompts do not establish host/tenant isolation.

## Decision
Out-of-control-plane sandbox with approved image/package digest, least privilege, no host socket/mount secrets, scoped grants, egress policy, resource caps. Per-app/tenant auth on every resource. Credential/data policy reviewed before live use. Untrusted content cannot grant permissions. Sandbox technology selected and tested via threat model.

## Alternatives considered

API-process plugin execution and caller arbitrary pluginDir ditolak. Container-name as proof of security ditolak. Shared broad credentials in every worker ditolak.

## Consequences and trade-offs

Operational/security complexity increases but matches threat surface. Some runtimes need constrained feature support. Privacy retention and trace capture must be deliberately configured.

## Verification

G01/G18/G19/G24; [SECURITY](../security/SECURITY.md).

## Evolution / revisit trigger

Any host integration or expanded egress/credential scope requires review and repeating affected gates.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
