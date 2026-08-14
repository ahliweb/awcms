---
name: awcms-document-infrastructure
description: **ADR-0055 (2 August 2026): this is a BUILD-IT-HERE candidate, not a port.** `awcms-mini`/`awcms-micro` are now ARCHIVES — they may be read as a specification, but the "port from mini" path is REVOKED. Working on it means: ADR admission first, then build it in this repo under the ADR-0055 §3 guardrails (ADR mandatory, security review for auth/access/sync, full `bun run check`, OpenAPI/AsyncAPI in sync, RLS FORCE, ABAC default-deny). READ-ONLY / TARGET SPECIFICATION — the document_infrastructure module DOES NOT EXIST in this repo (it exists in awcms-mini; `ls src/modules` does not contain `document-infrastructure`, and there is no migration for it in `sql/`). The module/table/`sql/NNN` references inside are awcms-mini artifacts, using mini numbering. Use it as the target specification when BUILDING it here (ADR admission first), not as a guide to code you can call — verify `ls src/modules` first. Port context (Issue #751, epic platform-evolution #738 Wave 3; fast-follow #780/#787/#795/#798). Use when adding endpoints/logic to src/modules/document-infrastructure, linking documents to another module's resources through the document_resource_relations capability port, changing numbering sequences/reservations, or changing confidentiality-tier gating. Summarises the concurrency and idempotency-hash-binding invariants that have already been fixed so they are not regressed.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Document Infrastructure Module

<!-- sql-refs: awcms-mini — module not yet ported; every `sql/NNN` in this file is awcms-mini numbering, not this repo's -->

> **STATUS — READ-ONLY: this module has NOT been ported into this repo.**
> `document_infrastructure` lives in **awcms-mini**, not here:
> `ls src/modules` does NOT contain `document-infrastructure`, and `sql/` does not
> contain its migrations. Every reference to `src/modules/document-infrastructure/...`,
> the `awcms_document*`/`awcms_documents` tables, and `sql/NNN` below are
> awcms-mini artifacts — **do not `import`/`SELECT`/claim they exist** in this
> repo. The `sql/NNN` numbers use awcms-mini numbering and will change when
> ported (continuing from this repo's last migration). Use this skill
> as the target specification for the port (via ADR admission; `awcms-port-from-mini` is HISTORICAL), not as a map of
> code you can call. Verify `ls src/modules` before claiming
> anything exists.

`document_infrastructure` (`src/modules/document-infrastructure`, Issue #751,
epic `platform-evolution` #738 Wave 3, admission decision
`docs/adr/0017-document-infrastructure-module-admission.md`) is an
**Official Optional Module** — generic document metadata infrastructure,
tenant-scoped, opt-in per tenant, reusable by any module/derived
application. Read `src/modules/document-infrastructure/README.md` for the full
detail of every table/endpoint; this skill summarises the invariants that are
**not obvious from reading a single file** — numbering concurrency,
confidentiality-tier gating, and idempotency-hash binding (a bug class that
slipped past 2 different security-review rounds in this very module).

## When to use this skill vs the generic skills

This skill complements (does not replace) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-idempotency`, `awcms-abac-guard`.
Use this skill for `document_infrastructure`-specific domain context:
when to use the capability port vs when to create a new relation table, the
numbering invariants, and the list of endpoints that MUST have idempotency-hash
resource binding.

## Purpose & scope boundary — what this module NEVER builds

- It does **not** implement domain document schemas (letters, invoices,
  purchase orders, journal batches, medical records, contracts) — those stay
  owned by their respective domain modules.
- It does **not** store binary document content bytes in a PostgreSQL column —
  `content_reference`/`content_reference_kind` only point at an already-approved
  managed-object storage contract (e.g. `sync_storage`'s object
  queue key, or an external URL/system reference).
- It does **not** implement electronic signatures/TTE, records-management
  certification, or one universal retention schedule (`retention_reference`
  is free text mapped manually to `data_lifecycle`, ADR-0017 §4 — not an
  FK/capability call).
- It does **not** import from or write to another module's tables directly —
  cross-module collaboration goes ONLY through the `document_resource_relations`
  capability port (see below). There is no `consumes` — see ADR-0017 §4/§10 for
  why there is no hard dependency on `data_lifecycle`/`workflow_approval`/
  `sync_storage`.

## Tables (`sql/066`–`068`)

1. `awcms_document_classifications` — tenant-scoped classification catalog
   (`code`/`name`/`confidentiality_level`/`retention_reference`).
2. `awcms_documents` — document registry: `owner_module_key`/`document_type`
   (opaque strings, this module NEVER reads another module's tables), status
   (`active`/`superseded`/`archived`/`void`), confidentiality level,
   the PRIMARY generic resource reference (`resource_type`+`resource_id`).
   `current_version_number` is a denormalized cache updated ONLY by
   `application/document-version-service.ts`.
3. `awcms_document_versions` — **IMMUTABLE, APPEND-ONLY** (no
   `updated_at`/`deleted_at` columns, no `UPDATE`/`DELETE` against
   this table anywhere in the module). A correction = a new version with
   `previous_version_id` pointing backwards.
4. `awcms_document_resource_relations` — ADDITIONAL typed relations from
   a document to another module's resources, OUTSIDE the primary reference above.
   Written ONLY through the capability port.
5. `awcms_document_number_sequences` — numbering sequence definitions,
   effective-dated (SCD Type 2, same pattern as `awcms_organization_unit_hierarchies`)
   — revising the format NEVER resets/reuses the counter.
6. `awcms_document_number_reservations` — one row per number that has
   ever been allocated (reserved -> committed OR canceled).
   `UNIQUE (tenant_id, sequence_id, reserved_number)` structurally guarantees
   "a number is never reused".
7. `awcms_document_evidence` — APPEND-ONLY evidence trail for document
   numbering/version/lifecycle events.

All seven tables: `tenant_id` + `ENABLE`+`FORCE ROW LEVEL SECURITY` + tenant-first
index + read-only `awcms_worker` grant.

## Concurrency-safe numbering — invariants that must be preserved

`application/document-number-reservation-service.ts`'s `reserveNumber`
locks the CURRENTLY OPEN sequence definition row
(`SELECT ... FOR UPDATE ... WHERE effective_to IS NULL`) before
reading/incrementing `current_value`. Two concurrent callers on the SAME
sequence are automatically serialized by the Postgres row lock — the second
caller can only read after the first transaction commits/rolls back.
`UNIQUE (tenant_id, sequence_id, reserved_number)` is the database-level
backstop: even if the lock were somehow bypassed, a duplicate would fail
with a unique violation rather than silently allocating twice.
Proven by a REAL concurrency test (not merely documented) in
`tests/integration/document-infrastructure.integration.test.ts` — several
parallel requests are genuinely sent to the same API handler, and the result is
verified to contain no duplicate numbers. **Do not** replace `SELECT ... FOR
UPDATE` with optimistic locking (a `version` column check) for
"performance" — the pessimistic serialization here is deliberate; sequence
numbering is a case where losing one update means a duplicate/missing document
number, not merely a stale read.

The number format (`format_template`, e.g. `INV/{YYYY}/{SEQ:6}`) is validated
by a RESTRICTED token grammar (`domain/number-format-template.ts`) — the parser
scans single characters manually, no `eval`/free-form regex/dynamic code. The
supported tokens: `{SEQ}`/`{SEQ:n}` (n=1-12), `{YYYY}`, `{YY}`, `{MM}`, `{DD}`.

## Capability port — `document_resource_relations`

`application/document-resource-relation-port.ts` exports
`linkDocumentToResource`/`unlinkDocumentFromResource`/
`listRelationsForResource`/`listRelationsForDocument` — OTHER modules
IMPORT and CALL these functions directly (in-process, the same ADR-0011 pattern
as `blog_content`↔`media_library`) to link documents to
their own resources. This module never reads/writes the calling module's
tables, and the calling module never writes directly
into `awcms_document_resource_relations` (ADR-0013 §6
no-shared-table-write). `ownerModuleKey`/`resourceType`/`resourceId`
are OPAQUE strings to this module — the CALLING module is responsible for
only ever passing ids it has already validated as belonging to its own tenant.

Proven reusable: `tests/integration/document-infrastructure.integration.test.ts`
demonstrates this module being reused for FIVE DIFFERENT domain
scenarios (correspondence evidence, contract attachment, invoice reference,
approval evidence, asset-disposal evidence) without this module ever
knowing/importing any domain rule — only the
`ownerModuleKey`/`documentType`/`resourceType` strings differ, not
different schemas/tables.

## Confidentiality-tier gating (security-review Critical, PR #780; extended by Issue #787)

`GET /documents`, `GET /documents/{id}`, `GET /documents/{id}/versions`,
`GET /documents/{id}/relations`, `GET /evidence`, `GET /reservations`
all enforce `confidentiality_level` — the base permissions
(`documents.read`/etc.) only grant access to `public`/`internal` rows;
reading `confidential`/`restricted` requires the ADDITIVE extra permissions
`documents_confidential.read`/`documents_restricted.read`
(`068_awcms_document_infrastructure_confidentiality_permissions.sql`,
same pattern as `visitor_analytics.raw_detail.read`). Rows beyond the caller's
clearance return a result IDENTICAL to "not found" (omitted
from lists, `404` for a single fetch) — they never confirm
their existence. Since Issue #787, MUTATION endpoints (`void`/`restore`/
`reclassify`/`versions.create`/`relations.assign`/`relations.revoke`) ALSO
require clearance tier against the document's CURRENT confidentiality level
AS A PRECONDITION (not a new write-tier permission — ADR-0017
§7) before the action-specific permission is evaluated further. A new
endpoint that reads/mutates documents **must** follow this tier-check pattern
— do not check only the action permission without checking the tier.

## CRITICAL — idempotency-hash resource binding (Issue #795, PR #798)

A recurring bug class (see also skill `awcms-idempotency` §CRITICAL):
`computeRequestHash` for 11 endpoints in this module — `documents/{id}/restore`,
`classifications/{id}/restore`, `documents/{id}` DELETE, `classifications/{id}`
DELETE, `documents/{id}/relations/{relationId}` DELETE,
`reservations/{id}/cancel`, `reservations/{id}/commit`, `documents/{id}/void`,
`documents/{id}/reclassify`, `documents/{id}/versions` POST, and
`documents/{id}/relations` POST — was originally hashed WITHOUT including the
resource-identity path params (`id`/`relationId`) AND an explicit `action`
literal. Because the idempotency `request_scope` is shared across ALL resources
of the same type within one tenant, this allowed reusing an `Idempotency-Key`
across TWO different documents to replay the first document's response for a
request that should have mutated the second document. 4 of the 11 endpoints
(`void`/`reclassify`/`versions.create`/`relations.assign`) were only found by an
independent security-auditor pass through a mandatory re-grep of the WHOLE
module after the first pass targeted only 7 endpoints — the lesson: do not
trust a list of "suspicious-looking" endpoints as complete.

`sequences/revise`/`restore`/`deactivate` were CHECKED and are NOT vulnerable —
these index-level endpoints identify the resource through
`scopeType`+`scopeId`+`sequenceKey`, which is already part of the raw body
that gets hashed; the pure create endpoints (`documents`/`classifications`/
`sequences` POST, `reservations/reserve`) are also NOT vulnerable (there is no
pre-existing resource to bind to). Adversarially tested in
`tests/integration/document-infrastructure.integration.test.ts` for
all 11 fixed endpoints. **New endpoints in this module that
have an `[id]`/`[relationId]` path param must follow the same pattern:**

```ts
const requestHash = computeRequestHash({
  ...body,
  id: documentId,
  action: "void"
});
```

## Endpoint idempotency (summary — see the README for the full table)

`documents.create`/`versions.create` are deliberately idempotency-gated EVEN
THOUGH `create`/`update` are not in `HIGH_RISK_ACTIONS` — Issue #751 itself
explicitly warned that a sibling PR in this epic needed an extra round of
fixes because its first idempotency pass missed the `create`
endpoints. Four new actions were added to `AccessAction`/`HIGH_RISK_ACTIONS`
for this module: `void`, `reclassify`, `reserve`, `commit` — `cancel`
(reservation) reuses an existing literal WITHOUT being added to
`HIGH_RISK_ACTIONS` (to avoid changing the blast radius of `cancel` in other
modules); the reservation cancel endpoint still requires an `Idempotency-Key` at
the route level independently.

## Domain events (AsyncAPI)

`document.created`, `document.voided`, `document.restored`,
`document.reclassified`, `version.created`, `number.reserved`,
`number.committed`, `number.canceled` — all published in the same transaction
as the state change (`appendDomainEvent`, `domain_event_runtime`).

## Admin UI

`/admin/document-infrastructure/classifications`,
`/admin/document-infrastructure/documents` (+ detail: versions/relations/
reclassify/evidence), `/admin/document-infrastructure/sequences` (sequence
definitions + reservations: reserve/commit/cancel are reachable from this screen —
`commit` prompts for a free-text document id, there is no cross-module picker).

## Common pitfalls

1. Do not link a document to another module's resource with a direct `INSERT`
   into `awcms_document_resource_relations` — always go through the capability
   port `linkDocumentToResource`.
2. Do not add a new mutation endpoint without idempotency-hash resource
   binding (see §CRITICAL above) — this is the ONLY module in the repo that
   has been hit by this bug twice in a row.
3. Do not add a new document read/mutation endpoint without a confidentiality-tier
   check — see §Confidentiality-tier gating.
4. Do not `UPDATE`/`DELETE` rows of `awcms_document_versions` — append-only,
   a correction is always a new version.
5. Do not replace the numbering row-lock with optimistic locking.

## Verification

`tests/integration/document-infrastructure.integration.test.ts` — negative
confidentiality-tier tests for ALL FOUR original read paths, a real numbering
concurrency test, AND (Issue #787) two extra tests: one covering the six
mutation endpoints (denied with the action permission alone, allowed once the
tier permission is added), and another covering `GET /evidence`/
`GET /reservations`. Run `bun test` with `DATABASE_URL` — `bun run
check` without `DATABASE_URL` silently skips every integration test.

## Not yet available

A real capability edge to `data_lifecycle` for retention (the
`retention_reference` column stays free text until there is a separate
admission decision).
