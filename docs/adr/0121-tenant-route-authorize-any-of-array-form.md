🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0121-tenant-route-authorize-any-of-array-form.id.md)

# ADR-0121 — `authorize` gains an any-of array form, still inside the chokepoint

- **Status:** Accepted
- **Date:** 2026-09-07
- **Decision maker:** ahliweb
- **Extends:** [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) — same chokepoint, same "no ad-hoc decision" rule; this ADR adds a third SHAPE for `TenantRouteConfig["authorize"]`, not a second decision path.
- **Related:** Issue #794 / PR #797 (`PATCH /api/v1/media/objects/{id}`, the route that needed this); `src/modules/_shared/tenant-route.ts` (`selectAnyAllowed`); `src/lib/auth/admin-screen.ts` (`selectEntryOutcome`, the sibling this mirrors); `tests/tenant-route-any-of.test.ts`; `tests/tenant-route-factory.test.ts`

## Context

`defineTenantRoute`'s `authorize` had two shapes: a single `AccessRequest` (the
common case — one permission gates the whole route), or a function of
`prepared` for the rare route whose required permission depends on the
request body. The function form has a documented, load-bearing carve-out:
when `prepare` itself refuses (bad body, missing header), `heldPrepareRefusal`
returns that refusal WITHOUT ever calling `authorizeInTransaction` — because a
function guard has no `prepared` to read yet, there is nothing to evaluate.
That carve-out is scoped, by name, to exactly two routes that genuinely cannot
defer (`POST /api/v1/partners/:id/status`, `POST /api/v1/access/machine-credentials`).

PR #797 needed a third thing: `PATCH /api/v1/media/objects/{id}` has no
permission common to every body shape it accepts (a status-only reviewer holds
`media.adjudicate_rights` but never `media.update`; a routine editor holds the
reverse). Its first cut picked `media.update` vs `media.adjudicate_rights` with
a function of the body — which matched `typeof config.authorize === "function"`
by accident, not by the property that carve-out exists for. The consequence was
live and measured: an INVALID body (missing `Idempotency-Key`) made the route
return its held `400` refusal for every caller, including a zero-permission
one, before `authorizeInTransaction` ran at all — no token checked, no
`awcms_access_decision_log` row written. `tests/e2e/api-authorization-first.e2e.ts`
caught it, and a live security review reproduced it.

The permission this route needs is NOT a function of the body — "does the
caller hold at least one of these two permissions" has a body-independent
answer. That question already had an implementation: `loadAdminScreen`'s
any-of entry guard (`selectEntryOutcome`), built for eight admin consoles whose
panels are independently readable. This ADR ports that shape onto
`defineTenantRoute`.

## Decision

**`authorize` accepts `AccessRequest | readonly AccessRequest[] | (context) => AccessRequest`.** The new middle form is any-of: the route is reachable once the caller holds AT LEAST ONE of the listed requests.

### When to use which form

- **Single object** (unchanged, still the default): one permission gates the
  whole route.
- **Array (this ADR):** the route has NO permission common to every caller it
  must admit, and which one applies does NOT depend on the request body — only
  on which permission(s) the caller happens to hold. The route's `handler`
  still makes the real, body-shape-specific `authorizeInTransaction` call(s)
  afterwards; the array only answers "is it worth opening the handler at all".
- **Function:** reserved for the narrower case the array cannot cover — the
  permission itself is computed from `prepared`, and no body-independent
  any-of question has a useful answer. This form CANNOT defer past
  `heldPrepareRefusal` (see below), which is why it stays a carve-out rather
  than the general case, and why PR #797's fix moved OFF this form instead of
  widening the carve-out to a third route.

### The invariants that make the array form safe

1. **Any-of, not all-of.** Allowed when at least one listed `AccessRequest`
   allows; refused only when every one evaluated refuses. Implemented in
   `selectAnyAllowed`, mirroring `selectEntryOutcome`.
