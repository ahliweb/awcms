---
"awcms": patch
---

perf(identity-access): the expiry job costs the same for twelve elapsed items as for one, and its SoD audit rows were never asserted

Both passes of `business-scope-expiry-job` issued one `INSERT` per expired item.
Both are capped at 500, so the worst case was **500 sequential statements inside
one transaction**, per tenant, per pass, across every tenant
`iterateTenantsInBatches` visits.

A bound of 500 is not a defence against a per-item query; it is the size at
which one starts to matter. It is more than twice the batch bound of the
scheduled blog sweeps that were flattened for exactly this reason.

- The assignment pass writes its `awcms_business_scope_assignment_events` rows
  with one `unnest` — an append-only log with no conflict target, and every
  column except the id is constant for the pass.
- The exception pass now uses `recordAuditEvents`, the batch form of the very
  writer its per-row loop was calling. **The rows are unchanged**: each expired
  exception still gets its own `critical` entry naming the rule that lapsed,
  because that is what an auditor reads one at a time. Only the number of round
  trips moved.

The asymmetry between the two passes is deliberate and stays: an assignment
expiring on schedule is routine and gets one summary event, an SoD exception
lapsing is a control coming off and gets one entry each.

**A gap this uncovered.** The SoD expiry test asserted the status flip and
nothing else — no assertion touched the audit rows at all. Moving that write to
a batch writer would have left every existing assertion in the file green even
if the batch had dropped its rows entirely. The test now checks the entry
exists, is `critical`, carries the resource id, and that `attributes.ruleKey`
reads back as a jsonb **object** rather than a jsonb string. Mutation-proven:
passing an empty batch fails it.

The budget is asserted as a **relation**, not an absolute: a run with twelve
elapsed assignments must cost exactly what a run with one costs. An absolute
number here would have to encode the fixed per-tenant overhead of every pass in
this job and would move for reasons unrelated to the defect. Measured through
`countPoolQueries`, because a job reaches its transaction itself via
`withTenantOrThrow` → `sql.begin` and counting only the pool's own tagged
templates would see none of the statements that matter.

Mutation-proven: restoring the per-item `INSERT` takes the twelve-item run from
17 queries to 28 — exactly eleven more, for eleven more items.
