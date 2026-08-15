---
name: awcms-integration-hub
description: **ADR-0055 (2 August 2026): this is a BUILD-IT-HERE candidate, not a port.** `awcms-mini`/`awcms-micro` are now ARCHIVES — they may be read as a specification, but the "port from mini" path is REVOKED. Working on it means: ADR admission first, then build it in this repo under the ADR-0055 §3 guardrails (ADR mandatory, security review for auth/access/sync, full `bun run check`, OpenAPI/AsyncAPI in sync, RLS FORCE, ABAC default-deny). READ-ONLY / TARGET SPECIFICATION — the integration_hub module DOES NOT EXIST in this repo (it exists in awcms-mini; `ls src/modules` does not contain `integration-hub`, and there is no migration for it in `sql/`). The module/table/adapter references inside are awcms-mini artifacts. Use it as the target specification when BUILDING it here (ADR admission first), not as a guide to code you can call — verify `ls src/modules` first. Port context (Issue #754, epic platform-evolution #738 Wave 3). Use when adding an inbound webhook endpoint, an outbound event subscription, a new provider adapter, or when changing the SSRF guard/replay protection/circuit-breaker/secret-reference validation. This module has a high security surface (2 findings on PR #784 before merge) — it summarises the invariants that must be preserved so they are not regressed.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Integration Hub Module

> **STATUS — READ-ONLY: this module has NOT been ported into this repo yet.**
> `integration_hub` lives in **awcms-mini**, not here: `ls src/modules`
> does NOT contain `integration-hub`, and `sql/` does not contain its migration.
> Every reference to `src/modules/integration-hub/...`, the
> `awcms_integration_hub_*` tables, and ADR-0019 below is an awcms-mini
> artifact — **do not `import`/`SELECT`/claim it exists** in this repo. Use
> this skill as the target specification for the port (via ADR admission;
> `awcms-port-from-mini` is HISTORICAL), not as a code map you can call.
> Verify `ls src/modules` before claiming anything exists.

`integration_hub` (`src/modules/integration-hub`, Issue #754, epic
`platform-evolution` #738 Wave 3, `type: "system"` — ADR-0013 §1/§6, admission
decision `docs/adr/0019-integration-hub-module-admission.md`) is a
**generic, provider-neutral integration boundary**: signed inbound webhooks
(HMAC + replay protection through a real DB uniqueness constraint), normalized
events (via `domain_event_runtime`), outbound event subscriptions (reliable
delivery with retry/dead-letter), and provider health tracking — the mechanism
that every new provider-owning module SHOULD have been reusing
(Mailketing/`email`, R2/`sync_storage`+`media_library`, Cloudflare DNS/
`tenant_domain`, Telegram/Meta/`social_publishing`) instead of each one
reinventing it. Read `src/modules/integration-hub/README.md` for the full
detail.

## When to use this skill vs the generic skills

It complements (does not replace) `awcms-integration` (ADR-0006 generic
outbox), `awcms-sync-hmac` (the HMAC/timing-safe compare pattern that
already existed earlier in `sync_storage`), `awcms-idempotency`,
`awcms-abac-guard`. This skill provides the security-invariant context
specific to this module — in particular the SSRF guard, where a redirect
bypass bug was already found before merge, so do not re-derive its validation
from scratch.

## What this module NEVER does

- It does **not** call any specific business provider API — there is no
  Meta/Telegram/Mailketing HTTP call in this module, only a generic `fetch()`
  to the tenant-configured `target_url` (outbound) and passive webhook
  reception (inbound). Provider-specific mapping/credentials remain owned by
  the module that has that capability, via
  `_shared/ports/integration-adapter-port.ts`.
- It does **not** ship a real business adapter — only two self-contained
  fixture signature schemes (`fixture_hmac_sha256`,
  `fixture_shared_secret_nonce`) and one generic outbound HTTP adapter
  (`generic_http_webhook`) — the same "the foundation issue ships zero real
  business integrations" pattern as #643/#742.
- It does **not** call a provider inside a database transaction — inbound
  verification is pure/local (HMAC compare only). Outbound delivery is a
  separate worker step, timeout-bounded, retriable
  (`bun run integration-hub:outbound:dispatch`), FIRMLY outside any
  transaction (ADR-0006).

## Inbound flow

1. An operator registers an **endpoint**
   (`POST /api/v1/integration-hub/endpoints`) — an opaque server-generated
   `endpointToken` (the URL segment the provider POSTs to) + a
   `secretReference` pointer (`env:VAR_NAME`, NEVER a raw secret value).
2. The provider POSTs to `POST /api/v1/integration-hub/inbound/{endpointToken}`
   — a PUBLIC endpoint (no tenant JWT). The tenant is resolved from the opaque
   token through a narrow `SECURITY DEFINER` bootstrap function
   (`awcms_resolve_integration_endpoint_lookup`, migration 071 — same pattern
   as `awcms_resolve_tenant_domain_lookup`, migration 033) BEFORE any
   `withTenant(...)` transaction runs.
3. `application/inbound-webhook-intake.ts`'s `processInboundWebhook` runs the
   full gate chain (endpoint/tenant status, content type, body size, signature
   verification) and — for VERIFIED deliveries — INSERTs an inbound delivery
   row with `ON CONFLICT (tenant_id, endpoint_id, replay_key) DO NOTHING`. A
   zero-row result = this delivery has ALREADY been processed (a replay), with
   no further effect. A new row = genuinely new: the payload is normalized and
   `appendDomainEvent` is called (event type
   `awcms.integration-hub.inbound-message.normalized`) — all in the SAME
   transaction.

## Outbound flow

1. An operator registers a **subscription**
   (`POST /api/v1/integration-hub/subscriptions`) — the internal event type it
   listens for, a `targetUrl` (SSRF-validated at write time), and an optional
   bounded declarative `filter`.
2. `integration_hub`'s own static consumer
   (`integrationHubOutboundFanoutConsumer`,
   `application/outbound-fanout-consumer.ts`) is registered in
   `domain-event-runtime/infrastructure/consumer-registry.ts`'s array — the
   same additive extension point used by `workflow_approval`/
   `organization_structure` to become real event PRODUCERs; this module is the
   first real third-party CONSUMER. It runs in the SAME transaction as the
   source event's commit — a same-process, DB-only (zero network calls)
   handler that creates `pending` `awcms_integration_outbound_deliveries` rows
   for every matching active subscription.
3. `bun run integration-hub:outbound:dispatch`
   (`application/outbound-dispatch.ts`) claims due rows, resolves the
   subscription's target/secret, calls
   `infrastructure/outbound-http-client.ts`'s `deliverOutboundWebhook`
   (SSRF-guarded) OUTSIDE any transaction, then finalizes
   (`delivered` / `retry_wait` exponential backoff / `dead_letter`).
   A `dead_letter` can be replayed through a permission-gated,
   reason-required, `Idempotency-Key`-required, audited admin action
   (`application/delivery-replay.ts`) — which creates a NEW delivery row
   referencing the old one, NEVER mutating/re-queueing the old row.

## Security invariants — MUST be preserved (do not regress)

- **Timing-safe signature verification**: `domain/signature-primitives.ts`'s
  `timingSafeEqualHex` uses `node:crypto`'s `timingSafeEqual` (NEVER `===` to
  compare signatures) — same pattern as
  `sync-storage/domain/sync-hmac.ts`.