2. **Every candidate that is evaluated goes through the real chokepoint** —
   `authorizeInTransaction`, sharing one read cache
   (`createAuthorizationReadCache`) so the session/tenant-state reads are not
   repeated per candidate — never an ad-hoc comparison. This is NOT the same
   claim as "every listed candidate always produces a decision-log row": the
   loop stops at the first ALLOW, so a candidate listed after one that already
   allowed is never evaluated and writes no row. Every candidate that is
   evaluated writes one — in particular, every DENIAL along the way does, and
   if all candidates deny, all of them do. This deliberately diverges from
   `selectEntryOutcome`, which evaluates every candidate because a screen has
   a per-panel `entry` readout to fill; a route has no such readout, and
   logging a permission the caller was never asked about would only add a
   decision row that misreads as "this was checked and denied" for a request
   that never needed it.
3. **An empty array denies.** `selectAnyAllowed([])` returns a `403`, never an
   allow — "no request authorizes this route" must never read as "any request
   does". **Verified in the current implementation** (not merely asserted):
   `tests/tenant-route-any-of.test.ts` calls `selectAnyAllowed([])` directly
   and asserts `allowed === false`. **Known caveat:** this is a RUNTIME
   invariant, not a type-system one — `readonly AccessRequest[]` does not
   forbid a route author from writing `authorize: []`, and TypeScript will not
   flag it. Nothing today constructs an empty array (`api:tenant-route:check`
   would need its own rule to forbid one at the call-site level, which this
   ADR does not add), so the safety net is the runtime deny path, exercised by
   a real unit test rather than left as an unenforced assumption.
4. **The reported denial is the FIRST candidate's**, not the last — routes
   list their primary permission first, so the response describes the refusal
   a caller is most likely asking about, and it does not shift with which
   permission a given caller happens to be missing.

### Why the array form does not fall into the `heldPrepareRefusal` carve-out

The carve-out's condition is `typeof config.authorize === "function"`. An
array literal's `typeof` is `"object"`, so the array form never matches it —
by construction, not by a route author's discipline. Concretely: it does not
read `prepared` at all, so there is nothing about it that a failed `prepare`
could invalidate, and it stays evaluable even when `prepare` refused. This is
the exact property PR #797's bug was missing: a guard that does not need the
body should never be gated behind the body having parsed successfully.
`tests/tenant-route-factory.test.ts` pins this behaviourally: an array-typed
`authorize` paired with a `prepare` that returns a `400` still reaches
`withTenant` (proven by an open circuit breaker turning that attempt into a
`503`, not the `400` the function-form carve-out would have returned early).

## Consequences

- **Positive:** a route with no single common permission no longer has to
  reach for the function form (and its carve-out risk) to express "any one of
  these is enough". `PATCH /api/v1/media/objects/{id}` is the first, and only,
  caller today.
- **Positive:** the property this ADR exists to protect — authorization
  answers before body validation — now has both the DB-gated e2e coverage that
  already existed and a fast, DB-free unit-level regression guard for the
  specific mechanism (array vs. function `typeof`).
- **Negative / trade-off:** a second any-of implementation now exists
  (`selectAnyAllowed` beside `selectEntryOutcome`), kept separate rather than
  shared because a route needs the original denial `Response` (`code`/
  `message` body) where a screen only ever needed a status number.
- **Neutral:** zero migrations, zero permission changes, zero OpenAPI change.
  The only behavioural change is `PATCH /api/v1/media/objects/{id}`'s own
  guard, covered by PR #797's existing integration tests.

## Alternatives considered

- **Widen the `heldPrepareRefusal` carve-out to a third route.** Rejected —
  that is the exact defect this ADR exists to stop repeating: a route whose
  guard only LOOKS like it needs the body, when the real question ("holds at
  least one of N permissions") does not.
- **Give the route a single, coarser permission** (e.g. require `media.update`
  for everything, drop `adjudicate_rights`). Rejected before this ADR, by
  PR #797 itself — it is the vulnerability the split exists to close: whoever
  can edit a credit line could also self-attest it cleared for publication.
- **Evaluate every listed candidate unconditionally, like `selectEntryOutcome`
  does.** Rejected — a route's `handler` has no per-candidate readout to fill,
  so the extra chokepoint call(s) would only add decision-log noise for a
  permission the request never needed.
