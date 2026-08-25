---
"awcms": patch
---

perf(blog): syncing a menu costs two queries instead of one per item, and two claims about why it couldn't be were wrong

`syncMenuItems` issued one `INSERT` per menu item — the third instance of the
shape `syncPostTermAssignments` and `syncPostInstitutionAssignments` already
had fixed, and the one deferred as needing "a decision rather than a drive-by".

**Both halves of that stated reason were wrong, and they were mine.**

The note called the function `replaceMenuItems`. No such function exists. The
name was written from memory instead of read from the signature, and it reached
a GitHub issue, a merged PR body, a merged changeset and both copies of
`PROJECT_STATE` before anything caught it — nothing checks a function name that
appears only in prose.

The note also said its callers depend on the order of its `RETURNING`. They do
not. `blog/menus/[id].ts` fills the same response field from `syncMenuItems`
(roots-then-children) or from `fetchMenuItems` (`ORDER BY sort_order`) depending
only on whether the request supplied `items` — the endpoint already answers in
two different orders, so no client can be depending on either. That claim was
inferred from the presence of a `RETURNING` clause, never verified.

With both checked, nothing needed deciding:

- The self-FK is `NOT DEFERRABLE`, and a `NOT DEFERRABLE` foreign key is checked
  by an AFTER ROW trigger that fires at the end of the **statement**, not after
  each row. Verified against a real Postgres with the child listed **first** —
  the arrangement that must fail if checking were per-row. One multi-row
  `INSERT` is therefore safe whatever the order within it.
- `RETURNING` was not needed at all. `MenuItemInput` carries all seven columns,
  `tenantId`/`menuId` are parameters, the table has no user triggers, and no
  `DEFAULT` applies to a column that is always given a value — so the clause read
  back exactly what had just been sent.

Now one `DELETE` and one `INSERT ... jsonb_to_recordset`
(`jsonb_to_recordset` rather than `unnest`: four nullable columns, and a Bun.SQL
array cannot carry NULL — it writes the literal string `'null'` without
throwing).

Behaviour is unchanged, including the returned roots-then-children order. It is
kept because it is what this function returns and changing it would be a silent
API change riding along with a performance fix — but its docstring no longer
claims the ordering is load-bearing for the FK, because it is not.

**One test in the first draft asserted something false and passed.** A case
named "a child listed BEFORE its parent still lands" claimed the old code could
not have done it. It could: `syncMenuItems` filters roots and children itself,
so the caller's order never reaches the `INSERT`, and the case passed under the
per-item loop too. It now asserts what it actually covers — input order changes
neither what lands nor what returns — and the file header states outright that
the FK property is **not** reproducible through this function, so the case is
not mistaken for evidence of it later.

Mutation-proven on both real properties: dropping a field from the batch so the
stored row diverges from the input reddens "what it RETURNS is what the table
holds" — the check that makes building the answer from input safe at all — and
restoring the per-item loop reddens the budget.