- **Replay protection = a real DB constraint**:
  `UNIQUE (tenant_id, endpoint_id, replay_key)` on
  `awcms_integration_inbound_deliveries` — not an in-memory check, it survives
  restarts/multi-instance deployments.
- **Key rotation with overlap**: `secretReferencePrevious`/
  `previousSecretExpiresAt` let requests signed with the OLD secret keep
  verifying until the overlap window elapses
  (`application/secret-resolver.ts`'s `resolvePreviousSecretIfInOverlap`).
- **SSRF protection — TWO layers, both mandatory**: `domain/ssrf-guard.ts`
  blocks private/link-local/metadata/reserved IP literals and known metadata
  hostnames at subscription WRITE-TIME;
  `infrastructure/outbound-http-client.ts` re-validates AGAIN AND checks every
  address returned by DNS resolution at DISPATCH-TIME — AND, critically,
  `fetch()` is called with `redirect: "manual"`, and EVERY redirect `Location`
  header is re-validated through the SAME check before being followed (capped
  by `MAX_REDIRECT_HOPS`, currently 2; exceeding it = a non-retryable hard
  failure). **The previous version** relied on `fetch()`'s default
  redirect-following and only ever validated the ORIGINAL `target_url` — a
  subscription target could 302/303/307 to `169.254.169.254` (cloud IMDS) or
  any private IP and the worker would follow it unconditionally, a
  100%-reliable bypass with no timing race (reviewer finding, PR #784, FIXED
  before merge — **do not remove `redirect: "manual"` + its re-validation loop
  for any reason whatsoever**). The response body is also byte-capped
  (`MAX_RESPONSE_BODY_READ_BYTES`, 8 KiB) within the SAME timeout window as
  the fetch itself. Deployment-wide opt-out for LAN-first:
  `INTEGRATION_HUB_ALLOW_PRIVATE_TARGETS=true` (doc 18).
  **Documented residual limitation**: the resolved IP is NOT pinned for the
  actual `fetch()` call, so the DNS-rebinding TOCTOU race (the target's DNS
  record changing between validation and the actual connection) is not fully
  closed — see the `ssrf-guard.ts` header comment. That gap is NARROW and
  timing-dependent, and is DIFFERENT from (and no longer conflated with) the
  redirect bug above, which is fully closed.
- **Secret reference naming is constrained at write time**:
  `domain/secret-reference-validation.ts` requires every `secretReference`
  (endpoint create/rotate-secret, subscription create) to point at an env var
  whose name starts with `INTEGRATION_HUB_` — closing the confused-deputy
  equality-oracle gap (security-auditor finding, PR #784) where an unbounded
  `env:<ANY_VAR_NAME>` let a tenant that ONLY has the ordinary
  `endpoints.create`/`.configure`/`subscriptions.create` permissions reference
  an UNRELATED process-wide secret and use repeated signed-webhook attempts
  (200 vs 401) as a boolean equality oracle against it. **Every new
  endpoint/subscription create/rotate must go through this validator** — do
  not accept a raw `secretReference` without the prefix check.
- **Data minimization**: `raw_body_snippet` (capped at 2000 chars,
  secret-pattern-redacted) is populated ONLY for signature-VALID deliveries;
  rejected/invalid attempts only store hash+size. The normalized JSON body
  relayed to subscribers also gets PII-key redaction
  (`_shared/redaction.ts`'s `redactSensitiveAttributes`) ON TOP OF the raw
  snippet's secret-pattern redaction (security-auditor Low finding, PR
  #784).
- **Never log/store raw secret values** — the `secret_reference` field is only
  a pointer (`env:VAR_NAME`); the resolved value is used in memory for EXACTLY
  ONE HMAC computation, and is never returned/logged.
- **Stale `sending` leases are reclaimed**:
  `application/outbound-dispatch.ts`'s claim query also reclaims deliveries
  stuck in `sending` whose 2-minute lease has expired
  (`OR (status = 'sending' AND next_attempt_at <= now)`), same pattern as
  `sync-storage/application/object-dispatch.ts` — a worker crash/kill in the
  middle of a `fetch()` no longer strands a delivery forever (reviewer
  finding, PR #784, fixed before merge).

## Tables (migration `073`)

`awcms_integration_endpoints` (soft-deletable), `_inbound_deliveries`
(append-only, replay-protected), `_subscriptions` (soft-deletable),
`_outbound_deliveries` (state per subscription+source event),
`_delivery_attempts` (append-only), `_adapter_health` (per
tenant+adapter+direction up/degraded/down). All of them `ENABLE`+`FORCE ROW
LEVEL SECURITY`, with an explicit `tenant_id` filter in every query (defense in
depth) on top of RLS.

## Jobs

`bun run integration-hub:outbound:dispatch`
(`scripts/integration-hub-outbound-dispatch.ts`) — recommended every 1-2
minutes via cron/systemd timer, built on top of the shared worker runner
(`src/lib/jobs/job-runner.ts`).

## 4 documented known limitations (README §Known limitations) — do not assume they are already fixed

1. `_outbound_deliveries`/`_delivery_attempts` are NOT yet registered with
   `data_lifecycle` — the generic `data_lifecycle` engine issues
   `DELETE FROM <tableName>` per descriptor WITHOUT cross-descriptor
   FK-aware ordering; `_delivery_attempts.delivery_id` FKs to
   `_outbound_deliveries.id`, and `_outbound_deliveries.replay_of_delivery_id`
   self-references — registering them without sorting out ordering/`ON DELETE`
   semantics first risks a real FK-violation purge failure. A separate
   follow-up issue; do not just register them without fixing the ordering.
2. **The SSRF DNS-rebinding TOCTOU gap** — see §Security invariants above,
   narrower than the redirect bug, which is already closed.
3. **No circuit-breaker persistence across restarts**:
   `getProviderCircuitBreaker` is in-memory (a fail-fast gate) and resets when
   the worker restarts; `awcms_integration_adapter_health` (a persisted
   signal, visible across restarts) is ONLY observability, it does NOT gate
   the dispatch attempts themselves.
4. **Outbound subscription fan-out is so far scoped to `integration_hub`'s own
   event type** (`awcms.integration-hub.inbound-message.
normalized`) — a future producer module that wants outbound webhook fan-out
   for its OWN event types adds them to
   `integrationHubOutboundFanoutConsumer`'s `eventTypes` array
   (`domain-event-runtime/infrastructure/consumer-registry.ts`) AND to the
   allowlist check in `subscription-directory.ts` — the same
   reviewed-source-code registration pattern used by other
   producers/consumers.

## Common pitfalls

1. Do not remove/weaken `redirect: "manual"` + the re-validation loop in
   `outbound-http-client.ts` — it closes a real SSRF redirect-bypass bug found
   before merge (PR #784).
2. Do not accept a `secretReference` without validating the
   `INTEGRATION_HUB_` prefix — a real confused-deputy oracle.
3. Do not call a provider/`fetch()` inside a database transaction (ADR-0006).
4. Do not register `_outbound_deliveries`/`_delivery_attempts` with
   `data_lifecycle` without fixing the FK-ordering purge first.
5. Do not copy this module's HMAC compare pattern without `timingSafeEqualHex`
   — `===` on a signature is a timing side-channel.

## Verification

See `tests/integration/integration-hub*.integration.test.ts` (where present)
for the replay-protection, SSRF guard (redirect bypass + private-IP), and
stale-lease reclaim tests. Run `bun test` with `DATABASE_URL` —
`bun run check` without `DATABASE_URL` silently skips the integration tests.
