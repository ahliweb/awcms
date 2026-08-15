🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0004-rbac-abac-default-deny.id.md)

# ADR-0004 — RBAC + ABAC default-deny as the access baseline

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** `docs/awcms/17_default_seed_rbac_abac.md`, `docs/awcms/10_template_kode_coding_standard.md` (§ABAC guard)

## Context

Role-based access control (RBAC) alone is not enough for rules that depend on attributes (resource ownership, office scope, self-approval, environmental conditions). The access model must be secure by default and auditable.

## Decision

We decided to use **RBAC + ABAC** with the principles of **default deny** and **deny overrides allow**. RBAC gives a baseline permission per role (`module.activity.action`); ABAC filters further based on attributes. Every non-public endpoint must pass through the ABAC guard. Every **high-risk deny** decision is recorded in the decision log. RLS remains mandatory as a defence layer (see ADR-0003).

## Consequences

- **Positive:** secure by default; complex policies (scope, self-approval, masking) can be expressed as policy; access decisions are auditable.
- **Trade-off:** every endpoint needs an access declaration; the evaluator + policy store add complexity.
- **Neutral:** the default seed (roles, permissions, policies) is created by the setup wizard.

## Alternatives considered

- **RBAC only** — rejected: does not handle attribute-based rules.
- **Default allow + blacklist** — rejected: violates the secure-by-default principle.
