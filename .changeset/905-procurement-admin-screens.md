---
"awcms": minor
---

feat(admin): procurement admin screen; flip `procurement` to active

`procurement` (ADR-0128) shipped API-first as `experimental` because ADR-0021
criterion 1 refuses an `active` module without an admin screen. The screen lands
here with its `navigation` entry in the same change, and the module becomes
`active`.

`/admin/procurement` has five views, each gated on its own read permission and
every control on its own action permission:

- suppliers: create and edit, soft-delete and restore, categories and tags, and
  the identifiers and references of a supplier shown masked. Revealing one
  (`suppliers.reveal`) is audited and the clear value is shown once in a single
  live region that clears itself; it is never stored or cached. An add answers a
  minimal acknowledgement, so the page reloads to re-list.
- documents: filter by kind and status, create a draft with lines for all four
  modes, and on the detail page submit, finalise, cancel and reverse. Cancel and
  reverse need a reason; every confirmed action carries an `Idempotency-Key`
  that is reused for a retry of the same request.
- approval policy: read and change the threshold.
- reports: receiving summary and per-supplier activity (deleted suppliers are
  flagged).
- reconciliation: the read-only proof that documents and the ledger agree.

The screen never writes a balance: stock moves only when the endpoint posts
through the ledger. Editing a draft in place (`procurement.documents.update`)
is not on the screen and stays on the shrink-only coverage ledger; cancel and
re-enter instead.

No migration: every key was seeded by `sql/175`. A tenant created before it needs
`bun run identity-access:permissions:backfill` for its roles to see the screen.
The client asset budget is raised by 8,604 B for the one screen script.
