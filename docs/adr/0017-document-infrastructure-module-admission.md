🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0017-document-infrastructure-module-admission.id.md)

# ADR-0017 — Admission of `document_infrastructure` as an Official Optional Business Foundation module

- **Status:** Accepted (not yet implemented)
- **Status note (2026-08-05):** This admission decision still stands, but its artifacts (`src/modules/document-infrastructure/`) do not exist in this repo, and since ADR-0055 its implementation awaits an admission ADR in this repo.
- **Date:** 2026-07-14
- **Decision makers:** @ahliweb
- **Related:** Issue #751 (epic #738 `platform-evolution`, Wave 3), Issue #739 / ADR-0013 (extension layers, data-ownership matrix, no-shared-table-write), ADR-0016 (`organization_structure` admission — same template, same wave family), Issue #742 (`domain_event_runtime`, merged), Issue #745 (`data_lifecycle`, referenced but not hard-depended-on), Issue #747 (`workflow_approval`, referenced but not hard-depended-on), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

> **NOT YET IMPLEMENTED IN THIS REPO.** The `Accepted` status above is an
> **admission** decision, not a statement that the module exists. As of today
> there is no `src/modules/document_infrastructure/`, no migration, no permission, and
> `listModules()` does not return it — calling it will fail. The plan to
> deliver it: Wave A of
> [`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`](../awcms/absorb-awcms-mini-backbone-roadmap.md).
> Delete this block in the PR that actually lands the module —
> `tests/adr-admission-implementation-status.test.ts` demands it be deleted as soon as
> the module enters the registry.

## Context

ADR-0013 §1's extension-layer table already lists "generic documents/managed-files" as a Wave 2/3 Official Optional Business Foundation candidate. Issue #751 asks for exactly that: a reusable document METADATA registry (immutable versions, classification, evidence/attachment links, generic resource references, access/audit controls, concurrency-safe numbering) that any derived application can attach to ITS OWN domain documents (letters, invoices, purchase orders, journal batches, medical records, contracts) without this module ever importing or writing to those domains' tables — matching ADR-0013 §6's no-shared-table-write rule and the issue's own explicit out-of-scope list.

Issue #751 requires "Admission decision/ADR confirms module category and capability dependencies" as its first acceptance criterion, mirroring ADR-0016's precedent (`organization_structure`, Issue #749) of writing a standalone ADR rather than relying on ADR-0013's pre-classification alone, since this issue explicitly asks for one.

## Decision

Admit `document_infrastructure` as a new module in this base registry, filling in the `module-proposal-template.md` format inline:

### 1. Module name & key

- Name: **Document Infrastructure**
- `key`: `document_infrastructure`
- Category: **Official Optional Module** (= the ADR-0013 "Official Optional Business Foundation" layer)

### 2. Problem/need

