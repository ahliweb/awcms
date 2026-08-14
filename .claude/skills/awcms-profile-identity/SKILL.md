---
name: awcms-profile-identity
description: 'PARTLY READ-ONLY — only the foundation (Issue 2.2: profile CRUD, identifier, entity link, `sql/003`) exists in this repo; the entire Issue #748 layer described below (merge workflow, party-to-party relationships, duplicate detection, merge history) LIVES IN awcms-mini and has NOT been ported here. Use when changing profile CRUD/identifier/masking/cross-tenant guard, OR when BUILDING the #748 layer here — the #748 parts of this skill are a target specification, not a description of code you can call today. ADR-0055 (2 August 2026) revokes the "port from mini" path: the archive may be read as a specification, but the #748 layer is built in this repo with its own admission ADR.'
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Profile Identity Module

`profile_identity` (`src/modules/profile-identity`) is the CANONICAL party
(person/organization) lifecycle. Read
`src/modules/profile-identity/README.md` for the actual state of this repo;
this skill summarises the security invariants (cross-tenant guard,
self-approval, field-conflict snapshot) that MUST be preserved.

## STATUS — read this first, two layers with DIFFERENT realities

| Layer                                                                                                                                                                                                  | In this repo                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Foundation (Issue 2.2, `sql/003`)** — `awcms_profiles`, `awcms_profile_identifiers`, `awcms_profile_entity_links`, masking, resolve                                                                  | **EXISTS** — real code, may be used as an implementation reference.                                                                                                                                                                                                |
| **Issue #748** (epic `platform-evolution` #738 Wave 2) — merge workflow, `profile_relationships`, `profile_duplicate_candidates`, `profile_merge_requests`/`_history`, effective-dated channel/address | **DOES NOT EXIST** — it lives in awcms-mini (migration 059 there) as an ARCHIVE that may be read; building it here requires an admission ADR (ADR-0055). The tables, endpoints, `domain/merge.ts`, `domain/relationship.ts` mentioned below **have no file here**. |

