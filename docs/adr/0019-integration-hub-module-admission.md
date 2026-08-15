🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0019-integration-hub-module-admission.id.md)

# ADR-0019 — Admission of `integration_hub` as a System Foundation module

- **Status:** Accepted (not yet implemented)
- **Status note (2026-08-05):** This admission decision still stands, but its artifact (`src/modules/integration-hub/`) does not exist in this repo, and since ADR-0055 its implementation waits on an admission ADR in this repo.
- **Date:** 2026-07-14
- **Decision maker:** @ahliweb
- **Related:** Issue #754 (epic #738 `platform-evolution`, Wave 3), Issue #742/#745 (`domain_event_runtime`, `data_lifecycle` — both dependencies), Issue #739/ADR-0013 §1/§6 (pre-classification of `integration_hub` as a System Foundation candidate + the data-ownership matrix), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

> **NOT YET IMPLEMENTED IN THIS REPO.** The `Accepted` status above is an
> **admission** decision, not a statement that the module exists. As of today
> there is no `src/modules/integration_hub/`, no migration, no permission, and
> `listModules()` does not return it — calling it will fail. The plan to build
> it: Wave A
> [`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`](../awcms/absorb-awcms-mini-backbone-roadmap.md).
> Delete this block in the PR that actually lands the module —
> `tests/adr-admission-implementation-status.test.ts` demands it be deleted as
> soon as the module enters the registry.

## Context

ADR-0013 §1 already pre-classified `integration_hub` as a **System Foundation** candidate for epic #738, and §6 (the data-ownership matrix) already stated its boundary explicitly: this module owns the **delivery status of inbound/outbound envelopes (staging/inbox/outbox) — not final business data**, collaborating with the data-owning modules through a capability port/internal-public API. Issue #754 itself explicitly requires as its first acceptance criterion: "Admission decision/ADR confirms category, owner, dependencies, offline behavior, and adapter ownership rules" — this ADR meets that requirement by filling in the `module-proposal-template.md` format inline, following the ADR-0016 precedent (`organization_structure`, Issue #749) which also wrote a dedicated admission ADR because its issue explicitly asked for one (unlike #742/#743, which relied on the ADR-0013 pre-classification alone, without a separate ADR/doc 21 §8).

This module depends on two other System Foundation modules already _merged_ in the same epic: **#742 `domain_event_runtime`** (normalising verified inbound messages into versioned domain events, and outbound delivery fan-out triggered AFTER the source commit through the same outbox/dispatcher mechanism) and **#745 `data_lifecycle`** (retention/minimisation/legal-hold policy for raw inbound payloads and outbound delivery history).

## Decision

We decide to admit `integration_hub` as a new module in this base registry with the following parameters:

### 1. Module name & key

- Name: **Integration Hub**
- `key`: `integration_hub`
- Category: **System** (= the ADR-0013 "System Foundation" layer)

### 2. Problem/need

AWCMS already has provider-specific integrations inside their respective owning modules (Mailketing in `email`, R2 in `sync_storage`/`news_portal`, Cloudflare DNS in `tenant_domain`, Telegram/Meta in `social_publishing`) and several reliable outbox/worker patterns. What does not exist is a **generic, provider-neutral integration boundary**: signed inbound webhooks (signature verification + replay protection), translation of provider-specific payloads into this repo's own domain-event shape (through #742), outbound event subscriptions (other systems/tenants are notified when an event happens, with reliable delivery), adapter health (up/down/degraded), and operator retry/replay that is safe against duplication. This is a cross-module need (every module with an external provider needs the same inbound signal and outbound subscription mechanism), not a standalone tenant product feature — precisely the doc 21 §2 definition of the System category.

### 3. Why this is System, not an Official Optional Module or a Derived Application

It passes the doc 21 §3 decision tree: Q1 (required at boot?) → No. Q2 (infrastructure/reusable across modules, not a standalone product feature?) → **Yes** — webhook signature verification, replay protection, and reliable outbound delivery are generic mechanisms that EVERY module with an external provider needs, not direct business value for a tenant's end-user (unlike `blog_content`/`news_portal`/`organization_structure`, which have direct product value). This is consistent with ADR-0013 §1's explicit pre-classification and §6's data boundary ("envelope delivery status ... not business data", the same as `domain_event_runtime`/`data_lifecycle`).

