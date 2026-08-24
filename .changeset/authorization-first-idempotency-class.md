---
"awcms": patch
---

fix(security): 51 endpoints refused a tenant user before authorization could record that they did

Gap C19's largest uniform class, retired. The ledger goes **121 -> 70**, and the
`400 IDEMPOTENCY_REQUIRED` half of it goes **54 -> 3**.

ADR-0063 made `authorizeInTransaction` the one place an access decision is taken
AND the one place it is recorded. A route that refuses before reaching it
refuses invisibly: no `awcms_access_decision_log` row, nothing for an audit to
read, nothing to alert on. These 51 refused a missing `Idempotency-Key` header —
and in most cases the body's field names, enum values and length limits right
after it — from outside the transaction, so a tenant user holding no grant could
map an endpoint's contract repeatedly and leave no trace of having been there.

**What moved is the ANSWER, not the work.** The body is still read and validated
before `withTenant` opens, because `await request.json()` waits on the CLIENT and
doing that inside a transaction holds a reserved connection and its work-class
slot for as long as a caller chooses to take. The refusal is held and returned
after authorization has spoken. The caller who is allowed still gets their
validation errors; the caller who is not gets `403` and leaves a row.

The body-size ceiling deliberately did NOT move: a PROTOCOL limit tells the
caller nothing they did not already send, and it must stay ahead of everything.

**Three of the 54 stayed, and they are a class, not a remainder.**
`comments/admin/:id/moderate`, `comments/admin/bulk-moderate` and
`seo/redirects/:id/lifecycle` read their guard's ACTION off the body
(`decision === "approve" ? "approve" : "reject"`). Authorizing first there means
authorizing against a GUESSED action — whatever the ternary falls back to when
the body is invalid — so a moderator holding only `approve` who sent a typo
would be told `403` for a permission their request never needed. That is a worse
answer than the one being fixed, not a smaller one, so they are recorded in the
ledger's structural section alongside the three already there, with the two ways
out named (split the route per action, or check the union of both permissions
first). Both are product decisions.

Two follow-on corrections fell out of doing it: `tenant/domains/:id/verify`
carries the proven key forward from phase 1 rather than re-reading it across
three phases, and `media-finalize-upload-session` takes a discriminated union
instead of nullable fields — a shape that let both be absent would have needed a
non-null assertion further down, which is how an invariant stops being checked.

Enforced, both directions, by the sweep that measured it:
`tests/e2e/api-authorization-first.e2e.ts` fails when an unlisted endpoint
answers anything but `403` (the debt growing) AND when a listed one answers
`403` (an entry that was fixed and must be deleted).
