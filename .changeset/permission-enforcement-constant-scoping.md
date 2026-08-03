---
"awcms": patch
---

Fix `access:permissions:enforcement:check` reporting enforced permissions as unenforced.

The gate resolved `const NAME = "value"` bindings across the whole repo as one
flat namespace. `MODULE_KEY` is bound in five files to four different values, so
the "a name bound to two values is unresolvable" rule silenced it everywhere —
including in the file that binds it one line above its own guard. The guards in
`src/pages/api/v1/analytics/settings.ts` were therefore invisible, and
`visitor_analytics.settings.read`/`.update` were recorded in the exception list
as permissions nothing enforces, with a stated reason the route disproves.

Constants now resolve file-first (`resolveConstantsForSource`); the cross-file
table is consulted only for names a file does not bind itself, which is exactly
the set that can only have arrived by import. A name a file binds twice to
different values stays unresolvable. Both exception entries are removed; the
score moves from 199/205 with 6 exceptions to 201/205 with 4.
