🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0075-sse-reauthorizes-every-tick.id.md)

# ADR-0075 — An SSE connection re-authorizes on every tick

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision maker:** @ahliweb
- **Related:** Issue #467 (epic #463), [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (per-handler chokepoint), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (route seams other than `defineTenantRoute`), [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (decision log retention, which bounds the per-tick volume), [ADR-0074](0074-push-delivery-is-a-second-outbox.md) (the console that became its first consumer)

## Context

SSE can run in this repo: the Node adapter supports streaming, the middleware does not touch the body, no compression holds the buffer, and the edge cache does not break it. What had not been decided is **how long an authorization decision may be used**.

`defineTenantRoute` returns the connection to the pool and releases the work-class slot **before** a single byte flows to the client. For a JSON request that is correct and economical. For a connection that lives thirty minutes, it turns a momentary decision into a **standing permission**: a role revoked in the second minute does not stop the stream until the client disconnects on its own.

That is the opposite of the posture just enforced when closing R3 (#450), when all 32 admin screens were moved to decide at `authorizeInTransaction` rather than from an already-read set of grants.

What makes it ADR-worthy is not that SSE is dangerous, but that **its default is silent**. No gate can see "this decision is 30 minutes old": `access:chokepoint:check` counts handlers that decide, not how long the decision is used. An SSE endpoint that is correct by every rule this repo has today still produces a standing permission, and nothing will tell you.

## Decision

**Every tick opens a new transaction and calls `authorizeInTransaction` again.** The data snapshot is only read after that decision, inside the same transaction. A deny ends the connection — it is not skipped, not retried, and not logged as a transient error.

The cost is one guard chain per tick per connection. That is exactly the price of having no standing permission, and it is paid with eyes open: the tick interval is a parameter that must be written in every route, so the cost is always visible where it is chosen.

**Rejected** as an alternative: a short connection TTL with reconnect. It moves the question rather than answering it — with a 60-second TTL, a role revocation is still up to 60 seconds late, and now there are two numbers to keep consistent (the TTL and the tick interval) instead of one. It also trades one query per tick for one TLS handshake + one full guard chain per TTL, which is not necessarily cheaper and is certainly noisier in the logs.

### Four consequences that bind the implementation

**1. The first byte is written immediately, and the comment explains why.** Astro's `writeResponse` calls `writeHead()` without `flushHeaders()` (`node_modules/astro/dist/core/app/node.js`), and Bun holds the headers until the first `write()`. Measured twice independently with a real `node:http` under Bun: headers arrive at **+3013 ms / +3010 ms** when the first byte is delayed, and at **+1 ms / +0 ms** when it is written immediately (the #467 measurement, then reproduced while this ADR was being written — someone else's numbers are not taken as fact without repeating them). This means `EventSource.onopen` never fires and the client thinks its connection is hanging. The fix is trivial — write an SSE comment (`: ok`) immediately — and precisely because it is trivial the next person will "tidy it up" unless the reason is written next to it.

**2. `tx` must not enter the stream closure.** The connection has already been returned to the pool by the time the stream starts; holding it means using a connection that has been handed to another request. Every tick opens and closes its own transaction, and `tx` never lives longer than one tick.

**3. The tick loop lives in `src/modules/_shared/`, not in `src/pages/api`.** `api:tenant-route:check` rejects `withTenant` directly in a route, and that rule is not relaxed for SSE: what landed is a fourth seam in `tenant-route.ts`, alongside `defineTenantRoute`, `defineSelfServiceTenantRoute`, and `defineClientCredentialTenantRoute`.

**4. Multi-instance fan-out DOES NOT EXIST YET, and that is written down rather than left silent.** Production defaults to a single instance (`capacity-config.ts`), so every connection polls the database itself and that works today. It will not break when replicas are scaled up — per-connection polling stays correct — but it will not get cheaper either, and the pub/sub pattern that will replace it has a trap of its own: Bun's `RedisClient`, once it has `subscribe`d, blocks almost every other command, so its subscriber **must** be a separate connection, not the singleton used by the rate limiter. Noted here so that whoever scales replicas up finds it before, not after.

## Consequences

An SSE route in this repo can no longer be written without answering "how often does this re-decide" — the parameter is mandatory. A deny mid-connection closes the stream with a named terminal event, so the client can tell "permission revoked" apart from "network dropped" and does not reconnect forever to an endpoint that will reject it.

Every per-tick decision writes its own row in `awcms_abac_decision_logs`, because it genuinely goes through the chokepoint. That is real volume and it is stated up front: one five-minute connection with a five-second tick writes 60 rows. ADR-0072 already gave that table retention, so the consequence is bounded — but an aggressive tick interval on a busy endpoint is a capacity decision, not just a UX decision.
