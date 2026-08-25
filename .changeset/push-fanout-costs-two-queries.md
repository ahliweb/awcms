---
"awcms": patch
---

perf(push): a notification fan-out costs two queries instead of one per device

`enqueuePushToRecipients` cost `R + (R x S)` queries — one subscription lookup
per recipient, then one `INSERT` per device — all inside a single transaction
holding one connection. A notification to 500 users with two devices each was
1,500 round trips.

Nothing in production ever paid it, and that is the reason to fix it rather than
to leave it. The only caller today, `POST /api/v1/push/test`, passes exactly one
recipient. But the helper's whole contract is "every ACTIVE subscription of
every recipient", so the cost is not a property of the function as used — it is
a property waiting for the first caller that broadcasts, at which point it
arrives as a production incident rather than a review comment. This is the same
write-side blind spot the performance round found in the scheduled sweeps and in
`syncPostTermAssignments`: a per-item query inside a path hit once per save
looks like nothing until a bulk caller appears.

Now two statements regardless of fan-out: `fetchActiveSubscriptionIdsForUsers`
resolves every recipient in one round trip, and one
`INSERT ... jsonb_to_recordset` writes the whole batch.
`fetchActiveSubscriptionIds` is now a batch of one so the two cannot drift — a
predicate fixed in one and not the other is how a batch path quietly stops
matching the path everything was tested against.

`jsonb_to_recordset` rather than `unnest` for the reason `recordAuditEvents`
uses it: this table has four nullable columns and a `jsonb` one, and a Bun.SQL
array cannot carry NULL — it writes the literal string `'null'` without
throwing.

The cheap cases did not get more expensive to make the expensive case cheap:
zero recipients still costs zero queries, and every-recipient-skipped — the
COMMON case, since most users never enable push — costs one, not two.

Behaviour is unchanged, deliberately including the odd part: recipients are
still fanned out in the order given, and a caller passing the same id twice
still gets two notifications. That is arguably a caller bug, but changing it
here would be a silent behaviour change riding along with a performance fix.

Pinned by `tests/integration/push-enqueue-budget.integration.test.ts` — exact
budgets against a fixture of 4 recipients and 9 devices, which is 13 queries
under the old shape, so it cannot pass by accident. The tests read the rows back
out of the table as well as counting, because a `jsonb_to_recordset` rewrite is
exactly the kind of change that satisfies a counter while corrupting what lands:
`data` arriving as a jsonb STRING, or a NULL arriving as the literal text
`'null'`, are both silent. Mutation-proven: restoring the per-row `INSERT` fails
the two budget tests and passes every correctness one.
