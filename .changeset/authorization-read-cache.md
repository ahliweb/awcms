---
"awcms": patch
---

perf(identity-access): an admin screen resolved the same session eleven times to render one page

`/admin/blog` calls `can()` ten times on top of its entry decision. Each one is a
full `authorizeInTransaction`, and each re-resolved the same session, the same
permission set, the same delegated-grant state and the same platform tenant id —
on **one** reserved `interactive` connection out of eight process-wide.

Measured against a real database:

| | queries | wall time |
| --- | --- | --- |
| before | **89** | 47 ms |
| after | **29** | 23 ms |

(The finding estimated ~66 queries. The real number was 89.)

**The cache is an opt-in the caller supplies, not something inside the guard**,
and that is the whole safety argument. A memo keyed on `tx` inside
`authorizeInTransaction` would speed up every caller and would also change what a
caller sees after **it** has written: a route that grants a role and then
re-authorizes in the same transaction would read the grant set from before its
own write — silently, and only sometimes.

So `loadAdminScreen` creates one per render and passes it to the entry decision
and to every `can()` probe, because a screen render is a read path by
construction: the eleven decisions describe one moment and nothing writes between
them. Every other caller is untouched and keeps reading fresh.

**Inputs are memoised, never a decision.** Only the reads whose answer cannot
differ between two decisions about the same principal in the same transaction:
the resolved principal, the machine credential, the granted permission keys, the
delegated grant state, the platform tenant id. Module availability and
entitlement, the delegated-write rule, the machine-credential write ceiling,
business-scope facts, SoD, the policy evaluation and the decision log all still
run per request — the eleven decision-log rows are still eleven.

The test proves the decisions first and the speed second, because a cache that is
faster and answers differently is not an optimisation. It compares cached against
uncached decision by decision for an **allowed** render and a **denied** one; it
asserts two principals sharing one cache do not see each other's answers; and it
executes the safety argument directly — grant a permission mid-transaction,
re-authorize **without** a cache, and watch the answer change, which is exactly
what would not happen if the memo lived inside the guard.

Mutation-proven: dropping the token hash from the cache key turns the
cross-principal case red; making `cachedRead` ignore the cache turns the query
count red.
