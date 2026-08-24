---
"awcms": patch
---

fix(security): the other 59 endpoints that refused before authorization could record it

Gap C19's second and final bulk shrink. The ledger goes **70 -> 11**, and from
its opening measurement **121 -> 11**. Every one of the eleven survivors is a
named class with a reason rather than a leftover.

Same property as the first pass, and the same one-sentence rule: **move the
ANSWER, not the work.** These 59 validated the request body before `withTenant`
opened and RETURNED from there, so a tenant user holding no grant learned the
endpoint's field names, enum values and length limits — repeatedly, and without
producing an `awcms_access_decision_log` row, because ADR-0063 makes
`authorizeInTransaction` the one place a decision is recorded and nothing ever
reached it.

The body is still read and validated outside the transaction, because it must
be: `await request.json()` waits on the CLIENT, and doing that inside
`withTenant` holds a reserved connection and its work-class slot for as long as
a caller chooses to take. Only the refusal was held. The caller who is allowed
gets exactly the validation errors they got before.

**Two things deliberately did not move, and they are the same rule.** The
body-size ceiling is a PROTOCOL limit — refusing it tells the caller nothing
they did not already send. And request-SHAPE guards (a missing tenant header, a
missing token, a missing path parameter) are about whether this is a well-formed
request for this route at all, not about the resource behind it; a caller who
omitted their own path segment learns nothing from being told so.

**What stayed, by class:**

- Ownership-grant-basis reads (`PATCH` posts/pages, `submit-review`): the row is
  an INPUT to the decision, not a decision taken instead of it.
- Guards whose ACTION is read off the body: authorizing first would authorize
  against a guessed action.
- `submit-review`'s `MODULE_DISABLED`: a smaller disclosure of a different kind,
  and deferring it is a product decision about which of two true things to say.
- Three authentication-flow routes that never call `authorizeInTransaction` at
  all, so there is no chokepoint to move a refusal behind. Whether they should
  record anything is a question about the decision log's scope, not about
  statement order.

Enforced both ways by `tests/e2e/api-authorization-first.e2e.ts`, which drives a
live zero-permission session at every gated endpoint: an unlisted endpoint
answering anything but `403` is RED, and so is a listed one that answers `403`.
