---
"awcms": minor
---

Add the `/admin/domain-events` operator console and put `domain_event_runtime` in the admin sidebar.

The module shipped consumers, deliveries, retry/dead-letter and replay with no screen, so the only way to see why an event never arrived — or to unstick it — was `curl`. Under ADR-0051 the screen belongs here.

All five of the module's permissions are driven from this one page: the consumer registry with pause state and backlog counts (pause/resume), the delivery list filtered by status/consumer/event type with replay on dead-lettered rows, and the outbox itself with a payload inspector. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially; every mutation posts to the guarded endpoint.

The interesting part is the idempotency split, which the screen reproduces exactly: `replay` sends an `Idempotency-Key` because each call does new work (it enqueues another attempt), while `pause` and `resume` send none because setting a flag twice has the same end state — `resume` takes no body at all. Sending a key to `pause` would imply a replay contract that endpoint does not have; omitting it on `replay` would render a button that always fails with `IDEMPOTENCY_REQUIRED`.

`tests/admin-domain-events-page-contract.test.ts` pins all five permission keys against what the routes enforce and the descriptor declares, pins the three-way idempotency split per request rather than as a global count, and asserts the endpoints themselves still disagree the way the page assumes. The module-specific trap: pause and resume are opposite actions sharing ONE permission, `consumers.manage` — `consumers.pause` and `consumers.resume` read better and are seeded nowhere, so inventing them would hide both buttons from every operator including the owner.

`MAX_REASON_LENGTH`, written out twice, moves to `domain-event-runtime/domain/reason-bounds.ts`.
