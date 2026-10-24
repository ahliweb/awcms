🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](bun-delivery-realtime-runtime.id.md)

# AWCMS channel delivery and realtime runtime standard — Bun-only (proposed)

> Draft implementation standard, not a shipped WebSocket feature. [Issue #1167](https://github.com/ahliweb/awcms/issues/1167) · Decision design [#1168](https://github.com/ahliweb/awcms/issues/1168) · 24 October 2026.

## Authority, runtime and transport

[ADR-0002](../adr/0002-bun-only-runtime.md) is already **Accepted**. `package.json` pins `bun@1.4.4`. All **AWCMS-owned** HTTP services, background delivery dispatchers, scheduled/outbox jobs and future event-stream gateway servers **MUST execute with the repository-declared Bun runtime**. Do not spawn Node.js, npm/pnpm/yarn servers, `ws`/Socket.IO services that require Node, alternate language dispatchers, or a second sidecar for CRM broadcast without a specific reviewed ADR. Bun-compatible `node:*` builtins and the existing `@astrojs/node` adapter **when actually hosted by Bun** do not constitute Node runtime execution.

**Distinguish transports:** outgoing email = existing `email` outbox → Bun `email:dispatch` → Mailketing/SMTP-capable adapter through authorized HTTP/transport; WhatsApp = existing `whatsapp_delivery` queue → Bun `whatsapp:dispatch` → Meta/Fonnte or _planned_ StarSender HTTPS API; Web Push = existing `push_delivery` queue → Bun `push:dispatch` → push service/FCM HTTPS. Staff-only Telegram has its own admitted notifications path; a customer Telegram adapter/social publishing is **planned**, not already an unrestricted blast. WebSockets do **not** deliver email/WhatsApp to provider APIs. A provider webhook enters via verified HTTPS and is recorded in durable storage before any optional realtime UI projection.

| Area                                              | Verified current state on upstream `main`                                                     | Target constraint                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `email`, Mailketing v1                            | Existing Bun queue/dispatcher, templates, consent/suppression primitives                      | Keep one email queue; scheduled marketing/CRM integrations use Bun, not a Node campaign worker; Mailketing v2 is planned              |
| `whatsapp_delivery`                               | Existing Bun queue, `log/fonnte/meta`, one deployment credential today                        | Keep one WA channel queue and Bun worker; multi-sender/StarSender planned [#1141–#1143](https://github.com/ahliweb/awcms/issues/1141) |
| `push_delivery`                                   | Existing Bun queue/dispatcher and Web Push/FCM support                                        | Keep server-side Bun jobs; browser Service Worker is client code, not a Node process                                                  |
| `telegram_delivery`                               | Existing staff-only controlled notifications                                                  | Future customer messaging and multi-bot in separately admitted module, executed on Bun                                                |
| CRM campaigns, email marketing, social publishing | Downstream commerce campaign queue exists; generic account/social provider extensions planned | Bun-native outbox/dispatch; no provider calls from request/DB transaction                                                             |
| Unified inbox realtime status                     | **No general Bun WebSocket gateway observed**                                                 | Admission [#1168](https://github.com/ahliweb/awcms/issues/1168), not represented as implemented                                       |

## Bun realtime protocol selection (subject to accepted ADR)

1. **Prefer authenticated Bun SSE** for server→browser progress such as campaign totals, queue alerts, task status and inbound inbox badges; reconnect via `Last-Event-ID`/cursor or authorized REST snapshot where supported.
2. Use **Bun native `Bun.serve` WebSocket** only for a validated bidirectional requirement (e.g. interactive agent presence/read receipts if provider supports them), and only after studying the existing Astro/Bun standalone server integration. Browser's native `WebSocket` API is client-side and permitted.
3. Plain authenticated polling remains a supported fallback; an event stream is **non-authoritative**. PostgreSQL queue/message rows + audit are system of record. In-memory Bun WebSocket pub/sub is process-local; if multiple instances are admitted, publish through a reviewed durable or coordinated multi-instance fan-out. Never mark an email delivered merely because a WS event was published.
4. Validate TLS/proxy upgrade on HTTP/1.1 for WS; no invented HTTP/2 WS support. Verify Origin against allowlist; authenticate the actor and bind topic audience to authorized tenant/account/campaign/role. A browser cannot add arbitrary `Authorization` headers during WS upgrade: propose short-lived single-purpose ticket or pre-existing approved session, with no long-lived bearer token in URL or log. Recheck authorization when needed and disconnect revoked subscriptions.
5. `tenant_id` and sender/channel scopes are server-derived, not browser-selected topic strings; message envelope is schema-versioned, bounded, redacted (no raw recipient list, provider API key, OTP or private conversation payload), correlated, sequence-aware, with snapshot/replay authorization.
6. Apply connection caps, per-tenant quotas, heartbeat/idle timeout, payload ceilings, backpressure limits and slow-client eviction. Test proxies, reconnection, tab refresh, iOS background/closed-browser behavior: **WebSocket/SSE is not durable browser-closed push**; use explicit opt-in Web Push for eligible notifications.
7. Instrument connected clients by tenant aggregate only, dropped events, replay lag, queue lag, auth denies, provider acceptance vs verified delivery, restart and stale/unknown states. Rate-limit upgrades and forbid CSWSH and cross-tenant leaks.
8. **Never use realtime gateway as a second agent runtime or OMES privileged listener.** OMES host worker keeps outbound signed HTTPS poll and Hermes retains its own runtime (per OMES ADR-0027).

## Acceptance criteria and design backlog

- Verify source/runtime `process.execPath` under Bun in worker integration tests; CI static audit against `node`/npm/yarn/pnpm launch commands in backend job manifests and Docker stages; no false failure on `node:crypto` or Bun-hosted `@astrojs/node`.
- Two tenants and multiple senders: message queued once, authorization and consent rechecked at send, provider call outside DB TX, per-recipient rate/opt-out, idempotent rerun; no silent provider failover.
- Future SSE/WS: wrong tenant/role/topic, expired ticket, Origin violation, revocation, slow consumer, browser background, broker restart, multi-instance recovery, safe unknown status and authorization on snapshot/replay.
- Synchronize OpenAPI and AsyncAPI plus English/Indonesian docs when implementing. Run repo-declared `bun test`, `bun run check`, DB integration and runtime checks; no migration rewrite, no hand-edited `bun.lock`.
- Related upstream issues [#1139](https://github.com/ahliweb/awcms/issues/1139), [#1140](https://github.com/ahliweb/awcms/issues/1140), [#1141](https://github.com/ahliweb/awcms/issues/1141), [#1142](https://github.com/ahliweb/awcms/issues/1142), [#1143](https://github.com/ahliweb/awcms/issues/1143), [#1144](https://github.com/ahliweb/awcms/issues/1144), [#1155](https://github.com/ahliweb/awcms/issues/1155), [#1158](https://github.com/ahliweb/awcms/issues/1158), [#1164](https://github.com/ahliweb/awcms/issues/1164), [#1165](https://github.com/ahliweb/awcms/issues/1165). Downstream [AWCMS-One #458](https://github.com/ahliweb/awcms-one/issues/458), [#459](https://github.com/ahliweb/awcms-one/issues/459), [#460](https://github.com/ahliweb/awcms-one/issues/460), [#461](https://github.com/ahliweb/awcms-one/issues/461), [#430–#432](https://github.com/ahliweb/awcms-one/issues/430).

**Official Bun docs:** [WebSocket and pub/sub](https://bun.com/docs/runtime/http/websockets), [SSE](https://bun.com/guides/http/sse), [Bun HTTP server](https://bun.com/docs/runtime/http/server). Versions/features must be validated against pinned Bun 1.4.4 at implementation time.

## Concrete implementation follow-ups (2026-10-24)

- [#1170](https://github.com/ahliweb/awcms/issues/1170): audit and test that delivery/job/container launch commands execute the pinned Bun binary, without false positives for Bun-hosted Node built-ins.
- [#1171](https://github.com/ahliweb/awcms/issues/1171): implement an authenticated SSE-first / optional native Bun WebSocket gateway **only after** [#1168](https://github.com/ahliweb/awcms/issues/1168) accepts its architecture; do not claim a gateway already ships.
- [AWCMS-One #469](https://github.com/ahliweb/awcms-one/issues/469): root template/deploy/commerce runtime guard, leaving upstream `apps/cms` intact.
