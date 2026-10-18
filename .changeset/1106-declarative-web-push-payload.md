---
"awcms": minor
---

Declarative Web Push payload with a dual-reader service worker (Issue #1106).

- `public/push-sw.js` reads both the legacy `{title, body, targetPath, data}` and the WebKit declarative `{web_push: 8030, notification: {...}}` shapes, shows exactly one notification per event, and navigates only to a validated same-origin http(s) URL (checked on arrival and again on click). Scope, registration path and cache policy are unchanged.
- New `PUSH_PAYLOAD_FORMAT=legacy|declarative` (default `legacy`). `declarative` makes the `web_push` adapter emit the new shape with an absolute https `navigate` derived from `APP_URL` (never the Host header); off-origin, protocol-relative and non-http(s) targets fail closed to the admin root, and an empty title, a missing https origin or an oversize payload fall back to legacy. `config:validate` requires an https `APP_URL` when it is `declarative`.
- VAPID, aes128gcm (RFC 8291) vectors, subscriptions, recipient binding and the queue are unchanged. No migration, no API change. Rollout and rollback runbook in `docs/awcms/push-notifications.md` (EN and ID).
