🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0169-integration-hub-admission-is-unimplemented-and-the-provider-boundary-already-lives-in-domain-owned-ports-and-outboxes.id.md)

# ADR-0169 — `integration_hub` admission is unimplemented, and the provider boundary already lives in domain-owned ports and outboxes

- **Status:** Accepted
- **Status note (2026-11-22):** the owner delegated Q1–Q3 to the orchestrator, who decided them as recorded under "Decision" below (priority: scalability, performance, security).
- **Date:** 2026-11-22
- **Decision maker:** ahliweb (owner), delegated to the orchestrator on 2026-11-22. ADR-0019 changes status only (to Deferred); its text is kept as history.
- **Resolves (proposes to):** Issue #1408
- **Amends (proposes to):** [ADR-0019](0019-integration-hub-module-admission.md) (`integration_hub`, `Accepted (not yet implemented)`)
- **Related:** [ADR-0006](0006-offline-first-sync-outbox.md), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0013](0013-extension-layers-and-boundary-model.md) §6, [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md), [ADR-0074](0074-push-delivery-is-a-second-outbox.md), [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md), [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md), [ADR-0150](0150-inbound-omnichannel-events-enter-as-verified-redacted-envelopes-with-no-generic-interactions-store.md), [ADR-0151](0151-mailketing-v2-and-multi-account-email-reuse-the-single-email-queue-and-never-trust-an-unauthenticated-callback.md), [ADR-0152](0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.md), [ADR-0154](0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.md); the consumer-template rule in `ahliweb/awcms-one` ADR-0017 (external providers are commerce-owned ports with env credentials and token-addressed webhooks)

## Context

ADR-0019 admitted `integration_hub` as a System Foundation module (generic signed inbound webhooks, outbound event subscriptions, adapter health). Audit of `main@f80bf0e5` (2026-11-22):

1. **Not implemented.** `src/modules/index.ts` registers no `integration_hub`; there is no `src/modules/integration-hub/`, no `awcms_integration_hub_*` table, and no `integration_hub.*` permission. `tests/adr-admission-implementation-status.test.ts` already pins the ADR as "not yet implemented".
2. **Broken provenance.** ADR-0019 (EN and ID) and the skill `awcms-integration-hub` cite "Issue #754" as the implementation tracker. #754 resolves to a **merged newsletter PR** ("fix(newsletter): the subscribe endpoint would mail-bomb any address, one IP at a time"). The number was inherited from the archived `awcms-mini` tracker (ADR-0055: archive, not a port source) and means something else in this repo. #754 is therefore **not** an integration-hub tracker, and no issue in this repo tracks the hub.
3. **The need was met piecemeal, by the domain owners.** Since ADR-0019 was written (2026-07-14), every provider boundary that was real was built where its data lives:

| Provider boundary                 | Owner module                               | Port / queue                                                           | Inbound                                                                                            |
| --------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Email (Mailketing, multi-account) | `email`                                    | one email outbox + lease dispatcher (ADR-0151, ADR-0164)               | callback never trusted unauthenticated (ADR-0151)                                                  |
| WhatsApp (Meta, StarSender)       | `whatsapp_delivery` + `channel_accounts`   | `WhatsAppDeliveryPort`, one queue per channel (ADR-0133, ADR-0148)     | per-account opaque token `wcb1.*` (`_shared/channel-webhook-token.ts`); payload never picks tenant |
| Telegram                          | `telegram_delivery`, `telegram_engagement` | `TelegramDeliveryPort`, own queue (ADR-0140, ADR-0152)                 | timing-safe secret; only `/start` and `/stop`                                                      |
| Web Push                          | `push_delivery`                            | second outbox (ADR-0074)                                               | not applicable                                                                                     |
| Object storage (R2)               | `sync_storage`, `media_library`            | R2 object queue (ADR-0006)                                             | not applicable                                                                                     |
| Social publishing                 | `social_publishing`                        | `social-publishing-port`                                               | not applicable                                                                                     |
| Commerce / OMES                   | `omes_control` and consumer templates      | commerce-owned ports (`awcms-one` ADR-0017)                            | token-addressed webhooks                                                                           |
| Inbound omnichannel normalisation | `omnichannel_inbox`                        | verified, redacted envelopes, no generic interactions store (ADR-0150) | via the owning adapter                                                                             |

Each has its own port, redaction, per-provider failure semantics (`retry_after`, hold lanes, `NO_BINDING` never falling back to another channel) and a CI gate. ADR-0133 and ADR-0148 chose **one queue per channel** deliberately, and ADR-0150 rejected a generic interactions store: a hub that re-centralises the envelope contradicts decisions taken after ADR-0019. 4. **Name collisions are real.** "Gateway" and "hub" now name several different things (vocabulary below). Building a runtime called `integration_hub` without a decision invites exactly the silent inference Issue #1408 warns against.

