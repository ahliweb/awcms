🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `procurement`

Generic **suppliers, receiving, supplier returns, requisitions and location
transfers** over the inventory ledger (Issue #888,
[ADR-0128](../../../docs/adr/0128-generic-procurement-supplier-receiving-transfer-module-admission.md)).
The full design pack (PRD-lite, state machine, ERD, permissions/RLS matrix,
ledger contract, reconciliation, rollback) is
[`docs/awcms/procurement.md`](../../../docs/awcms/procurement.md); this file is
the map of the code.

## The one rule

Procurement owns **documents**, never **stock**. Finalising a document posts
movements through `InventoryLedgerPort` (all lines or none, one savepoint) and
reversing posts compensating ones; there is no write to any `awcms_inventory_*`
table in this module. The state machine
(draft → submitted → finalised | cancelled, finalised → reversed) is a database
trigger, so a finalised document is immutable and nothing is ever deleted.

## Layout

| Path                                            | What it is                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `module.ts`                                     | Descriptor: 17 permissions, 2 events, 2 reporting projections, `dataLifecycle` + `subjectData` for 8 tables |
| `domain/procurement-types.ts`                   | Modes, statuses, the server-owned ledger source types — pure                                                |
| `domain/procurement-validation.ts`              | Strict request validators (exact decimals, no client-asserted state or totals) — pure                       |
| `domain/procurement-identifier.ts`              | Identifier normalisation and classification — pure                                                          |
| `domain/procurement-permissions.ts`             | Literal guard objects passed to `authorizeInTransaction`                                                    |
| `domain/procurement-events.ts`                  | Event type/version constants                                                                                |
| `application/procurement-posting.ts`            | Finalise and reverse: the only code that moves stock (through the port)                                     |
| `application/procurement-document-directory.ts` | Document CRUD, submit, cancel, approval threshold, optional `workflow_approval`                             |
| `application/procurement-supplier-directory.ts` | Suppliers, labels, identifiers, the audited reveal                                                          |
| `application/procurement-reporting.ts`          | Live reports and the document/ledger reconciliation                                                         |
| `application/procurement-route-support.ts`      | Idempotency, body validation and error mapping shared by the routes                                         |
| `src/pages/api/v1/procurement/**`               | 16 thin route files; each authorizes through `defineTenantRoute`                                            |

Status is `active`: `/admin/procurement` (Issue #905) is the admin screen ADR-0021
criterion 1 required, and it landed with its `navigation` entry (gated by
`procurement.documents.read`). It covers suppliers (masked identifiers, audited
reveal), documents of every mode with submit/finalise/cancel/reverse, the approval
threshold, the reports and the reconciliation. Editing a draft in place
(`documents.update`) is not on the screen: cancel and re-enter.

**Approval threshold:** cost-based; covers `receive` and `supplier_return` only (both require a `unitCost` per line). `requisition` and `transfer` are not cost-gated (mode/quantity gating is a recorded follow-up).
