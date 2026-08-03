---
"awcms": minor
---

`/admin/blog-taxonomy` — the categories-and-tags console, third sibling of
`/admin/blog` and `/admin/blog-pages`.

Drives both `taxonomies.*` permissions. `configure` gates create, update AND
delete together, because `sql/036` seeds no per-verb rows — the permission is
the capability "manage taxonomy", not one flag per verb, and a screen that
invented `taxonomies.create` would gate on authority nothing honours.

Three deliberate absences, each held by the contract test:

- **no bin view and no Restore.** Term soft delete is one-way BY DESIGN (no
  restore route, no `taxonomies.restore` to build one against), so a bin would
  imply a way back that does not exist. The confirmation states the finality
  instead — copy promising recoverability is what made #351 hard to see;
- **no re-parenting on edit.** Neither term route detects cycles, so pointing a
  parent at its own descendant is accepted and every reader then walks forever.
  Create still offers a parent: a term with no children cannot close a loop;
- **no `Idempotency-Key`.** None of the three term endpoints reads it.
