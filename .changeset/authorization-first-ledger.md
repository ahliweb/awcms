---
"awcms": minor
---

test(security): 121 endpoints refuse a tenant user without recording that they did

The previous change closed the caller who is *nobody*. This one measures the caller who is *somebody with no grant* — a shape every tenant has, and the one no static gate can reason about.

Driving a session holding **zero permissions** at every gated body endpoint:

| Answer | Count |
|---|---|
| `403 ACCESS_DENIED` — authorization first, correct | 84 |
| `400 VALIDATION_ERROR` — the endpoint's schema | 61 |
| `400 IDEMPOTENCY_REQUIRED` | 54 |
| `404` — an existence lookup ran first | 3 |
| `422` / `401` | 3 |

### The finding is the missing rows, not the status codes

ADR-0063 made `authorizeInTransaction` the one place a decision is taken — and the one place it is **recorded**. A route that refuses before reaching it refuses invisibly: no `awcms_access_decision_log` row, nothing an audit can read. So *"which endpoints answer something other than 403"* is the same question as *"which refusals leave no trace"*, and the answer was **121**.

### A ledger that may only shrink, enforced in both directions

`tests/e2e/api-authorization-first.e2e.ts` drives the sweep. `support/authorization-first-ledger.ts` lists what answers early today.

- An endpoint **not** listed that answers anything but `403` → red. The debt cannot grow.
- An endpoint **listed** that answers `403` → red, because it was fixed and its row must be deleted. Without this second direction a ledger fills with stale rows and becomes wallpaper.

Both are mutation-proven: the 121 entries were *generated* by the first direction failing, and adding one stale row turned the second red.

This is the shape `api:tenant-route:check` already uses in this repo. It is not an approval — it makes an invisible property visible and bounded.

### One route fixed, as the worked example

`POST /api/v1/media/news-images/upload-sessions` used to tell a caller with no `media_library.media.create` grant whether this deployment has R2 configured (`502`), and if so its exact accepted MIME types and size ceiling (`400` + field errors) — recording nothing. It now holds both refusals until authorization has answered.

The body is still read and validated *outside* the transaction, because `await request.json()` waits on the client and doing it inside `withTenant` holds a reserved connection for as long as a caller chooses to take. Holding the refusal keeps both properties. The held value is a discriminated union rather than two correlated nullables, so the code reads `held.value` where it would otherwise have asserted `input!`.

### Three entries are structural, and are listed rather than exempted

`PATCH /api/v1/blog/posts/:id` and `/blog/pages/:id` read the row before authorizing because the ownership **grant basis** (ADR-0063) is computed from `authorTenantUserId` and `status` — the read is an input to the decision, not a decision taken instead of it. `PATCH /api/v1/partners/:id/status` and `POST /api/v1/access/machine-credentials` compute a stricter permission *from* the body.

They are on the ledger anyway. "There is a reason for it" and "it is fine" are different claims, and only the first is true.

### What is genuinely exempt

Self-service routes (`defineSelfServiceTenantRoute`): the subject **is** the caller, so there is no permission to check and nothing to record. `POST /api/v1/auth/preferences` answering `200` to a zero-permission user is the product working. They are excluded by the helper their source calls, so the exemption cannot outlive its reason.

### Two traps the spec had to be built around, both recorded

**It logged itself out.** Sweeping every route with a live session hit `POST /api/v1/auth/logout`, and every request after that answered `401` — a self-inflicted false negative that reads exactly like a passing gate. Session-destroying endpoints are skipped by name, and the spec now asserts its session is live *before* drawing conclusions from any refusal.

**Several "findings" dissolved on inspection.** Status codes alone suggested five existence oracles and an outbound provider call. Reading the sources: `push/subscriptions` is self-service with a *documented* anti-oracle `404`, and the `502` is a local env-config check, not a network call. They are reported here as what they are rather than as fixes.

Full e2e suite: 30 passed. `bun run check` green.
