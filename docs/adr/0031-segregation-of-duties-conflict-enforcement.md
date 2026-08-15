🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0031-segregation-of-duties-conflict-enforcement.id.md)

# ADR-0031 — Generic segregation of duties (SoD), exception/override, and conflict enforcement for ERP

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision maker:** maintainer
- **Related:** Issue #181, epic #177 (derived ERP foundation readiness, Wave 2 authorization); ADR-0030 (business-scope hierarchy #180 — the foundation SoD is built on top of); ADR-0011 (capability port); ADR-0025 (module composition seam #178); ADR-0026 (modular OpenAPI); ported from awcms-mini Issue #746 (adapted, not copied).

## Context

An ERP needs separation of duties so that a single actor does not control the whole cycle of a risky transaction (creating a vendor and also approving its payment; creating a journal and also posting it; raising a requisition and also approving it). AWCMS already has default-deny RBAC, an ABAC baseline, the business-scope hierarchy (#180), the workflow self-approval guard, and audit — but it has no **generic SoD registry**, **conflict detection**, **exception workflow**, or **enforcement across assignment/action**.

This foundation is mature in awcms-mini (#746), but there SoD and business-scope were built **together**. #180 ported only the business-scope foundation and left a clean seam (`// SoD SEAM (#181)`); this ADR fills that seam.

## Decision

Port the generic SoD layer from mini, with these decisions:

1. **Versioned rule descriptor, code-only, contributed via the composition seam (#178).** `SoDRuleDescriptor` (`_shared/module-contract.ts`, `MODULE_CONTRACT_VERSION` 1.2.0 → 1.3.0) is trusted metadata declared by the owning module's `module.ts` — a pair/group of `conflictingPermissionKeys` (≥2), `scopeApplicability` (`same_scope_only`/`global_within_tenant`/`any`), `severity`, and `exceptionPolicy`. **The base NEVER hardcodes a domain rule** (out of scope for #181: finance/procurement/payroll/inventory). Rules flow through `listModules()` from domain modules (added directly to `src/modules/`, ADR-0034); the in-repo fixture (`tests/fixtures/example-domain-modules/`) contributes **≥5 illustrative examples** — not built-in base rules.
2. **Machine-readable registry gate → CI.** `identity-access/domain/sod-rule-registry.ts` aggregates + validates `listModules()` (owner matches, ruleKey unique, ≥2 keys, valid enums, consistent exceptionPolicy). Wired via `scripts/identity-access-sod-registry-check.ts` (`bun run identity-access:sod-registry:check`) into the `bun run check` chain **and** a CI step (parity with `reporting:projections:registry:check`). SoD registry drift (duplicate ruleKey / owner mismatch) turns CI red. The fixture rules are validated by `tests/sod-rule-registry.test.ts` (base + fixture composed), which also runs in `bun test`/CI.
3. **Pure conflict matcher, facts resolved outside (I/O separated from the decision).** `domain/sod-conflict-evaluation.ts` (`createSoDConflictEvaluator`/`detectSoDConflicts`) has no I/O; subject facts are resolved by `business-scope-facts.ts`. The matcher supports **hierarchy-aware** `same_scope_only` (facts in a resolved ancestor/descendant scope count as a match), `null`-scope facts (an ordinary RBAC grant) match in **every** scope, and `same_scope_only` without a `requestedScope` → **INDETERMINATE** (default-deny, not a silent "no conflict").
4. **Two fact sources.** A subject can hold conflicting permissions via a business-scope assignment **OR** an ordinary RBAC grant (`awcms_access_assignments`). `resolveSoDAssignmentFacts` merges both — otherwise the check is blind to the most common case (one role holding both sides of a conflict, e.g. the setup-wizard owner).
5. **Enforcement at TWO points.** **Assignment-time**: `createBusinessScopeAssignment` rejects (`sod_conflict`) a grant that completes an un-excepted conflict. **Action-time (fail-closed)**: `high-risk-sod-guard.ts` is wired into `authorizeInTransaction` for **every** high-risk action — deny-overrides-allow (it can only add a deny on top of an ABAC decision that already allowed). Conflicts are checked at **execution**, not only at assignment.
6. **Creator ≠ approver unless there is a sanctioned override.** The existing workflow self-approval guard (`evaluateAccess`, #147) stays; SoD adds creator/approver separation via generic rules. The only way a creator may pass a conflict on the same resource is a **valid exception**.
7. **An exception is a sanctioned administrative override.** The table `awcms_sod_conflict_exceptions` (tenant-scoped, RLS `ENABLE`+`FORCE`). Exceptions are **scope-bound** (blanket vs scope-specific), **time-bound** (`effective_to` NOT NULL — no indefinite override), **revocable**, and audited at `critical`. **They may not be self-approved**: approval requires the `business_scope_exceptions.approve` permission (dedicated, distinct from `.create`) **and** approver ≠ requester **and** approver ≠ subject/beneficiary (both re-checked from the DB row, never trusted from the body). Both independence axes are mandatory: the create route accepts an arbitrary `subjectTenantUserId` (a requester may file on behalf of another subject), so without the approver ≠ subject check a beneficiary who happens to hold `.approve` could approve their own bypass (a finding from the adversarial review of #181). A rule may forbid exceptions (`allowed: false`) — e.g. maker/checker over the override mechanism itself.
8. **Expired/revoked stops applying IMMEDIATELY.** `isSoDConflictExceptionCurrentlyValid(row, now, scope)` is the authoritative gate (status is only a cache; `effective_to` vs `now` is what is real). The scheduled job (`identity-access:business-scope:expiry`, a new pass in the sql/029 worker grant) only flips `status` as housekeeping.
9. **Append-only decision log.** `awcms_sod_conflict_evaluations` (RLS FORCE) records **every** conflict check (assignment_create + high_risk_decision) whatever the outcome — a safe projection (rule key, subject, trigger, outcome, reason, timestamp; no request/resource payload). The preview route `GET /conflicts` is keyset-paginated.
10. **Tenant isolation in TWO layers.** The subject/requester/approver FKs are **composite `(tenant_id, …)`** to `UNIQUE (tenant_id, id)` (PostgreSQL RI checks bypass RLS — GHSA-r7cx-c4jh-cvvw), + RLS FORCE. A tenant A exception **cannot** be used by tenant B — proven under the non-superuser role `awcms_app`.
11. **Bounded, non-N+1 evaluation.** Facts are resolved in a fixed number of SELECTs (two per check: business-scope + RBAC), exception lookup is batched into one query for many rule keys, and detection is indexed in memory. The query count does **not** grow with the number of the subject's permissions/assignments — proven by a query-count test (small subject == large subject).
12. **Cache invalidation = no cache.** Conflict/exception facts are resolved fresh per decision (not cached in memory), so a change to an assignment/rule/exception/hierarchy is reflected immediately in the next decision.

## Scope boundaries (DELIBERATELY not ported)

- **No domain rules in the base.** The base only ships the mechanism; finance/procurement/payroll/inventory rules live in the derived application.
- **No arbitrary expressions/SQL from a tenant.** Rules are static code-only data, not expressions evaluated at runtime.
- **Not a replacement for RBAC/ABAC.** SoD is an additional restricting layer (deny-overrides), not a grant.
- **Admin UI.** No UI in the base yet; API only. A registry/preview/exception UI is the derived application's work / a follow-on issue.

## Consequences

- Two new tables with RLS `ENABLE`+`FORCE` (`sql/029`) + a permission seed (`sql/030`); the worker grants are extended by one table (`awcms_sod_conflict_exceptions`) in `scripts/security-readiness.ts` `WORKER_ROLE_GRANTS`.
- `MODULE_CONTRACT_VERSION` rises 1.2.0 → 1.3.0 (additive: `sodRules` + the `SoDRule*` types).
- `authorizeInTransaction` gains an optional `sodRules` option (default = the composed registry); the `reject` action is added to the `AccessAction` union (not high-risk — rejecting an exception is a safe outcome).
- Six new OpenAPI operations in the `identity-access` fragment (`conflicts` + `exceptions/*`), bundle + docs regenerated; no domain events (no AsyncAPI change).
- Enforcement starts to bite in tenants whose role composition **already** holds both sides of a conflict once a derived rule is active — that is the correct behaviour, not a regression.

## Threat model in brief

- **Privilege accumulation** — one subject accumulates both sides of a conflict over time/across roles: detected via the merged facts (assignment + RBAC), rejected at assignment-time + action-time.
- **Collusion** — creator & approver collude: bounded by maker/checker (a dedicated approve permission, approver ≠ requester), an override requires an exception audited at `critical`.
- **Stale exception** — an expired/revoked override is still used: the `effective_to` vs `now` gate (status is only a cache) makes expired/revoked stop applying immediately.
- **Self-approval** — the requester OR the subject/beneficiary approves an exception that benefits themselves: rejected on both axes (approver ≠ requester AND approver ≠ subject; re-checked from the DB row, not the body).
- **Cross-tenant exception** — a tenant A exception used by tenant B: composite FK + RLS FORCE, proven under `awcms_app`.
