🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0074-push-delivery-is-a-second-outbox.id.md)

# ADR-0074 — Push notification is a SECOND outbox, not a domain-event consumer

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision maker:** @ahliweb
- **Related:** Issue #465 (epic #463), [ADR-0006](0006-offline-first-sync-outbox.md) (the ban on network calls inside a transaction), [ADR-0029](0029-deployment-profile-aware-turnstile-bot-protection.md) (the "LAN/offline = zero third-party origins" contract), [ADR-0037](0037-data-lifecycle-module-admission.md) (retention framework), [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (the `GRANT DELETE` precedent for a purge worker)

## Context

Analysing the notification stack (Bun + FCM HTTP v1 + FCM Web + SSE + PostgreSQL Outbox) against this repo found that four of its five components fit, and that the path that **looks** most obviously right for wiring it up is the wrong one.

`awcms_domain_events` already exists, already has a dispatcher, already has a DLQ, and already has replay. Hanging push delivery off it is anyone's natural first move. It cannot work, and the reason is written inside its own files:

- `domain-event-runtime/application/dispatch-domain-events.ts` states in its header that CLAIM + handler + FINALIZE run in **one** transaction, **deliberately**, because its built-in consumers are same-process with no external I/O. Handlers are invoked inside that transaction.
- A push provider is an HTTP call to Google or to a browser vendor's endpoint. **ADR-0006 forbids network calls inside a DB transaction.**
- `domain-event-runtime/infrastructure/broker-adapter-port.ts` already writes the consequence up front: an out-of-transaction consumer "would need the lease-based shape back". That port is itself **dead code** — `getDomainEventBrokerAdapter()` has zero callers across all of `src/`, `scripts/`, and `tests/`.

What makes this worth an ADR and not just a comment: **no gate would catch it.** There is no check forbidding `fetch` inside `sql.begin`; ADR-0006 is enforced by review. An FCM consumer registered the most natural way would hold one pool connection for the whole round-trip to Google while holding a row lock, turn every network failure into an event rollback so that **already delivered** events are delivered again, and do it on a path `getProviderCircuitBreaker` does not protect — with all 37 gates green.

## Decision

**Push delivery gets its own outbox**, the `push_delivery` module, using the lease pattern already proven three times in this repo (`email-dispatch.ts`, `object-dispatch.ts`, `purge-queue.ts`): claim with `FOR UPDATE SKIP LOCKED`, lease by reusing `next_attempt_at` without a new column, send **outside** the transaction, finalize per row.

Three tables (`sql/093`): device subscriptions, the queue, and the delivery-attempt ledger. There is no `push_recipients` table — one queue row **is** one delivery unit, the same shape `awcms_email_messages` uses.

### What is decided alongside it, and why

**1. Endpoints and tokens are treated as credentials, not as addresses.** A Web Push endpoint and an FCM registration token are both bearer-ish: whoever holds one can push notifications to that device until it is rotated. Both get the same three-column discipline as an email address (`endpoint` / `endpoint_hash` / `endpoint_masked`), and the raw column is named in **one** file only.

This is also why a device token can never ride on a domain event even if someone wanted it to: `domain-event-runtime/domain/envelope.ts` rejects payloads whose keys contain the substring `token`. Events carry _who_ and _what_; resolution to an endpoint happens in this module.

**2. `subscriptionGone` is its own outcome branch, not `retryable: false`.** A push service answering `404`/`410`, or FCM answering `UNREGISTERED`, is not a send failure and not a provider outage — it is a subscription reporting itself dead. Folding it into "failed, do not retry" would leave headstone endpoints in the table collecting one permanent failure per message, forever. The dispatcher deactivates the subscription instead.

**3. Retention uses `delegated`, not `generic`.** `HighVolumeTableDescriptor` carries a `cursorColumn` and does **not** carry a status predicate, so the generic executor deletes purely by age. Pointed at a **queue**, that deletes rows still waiting to be sent: a message held behind a provider outage for longer than the retention window would vanish silently, and its vanishing would look exactly like successful housekeeping. Every DELETE in `push-queue-purge.ts` therefore names terminal statuses explicitly, and its cursor is `updated_at` — when the row stopped moving — not `created_at`, which would make a long-retried message look older than it is.

