🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](omnichannel-ui-ux-screen-contracts.id.md)

# AWCMS generic Omnichannel UI/UX — upstream screen contracts v1.0

**Proposed only — 24 October 2026.** [Issue #1174](https://github.com/ahliweb/awcms/issues/1174). This supplements [AWCMS admin parity matrix](admin-ui-parity-matrix.md), existing module READMEs and the [cross-repo comprehensive CRM UX](https://github.com/ahliweb/awcms-one/issues/472). Do **not** claim that planned channel connectors, lead lifecycle or SSE/WebSocket gateway have shipped.

## 1. Baseline and authority

The upstream AWCMS backend and SYSTEM admin own tenant/RBAC/ABAC/FORCE RLS, existing email (Mailketing **v1**), templates, suppression, newsletter, WhatsApp (log/Fonnte/Meta), push, staff Telegram, and the OMES Control Center Astro /admin/omes/* routes. The upstream social publishing port currently routes to a no-op adapter for some flows. The full commerce customer/segment/campaign authority remains **AWCMS-One commerce**; never introduce a second generic customer master or provider queue. UI uses existing admin.css, design tokens, status pills, segmented filters, tables, two-pane and timelines, without a new admin framework.

**Latest verified external baseline:** Bun stable 1.4.4 (22 Oct 2026), now pinned in the repository ([#1172](https://github.com/ahliweb/awcms/issues/1172)). Mailketing documentation v2.0.2 (23 Oct 2026), existing adapter POST /api/v1/send remains → migration [#1159](https://github.com/ahliweb/awcms/issues/1159). All dependency update status is time-bound [#1173](https://github.com/ahliweb/awcms/issues/1173); production pins must be upgraded through tests/staging, not wildcard latest.

## 2. Upstream Admin navigation and screen inventory

| ID    | Screen                                                            | Current                         | Source/target owner                                                                                                                                                 |
| ----- | ----------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UP-01 | Email templates / message queue / announcements                   | IMPLEMENTED                     | email module                                                                                                                                                        |
| UP-02 | Email suppression                                                 | IMPLEMENTED                     | /admin/email-suppression                                                                                                                                            |
| UP-03 | Newsletter                                                        | IMPLEMENTED                     | newsletter module and consent                                                                                                                                       |
| UP-04 | Generic WhatsApp delivery                                         | IMPLEMENTED                     | /admin/whatsapp, Meta/Fonnte/log                                                                                                                                    |
| UP-05 | Push delivery                                                     | IMPLEMENTED backend             | push_delivery (customer UI not implied)                                                                                                                             |
| UP-06 | Staff Telegram                                                    | IMPLEMENTED backend             | telegram_delivery (not customer messaging)                                                                                                                          |
| UP-07 | OMES Control Center overview/servers/ops/jobs/audit/health/backup | IMPLEMENTED limited pages       | /admin/omes/*                                                                                                                                                       |
| UP-08 | Unified channel-account registry and permission wizard            | PLANNED                         | [#1139](https://github.com/ahliweb/awcms/issues/1139), [#1140](https://github.com/ahliweb/awcms/issues/1140), [#1154](https://github.com/ahliweb/awcms/issues/1154) |
| UP-09 | StarSender/Meta multi-device/phone provider manager               | PLANNED                         | [#1141](https://github.com/ahliweb/awcms/issues/1141)–[#1143](https://github.com/ahliweb/awcms/issues/1143)                                                         |
| UP-10 | Mailketing v2 accounts, verified senders, credits, lists          | PLANNED                         | [#1158](https://github.com/ahliweb/awcms/issues/1158)–[#1162](https://github.com/ahliweb/awcms/issues/1162)                                                         |
| UP-11 | Customer Telegram bots and channel publishing                     | PLANNED                         | [#1155](https://github.com/ahliweb/awcms/issues/1155)–[#1157](https://github.com/ahliweb/awcms/issues/1157)                                                         |
| UP-12 | Facebook/Instagram/TikTok/YouTube/LinkedIn/Threads publishing     | PLANNED/RESEARCH                | [#1145](https://github.com/ahliweb/awcms/issues/1145)–[#1152](https://github.com/ahliweb/awcms/issues/1152)                                                         |
| UP-13 | Lead/prospect pipeline                                            | PLANNED                         | [#1163](https://github.com/ahliweb/awcms/issues/1163), [#1166](https://github.com/ahliweb/awcms/issues/1166)                                                        |
| UP-14 | Unified inbox, assignment, SLA                                    | PLANNED                         | [#1144](https://github.com/ahliweb/awcms/issues/1144), [#1164](https://github.com/ahliweb/awcms/issues/1164)                                                        |
| UP-15 | Follow-up workflow, task calendar and notification policy         | PLANNED                         | [#1165](https://github.com/ahliweb/awcms/issues/1165)                                                                                                               |
| UP-16 | SSE/WS status gateway and console                                 | NOT IMPLEMENTED; design pending | [#1168](https://github.com/ahliweb/awcms/issues/1168), [#1171](https://github.com/ahliweb/awcms/issues/1171)                                                        |

## 3. Screen-specific user flows, fields and failure states

### UP-01–UP-03 Existing email and newsletter (preserve)

Template/list: template key/category/locale/version/last editor/status, content preview and synthetic test with no real recipient; targeted announcements require authorization and selected eligible recipients. Suppression list: masked recipient/reason/source/effective date, scoped add/remove with confirmation and provenance. Newsletter: double opt-in lifecycle, subscription state, unsubscribe link and audit. Error states include tenant permission denied, invalid recipient, hard bounce, unsubscribed, provider unavailable and opaque diagnostic ID. **Never repurpose newsletter opt-in into blanket cross-channel marketing consent.**

### UP-04 WhatsApp queue (preserve)

Show queue status, last attempt, permitted purpose (security/transactional/marketing), consent and suppression, provider-accepted vs independently verified delivered, sender masked, retryable/failed/expired. Cancel only unsent work; OTP body redacted in terminal states. The currently configured provider is deployment-level: do not show a working per-tenant sender selector until #1141 ships. Upgrade/cutover between commerce legacy and upstream queue must preserve one canonical final path.

### UP-08 Channel Accounts (planned)

List provider, aliases, tenant/brand, active capabilities, verified ownership, token expiry, credential vault reference, last event and quota. Wizard Select provider → OAuth/API credential handled server-side → scope/capability inspection → send/publish permission test (non-mutating where possible) → assign tenant/brands and allowed operators → review danger/consent → set default → save. Reconnect and disconnect require typed confirmation showing pending jobs and rollback; wrong-tenant binding, unverifiable webhook, missing scope and token revocation are explicit blocking states. Never render API token in HTML, logs or export.

### UP-09 Multi-number WhatsApp (planned)

Sender cards: StarSender device alias/masked number/device ID, health, risk acknowledgment, last verified, quota; Meta WABA/phone identity, approved template support and token scope. Account default is per tenant/brand, not global. In **LPP ENTER derived product**, StarSender can be selected default with explicit operator risk acceptance, and Meta chosen manually as alternative; neutral upstream retains no selected default. Outbound rows snapshot sender identity; mid-queue default switch does not reroute them. StarSender is unofficial; no badge saying Meta authorized, no unrestricted bulk sending, no anti-ban rotation. States: DISCONNECTED, EXPIRED, UNVERIFIED, BLOCKED, WEBHOOK_UNTRUSTED, READY, UNKNOWN_DELIVERY.

### UP-10 Mailketing v2.0.2 (planned)

Header: "Mailketing API v1 currently active; v2.0.2 target" until backend migration. Server-only token; select account/verified sender/domain; display last-fetched credits and sender list, external list mapping and subscriber sync, import preview/opt-in evidence, rate/credit warnings, no fabricated remote campaign management. Only documented general endpoints are POST /api/v2/send, GET /credits, GET /senders, GET /lists, POST /subscribers. **Server generates message_id in v2.0.2**: queue ID and provider ID are distinct; ambiguous provider response is not delivered and do not assume provider idempotency. Actionable errors 401, 402, 403, 422, 429 Retry-After, 5xx. Authenticate webhook or refuse mutations; never infer consent from remote list membership. Current v1 diagnostics remain until explicit validated, reversible migration.

### UP-11 Telegram (planned)

Bot channel account list: masked bot ID, chat/channel label, verification, admin rights, allowed send type, last webhook event. Separate staff operational Telegram queue from future customer engagement. Inbound chat must be eligible, webhook verified and tenant bound. Channel publish screen shows preview and permission error if bot is no longer admin.

### UP-12 Social connections (planned)

Permission-driven matrix for Facebook Pages/Messenger, Instagram Professional, TikTok, YouTube, LinkedIn Pages, Threads; optional X/LINE/GBP/Pinterest behind provider admission. Do not display unsupported DM/general lead capture features. Post calendar requires asset rights, caption, alt text, target accounts, supported media preview, schedule approval, per-provider publish ID and retry/failure; token expiry disables actions. The current generic social port's noop path **must not be represented as a successful publish**.

### UP-13–UP-15 Lead and inbox (planned)

Lead list fields stage version, owner, source account/campaign, last action, next due, privacy/redacted identity; detail has Timeline/Consent/Tasks/Interactions, versioned stage transitions with optimistic lock and conflict. Inbox split-pane: queue by assigned/overdue, thread with provider-specific allowed reply and internal-only note, quick reply, human+AI collision guard; calendar SLA respects local working hours/holidays. Follow-up builder: typed event trigger, consent gate, preview/simulate, approval, rate caps, stop rules after reply/convert/unsubscribe; no generic bot blast. Link to downstream commerce customer only through approved contracts.

### UP-16 Bun realtime status (planned)

**Do not implement or enable before ADR #1168.** Bun SSE for one-way data snapshots/progress by campaign/account/worker queue; Bun.serve WS only if duplex is proven. Upgrade Origin check, short-lived audience tickets (not long bearer in query), tenant/brand/actor authorization on reconnect/replay, bounded redacted envelope, slow-client eviction/backpressure and multi-instance fanout. Status remains durable DB projection; client-stream event is never a delivery receipt. Browser-closed updates require Web Push.

## 4. Shared UX states, security and accessibility

Each route: permission-aware heading, tenant scope, last freshness, text+icon status and error detail; filter/search with typed values and reset, paginator and bounded table, empty state/action, loading skeleton, stale snapshot, retry, 403, 409 conflict, 429 rate, 5xx diagnostic. Desktop two-pane only where useful; mobile one-pane stack, keyboard focus restoration, WCAG 2.2 AA color and noncolor status, accessible chart table. Any account change requires queue-impact preview and audit. Never add a bulk-action toolbar without a real authorized bulk API.

## 5. Acceptance and release gates

- Two tenants with same external phone/email cannot read/choose other's sender/thread/list/credits. Revocation invalidates active subscriptions and queued work eligibility.
- Mailketing v2.0.2 fake-vendor tests for server-assigned ID, credits/sender, semantic success:false, 401/402/403/422/429/5xx, no token leak, accepted ≠ delivered.
- Meta and StarSender template/permitted message distinction, switching default new sends only, disconnection/blocked risk.
- Keyboard-only and mobile 360px, i18n EN/ID, empty/loading/stale/permission denial, CSV formula injection; no raw PII in metrics.
- AWCMS jobs executed by repo-pinned Bun; Bun 1.4.4 pin landed via #1172; weekly package/report #1173. Upstream Bun native SSE/WS behind ADR #1168, not an introduced Node runtime.
- Run bun test, bun run check, relevant integration/PostgreSQL FORCE RLS, OpenAPI/AsyncAPI and translation/doc gates. No code in this docs PR.
