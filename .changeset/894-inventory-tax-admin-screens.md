---
"awcms": minor
---

feat(admin): inventory and tax admin screens; flip both modules to active

`inventory` (ADR-0126) and `tax` (ADR-0127) shipped API-first as `experimental`
because ADR-0021 criterion 1 refuses an `active` module without an admin screen.
Both screens land here, each with its `navigation` entry in the same change, and
both modules become `active`.

`/admin/inventory` has three views, each gated on its own read permission:
balances with a low-stock signal, filters, per-item thresholds and a read-only
reconciliation; the movement history with adjustments, reversal through the
reason panel, and transfers; and locations with the negative-stock policy per
location and per tenant. It never asserts a balance, so every change is a
movement.

`/admin/tax` has rule profiles and versions (a draft, then publish with
confirmation), the snapshot list and detail, and the reconciliation report. The
rule definition is authored as JSON that the server validates.

No new permission and no migration: every key the screens use was already seeded
by `sql/170` and `sql/173`. `inventory.balances.rebuild`, `inventory.movements.create`
and the four consumer-driven `tax.*` keys stay on the shrink-only coverage ledger.
The client asset budget is raised by 6,014 B for the two screen scripts.
