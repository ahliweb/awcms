---
"awcms": minor
---

feat(blog-content): an article can name the institution it is about

`sql/131` made institution the fourth classification dimension — a table rather
than a taxonomy type, because it carries a branch, a region code and its own
landing SEO. `sql/132` seeded its permissions.
`syncPostInstitutionAssignments` and `fetchPostInstitutionIds` were written, and
the first documents an "embedded `institutionIds?: string[]` on the post
payload, exactly like `syncPostTermAssignments`".

**That payload field never existed.** `institutionIds` appeared nowhere outside
its own directory file: the validator did not accept it, neither route passed
it, and both functions had **zero callers**. The dimension was schema, docs and
dead code — the writer landed and its readers never did.

### The write path

`institutionIds` joins `termIds` on create and update, deliberately sharing the
same shape validator (now `validateUuidIdList`) for the reason
`syncPostInstitutionAssignments` already gave: giving the two relations
different shapes would make the post endpoint's contract arbitrary.

Existence is checked with `countExistingInstitutions` before the write, so an
unknown id is a named 400 rather than a raw 500 from a bare FK violation — the
same treatment `termIds` gets. `GET` now returns `institutionIds` beside
`termIds`, read sequentially because two queries in parallel on one transaction
connection leak it.

### The picker

A separate fetch and a separate failure state from the term picker, because it
is a separate permission: `blog_content.institutions.read`, not
`taxonomies.read`. An editor can hold one and not the other, so folding them
into one request would blank both halves of the form on a single refusal.

Both pickers follow the rule established in #613: `institutionIds` is sent
**only** when the roster actually loaded. Absent means "leave the assignments
alone" and `[]` means "remove them all", so a failed fetch that sent `[]` would
silently unassign every institution on the next save.

### Note for the next change

The app asset surface is now **177,717 B against a 178,000 B budget** — 283 B of
headroom. That is deliberate rather than pre-emptively raised: the budget is
doing its job, and the next change should make its own case with its own
measurement, as ADR-0101 requires.