## Vocabulary (to stop the collisions)

| Term                                                                                        | Meaning in this repo                                                                                                                                                                                                 | Exists?                                                   | Owner                                          |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| **Outbound provider abstraction**                                                           | A domain-owned port (`WhatsAppDeliveryPort`, email category registry, push) plus that domain's outbox/dispatcher; the provider call happens in a lease-based worker, **never inside a DB transaction**               | Yes, per domain                                           | the domain module                              |
| **Inbound webhook ingress**                                                                 | A public route that verifies a secret/token/signature **before any work**, resolves the tenant from the token (never the payload), dedups by a DB uniqueness key, and hands a redacted envelope to the owning module | Yes, per domain (`wcb1.*`, Telegram secret, Mailketing)   | the domain module (shared helper in `_shared`) |
| **API gateway** (rate limit, edge routing, WAF, third-party resilience at the network edge) | Infrastructure in front of the app (edge cache, reverse proxy), not an application module                                                                                                                            | Deployment concern (`awcms-deploy`, edge cache)           | operations, not a module                       |
| **Realtime gateway**                                                                        | Bun SSE streams reading durable state and re-authorizing every tick (ADR-0154, ADR-0075, #1168/#1171); WebSocket not admitted                                                                                        | Yes (`whatsapp.sender.progress`, `inbox.status.progress`) | the topic's owning module via `_shared/sse-*`  |
| **`integration_hub` (ADR-0019)**                                                            | A generic, provider-neutral **ingress + outbound-subscription envelope** module with adapter health                                                                                                                  | **No**                                                    | undecided (this ADR)                           |

The first two exist as a **pattern**, not as a module. Only the last row is in question, and it is neither a gateway nor a provider abstraction.

## Options

### A. Reuse domain-owned ports and outboxes (recommended default)

No new module. Each new provider is a domain-owned port, its own queue and a token-addressed ingress, following the table above and the shared helpers (`channel-webhook-token.ts`, `redaction.ts`, the SSRF guards already used by `tenant_domain` and `seo_distribution`). A cross-cutting need (a second consumer of the same mechanism) is met by promoting the helper into `_shared` with a CI gate, as ADR-0133 did for WhatsApp, not by a runtime module.

### B. Optional generic hub: ingress registry plus outbound subscription envelope (ADR-0019, narrowed)

Build `integration_hub` only for what no domain owner covers: **tenant-configured outbound event subscriptions** (a tenant or external system is told when a domain event happens, to a tenant-supplied `target_url`) and **generic signed inbound endpoints for systems that are not a provider of a domain** (for example a LAN system posting facts). It owns delivery status and short-lived raw payloads only, never final business data (ADR-0013 §6), and it must not replace any queue in the table above.

### C. Independent service (outside the base)

A separate deployable (SaaS control plane or an API-management product) fronting providers. Not a base option: it adds a second runtime, a second database or shared-DB coupling, and contradicts the Bun-only single-process posture and ADR-0034 direct-use. It stays valid for a downstream consumer that already runs such a service, as a client of the base's public OpenAPI/AsyncAPI contract (ADR-0013 §6, SaaS Control Plane row).

## Decision matrix

| Dimension                   | A. Reuse domain ports/outboxes                                      | B. Optional generic hub                                                                                                                                                                    | C. Independent service                                  |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Owner**                   | each domain module (CODEOWNERS: ahliweb)                            | new `integration_hub` module                                                                                                                                                               | downstream operator                                     |
| **API contract**            | existing per-domain OpenAPI; no new surface                         | new `/api/v1/integration-hub/*` (endpoints, subscriptions, deliveries, health) plus one public inbound route; OpenAPI sync mandatory                                                       | the base's public contract, consumed as a client        |
| **Event contract**          | per-domain AsyncAPI as today                                        | new `integration_hub.*` events; subscriptions fan out from `domain_event_runtime` AFTER commit                                                                                             | none inside the base                                    |
| **Offline/LAN**             | unchanged: each domain degrades by its own rules                    | offline-lan-safe core (ADR-0019 §5); outbound needs only the destination reachable; a dead destination never blocks the source transaction                                                 | not applicable offline                                  |
| **Tenancy**                 | already tenant-scoped, FORCE RLS per domain                         | every table `tenant_id` + FORCE RLS; public inbound resolves the tenant only from an opaque token via a narrow `SECURITY DEFINER` lookup (precedent: `sql/033`, `sql/217`)                 | none; cross-tenant isolation becomes the operator's job |
| **Secrets / SSRF**          | env references per provider; guards reused                          | `secret_reference` as `env:VAR` only, never a raw secret; outbound `target_url` passes the block-list guard on **every redirect hop** and on the resolved IP; nothing secret in logs/audit | out of scope                                            |
| **Failure semantics**       | per provider (`retry_after`, hold lanes, no cross-channel fallback) | generic retry/backoff/dead-letter/circuit-breaker; replay safe by `(tenant_id, endpoint_id, replay_key)` uniqueness; never a provider call inside a transaction (ADR-0006)                 | the service's own                                       |
| **Cost / risk**             | lowest; duplicates helpers at worst                                 | highest security surface of any base module; one more registry in `modules:dag:check`                                                                                                      | new runtime and operational burden                      |
| **Name-collision risk**     | none                                                                | high unless named per the vocabulary above                                                                                                                                                 | not applicable                                          |
| **Fits ADR-0133/0148/0150** | yes                                                                 | only if it never owns a provider queue                                                                                                                                                     | yes                                                     |

## Recommendation

**Option A is the default.** Reconcile ADR-0019 as follows (decided, see "Decision"): its status moves from `Accepted (not yet implemented)` to a deferred state, and the generic hub is admitted **again** (a fresh admission ADR) only when the Definition of Ready below is met. Option B is kept as the shape of that future admission, narrowed to outbound subscriptions and non-provider ingress. Option C is not a base option.

On whether the hub is still justified: on today's evidence, **it is not**. There is no named consumer, no valid tracker, and the domains that needed provider boundaries built them without it.

### Definition of Ready for any future `integration_hub` (Option B)

1. A tracker issue **in this repo** (never #754) naming at least **two concrete consumers** that no domain-owned port can serve, with event types and target systems.
2. A fresh admission ADR (ADR-0055 §3: ADR mandatory, security review, full `bun run check`) that re-checks this matrix and states what stays domain-owned.
3. The answer to Q3 above for that consumer (base module or consumer template).
4. A security review before merge (inbound verification, SSRF including redirects and DNS rebinding, secret references, replay uniqueness).
5. `domain_event_runtime` and `data_lifecycle` descriptors for raw payloads and delivery history.
6. A fail-closed disable flag (off by default; off is `404`), as ADR-0148 and ADR-0154 did.

### Rollout criteria (if ever built)

Ships inert behind a flag; fixture schemes only (no real provider); outbound dispatch as a separate lease worker with a bounded batch and a query-budget entry; one pilot tenant with a real consumer; promote only after the SSRF and replay probes are in CI and the decision log shows no cross-tenant read; no migration of an existing domain queue into the hub without a separate ADR.

## Decision (2026-11-22, delegated by the owner to the orchestrator)

- **Q1 — ADR-0019 becomes `Deferred`** (not withdrawn); this ADR becomes `Accepted`. The old decision stays readable as history and the option stays open at no cost.
- **Q2 — No named consumer exists today, so the hub is not built.** No tracker, module, migration, permission or service is created.
- **Q3 — If a consumer appears later,** the hub is assessed through a fresh admission ADR (Option B above, or ownership by the consumer template, as `awcms-one` ADR-0017 does for commerce). That choice is **not taken now**.

Recorded reasons (priority: scalability, performance, security):

- Domain-owned ports and outboxes scale and are throttled **per provider, independently**; a hub is a single queueing point.
- A hub adds one more hop and serialisation to every provider call.
- A hub concentrates secrets and the SSRF surface across all providers (a large blast radius).
- Deferring keeps the option without cost.

## Provenance corrections (history is kept, not deleted)

- ADR-0019 EN/ID and `.claude/skills/awcms-integration-hub/SKILL.md`/`.id.md`: "Issue #754" is the archived `awcms-mini` tracker number; in this repo #754 is an unrelated merged newsletter PR. Those documents carry a marked provenance note (this PR) and otherwise still read as the archived specification.
- Where ADR-0019 refers to "Wave A" of `absorb-awcms-mini-backbone-roadmap.md`, that roadmap is historical (ADR-0055); it is not a work queue.

## Consequences

- **Positive:** No runtime is inferred from a status label; the false tracker no longer reads as active work; provider boundaries stay with the data owners; one table separates the several "gateway/hub" meanings.
- **Negative/trade-off:** If a real cross-domain subscription need appears, it waits on a fresh admission ADR.
- **Neutral:** No code, migration, service or database change. ADR-0019 moves to Deferred; its text is untouched.

## Alternatives considered

See Options A–C above.
