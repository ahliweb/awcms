🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0006-offline-first-sync-outbox.id.md)

# ADR-0006 — Offline-first + transactional outbox + sync HMAC

- **Status:** Accepted
- **Date:** 2026-07-05
- **Related:** `docs/awcms/15_frontend_architecture_integration.md`, `docs/awcms/16_backend_data_access_integration.md`, `docs/awcms/10_template_kode_coding_standard.md` (§Sync HMAC)

## Context

Derived applications may run in a LAN/offline environment. Critical operational flows must not depend on an internet connection or an external provider. Node-to-node synchronisation and provider calls must be reliable without sacrificing database consistency.

## Decision

We decided on the **offline-first** pattern:

- **Transactional outbox** — domain events, provider messages, and sync payloads are written in the same transaction as the data change, then sent by a separate worker. External providers are **never** called inside a DB transaction.
- **Sync HMAC** — node-to-node push/pull is signed with `HMAC(timestamp.body)` with anti-replay (max skew 300 seconds by default, timing-safe compare) and idempotency (duplicate events are safe).
- **Manual conflict** — conflicts are not resolved automatically; they are flagged for manual resolution + audit.

## Consequences

- **Positive:** critical flows survive connection disruption; DB consistency is preserved; sync is safe against replay/duplication.
- **Trade-off:** requires a worker dispatcher, an outbox table, and a conflict resolution mechanism.
- **Neutral:** providers (R2, messaging) are optional via a feature flag; a feature being off does not stop the application.

## Alternatives considered

- **Calling providers directly in the request/transaction** — rejected: ties critical flows to external availability and risks a partial commit.
- **Auto-merging conflicts** — rejected: risks losing/overwriting data without a trace.
