🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `inventory`

A generic, auditable multi-location **stock ledger** (Issue #887,
[ADR-0126](../../../docs/adr/0126-generic-multi-location-stock-ledger-module-admission.md)).

The inventory AUTHORITY for any domain module — commerce, POS, storefront —
that today keeps its own stock counter on a product row. The full design pack
(PRD-lite, ERD, data dictionary, permissions/RLS matrix, consumer adapter
contract, migration path, rollback) is
[`docs/awcms/inventory-ledger.md`](../../../docs/awcms/inventory-ledger.md);
this file is the map of the code.

## The one rule

`awcms_inventory_movements` is the truth and is **append-only**.
`awcms_inventory_balances` is a read model that is always the sum of it. Nothing
writes `on_hand` except `application/inventory-ledger.ts`'s `postLegs`, in the
same transaction as the movement that changes it. **A client can never assert a
balance**: there is no endpoint that accepts one, every request body is
validated strictly, and a body naming `onHand`/`balanceAfter` is a `400`.

## Layout

| Path                                           | What it is                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `module.ts`                                    | Descriptor: 12 permissions, 2 events, the `inventory.low_stock` projection, `dataLifecycle` + `subjectData` for every table        |
| `domain/inventory-types.ts`                    | Movement types, the sign each owns, policies — pure                                                                                |
| `domain/inventory-quantity.ts`                 | Exact decimal parsing/formatting on `BigInt` millionths — no float anywhere                                                        |
| `domain/inventory-validation.ts`               | Strict request validators, the replay fingerprint, the credential-shape guard on opaque ids                                        |
| `domain/inventory-permissions.ts`              | `INVENTORY_GUARDS` — literal guard objects (the enforcement-coverage gate recognises them only as literals)                        |
| `domain/inventory-events.ts`                   | Event type/version constants                                                                                                       |
| `application/inventory-ledger.ts`              | **The posting core.** Idempotent source identity, row locks in fixed order, guarded UPDATE, transfers, reversal, low-stock signals |
| `application/inventory-location-directory.ts`  | Locations and the negative-stock policy                                                                                            |
| `application/inventory-balance-directory.ts`   | Balance reads, thresholds, reconciliation, rebuild                                                                                 |
| `application/inventory-movement-directory.ts`  | Keyset-paginated ledger reads                                                                                                      |
| `application/inventory-route-support.ts`       | Body/idempotency plumbing and the refusal -> HTTP mapping the 14 route files share                                                 |
| `application/inventory-ledger-port-adapter.ts` | Concrete `InventoryLedgerPort` for in-process consumers                                                                            |
| `../_shared/ports/inventory-ledger-port.ts`    | The consumer adapter contract — what a consumer depends on, never this module's internals                                          |
| `../../pages/api/v1/inventory/**`              | 14 thin route files; every one is a `defineTenantRoute` and authorizes through the ADR-0063 chokepoint                             |
| `sql/169_awcms_inventory_schema.sql`           | Five tables, FORCE RLS, composite FKs, the immutability trigger, the deferred balanced-transfer constraint trigger                 |
| `sql/170_awcms_inventory_permissions.sql`      | The permission catalog seed (grants nothing to any role)                                                                           |

## Invariants and where each is enforced

| Invariant                                    | Enforced by                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Movements are append-only                    | Row trigger (`55000`) **and** `REVOKE UPDATE, DELETE, TRUNCATE FROM awcms_app`                                      |
| No reference crosses tenants or locations    | FORCE RLS **and** composite `(tenant_id, id)` foreign keys on every reference                                       |
| A transfer is a balanced pair                | `postLegs` validates both legs before writing **and** a deferred constraint trigger refuses to COMMIT anything else |
| The type owns the sign                       | `CHECK` on `quantity_delta` per `movement_type`                                                                     |
| Stock cannot silently go negative            | Locked row + guarded `UPDATE … WHERE on_hand + delta >= 0` + the location/tenant policy                             |
| Two attempts on the last unit: one wins      | The row lock; proved with 12 concurrent sales of one unit                                                           |
| Replay returns the original                  | Unique `(tenant, source_type, source_id, source_line, operation)` + an advisory lock serialising the identity       |
| `balance == SUM(movements)`                  | `GET …/balances/reconciliation` proves it; `POST …/balances/rebuild` repairs it from the ledger                     |
| One opening per key; a reversal at most once | Partial unique indexes                                                                                              |

## Status: `active`

Registered `experimental` while it was API-only (like `push_delivery`,
ADR-0074), because ADR-0021 criterion 1 holds every `active` module to having
an admin screen. `/admin/inventory` (Issue #894) is that screen — balances with
low-stock signals, the movement history, adjustments with reversal (reason
panel), transfers, locations, the negative-stock policy and thresholds, and a
read-only reconciliation — and landed with its `navigation` entry, so the module
is `active`. The screen never asserts a balance: every change on it is a
movement.

## What is NOT here

A screen for `inventory.movements.create` (a consumer action; `balances.rebuild`
has a guarded screen action since Issue #901); reservations/holds; unit conversion;
costing/valuation; multi-line atomic posting; archive-then-purge and
partitioning (nothing purges the ledger, and the descriptors say so —
ADR-0126 §7).

## Tests

- `tests/inventory-validation.test.ts` — validators, quantity arithmetic, the
  "no client-asserted balance" rule, module descriptor shape (no DB).
- `tests/integration/inventory-ledger.integration.test.ts` — the posting core
  against real PostgreSQL as `awcms_app` with FORCE RLS: concurrency on the last
  unit, transfer atomicity and replay, adjustment + reversal, append-only from
  both the runtime role and the table owner, cross-tenant isolation,
  reconciliation/rebuild, low-stock signals + projection, events/outbox, the
  consumer port, query plans and a load run.
- `tests/integration/inventory-api.integration.test.ts` — the real route
  handlers: default-deny, `Idempotency-Key`, refusals, audit.