Every derived application that has business documents (contracts, invoices, correspondence letters, approval evidence, asset disposal evidence, and so on) repeatedly rebuilds infrastructure that is structurally identical: immutable document versions, classification/confidentiality, attachments/evidence, document numbering that is safe against race conditions, and access/audit controls — even though the BUSINESS RULES of each document itself (what an "invoice" is, when it is "posted", who approves a PO) are always domain-specific. This module provides the genuinely generic part (registry + versioning + classification + evidence + numbering), never the domain-specific part (see §Out of scope of issue #751).

### 3. Why this is not a Derived Application module

It passes the doc 21 §3 decision tree, node Q3 ("generic for ALL derived applications"): a generic document registry + immutable versioning + concurrency-safe numbering is the exact same structural need for retail (invoice/PO), public services (letters/dispositions), healthcare (medical records — only the metadata/evidence, not the clinical content), and education (letters of certification) — it is not logic specific to a single vertical. This module explicitly DOES NOT implement any domain document's content schema/editor, DOES NOT integrate electronic signature/TTE, and DOES NOT claim universal records-management certification (see Out of scope of issue #751) — the same precedent as `organization_structure` (ADR-0016): a generic structural primitive, not an ERP/vertical domain.

### 4. Dependencies

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, must be enabled first): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` for the tenant boundary, `identity_access` for `awcms_tenant_users` (the actor/`created_by`/`reserved_by` are referenced through ordinary FKs, re-validated in the application layer — the same pattern `organization_structure`/`workflow_approval` already use), `domain_event_runtime` because this module is a REAL producer (`appendDomainEvent`, event types registered in `domain-event-runtime/domain/event-type-registry.ts`) — the pattern is identical to ADR-0016 §4.
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `document_infrastructure` **PROVIDES** `document_resource_relations` — a set of exported application functions (`application/document-resource-relation-port.ts`: `linkDocumentToResource`/`unlinkDocumentToResource`/`listRelationsForResource`/`listRelationsForDocument`) that OTHER modules may IMPORT and CALL DIRECTLY (an in-process function call, the same monolith — the pattern is identical to `blog_content`↔`news_portal`, ADR-0011) in order to link a document to ONE OF their own resources, without this module ever reading/writing the calling module's tables and without the calling module ever writing directly into the `awcms_document_resource_relations` table (the only writer of that table is `document_infrastructure`'s own code — ADR-0013 §6 no-shared-table-write). This module declares **NO** `capabilities.consumes` at all from `data_lifecycle`/`workflow_approval`/`sync_storage` in this PR — issue #751 explicitly asks for retention/legal-hold (#745) and workflow/event (#747/#742) integration "when available **without hard dependencies unless admitted**"; `retention_reference` on `awcms_documents`/`awcms_document_classifications` is a free-text column (documenting a convention, mapped manually onto a `data_lifecycle` policy by the operator), not a foreign key or a capability call — following the issue's instruction literally, a real capability edge to `data_lifecycle` is a separate follow-up that needs its own admission.
- **Binary content**: `awcms_document_versions.content_reference`/`.content_reference_kind` point at the ONLY real "approved managed-object storage contract" that exists in this base today — the `sync_storage` object queue (`awcms_object_sync_queue`, migrations 009/018) — BUT purely as a REFERENCE NAMING CONVENTION (an `objectKey` string with the same shape), not as a real capability call/FK to `sync_storage` in this PR (deliberately no lifecycle/capability edge added, a decision consistent with the point above: avoiding a hard dependency the issue has not asked for). `content_reference_kind` also accepts `external_url`/`external_system_reference` for deployments that store files entirely outside `sync_storage`. No binary byte is ever stored in any PostgreSQL column of this module — literally satisfying the acceptance criterion "Binary content is referenced through an approved file/object capability, not stored as unbounded database blobs" (reference, not storage).

### 5. Offline/LAN vs full-online-only compatibility

- Compatibility class: **offline-lan-safe**. No external provider is called directly by this module — the whole registry/versioning/classification/evidence/numbering surface is pure database operations; a content reference (`content_reference`) is a metadata string, not an actual upload/download call.
- Works 100% in the `offline-lan` profile with no internet connectivity.

### 6. External providers

None. There is no External Integration category inside this module.

### 7. Security & data governance

- Data touched: document metadata (title/summary/date/classification/confidentiality), content references (not the content itself), generic resource references (`ownerModuleKey`+`resourceType`+`resourceId`, opaque strings to this module), numbering sequence definitions/values, numbering/version evidence.
- ABAC: default-deny, a new permission key per resource (`document_infrastructure.documents.*`, `.classifications.*`, `.versions.*`, `.relations.*`, `.sequences.*`, `.reservations.*`, `.evidence.*`) — see the permission seed migration.
- **Document access combines tenant + classification/confidentiality + an explicit permission** (issue #751 "Security and integrity requirements") — concretely: `confidentiality_level` (`public`/`internal`/`confidential`/`restricted`) is ENFORCED on read, not merely stored. Two new ADDITIVE permissions (not a hierarchy — neither implies the other), the same pattern as `visitor_analytics.raw_detail.read`: `document_infrastructure.documents_confidential.read` and `document_infrastructure.documents_restricted.read` (`sql/068`). Holding the base `documents.read` alone only grants access to `public`/`internal` documents. Enforcement points: `domain/document.ts`'s `isConfidentialityLevelReadable`/`readableConfidentialityLevels` (pure — it NEVER resolves permissions itself, the boolean decision always comes from a route handler that has already called `authorizeInTransaction` once) + `application/document-directory.ts`'s `listDocuments` (filtering at the SQL level, `confidentiality_level = ANY(...)`, rows outside the clearance never leave PostgreSQL)/`fetchDocumentById` (returns `null` — IDENTICAL to "not found" — for a document outside the clearance, never confirming its existence to a caller without clearance)/`listDocumentsByPrimaryResource`. The `access` parameter is MANDATORY (not optional) in all three of those functions — forced by TypeScript at compile time, not a convention that can be forgotten. Applied in `GET .../documents`, `GET .../documents/{id}`, `GET .../documents/{id}/versions`, and `GET .../documents/{id}/relations` (the last two verify that the parent document is readable first).

  **Update (Issue #787 fast-follow, fully closed)**: the limitation previously recorded here — mutation endpoints and `GET .../evidence`/`GET .../reservations` were not yet gated — is now CLOSED, WITHOUT a new migration (the two `sql/068` permissions above are enough). Design decision: the mutation endpoints (`void`/`restore`/`reclassify`/`versions.create`/`relations.assign`/`relations.revoke`) REUSE the SAME read-tier permission as an extra PRECONDITION (not a new write-tier permission such as `documents_confidential.write`), for these reasons: (1) this module has no precedent for a write-tier permission separate from the action permissions that already exist (`documents.void`, etc. — the action permission itself ALREADY answers "who may perform WHICH action", while the confidentiality tier answers the ORTHOGONAL dimension "who may access documents at WHICH level" — a single precondition, not a new permission matrix); (2) adding separate write-tier permissions (four more: `documents_confidential.write`/`documents_restricted.write` × ... ) multiplies the permission surface for a marginal benefit that no acceptance criterion of issue #751/#787 asks for; (3) it stays additive-only and reversible — it loosens no RLS/tenant isolation whatsoever, purely an extra precondition before the action-specific permission is evaluated. Enforcement points: `voidDocument`/`restoreDocument`/`reclassifyDocument` (`document-directory.ts`) check the document's CURRENT `confidentiality_level` (not the newly proposed level, for `reclassify`) before the mutation is applied; `createDocumentVersion` (`document-version-service.ts`) and `linkDocumentToResource`/`unlinkDocumentFromResource` (`document-resource-relation-port.ts`) check the parent document's confidentiality (for `unlinkDocumentFromResource`, resolved via a JOIN `relations`→`documents` because the route only receives a bare `relationId`). All of them return the "not found"-shaped reason codes that ALREADY EXIST (`not_found`/`document_not_found`) — not a new reason — preserving the same anti-enumeration property as the read path. `GET .../evidence`/`GET .../reservations` (`document-evidence-directory.ts`/`document-number-reservation-service.ts`) filter at the SQL level via a `LEFT JOIN` to `awcms_documents` + `confidentiality_level = ANY(...)`; rows WITHOUT a document link (sequence-only evidence, reservations not yet `commit`ted) always pass — they have no confidentiality dimension to check. The `access` parameter is MANDATORY across all of these extended functions, consistent with the same compile-time-forced pattern. Negatively tested for all 8 extended endpoints (`tests/integration/document-infrastructure.integration.test.ts`). Reservation `reserve`/`commit`/`cancel` ITSELF (as opposed to `GET .../reservations`) was deliberately NOT added — it is outside issue #787's explicit list, and operates at the sequence level before being linked to any document. There is no new audit-log entry for the tier decision itself (deny/allow) — following the `raw_detail.read` precedent, which likewise writes no separate decision log for its tier check, only the main guard is logged.

- High-risk actions that require idempotency + audit: document create/void/restore/reclassify, version create (append-only — must be retry-safe), classification delete/restore, relation link (`assign`)/unlink (`revoke`), sequence reserve/commit/cancel-reservation. See the permission seed migration and `identity-access/domain/access-control.ts` for the four new actions (`void`, `reserve`, `commit`, `reclassify`) added additively to `AccessAction`/`HIGH_RISK_ACTIONS`.
- Numbering: number allocation is ATOMIC (row-level `SELECT ... FOR UPDATE` on the currently open sequence row), the template format is BOUNDED (a fixed token parser, not `eval`/free-form regex/dynamic code), and a number that has been reserved/committed/canceled is NEVER reused (guaranteed structurally by `UNIQUE (tenant_id, sequence_id, reserved_number)` + a monotonic counter, not merely an application promise).
- Document versions: structurally append-only (there is no `UPDATE`/`DELETE` function against `awcms_document_versions` anywhere in this module — a correction is always a new version + `previous_version_id` pointing backwards, never overwriting the previous version row).
- The tenant remains the isolation boundary — the RLS predicate of EVERY new table in this module is always and only `tenant_id` (ADR-0013 §2/§9, not loosened).

### 8. Ownership

`@ahliweb` (following `.github/CODEOWNERS`, the same as every other module — `ModuleDescriptor.maintainers` has not been filled by any module per doc 21 §8 R3, and is not changed here).

### 9. Deprecation plan

Not applicable — a new module, it does not replace any existing module/feature.

### 10. Alternatives considered

- **Storing document content (binary bytes) directly in a PostgreSQL column (`bytea`)** — explicitly rejected by issue #751 itself ("Reuse existing/approved managed-object storage contracts rather than storing large binary content in PostgreSQL") and by the acceptance criteria ("Binary content is referenced through an approved file/object capability, not stored as unbounded database blobs"). The `content_reference` column stores the KEY/URI only.
- **Making `sync_storage` a real capability dependency (a hard edge) in this PR** — considered, rejected for now: issue #751 only asks to REUSE the concept (reference, not storage), and adding a real dependency edge before any consumer actually calls it enlarges the `modules:dag:check`/`modules:compose:check` surface with no concrete benefit in this PR — an explicit follow-up if/when an endpoint genuinely needs to trigger a real upload through `sync_storage`.
- **Other modules writing directly into `awcms_document_resource_relations` through their own SQL queries (not through the capability port)** — rejected: it directly violates ADR-0013 §6 no-shared-table-write; the capability port (exported functions, called in-process) is the ONLY permitted mechanism, consistent with `tests/unit/module-boundary-cycles.test.ts`/`module-boundary.test.ts`.
- **Making `document_infrastructure` a System module rather than an Official Optional Module** — rejected: this is a product feature with direct business value (opt-in per tenant), not pure reusable infrastructure like `logging`/`sync_storage` — the same criterion that places `organization_structure`/`blog_content`/`news_portal` in this category (doc 21 §2).
- **Making `retention_reference` a real foreign key to the `data_lifecycle` policy table** — rejected for now: `data_lifecycle` (Issue #745) does already exist, but issue #751 explicitly asks for integration "when available without hard dependencies unless admitted" — a real FK is a separate admission decision (and `data_lifecycle` itself operates through a `dataLifecycle` descriptor declared by the module that OWNS the table, not a cross FK), so this column stays free text for this PR.

## Consequences

- **Positive:** Derived applications (AWPOS invoice/PO attachments, public-service correspondence/dispositions, healthcare medical-record evidence) get reusable document primitives (immutable versions, classification, evidence, concurrency-safe numbering) without rebuilding structurally identical mechanisms in every derived repo.
- **Positive:** Concurrency-safe sequence numbering becomes the first GENERIC primitive in this base for the "sequential document number per scope, safe against double-submit" pattern — a pattern that previously existed only implicitly/ad hoc in other modules (e.g. `awcms_sync_outbox.sequence`, which is an identity column, not reservation-aware).
- **Negative/trade-off:** A new module enlarges the surface that must pass `modules:dag:check`/`modules:compose:check` every time the registry changes — mitigation: dependencies are declared minimally (`tenant_admin`, `identity_access`, `domain_event_runtime` only), there is no `consumes` capability that could create a cycle, and `capabilities.provides` is purely one-way (other modules consume, this module never consumes back).
- **Negative/trade-off:** `retention_reference`/`content_reference` being pure free text (not a real FK/capability call to `data_lifecycle`/`sync_storage`) means referential consistency to the retention policy/storage object actually depends on operator/calling-application discipline, not machine enforcement — recorded as a deliberate limitation (§10), not claimed as fully integrated.
- **Neutral:** `docs/awcms/21_module_admission_governance.md` §8 is updated with a row for the new module (see this PR).

## Alternatives considered

See §10 above (merged into the inline proposal template format, not repeated here).
