🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0072-decision-log-retention-and-projection-authority.id.md)

# ADR-0072 — Retention for the authorization decision log, and who is authoritative afterwards

- **Status:** Accepted
- **Date:** 2026-08-09
- **Decision maker:** @ahliweb
- **Related:** Issue #427 (Wave 0 of #423), [`../awcms/program-model-keanggotaan-2026-08-09.md`](../awcms/program-model-keanggotaan-2026-08-09.md), [ADR-0037](0037-data-lifecycle-module-admission.md) (retention engine + legal hold), [ADR-0033](0033-abac-dynamic-policy-evaluator.md) (what writes the rows), [ADR-0049](0049-machine-credentials-and-session-introspection.md) §6 (what is DELIBERATELY not recorded)

## Context

### 1. The largest unbounded table in the repo

`awcms_abac_decision_logs` (`sql/005`) receives one row for **every**
authorization decision — allow and deny alike, on every terminal path of
`authorizeInTransaction`. At 100 req/s that is ~8.6 million rows/day.

It has **no retention whatsoever**. I recounted every `dataLifecycle` descriptor
in the repo — `logging.audit_events`, `form_drafts.*`,
`data_lifecycle.data_lifecycle_runs`, the `comments` abuse events,
`identity_access.password_reset_tokens`, the `site_search` query log,
`visitor_analytics.visit_events`, and the `seo` not-founds — and this table is not
among them.

What makes it different from the other big tables: it grows in proportion to
**traffic**, not to customer data. A tenant that adds not a single content row
still adds rows here every time its staff open a screen. And it is also the table
most needed during an incident — precisely when querying it is slowest.

### 2. Its purge job, if written today, would delete zero rows

`sql/022:177` gives `awcms_worker` only `SELECT` on this table. The generic
`data_lifecycle` executor runs as `awcms_worker`. Without `GRANT DELETE`, its
purge runs, reports success, and deletes nothing.

That failure does not sound like a failure. It sounds like "there was nothing to
delete".

### 3. The dispute that is born together with the retention

The `reporting` module uses this table as the cursor source for the
`access_audit_summary` projection, and its source description reads:

> append-only — every decision is logged once and **never updated/deleted**, the
> ideal `cursor_table` source

Adding retention **invalidates that claim**, and the consequence is not cosmetic.
The projection has two paths:

- **incremental** — accumulated forward via the cursor, never recomputed;
- **rebuild** — recomputed from the rows that **still exist**.

After the first purge, the two diverge. An operator who presses rebuild will
silently **destroy** the historical count and replace it with a smaller one,
without a single error.

So retention and projection authority are **one** decision. Deciding the first
without the second produces two numbers for one question, and nobody knows which
is right.

### 4. One claim in the original design turned out to be wrong

Issue #427 proposed an **ascending** `(tenant_id, created_at)` index, because
`archive-purge-job.ts` scans `ORDER BY <cursor> ASC` while the existing index
(`sql/005`) is descending.

Checked before writing: **PostgreSQL btrees can be scanned backwards**. The
`(tenant_id, created_at DESC)` index already serves
`WHERE tenant_id = $1 AND created_at < $2 ORDER BY created_at ASC` without an
extra sort. A second index would only add write load to the table that is
**written to most often in the whole repo** — a trade in the wrong direction,
bought for nothing.

## Decision

We decide to:

**A. Grant `awcms_worker` `DELETE`** on `awcms_abac_decision_logs` (`sql/091`),
and **not** add a new index. The migration header carries the §4 reasoning so
that the index proposal does not get born again.

**B. Register the `identity_access.abac_decision_logs` descriptor** with
`retentionClass: "audit_security"`, `executionMode: "generic"`, `hard_delete`,
`legalHold.precedence: "overrides_retention"`, and `partition.eligible: true`
(monthly, **not** automated — declaring eligibility is a statement about the
table, not a promise that the partitions exist).

**C. Set the default window to 365 days, not 90.** That number was **not** chosen
for storage. It is the horizon within which the `access_audit_summary` projection
can still be _rebuilt_. A shorter window would silently narrow what a rebuild can
reconstruct — which is the coupling in §3, hidden behind a number instead of
being stated.

**D. State the authority explicitly, and write it into the artifact the next
person will read**, not only into this ADR:

- The **incremental** counter is authoritative for all-time. It is unaffected by
  purge and is never recomputed.
- A **rebuild** is authoritative for "since the retention horizon". After the
  first purge it is **legitimately** smaller than the incremental number.

The projection's source description in `reporting/module.ts` is corrected to stop
claiming `never updated/deleted` and to state that coupling where an implementor
will read it.

**E. Enforce those two artifacts' honesty towards each other with a two-way
test**, not with review habit: once this table has a lifecycle descriptor, its
projection description may no longer claim rows are never deleted, and must name
the coupling.

## Consequences

- **Positive:** the largest unbounded table in the repo gets a bound; its purge
  job can actually delete; legal hold applies to it; and the
  incremental-vs-rebuild dispute becomes a written fact instead of a surprise
  when somebody presses rebuild.
- **Negative / trade-off:** two numbers for one question still EXIST — we chose to
  name them, not to delete one of them. Removing the rebuild path would throw away
  the repair tool; stopping the incremental accumulation would throw away the
  all-time answer. What this ADR can do is make sure both have a name and a scope.
- **Neutral:** retention does not take effect until
  `bun run data-lifecycle:archive-purge` is actually scheduled — the same lesson is
  already recorded for `AUDIT_LOG_RETENTION_DAYS` (Issue #146). A descriptor
  without a schedule is intent, not retention.
- **Neutral:** restoring a backup older than the retention window brings purged
  rows back to life. Harmless for authorization — nothing reads this table to
  decide anything — but a rebuild afterwards can reach further back than the live
  database.

## Alternatives considered

- **A 90-day window** — the first number the issue proposed. Rejected because it
  picks a number that hides the §3 coupling instead of confronting it: rebuild
  would stop being meaningful after one quarter with nobody stating it.
- **Exempt this table from retention because `reporting` depends on it** — the
  status quo. Rejected: it lets the largest table grow forever for the sake of a
  projection that has its own incremental counter, and that is exactly the tail
  wagging the dog.
- **Block rebuild for projections whose source has a lifecycle descriptor** —
  attractive, and firmer than §D. Rejected for this wave: it throws away the only
  projection repair tool in order to prevent one misreading, and that choice
  deserves its own ADR if someone wants its firmness. What must not happen is this
  coupling staying unwritten, and §D/§E close that.
- **Add the ascending index** — rejected, §4. It buys zero and pays with write
  load on the repo's busiest table.
- **`archive.archivable: true`** — rejected. A decision row records that a check
  ran and what its answer was; it does not carry resource attribute VALUES nor
  subject identity beyond `tenant_user_id` (ADR-0049 §6 states that is
  deliberate). Archiving it stores the stream of security decisions past the very
  window retention exists to close, with nothing recoverable from it.
