🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](procurement.id.md)

# Procurement — suppliers, receiving and transfers (module doc pack)

> **Status:** admitted by [ADR-0128](../adr/0128-generic-procurement-supplier-receiving-transfer-module-admission.md)
> (Issue #888). PRD-lite, receiving state machine, ERD, permissions/RLS matrix,
> the contract with the inventory ledger, reconciliation and rollback in one
> place. Decisions and rejected alternatives are in the ADR; the code map is
> [`src/modules/procurement/README.md`](../../src/modules/procurement/README.md);
> the HTTP contract is
> [`openapi/modules/procurement.openapi.yaml`](../../openapi/modules/procurement.openapi.yaml)
> and the event contract is the two `awcms.procurement.*` channels of
> [`asyncapi/awcms-domain-events.asyncapi.yaml`](../../asyncapi/awcms-domain-events.asyncapi.yaml).
> It sits on the stock ledger described in
> [`inventory-ledger.md`](inventory-ledger.md).

## 1. PRD-lite

**Problem.** A domain module that buys or moves goods needs a counterparty (a
supplier with tax and payment details), a document a person can raise, review,
approve and correct, and a lifecycle that makes the moment stock changes
unambiguous. Built per consumer, each differs in how it can make stock wrong.

**Goal.** One generic module: suppliers as a business role over the canonical
party, four document modes, an enforced lifecycle, and stock effects that exist
only as ledger movements.

**Users.** A purchasing clerk (drafts documents), a stores manager (submits and
finalises), an approver (workflow), a finance reader (reports, reveal of a tax
id), an auditor (reconciliation).

**Acceptance criteria (from the issue) and where each is met**

| Criterion                                                                             | Where                                                                                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Supplier role referencing the canonical party; code, status, categories, tags         | `awcms_procurement_suppliers` (+ `_labels`), optional `profile_id` composite FK; ADR §2                              |
| Tax/business identifiers with a sensitivity classification; payment/contact refs      | `awcms_procurement_supplier_identifiers`; `tax_id`/`business_id` forced `sensitive`; masked; one audited reveal      |
| Receiving document: supplier, location, external reference, date, notes, lines, actor | `awcms_procurement_documents` + `_lines`; actor stamps per transition                                                |
| Modes: receive, supplier return, requisition, location transfer (paired movements)    | `mode` CHECK; ledger `receive`/`supplier_return`/transfer pair                                                       |
| Line snapshots of SKU, name, unit, cost                                               | `sku`, `item_name`, `unit_code`, `unit_cost` on the line; supplier code/name snapshot on the document                |
| draft → submitted/finalised/cancelled/reversed, idempotent finalise                   | trigger-enforced state machine; §2                                                                                   |
| Finalising creates movements and never writes a balance                               | no `awcms_inventory_*` write in the module (reads only: location checks, reconciliation); `InventoryLedgerPort` only |
| Optional approval via `workflow_approval`                                             | `approval_threshold`; soft, fail-closed; ADR §9                                                                      |
| Reporting projections                                                                 | `procurement.receiving`, `procurement.suppliers`; live reports under `/procurement/reports/*`                        |

**Approval threshold.** `approval_threshold` is **cost-based and covers `receive` and `supplier_return` only** (both require a `unitCost` on every line). `requisition` and `transfer` carry no cost and are **not** gated; mode/quantity-based gating is a follow-up.

**Non-goals.** A full accounts-payable ledger; any network or provider call in a
database transaction; purchase orders; partial receipts of one document;
costing/valuation; supplier portals. (The admin screen landed in Issue #905; see §9.)

## 2. The receiving state machine

```
draft ──submit──> submitted ──finalise──> finalised ──reverse──> reversed
  │                   │
  └────cancel─────────┴───────cancel────> cancelled
```

| Transition                  | Permission           | Stock                                       | Idem. | Audit    |
| --------------------------- | -------------------- | ------------------------------------------- | ----- | -------- |
| (create) → draft            | `documents.create`   | none                                        | yes   | info     |
| draft edit                  | `documents.update`   | none                                        | no    | info     |
| draft → submitted           | `documents.submit`   | none (starts approval when over threshold)  | yes   | info     |
| submitted → finalised       | `documents.finalise` | **posts** the ledger movements, all or none | yes   | warning  |
| draft/submitted → cancelled | `documents.cancel`   | none; withdraws a pending approval          | yes   | warning  |
| finalised → reversed        | `documents.reverse`  | **posts** compensating movements            | yes   | critical |

Rules the database enforces (trigger `awcms_procurement_documents_update_guard`),
not only the handlers: only these transitions; per transition only the columns it
may change; `cancelled` and `reversed` are terminal; lines writable only while
the parent is `draft`; a finalised or reversed document is only ever `not_required`/`approved`, approval moves `pending → approved|rejected` once and its instance never changes; a finalised document cannot be edited, re-pointed or
deleted, even by the table owner; each of `finalised`/`cancelled`/`reversed` is
reached at most once.

Refusals and their codes: `INVALID_STATE` (409, wrong state for the verb),
`APPROVAL_PENDING` / `APPROVAL_REJECTED` (409), `APPROVAL_WORKFLOW_NOT_CONFIGURED`
/ `APPROVAL_WORKFLOW_MISCONFIGURED` (409, fail closed), `SUPPLIER_UNAVAILABLE`
(409, blocked/inactive/deleted supplier), `LOCATION_INACTIVE`,
`INSUFFICIENT_STOCK`, `UNIT_MISMATCH`, `QUANTITY_OUT_OF_RANGE` (ledger refusals,
the whole document posts nothing), `DUPLICATE_EXTERNAL_REFERENCE`,
`IDEMPOTENCY_REQUIRED` (400) and `IDEMPOTENCY_CONFLICT` (409).

## 3. ERD and data dictionary

```
awcms_profiles (profile_identity) <-0..1- awcms_procurement_suppliers -1..n- _supplier_labels
                                              |  1..n  _supplier_identifiers (masked, classified)
                                              | 0..n
awcms_inventory_locations <-1,0..1- awcms_procurement_documents -1..n- _document_lines
                                              | 1..n                         | 1..n
                                _document_events (append-only)     _document_movements (append-only)
                                                                         |
                                                       awcms_inventory_movements (ledger, ADR-0126)
awcms_procurement_settings  (one row per tenant: approval_threshold)
```

| Table                                    | Holds                                                                                                                                                          | `awcms_app` privileges                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `awcms_procurement_settings`             | `approval_threshold` (`NULL` = off)                                                                                                                            | SELECT, INSERT, UPDATE                                  |
| `awcms_procurement_suppliers`            | vendor code (unique per tenant among live), status, name, optional `profile_id`, soft-delete stamps                                                            | SELECT, INSERT, UPDATE (no DELETE)                      |
| `awcms_procurement_supplier_labels`      | categories and tags (≤ 20 each), replaced wholesale on edit                                                                                                    | SELECT, INSERT, DELETE                                  |
| `awcms_procurement_supplier_identifiers` | type, classification, normalised value (**plaintext under RLS**, not encrypted), **unkeyed** SHA-256 hash shared with `profile_identity`, mask — **sensitive** | SELECT, INSERT, DELETE                                  |
| `awcms_procurement_documents`            | mode, status, supplier/location refs and snapshots, external reference, totals, approval, stamps                                                               | SELECT, INSERT, UPDATE (**no DELETE**)                  |
| `awcms_procurement_document_lines`       | item ref, SKU/name/unit snapshot, quantity, unit cost, DB-computed `line_total`                                                                                | SELECT, INSERT, UPDATE, DELETE (draft only, by trigger) |
| `awcms_procurement_document_movements`   | document line ↔ ledger movement, `operation` `post`/`reversal`                                                                                                 | SELECT, INSERT (**no UPDATE/DELETE**)                   |
| `awcms_procurement_document_events`      | `submitted`/`finalised`/`cancelled`/`reversed` log; generated `kind_mode`, `supplier_event_kind`                                                               | SELECT, INSERT (**no UPDATE/DELETE**)                   |

Money and quantity are `numeric` and decimal **strings** on the wire. Every
reference is a composite `(tenant_id, id)` foreign key, including to
`awcms_profiles`, `awcms_inventory_locations` and `awcms_inventory_movements`.
`awcms_worker` holds `SELECT` on `awcms_procurement_document_events` only (the
reporting engine's incremental worker reads the source as that role).

## 4. Permissions and RLS matrix

All routes are `defineTenantRoute`, authorize through `authorizeInTransaction`
(ADR-0063), and are default-deny. `sql/175` seeds the catalogue and grants
**nothing** to any role; existing tenants use
`bun run identity-access:permissions:backfill`.

| Method and path                                       | Permission                                                              | Risk        |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ----------- |
| `GET /procurement/suppliers`, `/{id}`                 | `suppliers.read` (`includeDeleted=true` also needs `suppliers.restore`) |             |
| `POST /procurement/suppliers`                         | `suppliers.create`                                                      |             |
| `PATCH /procurement/suppliers/{id}`                   | `suppliers.update`                                                      |             |
| `DELETE /procurement/suppliers/{id}`                  | `suppliers.delete`                                                      |             |
| `POST /procurement/suppliers/{id}/restore`            | `suppliers.restore`                                                     |             |
| `GET/POST /procurement/suppliers/{id}/identifiers`    | `suppliers.read` / `.update`                                            |             |
| `DELETE …/identifiers/{identifierId}`                 | `suppliers.update`                                                      |             |
| `POST …/identifiers/{identifierId}/reveal`            | `suppliers.reveal`                                                      | **high**    |
| `GET /procurement/documents`, `/{id}`                 | `documents.read`                                                        |             |
| `POST /procurement/documents`                         | `documents.create`                                                      |             |
| `PATCH /procurement/documents/{id}`                   | `documents.update`                                                      |             |
| `POST …/{id}/submit`                                  | `documents.submit`                                                      |             |
| `POST …/{id}/finalise`                                | `documents.finalise`                                                    | **high**    |
| `POST …/{id}/cancel`                                  | `documents.cancel`                                                      |             |
| `POST …/{id}/reversal`                                | `documents.reverse`                                                     | **high**    |
| `GET /procurement/documents/reconciliation`           | `documents.reconcile`                                                   |             |
| `GET /procurement/policy` / `PUT /procurement/policy` | `policy.read` / `policy.configure`                                      | high-impact |
| `GET /procurement/reports/receiving`, `/suppliers`    | `reports.read`                                                          |             |

Tables: every one has `tenant_id`, RLS `ENABLE`+`FORCE`, a policy with `USING`
and `WITH CHECK`; verified by the integration suite as the runtime role
(`awcms_app`), including that it cannot read or write another tenant's rows.

## 5. Contract with the inventory ledger

Procurement is a **consumer** of `InventoryLedgerPort` and carries the consumer's
duties stated in `_shared/ports/inventory-ledger-port.ts`:

- **Verify the source.** Lines are posted only from a document just read under
  `FOR UPDATE`, in the caller's tenant, in the one state that may post.
- **Authorize before posting.** The route authorizes (`finalise`/`reverse`)
  before the application function runs; the function audits and passes the
  request's correlation id to every ledger row, so both halves of one action join.
- **Never write a balance.** No `awcms_inventory_*` write exists here (reads only).

Mapping (source type is server-owned; line = `line_no`; operation `post`):

| Mode              | Finalise posts                        | Reverse posts                        |
| ----------------- | ------------------------------------- | ------------------------------------ |
| `receive`         | `postReceipt` at `location_id`        | `postSupplierReturn` (same location) |
| `supplier_return` | `postSupplierReturn` at `location_id` | `postReceipt`                        |
| `requisition`     | `postTransfer` source → `location_id` | `postTransfer` back                  |
| `transfer`        | `postTransfer` source → `location_id` | `postTransfer` back                  |

Source types: `procurement_receipt`, `procurement_supplier_return`,
`procurement_requisition`, `procurement_transfer`, each with a distinct
`…_reversal`. Posting is all-lines-or-none inside one savepoint, in
`(item_type, item_ref, line_no)` order.

## 6. Events

| Event                                  | When                                          |
| -------------------------------------- | --------------------------------------------- |
| `awcms.procurement.document.finalised` | Once per finalised document, same transaction |
| `awcms.procurement.document.reversed`  | Once per reversed document, same transaction  |

Both through the domain-event outbox; a refused or replayed call publishes
nothing. Payloads: opaque ids, mode, line count and decimal-string totals — never
a supplier name, identifier, note or reason.

## 7. Reconciliation, reporting and verification

- **Reconciliation** (`GET /procurement/documents/reconciliation`): per
  finalised/reversed line, the ledger holds exactly the linked movements; lists
  missing links, procurement-identity movements posted outside the module, and
  disagreeing quantity/location. Read-only; tenant-scoped.
- **Projections** `procurement.receiving` (6 counters) and `procurement.suppliers`
  (3 counters) over the append-only events table; every metric is monotonic.
- **Tests:** `tests/procurement-validation.test.ts` (pure),
  `tests/integration/procurement-database.integration.test.ts` (RLS, composite
  FKs across tenants, trigger state machine, immutability, privileges,
  reconciliation, projections) and
  `tests/integration/procurement-api.integration.test.ts` (every high-risk guard
  both ways, finalise replay and concurrency, all-or-none, transfers, reversal,
  masking and reveal, approval) against a real database.

## 8. Rollback and operations

Forward-only like every migration here. To stop using the module: stop calling
it and (optionally) disable it per tenant; the tables are inert and the ledger
stays valid by itself. Dropping them is a restore-class decision. After any
restore run the procurement **and** inventory reconciliations: documents and
ledger must come back from the same point in time. Nothing purges these tables
(ADR §7); growth is bounded by documents, not traffic. To give an existing
tenant the new permissions run `bun run identity-access:permissions:backfill`.

## 9. Known limits and follow-ups

Known limits, stated explicitly (ADR-0128):

- **Reveal has no step-up and no rate limit.** No sibling reveal exists to mirror (`profile_identity` has no clear-text reveal; no other reveal carries those protections), and an unconditional `requireStepUp` is the ADR-0058 §E trap. Reveal is audited, `no-store` and behind its own permission only.
- **The approval threshold is cost-based.** A document with zero or omitted cost, and every requisition and transfer, bypasses it.
- **No location-scoped ABAC and no default maker/checker.** Separating `documents.submit` from `documents.finalise` is an operator duty: author a SoD rule over those two high-risk actions.
- On anonymisation the supplier's `profile_id` link is **retained** (it resolves to an anonymised profile); the trading name is retained under the financial_tax obligation.
- Adding an identifier the supplier already holds is idempotent (a uniform `201` acknowledgement of type, label, masked value and classification — no id, no timestamp — identical for a fresh and an already-held value, so it is no equality oracle); soft-deleted suppliers' identifiers are unreachable until restore; the supplier report lists soft-deleted suppliers with `deleted: true`.

- **DB-level limit of the approval rule.** The database refuses `finalised`/`reversed` unless approval is `not_required|approved` and fixes the instance after submit, but it trusts the application at `draft → submitted`: it cannot tell that an `approved` status written at submit came from a real workflow decision.

Recorded follow-ups:

Recorded by the security audit: step-up and a rate limit on reveal; a stricter permission for payment/contact references and soft-delete of identifiers; keyed hashing and at-rest encryption of `normalized_value`; mode/quantity-based approval gating for requisitions and transfers; actor-bound idempotency in `inventory`.

Admin screens **landed in Issue #905** (`/admin/procurement`, module `active`,
navigation gated by `procurement.documents.read`): suppliers (create/edit,
soft-delete/restore, masked identifiers, add/remove, and an audited reveal shown
once and never cached), documents of every mode (draft with lines, submit,
finalise, cancel and reverse with a mandatory reason, each with an
`Idempotency-Key`), the approval threshold, the receiving and supplier reports and
the reconciliation. Not on the screen: editing a draft in place
(`documents.update`; cancel and re-enter instead), and the residual gaps above
(reveal step-up, cost-only threshold, location-scoped ABAC). Existing tenants
need `bun run identity-access:permissions:backfill` before their roles see the
screen. Still open: purchase
orders and receipt against an order; partial receipts; costing; archive-then-purge.
