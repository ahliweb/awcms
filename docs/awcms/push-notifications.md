🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](push-notifications.id.md)

# Push Notifications — Auth Secret at Rest and Rollout Runbook

Scope: the `push_delivery` module (ADR-0074), specifically how the RFC 8291
per-subscription `auth_secret` is stored (Issue #1089, follow-up to #1082). The
module itself is described in `src/modules/push-delivery/README.md`.

Operator test matrix, real-device UAT status and go/no-go checklist:
[`push-notifications-test-matrix.md`](push-notifications-test-matrix.md) (Issue #1107).

## What changed

`awcms_push_subscriptions.auth_secret` was plaintext, readable by `awcms_app` and
`awcms_worker`. It is now **ciphertext** in `auth_secret_ciphertext`
(`sql/314`): AES-256-GCM through the shared ADR-0137 helper, under its own key
ring `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` (same `keyId:base64,...` format and
rotation rule as `TELEGRAM_CHAT_ENCRYPTION_KEYS`: the first key writes, every key
reads).

The AAD is `(purpose, tenant_id, endpoint_hash)`. This mirrors
`awcms_telegram_bindings.chat_ciphertext` (which binds the row `id`) with one
deliberate difference: registration is an upsert keyed on
`(tenant_id, endpoint_hash)`, so the surviving row's `id` is unknown until the
statement has run, whereas the hash is known beforehand and never changes. A
ciphertext copied to another subscription or tenant fails authentication.

## Trade-offs decided

| Decision                                              | Choice                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key ring absent at registration                       | **Fail closed**: `503 PUSH_MISCONFIGURED`, nothing stored; `GET` reports `webPush.enabled=false`                                                                                                  | A legacy-plaintext fallback would keep writing rows the backfill must chase, so the rollout could never converge, and it would silently keep the exact exposure this change removes. A device that cannot register can retry once the key is set; a leaked secret cannot be recalled. `fcm` rows carry no secret and need no ring.                                                                                                                               |
| Dispatcher, row has ciphertext                        | Decrypt; **never** fall back to plaintext                                                                                                                                                         | A fallback would let a stale plaintext shadow a failed (tampered/moved) ciphertext.                                                                                                                                                                                                                                                                                                                                                                              |
| Dispatcher, row has no ciphertext                     | Use legacy plaintext                                                                                                                                                                              | Transition window only; ends with the backfill and the column drop.                                                                                                                                                                                                                                                                                                                                                                                              |
| Dispatcher, ciphertext but no ring / key rotated away | **Retryable** failure with a fixed message                                                                                                                                                        | Operator-fixable configuration; the message is not lost.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Dispatcher, ciphertext fails authentication           | **Non-retryable** failure                                                                                                                                                                         | Tampered or moved data; retrying cannot help.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Row holds both columns                                | Refused by CHECK ("exactly one")                                                                                                                                                                  | A stale ciphertext must not shadow a newer plaintext.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Plaintext column                                      | **Kept** in this change (phase 1)                                                                                                                                                                 | A migration cannot encrypt; dropping it before the backfill would destroy every existing subscription's secret.                                                                                                                                                                                                                                                                                                                                                  |
| Worker grants                                         | `INSERT` revoked; `UPDATE` narrowed to `status, disabled_reason, last_success_at, updated_at, auth_secret, auth_secret_ciphertext` (pinned in `WORKER_COLUMN_GRANTS`); `SELECT` and `DELETE` stay | The worker could rewrite `endpoint`/`p256dh_key`, or DELETE a row and INSERT it back with an attacker endpoint and the victim's copied ciphertext (the same `id`/`endpoint_hash`). It **can** still delete a subscription (the purge needs it; only stops notifications) and write the two secret columns (the backfill needs it; garbage there makes delivery fail, it cannot redirect it). It **cannot** insert, or change the endpoint, its hash or the keys. |
| Row identity at delivery                              | The dispatcher refuses (non-retryable, fixed message) a row whose `endpoint` does not hash to `endpoint_hash`                                                                                     | Defence in depth: the hash is the ciphertext AAD, and a forged row must not be delivered with a decrypted secret. Checked outside the DB transaction, so a refusal never counts as a database failure in the circuit breaker.                                                                                                                                                                                                                                    |

## Operator runbook: rollout order

Order matters. Doing step 4 before step 1 or 2 stops registrations (by design);
doing the column drop before step 5 loses secrets.

1. **Generate and store the key ring** (secret store, not the repo):
   `PUSH_AUTH_SECRET_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)`. It must
   differ from every other ring. Provide it to the **app**, `push:dispatch` and
   `push:auth-secret:backfill` (it is in `ops/awcms-jobs.env-allowlist`).
   `bun run config:validate` checks it when `PUSH_PROVIDER=web_push`.
2. **Deploy the release** (runs `sql/314`: adds the column, relaxes the CHECK,
   narrows worker UPDATE). From here: new/re-registered devices are ciphertext;
   old rows still deliver from plaintext.
3. **Run the backfill once** (as `awcms_worker`):
   `bun run push:auth-secret:backfill`. Idempotent and resumable: re-run it after
   a crash or a non-zero exit (exit 2 = a tenant hit the batch cap; exit 1 = no
   key ring). It converts in bounded keyset batches, one transaction per batch.
4. **Verify**: `bun run security:readiness` check "Push subscription auth secrets
   are encrypted at rest" must PASS (it reports the plaintext row count while any
   remain; severity warning, since mid-rollout is expected).
5. **Later (separate PR, after every deployment passes step 4)**: a migration
   drops `auth_secret`, tightens the CHECK to require the ciphertext, and the
   `awcms_push_subscriptions.auth_secret` entry is removed from
   `WORKER_CREDENTIAL_COLUMN_EXCEPTIONS`.

### Rotation

Operator runbook (Issue #1098; the same procedure applies to the Telegram ring,
see below):

1. Prepend a new key (`k2:<new>,k1:<old>`) to `PUSH_AUTH_SECRET_ENCRYPTION_KEYS`
   and deploy. The first key writes, every key reads, so nothing breaks while rows
   still carry `k1`.
2. Run `bun run push:auth-secret:rekey` (the `--rekey` mode of the backfill
   script). It re-encrypts every row whose ciphertext key id is not the active
   key. Idempotent, resumable and batched (keyset), runs as `awcms_worker`, and
   never prints key material or ciphertext. Exit codes: `1` no valid ring, `2` a
   tenant did not finish (run it again), `3` some rows could not be decrypted under
   the ring (they are counted and left untouched; this means a key they were
   written under is already missing from the ring: put it back, re-run).
3. Check `bun run security:readiness`, check "Push auth-secret ciphertexts are
   under the active key". It prints the row count per key id (counts only) and
   warns while any row remains under a key other than the active one.
4. Only when that check passes, remove `k1` from the ring and deploy. Removing a
   key id still in use makes those rows undeliverable (retryable failure, "ring
   lacks the key"). After a key COMPROMISE, run steps 1-4 immediately; the old key
   is retired as soon as step 3 is green.

**A re-key only rewraps; it does not undo a compromise.** Anyone who held the old
key and a copy of the data (database, backup, replica) can still read the secrets
they copied. After a compromise treat the push subscriptions as exposed: force
re-subscription (disable the rows, so each device registers again with a fresh
secret) and purge backups per policy. Telegram chat ids are disclosed PII.

**Last resort for rows that cannot be decrypted** (re-key exit code `3`, their key
is gone for good): the readiness check cannot go green while they remain. Disable
the push subscriptions (`disablePushSubscription`, or purge them through the
retention sweep) so devices re-subscribe; for Telegram, end the bindings with
`endBindings` so users re-link. Do not edit ciphertext by hand.

A re-registering device is also re-encrypted under the active key automatically.

#### Telegram chat ring

`TELEGRAM_CHAT_ENCRYPTION_KEYS` (`awcms_telegram_bindings.chat_ciphertext`) has the
same gap and the same procedure with `bun run telegram:chat:rekey` and the
readiness check "Telegram chat ciphertexts are under the active key". One
difference: this job runs as `awcms_app` (`DATABASE_URL`), not as the worker,
because the binding guard trigger (`sql/216`) refuses every other role any write
of a live chat ciphertext, so a worker holding the key ring cannot re-point a
binding at another chat. The trigger cannot tell a re-key from a swap, so it is
deliberately left as it is. Revoked and erased bindings carry no ciphertext and are
not touched; the hash ring `TELEGRAM_CHAT_HASH_KEYS` is a separate ring and is not
affected.

### Rollback

Rolling the **application** back to a release without this change while rows are
ciphertext breaks delivery for those rows (the old code reads only `auth_secret`)
and makes the old registration upsert fail the "exactly one" CHECK. Roll forward
instead, or null the ciphertext only for rows you can re-collect. The migration
is additive; there is no down migration.

### Known limits

- ~~Rotation has no re-key mode / no per-key row count~~ **Resolved (Issue #1098):** `bun run push:auth-secret:rekey`, `bun run telegram:chat:rekey` and the per-key-id readiness checks. See Rotation.
- ~~Registration takes a device over from another user in the same tenant~~ **Resolved as an explicit, audited transfer (Issue #1098), see below.** The residual risk is accepted: a tenant user who knows another user's exact endpoint (a capability URL, masked everywhere) can still move that device to themselves; the secret is not disclosed.

### Endpoint re-registration by another user (Issue #1098)

Registration is keyed on `(tenant_id, endpoint_hash)`. When the same endpoint is
registered by a different tenant user than the one who holds the row (**whatever
its status**: active, disabled or revoked), the row **moves to the new user**. Trade-off, decided:

| Option                                   | For                                                                                            | Against                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refuse when the owner differs (rejected) | Closes the takeover outright                                                                   | The endpoint belongs to the **browser profile**: on a shared browser the second user could never receive notifications, with no way to learn why. |
| Transfer, silently (before)              | Works on shared browsers                                                                       | The previous owner stops receiving notifications and nothing says so.                                                                             |
| **Transfer, explicit and audited (now)** | Works on shared browsers; the move is visible, attributable and reversible by an administrator | A tenant user holding the raw endpoint can still take a device; detection, not prevention.                                                        |

What the transfer does, in the **same transaction** as the registration:

- the row's `tenant_user_id` becomes the new user; the previous user's still
  queued notifications (`queued`, `retry_wait`) for that device are cancelled with
  `last_error = 'subscription_transferred'`, and later fan-out for the previous
  user skips the device. Revoking or disabling a device cancels its pending
  messages the same way. Defence in depth: every message carries
  `recipient_tenant_user_id` (`sql/315`, set at enqueue), and the dispatcher
  refuses, non-retryably and with a fixed message, any message whose recipient is
  no longer the subscription's owner. So nothing addressed to the previous user
  reaches the new owner, including a message already claimed (`sending`) when the
  transfer commits and one revoked-then-re-registered by someone else. The only
  residual window is a transfer committing between the dispatcher's owner check
  and the provider call, which delivers under the previous owner's now-stale
  secret and is undecryptable on the device;
- one audit event `push_delivery` / `subscription.transfer` (`push_subscription`,
  severity `warning`) records the subscription id and the previous and new
  `tenant_user_id`. **Ids only**: never the endpoint, the keys or the secret. If
  writing the audit event fails, the registration fails and rolls back (fail
  closed);
- the "previous owner" is read with the row **locked** (`SELECT ... FOR UPDATE`
  after an `INSERT ... ON CONFLICT DO NOTHING`), so two concurrent registrations
  cannot both believe they were the first. Re-registering one's own device or a new
  device records no transfer.

### Logging

The plaintext secret and the ciphertext appear in no log line, audit row, event
or API response; dispatcher failure messages are fixed strings.

## Declarative Web Push payload and rollout (Issue #1106)

`web_push` can now emit WebKit's **Declarative Web Push** shape instead of the
legacy one. Only the encrypted plaintext changes; VAPID, `aes128gcm` (RFC 8291),
subscriptions, recipient binding and the queue are untouched (the RFC 8291 test
vectors are unchanged).

| Format        | Plaintext JSON                                                                             |
| ------------- | ------------------------------------------------------------------------------------------ |
| `legacy`      | `{ title, body, targetPath?, data? }` (default)                                            |
| `declarative` | `{ web_push: 8030, notification: { title, body?, navigate, silent: false, tag?, data? } }` |

- **Switch:** `PUSH_PAYLOAD_FORMAT=legacy|declarative`, default `legacy`; an
  unknown value behaves as `legacy` and `config:validate` rejects it.
  `declarative` additionally requires `APP_URL` to be an `https:` URL without
  credentials (`config:validate` enforces it), because `navigate` is an
  **absolute https URL on the configured public origin**.
- **`navigate` is derived, never trusted:** the producer joins the queue's
  already-validated same-origin `targetPath` onto `APP_URL`'s origin (never the
  request Host header). Off-origin, protocol-relative (`//`, `/\`),
  `javascript:`/`data:` and other schemes fail closed to `<origin>/admin`. The
  service worker re-checks the origin when the notification arrives and again on
  click.
- **Size/content:** title must be non-empty (else the message is sent as
  legacy), title is capped at 120 and body at 240 characters, the whole payload
  at 2,048 bytes (else legacy). The legacy payload gets the same title/body caps and is always shrunk to fit one record (`data`, then `targetPath`, are dropped as a last resort); `tag` is capped at 64. Nothing beyond the existing `title`/`body` is
  added; no icon or image is taken from the payload.
- **No PII or secrets in `targetPath`:** it travels in the clear inside every
  notification URL (including the query string), is capped at 512 characters,
  and browsers that render declarative pushes natively bypass the service-worker
  click check, so producer validation is the only wall for them.
- **Service worker (dual reader):** `public/push-sw.js` reads both shapes
  regardless of the switch and shows exactly **one** notification per `push`
  event (`tag` from `tag` or `data.category` coalesces). Browsers that render the
  declarative shape natively do not wake the worker, so there is no second
  banner. Malformed, empty or non-JSON payloads show the generic fallback.
  Scope, registration path and cache policy are unchanged.

### Rollout (two stages)

1. **Ship the release with `PUSH_PAYLOAD_FORMAT` unset.** Producers keep sending
   legacy; the new worker is delivered through the normal service-worker update
   (`/push-sw.js` is served `max-age=0`, so browsers revalidate it on their next
   update check, at most about 24 hours later, or on the next navigation).
2. **After at least one full service-worker update cycle (24 hours, the browser update-check ceiling) has passed since deploy**, set
   `PUSH_PAYLOAD_FORMAT=declarative` on the app and `push:dispatch` (it is in
   `ops/awcms-jobs.env-allowlist`) and restart them. Verify with
   `bun run config:validate`, then send a test from `/admin/push-notifications`
   to a Chromium device and an installed iOS/iPadOS 18.4+ PWA. Provider HTTP
   acceptance is not device display: confirm the banner on the device.

An older registered worker that predates the dual reader would read a
declarative message as an untitled payload and show the generic fallback;
that is why stage 2 waits for propagation and why legacy stays the default.

### Rollback

Set `PUSH_PAYLOAD_FORMAT=legacy` (or unset it) and restart the app and
`push:dispatch`. No subscription, queue row or migration is involved, nobody has
to re-subscribe, and messages already in flight in either shape are still read by
the dual-reader worker. Do **not** roll the worker file back to a release that
cannot read the declarative shape while the producer still emits it.

## Installable admin on iPhone/iPad (Issue #1105)

Web Push on iOS/iPadOS 16.4+ is delivered only to a web app **added to the Home
Screen and opened from its icon**. A Safari tab has no `PushManager`, so it can
never receive background push. This change makes the admin installable and
guides the person there; it adds **no new sender, service worker or push
origin** -- delivery is still the Bun/VAPID path of ADR-0074.

### What ships

- **One origin-level manifest**, `GET /manifest.webmanifest`
  (`src/pages/manifest.webmanifest.ts`, contract in
  `src/lib/pwa/web-app-manifest.ts`): `id`, `start_url` and `scope` are all
  `/admin/`, `display: standalone`. Name, short name and colours come from
  deployment config (`PWA_APP_NAME`, `PWA_APP_SHORT_NAME`, `PWA_THEME_COLOR`,
  `PWA_BACKGROUND_COLOR`; defaults `AWCMS Admin`/`AWCMS`/`#2563eb`/`#ffffff`),
  **never** from the request `Host` or a tenant row. Cache is
  `public, max-age=3600, must-revalidate` -- the manifest may refresh; it is not
  `immutable`.
- **Self-hosted icons** in `public/icons/` (192, 512, maskable 512, and
  `apple-touch-icon` 180), generated deterministically by
  `bun run pwa:icons:generate`. They are a neutral placeholder mark; replace the
  four PNGs (same names and sizes) for deployment artwork.
- **Head links from the shared admin layout only**
  (`src/layouts/AdminLayout.astro`): `rel=manifest`, `rel=apple-touch-icon`,
  `theme-color`, `apple-mobile-web-app-*`. CSP is unchanged (`manifest-src` and
  `img-src` fall back to `'self'`); `public/push-sw.js`, its path and its scope
  are untouched.
- **Guidance in `/admin/push-notifications`**: capability detection
  (`serviceWorker` + `PushManager` + `Notification`) and standalone detection
  (`display-mode: standalone` / `navigator.standalone`); the user agent is used
  only to choose between "install it" and "this browser cannot". States: `ready`
  (button offered; permission is requested **only on the click**), `denied`
  (explanation, button withdrawn -- the browser will not prompt again, so there
  is no retry loop), `ios-install` (Add to Home Screen, open from the icon,
  then enable), `ios-update` (installed but OS older than 16.4), `unsupported`.
  Strings are English + Indonesian; the panel is an `aria-live` region.

### Identity and tenancy

The installed identity is `<origin>/admin/`. Two deployments never collide
(different origins). Within one deployment all tenants share one admin origin
and therefore one installed app; the tenant is whatever the signed-in session
selects. Per-tenant manifests are **out of scope** and a future extension via
`tenant_domain` (resolve from the verified primary domain, keep `id` per origin).
Changing the origin (new domain, protocol, or port) creates a **different**
installed app and a different push subscription: the old Home Screen icon must be
removed and the new one added, and notifications re-enabled.

### Install, uninstall, permission reset (operator/user guide)

- Install (iOS/iPadOS 16.4+): Safari -> Share -> Add to Home Screen -> Add; open
  from the icon; sign in; `/admin/push-notifications` -> Enable on this device.
- Uninstall: long-press the icon -> Remove App. Then use "Turn off on this
  device" first if possible; a stale server row is disabled automatically when
  the push service reports it gone.
- Permission reset: iOS Settings -> Notifications -> the app (or Settings ->
  Apps -> Safari -> Advanced -> Website Data for a browser tab). After a denial
  the page cannot ask again.
- Consent/privacy: permission is requested only after a deliberate tap; no
  notification text carries sensitive personal data (ADR-0074 payload rules);
  a subscription is personal data under UU PDP 27/2022 and is handled by the
  existing subscription lifecycle. No compliance claim is made without evidence.
- Online-first / offline-LAN: push requires internet reachability to the push
  service. An offline/LAN deployment shows push as unavailable and promises
  nothing; the OS may delay or drop notifications.

### Known limitation to verify on a device

`scope` is `/admin/` as decided, while the login page (`/login`) is outside it.
Opening the installed app while signed out redirects to `/login`; iOS may present
that navigation with an in-app browser bar. Confirm in UAT whether this is
acceptable or whether the scope should be widened (a separate decision).

### UAT status: PENDING (human)

Installability on real iOS/iPadOS 16.4+, Chrome Android/desktop and macOS has
**not** been exercised. Record device, OS version, screenshots and repro steps
here before deploying, and keep **subscription acceptance** (server row created)
separate from **device display** (notification actually shown). Do not deploy
without that evidence.
