🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `push_delivery`

Transactional outbox for device push notifications (epic #463, ADR-0074).

This module **delivers** notifications that someone else decided to send. It has no opinion about what deserves to be notified — exactly like `email`, which is likewise generic infrastructure and not a "send a receipt" feature.

## Why a SECOND outbox

`awcms_domain_events` already has a dispatcher, a DLQ, and replay, so hanging push off it is the natural first move. It cannot:

- `domain-event-runtime/application/dispatch-domain-events.ts` states in its own header that CLAIM + handler + FINALIZE run inside **one** transaction, **deliberately**, and the handler is called inside it;
- a push provider is an external HTTP call, and **ADR-0006 forbids that inside a DB transaction**;
- `broker-adapter-port.ts` already writes the consequence down up front — an out-of-transaction consumer "would need the lease-based shape back" — and that port itself has zero callers.

What makes this worth writing down rather than merely knowing: **no gate will catch getting it wrong.** An FCM consumer registered the most natural way will hold a pool connection for the whole round trip to Google while holding a row lock, and turn every network failure into an event rollback — so an event that **has** been delivered is delivered again — with all 37 gates green.

## Its shape

Three phases, copied from `email/application/email-dispatch.ts`:

1. **CLAIM** — one short transaction flips due `queued`/`retry_wait` rows to `sending` (`FOR UPDATE SKIP LOCKED`), reusing `next_attempt_at` as the claim deadline. No new lease column. The lease is **read back**, not merely written: a `sending` row whose lease has expired is re-claimed by the next pass, and that is what stops a worker that died mid-pass from leaving a row in permanent limbo.
2. **SEND** — calls `PushProvider` **outside** any transaction.
3. **FINALIZE** — one short transaction per row: `sent`, or `retry_wait` with backoff, or terminal `failed`. Every attempt is recorded.

The accepted trade-off is the same as for both of its siblings: a crash in the narrow window after the provider accepted but before FINALIZE can produce one duplicate notification. For push that is one repeated banner — clearly better than a notification stuck forever.

## What this dispatcher does and email's does not

It can **disable its own target**. A push service answering `404`/`410`, or an FCM answering `UNREGISTERED`, is not a send failure and not a provider outage — it is a subscription reporting itself dead. `subscriptionGone` is therefore its own result branch, not `retryable: false`: folding it in there would leave tombstone endpoints collecting one permanent failure per message, forever.

## An endpoint is a credential

Web Push endpoints and FCM registration tokens are both bearer-ish. Both use the same three-column discipline as an email address (`endpoint` / `endpoint_hash` / `endpoint_masked`), and the raw column is named in **one** file: `application/subscription-directory.ts`. That rule is holdable precisely because only one file names it.

## Behaviour when off

Without `PUSH_ENABLED=true`, `dispatchPushQueue` **claims not a single row** and never touches a provider. That is the feature-flag rule `email` already uses, and it is what makes `bun run push:dispatch` safe to schedule in any deployment profile including offline/LAN.

`bun run push:queue:purge` on the contrary runs **regardless of** that flag: a deployment that turns push off still has rows from the time it was on, and those are exactly the rows nothing would ever clean up.

## Retention: `delegated`, not `generic`

`HighVolumeTableDescriptor` carries a `cursorColumn` and does **not** carry a status predicate, so the generic executor deletes purely by age. Pointed at a queue, that deletes rows **still waiting to be sent** — and their disappearance looks exactly like successful housekeeping. Every DELETE in `application/push-queue-purge.ts` names the terminal statuses explicitly, and its cursor is `updated_at` (when the row stopped moving), not `created_at`.

All three are deleted in FK order — attempts, messages, subscriptions — because each is the child of the next.

## FCM HTTP v1 adapter

`PUSH_PROVIDER=fcm` — server → Google, for **native** Android/iOS clients. It never touches the browser, so zero bytes in the client asset budget and zero new CSP origins; that is why ADR-0074 kept FCM HTTP v1 while rejecting the FCM Web SDK.

**No dependency.** The service-account assertion (RFC 7523) is signed RS256 through `crypto.subtle`, mirroring the `src/lib/auth/jwt-verify.ts` precedent that refused to add `jose` for JWT verification. The access token is cached per process, keyed by `client_email`, and never written to Redis/Postgres — it is a live bearer credential, and storing it at rest to save one HTTP call an hour is a trade in the wrong direction.

**Credentials must be base64** (`PUSH_FCM_CREDENTIALS_BASE64`): `config:validate` parses `.env` line by line, and a service account's `private_key` is a multi-line PEM block — pasted raw, it is silently truncated at the first line and the failure surfaces on the first send, not at boot. The parser is **pure** and is used by both `config:validate` and the adapter, so the validator cannot disagree with the thing it validates.

**Three things that are subtle and deliberate:**

- **A dead token does NOT trip the circuit breaker.** A normal queue carries thousands of stale tokens; if those counted as provider failures, one batch of old registrations would stop delivery to every healthy device — and the symptom ("push has stopped") points at FCM. Only signals about the SERVICE trip it: transport failures, 429, and 5xx.
- **The error code is read before the status.** FCM overloads statuses in both directions, and 401 is the sharpest case: it is at once "access token expired" (no code) and `THIRD_PARTY_AUTH_ERROR` (APNs/web credentials an operator has to fix). The first version of this function checked the status first, and a test caught it.
- **A 401 is refreshed exactly ONCE.** A token that expires mid-batch costs one extra call, not the whole rest of the batch; a fresh token that is still rejected is a credential problem and stops there.

`healthCheck` proves the **credentials**, not the send path — sending a real notification needs a real device token, and inventing one would be answered `UNREGISTERED`, which is a healthy FCM reporting failure.

## Web Push adapter (VAPID)

`PUSH_PROVIDER=web_push` — RFC 8030 + 8291 + 8292, for the **browser**. This is what ADR-0074 chose instead of the FCM Web SDK, and the reason is measurable: that SDK is 45,041 B against a 21,000 B per-file ceiling, **and** demands three third-party origins in a CSP that has none at all. The adapter itself runs entirely server-side: `PushManager.subscribe()` is a browser API, not a `fetch` from a page script, so **zero SDK bytes and zero CSP origins**.

The client side is not free, and the numbers are stated so that comparison stays honest: the service worker (5,515 B) plus the page registration script (4,659 B) = **10,174 B**, against the **91,333 B** of the rejected SDK. Its service worker is not minified because it is a `public/` file — and it has to be there, because registration is pinned to the script URL and a content-hashed name would change every build and then abandon every subscription from the previous build.

**Its encryption is verified against the RFC vectors, not by round trip.** This is the riskiest part of the whole push programme, and the reason needs stating: a push service **does not validate the payload**. It forwards the ciphertext to the browser, and a browser that cannot decrypt it discards that notification **silently**. A wrong key schedule therefore produces a system that accepts every message, records every send as a success, and delivers nothing at all — without a single error anywhere.

A round-trip test cannot catch that: it proves the encryptor and the decryptor agree, not that either matches the specification. So `tests/push-web-push-adapter.test.ts` reproduces RFC 8291's own worked example — **every published intermediate value** (`ecdh_secret`, `PRK_key`, `IKM`, `PRK`, `CEK`, `NONCE`) **and the final body, byte for byte**. Those numbers come from a third party; reproducing them is proof of interoperability.

HKDF is written on top of `crypto.subtle` HMAC instead of using `deriveBits({name:"HKDF"})`, precisely so those intermediate values are **observable** — `deriveBits` does extract-then-expand as one opaque operation.

**Subtle details:** the server ECDH key pair is **ephemeral per message** (RFC design, not an optimisation nobody got to yet — one reused pair makes every notification to a given subscriber share a key schedule); the VAPID `aud` is the endpoint's **origin**, not the endpoint itself (signing the full endpoint is the classic mistake whose symptom is a 401 and reads like a key problem); the ES256 signature is **raw r||s**, 64 bytes, not DER.

The VAPID token is cached per **origin**, so one batch of 500 Firefox subscribers costs one signature, not 500.

`bun run push:vapid:generate` prints one key pair in exactly the shape `.env` wants — together with the warning that **rotating it does not re-key existing subscriptions**, it makes all of them permanently undeliverable until their users subscribe again.

## HTTP surface

Two classes of endpoint, and the split is an authorization decision — not file arrangement.

**A caller's OWN devices are self-service** (`defineSelfServiceTenantRoute`, ADR-0049 §7). `GET|POST /api/v1/push/subscriptions` and `DELETE …/{id}` check no permission at all, because the subject is the caller: the answer to "may I subscribe in this browser?" is "you are holding its session". Those routes **never accept a `tenantUserId`** — it comes from the resolved session and from nowhere else, so there is no id to compare against anything.

Inventing `push_delivery.subscriptions.create` would instead be exactly the latent-authz trap this repo has already been bitten by: an action seeded into no role denies **everyone including the owner**, while the calling code reads as though it were correctly gated. Push notifications are for ordinary users; a permission wall in front of them is a wall in front of the feature.

**Anything touching someone else's rows, or making the deployment send real traffic, goes through the chokepoint.** Three permissions, and that is all of them: `diagnostics.read`, `messages.cancel`, `diagnostics.check`.

Ownership on revocation is enforced **inside the `WHERE`**, not by read-then-compare: there is no window between the two, and no decision to be taken about a row already read but not allowed to be touched — precisely how an existence oracle is born by accident. "Does not exist", "belongs to someone else", and "already revoked" all answer the same **404**.

Revocation by the user also **destroys the stored endpoint**, unlike `disablePushSubscription`, which keeps it as evidence. The difference: one records what the push service said about an endpoint that is already dead; this one records what the PERSON said about an endpoint that may still be perfectly alive. The row stays (an operator still needs to know that device was revoked and when), the credential does not.

`endpoint = EXCLUDED.endpoint` in the upsert is its mandatory counterpart, and without that thought it looks like a redundant line: the conflict target is the HASH of that very column, so in every ordinary case the value is identical. It exists for one case — a device re-subscribing after a revocation would come back `active` while still pointing at a tombstone: healthy-looking in the console, undeliverable in reality.

### Send probe

`POST /api/v1/push/test` sends to the caller's **own** devices, with a **fixed** title and body, and takes no recipient parameter. That is a security boundary, not a simplification: a test endpoint that accepts a recipient is an arbitrary-notification surface — system-branded text, chosen by the sender, with a click target, landing on any colleague's lock screen. Notification text is the most trusted text this application can put in front of a person.

Why the probe needs to exist at all: push fails in places nothing in this system can see — a VAPID key pair that does not match the one the browser used when subscribing, a service worker registered at the wrong scope, an operating system silently withholding permission. All three produce a queue that drains clean and a device that shows nothing.

## Service worker and console

`public/push-sw.js` is served same-origin from a **fixed** path, so its scope is `/` without needing a `Service-Worker-Allowed` header, and `worker-src` falls back to `default-src 'self'` — no CSP directive changes.

It is not bundled by Astro for three reasons, and the third is only visible by actually fetching it from a built server:

1. registration is pinned to the script URL, so a content-hashed name changes every build and abandons every subscription from the previous build;
2. its path has to be stable so that `PUSH_SERVICE_WORKER_PATH` can name it;
3. `dist/client/_astro/**` is served `Cache-Control: public, max-age=31536000, immutable`, while this file is served `public, max-age=0`. An `immutable` service worker is a service worker a browser may keep **for a year without revalidating** — a bug fix here would reach nobody, and its only symptom would be the old behaviour.

The cost: it is never minified, because `public/` is copied as is.

Two of its behaviours need stating because both look optional and are not:

- **A push with no payload still shows a notification.** Some push services send a contentless "tickle", and a payload that fails to decrypt is unusable. Silence is not a safe default: the browser **requires** a visible notification for every push, and answers a silent one with its own "this site was updated in the background" — and then, if it repeats, by revoking the permission.
- **The click target is resolved against this origin and then compared.** `push-target-path.ts` already validates before the row is written, so this is the second wall — but this is the code that actually navigates, and a notification carrying this site's name and icon is the most convincing open-redirect vehicle there is. `new URL(path, origin)` is what makes it decidable: protocol-relative `//evil.example/x` resolves to another origin and is caught, while a "starts with `/`" string test would let it through.

The icon is **not** taken from the payload — it would be fetched when displayed, handing the recipient's IP address and the fact that they are online right now to whoever picked the URL.

`/admin/push-notifications` deliberately combines two audiences on one page: the top half self-service ("notifications on this device", no permission), the bottom half the tenant queue (`diagnostics.read`). Both answer one shared question — "I turned notifications on and nothing arrives" is answered by the device panel (is this browser subscribed?) and the queue panel (did anything get queued? what did the push service say?) — and an operator forced to correlate two screens will be correlating two moments in time.

## What is NOT there yet

- **FCM Web (browser SDK).** Rejected, with the numbers, in ADR-0074 §What was REJECTED.
