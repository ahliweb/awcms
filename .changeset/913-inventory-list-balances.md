---
"awcms": minor
---

feat(inventory): `InventoryLedgerPort.listBalances` — a keyset-paged, read-only list of the current balances of one location (`itemTypePrefix`, `nonZeroOnly`, `after`, `limit` up to 500), so a consumer can reconcile its catalogue against the ledger without reading the module's tables (#913, ADR-0126). Never returns movement history; runs under the caller's tenant RLS; a cursor is bound to its location.
