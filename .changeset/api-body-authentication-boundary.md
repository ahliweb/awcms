---
"awcms": minor
---

fix(security): 77 API endpoints handed their validation schema to any bearer token, and recorded nothing

Found by running the API rather than reading it:

```
POST /api/v1/blog/institutions   Authorization: Bearer nonsense
→ 400 VALIDATION_ERROR
  branch must be one of legislative, executive.
  name is required and must be at most 150 characters.
  slug is required.
```

No account, no session — any string at all in the `Authorization` header. Measured against a running server: **77 session-gated endpoints answered that way.**

### The disclosure is the smallest part of it

`authorizeInTransaction` is what writes the decision log. A request that short-circuits before reaching it is never recorded — so **enumerating the API left no trace at all**. Schema disclosure is the visible symptom; the missing audit trail is the finding.

The cause is ordering. `defineTenantRoute` checked that a token was *present*, then ran the route's `prepare` hook, which parses and validates the body. Hand-written handlers did the same thing by validating before `withTenant`.

### Why no gate saw it

Every static check in this repo was green on the day it was measured. Ordering between a `prepare` hook and a chokepoint call is not a text property: a textual "validation appears before authorization" scan reported **297 of 305** route blocks — a number wrong enough to be useless, and one I nearly reported before checking it against a server.

### One boundary, not 77 edits

`src/middleware.ts` now refuses a body-carrying API request whose credential does not resolve, before anything parses it. The per-route fix would have been 77 edits with no mechanism behind them — nothing stops the 78th route, and 63 of the 77 are hand-written handlers sharing no shape.

It also turns "which endpoints are reachable without a session" — until now implicit, and knowable only by reading 246 handlers — into `SESSION_FREE_BODY_ENDPOINTS`, where each of the 26 entries carries a stated reason.

**Authentication only.** Authorization stays at the ADR-0063 chokepoint and is not duplicated; a second place deciding what a caller may *do* is the drift this repo keeps paying for. The session is therefore looked up twice on a write — once at the boundary, once inside the route's own transaction — and that is deliberate: handing the route a principal resolved in a different transaction would split the decision from the read it guards, the exact hazard `loadAdminScreen` documents. Reads carry no body and never reach the boundary.

### The authorization half, in the factory

`defineTenantRoute` now **holds** a `prepare` refusal until authorization has answered. A caller lacking the permission gets `403` and a decision-log row instead of `400` and a schema; an allowed caller still gets their validation errors.

Authorizing before parsing would have been wrong for a documented reason: `await request.json()` waits on the *client*, so parsing inside `withTenant` holds a reserved connection and its work-class slot for as long as a caller chooses to take. Holding the refusal keeps both properties.

Two routes cannot defer — `POST /api/v1/partners/:id/status` and `POST /api/v1/access/machine-credentials` compute their guard *from* the body, so with no valid `prepared` there is no guard to evaluate. They return early, and what that leaves is bounded to callers who already hold a live session.

### Both halves proven by breaking them

| Mutation | Result |
|---|---|
| Boundary disabled, rebuilt, re-run | **185 assertion failures** across 92 endpoints |
| Blank reason on an exemption | pure gate red |
| Exemption naming a route that no longer exists | pure gate red |
| Trailing-slash variant of a protected path | pure gate red |

`tests/e2e/api-body-auth-boundary.e2e.ts` probes **every** body-accepting route against a running server and requires `401` unless declared exempt. It imports the exemption list from the module the middleware uses, so it cannot drift from the boundary it checks. A new public endpoint fails it until declared, with a reason.

Verified end to end: the leak returns `401`; a read-only session posting an invalid body to a factory route returns `403 ACCESS_DENIED` where it used to return the schema; the full e2e suite passes 27, so no legitimate authenticated write regressed.

Recorded as **C18** in `docs/awcms/standar-performa-dan-keamanan.md`, closed with its checker named, per that document's own rule.
