---
"awcms": minor
---

feat(inventory): admit a generic multi-location stock ledger module

A domain module that sells goods had one way to track stock: a single counter on
a product or variant row. A counter cannot say where, why, who changed it, or
whether it is still the sum of what happened, and two concurrent sales of the
last unit are a read-modify-write race on one cell.

`inventory` is a new module (ADR-0126, `sql/169` + `sql/170`, Issue #887) that
any commerce, POS or storefront module can use as its inventory authority, API
first (no admin screen or `navigation` entry yet — a recorded follow-up).

### What it guarantees, and how each is enforced

- **Immutable ledger.** Finalised movements are append-only by a row trigger
  **and** by `REVOKE UPDATE, DELETE, TRUNCATE` from `awcms_app`; a mistake is
  corrected by a compensating movement. Only an adjustment is reversible, once.
- **A balance is never asserted.** `awcms_inventory_balances` is a read model that
  is always the sum of its movements. No endpoint accepts a quantity on hand, and
  a body naming `onHand`/`balanceAfter` is a `400`. `GET .../balances/reconciliation`
  proves `balance == SUM(movements)`; `POST .../balances/rebuild` repairs a drifted
  row FROM the ledger (lock first, then recompute — never a stale sum).
- **The last unit is safe.** Balance rows are locked in a fixed order and the
  UPDATE is guarded; twelve concurrent sales of one unit sell exactly one. A
  non-locking pre-read refuses an impossible withdrawal before any row is
  created, so a refused sale commits nothing.
- **A transfer is a balanced pair**, validated whole before either leg is written
  and independently enforced at COMMIT by a deferred constraint trigger.
- **Idempotent source identity** `(type, id, line, operation)`: replaying it
  returns the ORIGINAL movement; the same identity with a different payload is
  `409 SOURCE_CONFLICT`. It is separate from the `Idempotency-Key` header, which
  the API also requires.
- **Negative stock** is a per-tenant default with a per-location override
  (`forbid` unless configured). It never blocks a movement that only improves a
  balance.
- **Opaque item references** `(item_type, item_ref)`, deliberately not a foreign
  key to any catalogue. Quantities are exact decimal strings (`numeric(20,6)`),
  and a unit mismatch is refused rather than converted.

### Surface

14 route files under `/api/v1/inventory/*`, every one a `defineTenantRoute`
authorizing through the ADR-0063 chokepoint; twelve permissions seeded by
`sql/170` (nothing is granted to any role — existing tenants use
`identity-access:permissions:backfill`). `adjust` and `transfer` are new
HIGH-RISK `AccessAction` members. Two domain events
(`awcms.inventory.movement.posted`, `awcms.inventory.stock.low`) go through the
outbox in the same transaction. The `inventory.low_stock` projection is
registered on the reporting engine as two monotonic counters, because the engine
clamps a decrement at zero. Consumers adopt the ledger through
`InventoryLedgerPort`, documented with the expand, backfill, reconcile, contract
migration path in the module doc pack.

### Security-review hardening

- **Openings need `movements.adjust`.** `opening` states a starting quantity with
  no document behind it, so it is no longer postable through `POST /movements`;
  it has `POST /openings`, guarded by `movements.adjust` and audited at warning.
  `source.type` `reversal` is reserved for the server.
- **The ledger trusts the caller's source identity** — now said plainly in the
  permission descriptions, the OpenAPI text and the port contract, with the
  composition-root duty (authorize, audit, pass `correlationId`) spelled out.
- `awcms_worker` is granted `SELECT` on the low-stock signals table (the
  projection refresh failed under `WORKER_DATABASE_URL` without it), and a test
  now asks the same question of every registered projection source.
- A balance past `numeric(20,6)` is a `422`, not a 500. The location row is read
  `FOR SHARE` in the posting path. The replay fingerprint includes the reason and
  note. `occurredAt` is bounded (`INVENTORY_BACKDATE_WINDOW_DAYS`, default 7;
  older needs `adjust`). No response returns `balanceAfter` or the on-hand
  quantity of an `INSUFFICIENT_STOCK`. A trigger refuses a forged reversal.

### Not done, on the record

Nothing purges the ledger (the `data_lifecycle` descriptors say so; partitioning
and archive-then-purge need their own ADR), no reservations/holds, no unit
conversion, no multi-line atomic posting, no admin screens.

### Operating note

Existing tenants must be granted the new permissions
(`bun run identity-access:permissions:backfill`, dry-run by default) before they
can use the API; until then every route is a 403, which is the default-deny
posture rather than a fault.
