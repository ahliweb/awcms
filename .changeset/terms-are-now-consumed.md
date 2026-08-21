---
"awcms": patch
---

chore(api): the taxonomy endpoint is now CONSUMED, not merely promised (#597)

`ahliweb/awcms-astro#66` landed the category and tag archives, so
`/api/v1/blog/terms` moves from `COMMITTED_PATHS` to `CONSUMED_PATHS` and the
pinned count goes four to five — the same number that repo's own gate asserts,
derived from its source with comments stripped.

This is the third step of the sequence ADR-0104 records, and it is not
bookkeeping. Breaking a consumed path breaks a build that exists today;
breaking a committed one breaks a design that has been agreed and not yet
built. The two deserve different care, and the distinction only survives if
entries actually move — the state that once let three non-calls sit in
`CONSUMED_PATHS` describing calls that never happened.

The frozen fixture is unchanged in shape: the same seven paths were already
frozen, only their justification moved.
