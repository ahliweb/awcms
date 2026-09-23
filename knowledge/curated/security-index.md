🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](security-index.id.md)

# Security index

Pointers into the security posture, not a restatement of it.

- **Baseline rules (RBAC/ABAC default-deny, RLS, idempotency, audit,
  masking):** [`../../AGENTS.md`](../../AGENTS.md) §"Aturan wajib".
- **The authorization chokepoint (every protected route MUST go through
  both):** ADR-0003, ADR-0004, ADR-0063 —
  [`../../docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md`](../../docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md).
- **Vulnerability reporting:** [`../../SECURITY.md`](../../SECURITY.md).
- **Sensitive modules requiring extra review before merge:** `auth`,
  `access`, `sync`, `finance`, `hr-payroll` — see
  [`../../AGENTS.md`](../../AGENTS.md) §"Guardrail keamanan".
- **Knowledge-graph-specific threat model** (secrets accidentally indexed,
  semantic extraction sending docs to an external provider, query
  logs/caches leaking context, stale graph treated as truth, prompt-injection
  via untrusted repo text, Obsidian export overwriting curated notes):
  [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  §Security and privacy, and ADR-0124.
