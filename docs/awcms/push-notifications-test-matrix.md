🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](push-notifications-test-matrix.id.md)

# Push Notifications — Operator Test Matrix and Runbook

Scope: Issue #1107. Evidence plan for the Bun Web Push sender
(`bun run push:dispatch`, ADR-0074) together with the installable iOS admin
(#1105) and the declarative payload (#1106). It reuses `/admin/push-notifications`,
`POST /api/v1/push/test`, `GET /api/v1/push/diagnostics` and the existing
scripts; it adds **no** new console, queue or sender. Background and rollout:
[`push-notifications.md`](push-notifications.md).

## 1. The four words that must not be confused

| Term                      | What it means                                                                                                             | Who can observe it                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Subscription accepted** | The browser created a `PushSubscription` and the server stored a row (`awcms_push_subscriptions`, `status=active`).       | Server (`/admin/push-notifications` device list).       |
| **Provider accepted**     | The push service (Apple/Google/Mozilla/Microsoft) answered HTTP **201/202**. Queue row becomes `sent`; attempt `success`. | Server only. **This is the most the product can know.** |
| **Device shown**          | A person saw the banner on the device (or on the lock screen).                                                            | A human on the device. Never inferred from the server.  |
| **Clicked / navigated**   | Tapping the banner opened the app on the intended same-origin page.                                                       | A human on the device.                                  |

`sent` in the queue, `last_success_at` on a subscription and the
`push.dispatch.sent` log line all mean **provider accepted**. A 201 does not
promise display: the service may hold the message for an offline device, drop it
at the TTL, or the device may suppress it (Focus/DND, permission revoked, app
removed). Do not report "delivered to device" from provider acceptance, and do
not claim any delivery percentage from it.

Message lifecycle on the server: `queued -> sending (claim lease) -> sent |
retry_wait -> sending ... | failed | cancelled`. A `410/404` also disables the
subscription. Every try writes one `awcms_push_delivery_attempts` row.

## 2. Current delivery parameters (inspected, not changed)

| Parameter          | Value / location                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Push TTL       | 4 hours (`DEFAULT_TTL_SECONDS` in `web-push-provider.ts`). After that the push service drops an undelivered message.                              |
| Worker cadence     | `push:dispatch` every minute in `deploy/cron/awcms.crontab`, every 2 minutes in `ops/awcms-jobs.crontab` (one tenant at a time, `flock`-guarded). |
| Claim lease        | 2 minutes (`PUSH_DISPATCH_LEASE_MINUTES`); a `sending` row past its lease is re-claimed.                                                          |
| Retry              | `PUSH_SEND_MAX_RETRIES` (default 3); backoff `2^n` minutes capped at 15; retryable = 429, 5xx, transport error/timeout.                           |
| Provider timeout   | `PUSH_SEND_TIMEOUT_MS`, default 10,000 ms.                                                                                                        |
| Dead subscriptions | 404/410 -> subscription `disabled`, queued messages cancelled; no retry.                                                                          |
| Duplicate window   | A crash after the push service accepted but before the row is marked `sent` can re-send once (accepted trade-off, see the dispatcher header).     |
| Circuit breaker    | Shared key `push-delivery`; 404/410 and permanent 4xx do not trip it, 429/5xx/transport errors do.                                                |

No change is proposed: there is no operational baseline yet that would justify
new thresholds. Revisit after real-device evidence (section 5) exists.

## 3. Automated coverage (replayable, no device)

Run with `bun run test` (unit, no database) and, for the integration rows,
`DATABASE_URL=<postgres> bun test tests/integration/<file> --timeout 60000` in its
own process. All of them stop at **provider accepted**.

| #   | Scenario                                                                                                          | Test file(s)                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A1  | Enqueue -> dispatch -> provider accepted (201) -> `sent`, attempt row, no double send; **both** payload formats   | `tests/integration/push-operator-matrix.integration.test.ts` (#1107)                                        |
| A2  | 429 / 503 / transport timeout: `retry_wait`, backoff, not re-sent early, later accepted                           | same (#1107)                                                                                                |
| A3  | Retry ceiling reached -> `failed`; permanent 403 -> `failed` at once                                              | same (#1107)                                                                                                |
| A4  | 404 / 410 gone -> subscription disabled, out of later fan-out                                                     | same (#1107); mapping in `tests/push-web-push-adapter.test.ts`                                              |
| A5  | Tenant A's dispatch never reaches tenant B; RLS hides B's rows                                                    | same (#1107)                                                                                                |
| A6  | Unsubscribe/revoke cancels queued messages, nothing sent afterwards                                               | same (#1107); also `push-rekey-takeover` (disable cancels queued)                                           |
| A7  | Worker crash mid-batch: lease respected, reclaimed after expiry, no double send; two concurrent workers send once | same (#1107)                                                                                                |
| A8  | Recipient-bound dispatch, endpoint transfer, audit with ids only, L1 in-flight claim                              | `tests/integration/push-rekey-takeover.integration.test.ts` (#1098)                                         |
| A9  | Auth secret encrypted at rest, legacy/ciphertext delivery, wrong-row ciphertext refused                           | `tests/integration/push-auth-secret-at-rest.integration.test.ts`, `tests/push-auth-secret*.test.ts` (#1089) |
| A10 | Enqueue query budget, `data` as jsonb, one row per device                                                         | `tests/integration/push-enqueue-budget.integration.test.ts`                                                 |
| A11 | RFC 8291 vector, VAPID (RFC 8292), headers, response mapping                                                      | `tests/push-web-push-adapter.test.ts`, `tests/push-fcm-adapter.test.ts`                                     |
| A12 | `legacy`/`declarative` payload shape, hostile `navigate`, size bounds, SW dual reader and click handling          | `tests/push-payload-format.test.ts` (#1106)                                                                 |
| A13 | Registration validation, ownership in the statement, diagnostics never expose the endpoint                        | `tests/push-http-surface.test.ts`, `tests/push-delivery.test.ts`                                            |
| A14 | Admin page contract, manifest/installability                                                                      | `tests/admin-push-notifications-page-contract.test.ts`, PWA manifest tests (#1105)                          |

Not automatable and therefore **not claimed**: banner display, lock-screen
behaviour, Focus/DND, OS delivery delays, click navigation on a real device.

## 4. Real-device UAT matrix (status: PENDING, human)

Every cell below is **PENDING (human)**. No row may be marked passed without the
evidence in section 6. Columns are separate on purpose: a row can have
"provider accepted" while "device shown" fails.

Legend for cells: `PENDING` = not yet exercised. Fill with `PASS`, `FAIL` (log it
in section 7) or `N/A`.

| #   | Device / mode                                                             | Subscription accepted | Provider accepted | Device shown | Click navigates | Unsubscribe stops |
| --- | ------------------------------------------------------------------------- | --------------------- | ----------------- | ------------ | --------------- | ----------------- |
| U1  | Chrome desktop, tab closed, browser running                               | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U2  | Chrome desktop, browser fully quit (OS may restart it)                    | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U3  | Chrome Android, app backgrounded and screen locked                        | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U4  | Edge desktop (Windows/macOS)                                              | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U5  | Firefox desktop                                                           | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U6  | macOS Safari (web push, Safari 16+)                                       | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U7  | iOS/iPadOS 16.4 - 18.3, installed PWA, closed and locked (legacy payload) | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U8  | iOS/iPadOS 18.4+, installed PWA, closed and locked (declarative payload)  | PENDING               | PENDING           | PENDING      | PENDING         | PENDING           |
| U9  | iOS Safari **tab only** (not installed)                                   | expected unsupported  | n/a               | n/a          | n/a             | n/a               |

Behavioural checks, each recorded per device where it applies:

| #   | Check                                                                                                                                                                                                                                      | Result  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| C1  | Focus / Do Not Disturb on: banner suppressed, appears in the notification list after Focus ends or not at all (record which)                                                                                                               | PENDING |
| C2  | Device offline, then online within 4 h: message arrives late; offline longer than the 4 h TTL: message dropped, server still showed `sent`                                                                                                 | PENDING |
| C3  | Permission revoked in OS/browser settings: next send returns 404/410, subscription becomes `disabled`                                                                                                                                      | PENDING |
| C4  | VAPID key mismatch / rotation: sends fail with a permanent 4xx (no device banner), re-subscribe recovers                                                                                                                                   | PENDING |
| C5  | Logout / shared device / switch tenant: previous user's queued messages do not appear for the next user (recipient binding, #1098)                                                                                                         | PENDING |
| C6  | Old service worker still registered: a `declarative` payload shows the generic fallback, `legacy` shows normal text                                                                                                                        | PENDING |
| C7  | Lock-screen content: only the generic title/body defined for the category; no PHI, payment or personal data                                                                                                                                | PENDING |
| C8  | **`/login` outside scope (#1105):** open the installed iOS app while signed out; it redirects to `/login` (outside `scope=/admin/`). Record whether iOS shows an in-app browser bar and whether that is acceptable or the scope must widen | PENDING |

## 5. `PUSH_PAYLOAD_FORMAT` flip gate

Do **not** set `PUSH_PAYLOAD_FORMAT=declarative` in production until **all** hold:

1. The dual-reader `public/push-sw.js` has been deployed for at least one full
   service-worker update cycle (**24 hours**, the browser update-check ceiling)
   with `PUSH_PAYLOAD_FORMAT` unset (legacy).
2. Real-device evidence (section 6) exists for U3 (Chrome Android), at least one
   Chromium desktop row, **U7** (legacy still works) and **U8** (declarative
   shows once, click navigates). Provider acceptance alone does not count.
3. C6 (old-worker fallback) and C8 (`/login` scope) are recorded.
4. `bun run config:validate` passes with `APP_URL` an `https:` URL.
5. Rollback is rehearsed: set `PUSH_PAYLOAD_FORMAT=legacy`, restart app and
   `push:dispatch`, send a test, confirm display. No re-subscription needed.

## 6. Evidence template (one per device row)

Copy this block into the Issue or the release record. Do not paste endpoints,
keys, tokens, cookies or screenshots that show personal data.

```
Row:                 U#/C#
Tester / date:       <name>, <ISO timestamp with timezone>
Device model:        <e.g. iPhone 15>
OS + version:        <e.g. iOS 18.4.1>
Browser + version:   <e.g. Safari / Chrome 131>
Origin:              <https://admin.example.test>
Mode:                tab | installed PWA (opened from icon)
Permission state:    default | granted | denied
Payload format:      legacy | declarative
Subscription accepted at:   <timestamp>  (device list shows it)
Test sent at:               <timestamp>  (POST /api/v1/push/test)
Provider accepted:          yes/no, attempt outcome from diagnostics, correlationId
Device shown at:            <timestamp or "not shown"> (lock screen | banner | list)
Click navigated to:         <path> / <failure>
Unsubscribe stops delivery: yes/no (send again after "Turn off", expect nothing)
Evidence:                   <screen recording / photo id, no personal data>
Result:                     PASS | FAIL | N/A
Notes / known limit:        <...>
```

## 7. Known limits log

Failures from section 4 are logged here as known limits with date, row and
repro. Empty means nothing has been exercised yet, **not** that nothing fails.

| Date | Row | Limit observed                  | Decision |
| ---- | --- | ------------------------------- | -------- |
| --   | --  | (none recorded; UAT is PENDING) | --       |

## 8. Operator runbook

**Triage "I did not get a notification"**, in this order, using the existing
console (`/admin/push-notifications`) and `GET /api/v1/push/diagnostics`:

1. Is the device listed and `active`? No -> subscription never accepted, or
   disabled after 404/410: have the user enable it again.
2. Is the message in the queue? `queued`/`retry_wait` -> the worker has not run
   or the provider is failing: check `push:dispatch` log and the breaker.
3. `sent` with a `success` attempt -> **provider accepted**. Escalate to the
   device: permission, Focus/DND, iOS installed-PWA mode, TTL expiry, network.
   The server cannot tell more.
4. `failed` -> read the attempt error (masked; endpoints are never logged).

**Controls to keep working during tests:**

- Self-hosted deployment: outbound HTTPS from the worker host to the push
  services (e.g. `fcm.googleapis.com`, `web.push.apple.com`,
  `updates.push.services.mozilla.com`, `*.notify.windows.com`); the app must be
  served over valid HTTPS (iOS rejects untrusted certificates).
- Key rotation: `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` ring plus
  `bun run push:auth-secret:rekey` (see `push-notifications.md`); VAPID key
  changes require every device to re-subscribe.
- PII: payloads carry no personal, health or payment data; diagnostics show
  masked endpoints; subscription rows are personal data under UU PDP 27/2022.
  Mapping to ISO 27001/27002/27005/27701/22301 is a control reference only; this
  document makes **no compliance claim**.
- Purge: `bun run push:queue:purge` (daily) removes terminal queue rows and spent
  attempts; subscription rows follow the retention descriptors.

## 9. Go / no-go checklist (before enabling push for a tenant or flipping the format)

- [ ] CI green: `bun run check` and the integration job.
- [ ] Backup taken and restore verified for the database.
- [ ] Compatibility confirmed for the target devices (section 4 rows PASS).
- [ ] UAT evidence attached (section 6); known limits logged (section 7).
- [ ] Monitoring: `push:dispatch` log watched, breaker state, queue `failed` and
      `retry_wait` counts reviewed after the first sends.
- [ ] Rollback of the declarative producer rehearsed (section 5, item 5).
- [ ] Worker configured: `PUSH_ENABLED`, `PUSH_PROVIDER`, VAPID keys,
      `PUSH_AUTH_SECRET_ENCRYPTION_KEYS`, `APP_URL`, cron entry present.
- [ ] Operator owner named for on-call and for key rotation.