All three tables carry a descriptor from day one. There is no other option: `TABLES_PREDATING_THE_RULE` is closed to new tables and `BOUNDED_BY_DESIGN` is empty. Issue #468 records that six **existing** outbox tables still have none — this module must not join that list.

**4. `targetPath` may only be a same-origin path, validated before the row is written.** A push notification is rendered by the browser outside the page, and clicking it navigates wherever the payload says. A queue row that can carry an absolute URL is a stored open redirect with a system notification as its vehicle — arriving with this origin's own name and icon, which is a far better phishing primitive than a link inside a page. The validation is positive (allow-list + `new URL` round-trip), not a deny-list, because a deny-list is complete only until the next URL parser quirk.

**5. Credentials are per-DEPLOYMENT, never per-tenant.** An FCM service account belongs to one Firebase project; a VAPID key pair identifies one application server. Modelling them as tenant configuration means tenant A's admin can install keys that make this deployment speak as someone else.

Anything JSON-shaped must arrive **base64**: `scripts/validate-env.ts` parses `.env` line by line with its own parser, so a multi-line value is silently truncated — and the FCM service-account JSON is multi-line in its native form.

## What was REJECTED

**FCM Web (the `firebase/messaging` SDK in the browser).** Measured, not estimated: `firebase/app` + `firebase/messaging` = **45,041 B** after `bun build --minify` versus a **21,000 B** per-file ceiling, and the client total would become 185,049 B versus a 180,000 B ceiling. The headroom left today is only 39,992 B. That gate is in the `build` chain, which also runs inside the production image build — its red blocks the release.

The CDN path is closed too: this repo's CSP has six directives with no `connect-src` at all, and `tests/security-headers-csp.test.ts` locks the list with `toEqual` and asserts zero third-party origins when Turnstile is off — the realisation of the ADR-0029 contract "LAN/offline = zero third-party origins".

And it is **redundant**. `PushManager.subscribe()` is a browser API, not a `fetch` from page JS, so standard Web Push with VAPID gives the same result with zero SDK bytes, zero new `script-src` origins, zero new `connect-src` origins, and zero new `worker-src` (it falls back to `default-src 'self'`). FCM HTTP v1 is still used for native apps — that is purely server → Google and never touches CSP.

Written down here so that the next person to propose it reads the numbers first.

**Extending `awcms_domain_events` so it can call consumers outside the transaction.** That changes the execution model eight other consumers already rely on, for the sake of one consumer that needs a different shape. A second outbox separates the risk completely: a push failure cannot touch domain event delivery, and vice versa.

**Registering `broker-adapter-port.ts`.** It has zero callers and cannot work for this case according to its own docblock. Registering an adapter there would look like an integration while doing nothing at all.

## Consequences

The module lands **inert**: without `PUSH_ENABLED=true`, `dispatchPushQueue` claims not a single row — the feature-flag rule `email` already uses, and the one that ensures a deployment that never turns push on can schedule its job forever without piling up abandoned rows.

The real adapters (FCM HTTP v1 and Web Push/VAPID), the HTTP surface, the service worker, and the `/admin/push-notifications` console land through #466 in four separate PRs. The module starts `experimental` and becomes `active` only once its console exists — ADR-0021 criterion 1 rejects an `active` module without an admin screen, without exception, and an honest status was chosen over a carve-out for those three PRs.

The gap recorded here when this ADR was written — `enqueuePushToRecipients` with no production caller — is **closed** by `POST /api/v1/push/test`, a send probe to the caller's own device. It was chosen as the first caller because push fails in three places nothing in this system can see: a VAPID key pair that does not match the one the browser used when subscribing, a service worker registered at the wrong scope, and an OS permission silently withheld. All three produce a queue that drains clean and a device that shows nothing.

**Client-side numbers, restated so the §What was REJECTED comparison stays honest.** "Zero SDK bytes" is still true and that is exactly the claim, but the client side is not free: the service worker (5,515 B, copied verbatim from `public/` — a file there is never minified, and it cannot be bundled because registration is keyed to the script URL) plus the page registration script (4,659 B, bundled and minified) = **10,174 B**. The rejected FCM Web SDK costs **91,333 B** for the same work, breaches the 21,000 B per-file ceiling on both of its files, and demands three third-party origins. The difference is 9×, and the ADR-0029 CSP promise stays intact: `worker-src` falls back to `default-src 'self'`, the service worker is same-origin, and not a single directive changes.