### 4. Dependencies

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, must be enabled first): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` for the tenant boundary (`awcms_tenants`), `identity_access` for RBAC/ABAC + the audit actor, `domain_event_runtime` because this module is a REAL producer (translating verified inbound messages into events via `appendDomainEvent`) AND a real consumer (outbound subscription fan-out is triggered by the #742 dispatcher) — the same pattern as `workflow_approval` (#747) and `organization_structure` (#749), not the Core `profile_identity` (#748) pattern which deliberately does not import cross-module constants.
- **Data lifecycle contract** (`ModuleDescriptor.dataLifecycle`, #745): this module registers descriptors for raw inbound payloads (short retention, `retentionClass: "communication_log"`) and outbound delivery history — **not** a lifecycle dependency (it does not need `data_lifecycle` enabled first; the `data_lifecycle` engine reads descriptors through `listModules()` at any time, just as `logging`/`visitor_analytics`/`form_drafts` register descriptors without adding `data_lifecycle` to their `dependencies`).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `integration_hub` **PROVIDES** `integration_adapter_registration` — a capability port (`_shared/ports/integration-adapter-port.ts`) that future provider-owning modules (e.g. `email` wanting to process bounce webhooks, `social_publishing` wanting to verify Meta webhooks) can implement to register their own provider verification/normalisation schemes — **the hub itself never imports the internals of any adapter module**, only the port defined in `_shared`. This module registers no `capabilities.consumes` at all — it is the future adapter modules that will consume this port, not the other way around.

### 5. Offline/LAN compatibility vs full-online-only

- Compatibility class: **offline-lan-safe** for its core mechanism (the endpoint registry, webhook reception+verification, replay protection, subscription storage, the PostgreSQL-based outbound dispatch worker) — there is no MANDATORY external provider dependency. The inbound endpoint `POST /api/v1/integration-hub/inbound/{endpointToken}` is only meaningful if there IS an external caller sending webhooks (a LAN without internet can still receive webhooks from other LAN systems), and outbound dispatch to a tenant-configured `target_url` requires network connectivity ONLY to that destination itself (not a mandatory platform dependency) — a dead provider/destination never blocks the source transaction (item #4 of this issue's security checklist, ADR-0006).
- The two fixture signature schemes this module ships (`fixture_hmac_sha256`, `fixture_shared_secret_nonce`) are self-contained references (following the "foundation issue ships zero real business integrations" precedent — #643, #742) — not real provider integrations, so they need no external credentials/connection whatsoever to function/be tested.

### 6. External providers

There is no SPECIFIC external provider called directly by this module (out of scope, see the issue). This module provides a GENERIC MECHANISM (adapter/signature-scheme registry, capability port, outbound HTTP client with SSRF protection) that future provider-specific owning modules will use — this module itself never calls any specific business provider API (Meta, Telegram, Mailketing, etc.) directly, only a generic `fetch()` to the tenant-configured `target_url` for outbound subscriptions, and it only receives (does not call out) for inbound webhooks.

### 7. Security & data governance

- Data touched: webhook delivery metadata (verification status, payload hash/size, a LIMITED payload snippet and only for deliveries that pass signature verification), outbound subscription configuration (destination URL, filters, without storing raw secrets — only a `secret_reference` in the form of an `env:VAR_NAME` pointer), adapter health status.
- ABAC: default-deny, new permission keys per resource (`integration_hub.endpoints.*`, `.subscriptions.*`, `.deliveries.*`, `.health.*`) — see the permission seed migration.
- High-risk actions that must be audited + carry an `Idempotency-Key`: creating/deleting an inbound endpoint, secret rotation, creating/deleting an outbound subscription, replaying a failed outbound delivery, pausing/resuming an adapter.
- The inbound webhook endpoint itself is secured through signature verification + replay protection (items #2/#3 of this issue's security checklist), NOT the conventional `Idempotency-Key` header (the external provider controls that request, not a consumer of our API) — dedup is done through the DB unique constraint `(tenant_id, endpoint_id, replay_key)`.
- The RLS predicate of every new table in this module is always and only `tenant_id`.
- Raw payloads/secrets never enter logs/audit raw (redaction mandatory, following `_shared/redaction.ts`).

### 8. Ownership

`@ahliweb` (following `.github/CODEOWNERS`, the same as every other module).

### 9. Deprecation plan

Not relevant — a new module, it does not replace any existing module/feature.

### 10. Alternatives considered

- **Building webhooks/subscriptions as part of `domain_event_runtime` itself** — rejected: #742 is deliberately confined to a generic SAME-PROCESS/DB-only outbox/dispatcher mechanism with no external I/O (see the #742 README §"Execution model" — a CALL outside the transaction needs a lease-based 3-phase shape that is DIFFERENT from #742's model today). Splitting `integration_hub` out as its own module keeps #742 simple and avoids mixing "generic outbox mechanism" with "external network boundary security" (signature verification, SSRF, secret rotation) — two different concerns.
- **Every adapter module (email/social_publishing/etc.) building its own webhook/replay protection** — rejected: duplicating timing-safe HMAC verification, replay-key DB uniqueness, and retry/backoff/DLQ/circuit-breaker in every provider module is exactly the problem that drove #742/#745 to be built as a shared foundation — the same pattern applies here.
- **Making `integration_hub` an Official Optional Module (opt-in per tenant, like `blog_content`)** — rejected: this is pure cross-module reusable infrastructure (doc 21 §2), not a standalone end-user business feature — the same criterion that places `domain_event_runtime`/`data_lifecycle` in the System category rather than Official Optional Module.
- **This module calling specific business provider APIs directly (e.g. verifying straight against the Meta Graph API)** — explicitly rejected by the scope of issue #754 ("Provider-specific business adapters implemented in the generic hub" = out of scope) and by ADR-0013 §6 (final data stays owned by its owning business module) — this module only provides the port + the generic mechanism, with two self-contained fixture schemes to prove the mechanism works end to end.

## Consequences

- **Positive:** Future provider modules (email bounce webhooks, social_publishing inbound Meta/Telegram webhooks, etc.) get a ready-made signature-verification/replay-protection/outbound-subscription mechanism through the capability port, without rebuilding HMAC/replay/circuit-breaker each on their own.
- **Positive:** The ADR-0013 §6 "envelope staging vs final business data" boundary now has its first concrete implementation proving that rule can be enforced (this hub never owns final business data, only delivery status + short-lived raw payloads).
- **Negative/trade-off:** The 18th module in the registry adds surface that must pass `modules:dag:check`/`modules:compose:check` every time the registry changes — mitigation: dependencies are declared minimally (`tenant_admin`, `identity_access`, `domain_event_runtime`), and there is no `consumes` capability that could create a cycle (only `provides`).
- **Neutral:** `docs/awcms/21_module_admission_governance.md` §8 is updated with an 18th row (see this PR).

## Alternatives considered

See §10 above (merged into the inline proposal template format, not repeated here).
