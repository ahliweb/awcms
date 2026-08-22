---
"awcms": patch
---

fix(jobs): three scheduled jobs that reported success while doing nothing

Findings **D4**, **D5** and **D6** of the 17 August 2026 audit round. One PR
because they are one failure mode, and it is the one that survives every other
kind of check: the job runs, the exit code is 0, the summary prints a number,
and the number is wrong in the direction that looks fine.

**D4 — a dead branch, and a run that gave up on every remaining tenant.**
`visitor-analytics-rollup.ts` tested `if (result instanceof Response)` to detect
database backpressure. That shape only ever comes out of `withTenant`; this loop
calls `withTenantOrThrow`, which **throws** `DatabaseBusyError` instead. So
`tenantsSkipped` was permanently 0, the `partial` warning built on it could never
fire, and — the part that actually cost something — a busy database abandoned
every tenant after the first instead of skipping one. The rollup targets a single
day, so an abandoned run is a permanent hole: tomorrow's pass rolls up tomorrow.
Skipped tenants are now caught, **named** (`--date=` is the remedy and it needs
the ids) and the loop continues. The catch is deliberately narrow — anything that
is not `DatabaseBusyError` still reaches the job runner, or the fix would
reintroduce the bug it is fixing.

`visitor-analytics-purge.ts` carries the identical dead branch and is fixed the
same way. It is the more serious of the two: it is what **enforces** retention,
so an abandoned run means every tenant after the first keeps holding visitor data
past its window — and the summary's own `(WARNING: … database busy)` clause,
gated on the permanently-zero counter, could never print.

**D5 — `failures=0` while a whole source had stopped indexing.**
`failureCount` sums per-**document** failures across the sources that finished. A
source whose reconcile threw never reached `results.push`, so it contributed
nothing to that sum, and the `break` meant every source after it went
unattempted. The engine returned `status: "failed"`;
`scripts/site-search-reconcile.ts` summed the number and never looked at the
status. `site-search:reconcile complete … failures=0`, exit 0, public search
silently frozen.

The engine now reports `failedSources` and `unattemptedSources` — named, and
separate from `failureCount`, because collapsing a dead source into a document
counter is how "0" came to mean "one whole source stopped". The script checks
`status`, prints both lists, and exits **1**. The `break` stays: a source failing
on a database error leaves the transaction aborted, so continuing would only
produce a cascade of `25P02`s. That case now gets caught **per tenant** instead
of rejecting out of the whole loop — the same lesson as D4.

**D6 — a ledger that recorded contact that never happened, and a breaker one bad
address could open.**

`EmailDeliveryResult` gains `skipped`. When the Mailketing breaker opens
*mid-pass*, `send` refuses without calling out; the dispatcher was writing a
`failure` row into `awcms_email_delivery_attempts` and burning a `retry_count`
for it, so a breaker that opened part-way through a batch could push the rest to
terminal `failed` without one of them having been sent. Such a message now
returns to `queued` untouched — no attempt row, no retry spent — counted as
`deferred` and printed in the summary.

Separately, the adapter was feeding the breaker for two **per-message business
rejections**: a message with no recipient, and a `2xx` body carrying
`status: "failed"`. Six invalid addresses in one batch was enough to open it and
stop email for the whole deployment, including the password-reset messages that
are the reason the module exists. Both now leave the breaker alone, and the
HTTP-status branch adopts the split the sibling port already documents
(`push-delivery/domain/fcm-error-mapping.ts`): 429 and 5xx are statements about
the service, every other 4xx is about the message. A bad API token — the one
shape that hides among those rejections — is `email:provider:health`'s job, and
unlike the breaker it can tell an operator *which* problem it is.
