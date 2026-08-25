---
"awcms": patch
---

fix(sync): a push batch had no count bound, and the write side of one protocol was capped while the read side was not

`POST /api/v1/sync/push` validated every event in the `events` array and never
the array's length. The only limit was the body tier:
`readTextBody(request, "large")` allows 5 MB, and a minimal event serialises to
a couple of hundred bytes, so one authenticated request could carry on the order
of **30,000 events**.

That is not merely slow. Each accepted event costs a compare-and-set on the
aggregate version plus an inbox `INSERT`, each conflicted one a conflict
`INSERT` — all sequential, all inside a single transaction that holds a
connection and keeps every aggregate row it has advanced locked until commit.
The cost is not the round trips; it is how long everything else waits behind
them.

Meanwhile `/sync/pull` has clamped reads to 500 since it shipped. The two halves
of one protocol had asymmetric bounds, and the unbounded half was the one that
writes.

`MAX_SYNC_PUSH_EVENTS` is now defined **as** `MAX_SYNC_PULL_EVENTS` rather than
as a second `500`, because the reason for the number is the relationship — a
node must not be able to push more in one batch than it can pull in one page.
`pull.ts` imports the same constant. Two independent literals that happen to
agree today are how the asymmetry comes back the next time one of them is tuned,
so the test asserts the relationship and not the value.

**Refused, never truncated.** Truncation on a write path silently drops events a
node believes it delivered: a node treats an accepted batch as accepted in full
and would advance its own cursor past events that never landed. This is the
bound posture #180 settled for the business-scope resolver — every bound refuses
rather than truncating. The read side clamps instead, correctly, because a
clamped page still says `hasMore`.

The refusal is reported as ONE error, not one per event. An error body carrying
a field error for each of 30,000 events is its own denial of service, and the
verdict does not depend on their contents. `maxItems: 500` and `minItems: 1` are
in the OpenAPI schema so the contract says it too.

**Found by a sweep, and it turned up a second thing.** Scanning `src/` for SQL
issued inside a loop found 34 sites. Most are bounded — by a code registry
(`append-domain-event`), by a declared cap (`MAX_NODE_ACTIVATIONS = 128`,
`MAX_SIDEBAR_ROWS`), or by a job's batch size — and several were already batched
(`/sync/objects` under #435). One was not bounded at all, above.

And one was a **twin of an already-fixed defect**.
`syncPostInstitutionAssignments` issued one `INSERT` per institution. Its own
docstring says it is "exactly like `syncPostTermAssignments`" — and it was, in
contract and not in cost: the term path was flattened to two statements when
`blog:legacy:import` made a 23,906-article archive its caller, and this path,
which the same importer drives through the same post payload, kept the loop. It
now uses the same `DELETE` + `INSERT ... unnest`, with its own budget file
because two budgets in one file go green the moment either regresses and the
other absorbs it.

A sibling that advertises itself as a sibling is the easiest kind of defect to
miss: whoever fixed the first one had already read the second and remembered
agreeing with it.

`replaceMenuItems` has the same shape and is deliberately NOT changed here — it
carries a self-referencing FK and its callers depend on the order of its
`RETURNING`, so it needs a decision rather than a drive-by. Recorded with the
rest of the sweep.