Consequently, do not: (1) call/import `domain/merge.ts`,
`domain/relationship.ts`, `application/merge-workflow.ts`,
`duplicate-candidate-directory.ts`, or
`_shared/ports/party-directory-port.ts` — they do not exist in this repo;
(2) `SELECT` from the merge/relationship/duplicate-candidate tables;
(3) claim to the user that the merge workflow "already exists". This module's
`README.md` lists them under §"Not yet available" — that is what is accurate. The
rest of this skill is useful as a **target specification** (which invariants MUST
come along when the #748 layer is BUILT here, ADR-0055 §1) — not as a code map.

## When to use this skill vs the generic skills

It complements `awcms-sensitive-data` (normalize/hash/mask identifier —
`domain/identifier.ts` in this module is an EXAMPLE implementation of that pattern),
`awcms-abac-guard` (the self-approval guard is reused here),
`awcms-idempotency`. This skill supplies the merge-workflow and
cross-tenant guard context specific to this module.

## Tables (`sql/003` foundation = EXISTS; tables marked **[#748 — mini]** = DO NOT EXIST here yet)

- `awcms_profiles` — canonical profile, soft delete,
  `merged_into_profile_id` for merge results, `status`
  (`active`/`inactive`/`merged` — `merged` is ONLY set by merge
  execution, it cannot be set through `PATCH`).
- `awcms_profile_identifiers` — sensitive identifiers (email/phone/
  whatsapp/national_id/tax_id/external_code), dedup via `value_hash`
  (partial unique per tenant+type while not soft-deleted),
  `masked_value` for safe display. The `provenance`/`verified_at`/
  `verified_by`/`valid_from`/`valid_until` columns = **[#748 — mini]**, they do not
  exist in this repo's `sql/003`.
- **[#748 — mini]** `awcms_profile_channels` — channel preferences, referring
  to `profile_identifiers` (does NOT duplicate the sensitive value);
  `is_default` = the "preferred channel per type" flag.
- **[#748 — mini]** `awcms_profile_addresses` — addresses per profile,
  effective-dated.
- `awcms_profile_entity_links` — links a profile to another module's
  entity (`module_key`/`entity_type`/`entity_id`), unique per entity — the
  REFERENCE SET that is repointed when a merge is executed.
- **[#748 — mini]** `awcms_profile_relationships` — effective-dated
  party-to-party relationships, GENERIC: `relationship_type` is free snake_case
  text, there is NO CHECK enum of business roles (customer/supplier/employee). An
  authorized representative is merely a relationship row with `is_authorized_representative = true`.
- **[#748 — mini]** `awcms_profile_duplicate_candidates` — duplicate
  candidates: `match_basis`/`match_score`/`match_reasons` (jsonb, ALWAYS
  explainable), `status` (`pending`/`confirmed_duplicate`/`not_duplicate`).
  The pair is stored ordered (`profile_id_a < profile_id_b`).
- **[#748 — mini]** `awcms_profile_merge_requests` — `source`(loser)/`target`(survivor),
  `source_profile_id <> target_profile_id` (DB constraint + `domain/merge.ts`),
  `requires_approval`, `field_conflict_snapshot`, `reference_impact_snapshot`.
  The permission `profile_identity.profile_management.restore` is already seeded by
  `sql/005` here but has no consumer yet — do not conclude from the
  existence of a permission that its endpoint/table exists.
- **[#748 — mini]** `awcms_profile_merge_history` — **append-only,
  immutable**, SEPARATE from `merge_requests` whose status is mutable.
  The basis for an operator to reason about/recover from an erroneous merge.
- `awcms_profile_audit_logs` — **does not exist in this repo at all** (in
  mini it is dead schema: declared but never written by any code; here
  `sql/003` does not declare it). High-risk auditing goes through the `logging`
  module's `recordAuditEvent`/`awcms_audit_events`. Do not recreate this
  table "because the skill mentions it".

The tenant-scoped tables of `sql/003` get `ENABLE`+`FORCE ROW LEVEL SECURITY`
via `sql/017_awcms_enforce_rls_force.sql` (Issue #139 — before that only
`ENABLE`, which is **inert** while the app connects as the table owner). If you are
investigating "when did RLS FORCE start applying to the profile tables" in
THIS repo, the answer is `sql/017` — not migration 013 (that number is mini's
numbering for `enforce_rls_least_privilege`; here 013 is workflow approval).
Note that `FORCE` alone is still not enough: superuser/BYPASSRLS still bypasses it —
see the header of `sql/019_awcms_db_role_separation.sql` (Issue #141) for the
`awcms_app` role that makes this policy genuinely evaluated.

## [#748 — mini] Merge workflow — 3 steps, approval MANDATORY on every merge

> This entire § describes code in **awcms-mini**. In this repo there is not yet
> a single merge endpoint/function. Read it as a contract that MUST be
> preserved when porting, not as an API you can call.

1. **Create** (`profile_merge.create`) — `sourceProfileId` (loser) +
   `targetProfileId` (survivor) + `reason`. Computes and stores the
   `field_conflict_snapshot` (fields that differ between the profiles —
   for review ONLY, this base has NO per-field pick-and-choose UI;
   the SURVIVOR's value always wins) and `reference_impact_snapshot`
   (the number of `profile_entity_links` per module/entity type that will
   be repointed).
2. **Approval** (`profile_merge.approve`) — **EVERY** merge in this base
   requires approval (`computeRequiresApproval()` is ALWAYS `true` — a strict
   superset of "only high-risk merges need approval", avoiding a risk
   heuristic that could be wrong). The generic self-approval guard
   (`identity-access/domain/access-control.ts`) prevents the requester from
   approving their own request.
3. **Execute** (`profile_merge.merge`, an ABAC action SEPARATE from
   `.approve`) — high-risk: `Idempotency-Key` mandatory, PLUS a row lock
   (`SELECT ... FOR UPDATE`) on `merge_requests` that serialises a SECOND
   concurrent execution (even with a DIFFERENT idempotency key) so that
   the second call sees `status = 'completed'` and returns the existing
   result rather than executing again. **The loser's and survivor's tenants
   are re-validated exactly at the point of execution** (`assertSameTenant`), never
   trusting anything stored in the request — see
   §Cross-tenant guard below.

Execution effects: the loser's `profile_entity_links` are repointed to the survivor
(rows that collide with an existing survivor link are deleted as pure
duplicates), the loser is soft-deleted with `status = 'merged'` +
`merged_into_profile_id`, an immutable `profile_merge_history` row is written,
and the domain event `awcms.profile-identity.profile.merged` is published.

### Merge recovery strategy — there is NO "undo" button

A merge **does not hard-delete** — the loser remains as a soft-deleted row
with `merged_into_profile_id`. A full AUTOMATIC un-merge is **not
provided** — recovery requires: (1) reading `profile_merge_history` for the
survivor/loser + snapshots; (2) the repointed `profile_entity_links` are still
identifiable through the same `module_key`/`entity_type`/`entity_id` (their
profile_id has changed); (3) rewriting the links + restoring the loser
MANUALLY/deliberately — the audit trail above is what the operator
needs, not an automatic mechanism. **Do not promise/build a one-click
"undo merge" button without an explicit new issue.**

## [#748 — mini] CRITICAL — cross-tenant guard, TWO layers, both mandatory

Cross-tenant matching/merging is STRICTLY FORBIDDEN. Enforced in mini through two
independent layers — **a MANDATORY contract that must come along when the #748 layer is built
here**, not code already running in this repo:

1. **RLS** (`FORCE ROW LEVEL SECURITY`) — an ordinary application-role connection
   will never see another tenant's rows at all.
2. **`domain/merge.ts`'s `assertSameTenant`/`CrossTenantMergeError`** —
   called AGAIN in `application/merge-workflow.ts`'s
   `createMergeRequest` AND `executeMergeRequest`, against rows
   re-fetched inside the same transaction, never trusting the
   tenant id carried by an older object. `fetchPartyForMerge` DELIBERATELY does NOT
   filter `tenant_id` in its `WHERE` (relying on RLS for the normal
   path) precisely so that this second layer is GENUINELY tested through a test
   against a privileged connection (RLS bypassed) — in mini:
   `tests/integration/profile-identity.integration.test.ts`'s test
   "application-layer guard: assertSameTenant/CrossTenantMergeError fires
   even when RLS is bypassed". **This repo has no `tests/integration/`
   at all yet (Issue #154)** — porting the #748 layer without porting that test
   means the second guard is unverified. **A new merge/match endpoint must
   call `assertSameTenant` at the point of execution, do not rely on RLS
   alone** — RLS is the first layer, not the only one.

`duplicate-candidate-directory.ts`'s scan is also always scoped to the same
`tenant_id` on both sides of the query — there is no path that compares
profiles across tenants.

## Business roles are NOT hardcoded (an explicit requirement of Issue #748)

This applies to BOTH layers. There is no table/column/enum in this module that
encodes a contextual business role (customer/supplier/employee/donor/
merchant/student/patient). **[#748 — mini]** `relationship_type` is free text
validated for FORMAT only; `domain/relationship.ts` (mini) even explicitly REJECTS
a few business-role words as a defensive guard against
regression. Derived applications are free to
build domain-specific semantics ON TOP of these generic relationships — **do not
add any business-role CHECK constraint/enum to this base module.**

## Projection contract (`domain/projection.ts`)

In this repo `domain/projection.ts` exports **one** contract:
`PartyMaskedAdminDTO` (admin API — WITHOUT `tenantId`/actor id) +
`toPartyMaskedAdminDTO`. **A new endpoint/response must use it
explicitly** — do not invent a new ad-hoc DTO shape that leaks internal
fields.

**[#748 — mini]** `PartyFullDTO` (internal) and `PartyPublicSafeDTO` (3
fields only: `id`/`profileType`/`displayName`, `null` for
soft-deleted/merged/inactive profiles) **do not exist here yet** — if you need a
public-safe projection, port `PartyPublicSafeDTO` from mini as-is, do not create a
new variant.

## [#748 — mini] Capability port — DOES NOT EXIST in this repo yet

`_shared/ports/` here contains only `workflow-condition-port.ts` and
`workflow-notification-port.ts`. `party-directory-port.ts`
(`PartyDirectoryPort` — `exists`/`resolveSummary`/`resolveMergeSurvivor`
following the `merged_into_profile_id` chain/`resolvePublicSafeSummary`),
its adapter, and the `legal-hold-guard-port.ts` mentioned as a precedent
all exist in mini only. **Do not `import` any of them in this repo** —
port it first if it really is needed.

## Common pitfalls

1. Do not set `status: merged` through `PATCH` — only merge execution
   may set that field (`domain/party-validation.ts` rejects it).
2. Do not add a raw identifier reveal endpoint — it is not in any scope
   yet, `masked_value` is the only read form allowed
   today.
3. Do not assume `awcms_profile_audit_logs` is the source of the audit
   trail — that table does not exist here at all; use
   `recordAuditEvent`/`awcms_audit_events`.
4. Do not build merge/match without calling `assertSameTenant` again at
   the point of execution, even though RLS "should" already prevent it.
5. Do not add a business-role CHECK enum to `relationship_type` or any
   other table in this module.
6. If you are tracing "when RLS FORCE started applying" for the `sql/003` tables
   **in this repo**, the answer is `sql/017` (Issue #139). The numbers 013/059 that
   circulate in legacy documents are awcms-mini's numbering.
7. **Do not treat the §sections marked [#748 — mini] as existing code.**
   Verify against `src/modules/profile-identity/` + `sql/003` first before
   calling/claiming anything from there.

## Verification

This repo **has no `tests/integration/` at all yet** (Issue #154) —
including the `profile-identity.integration.test.ts` mentioned above; that one
belongs to mini. What exists here: unit tests `tests/*.test.ts` (run
`bun test`). When porting the #748 layer, the cross-tenant guard test that
deliberately bypasses RLS (privileged connection) is a MANDATORY part of the port — not
optional — because it is the only thing that proves the second layer is
independent of RLS.

## Not yet available in this repo

The entire #748 layer (see §STATUS), plus — deliberately out of scope even in
mini — a raw identifier reveal endpoint (raw value), automatic un-merge,
full-text search (still substring `ILIKE`), and business roles/domain
entities (customer/supplier/etc.).
