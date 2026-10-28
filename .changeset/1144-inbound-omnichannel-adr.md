---
"awcms": patch
---

Propose ADR-0150 (Issue #1144), the inbound omnichannel conversation and webhook admission boundary. It keeps the ADR-0148 section 6 default with no departure: no generic upstream `interactions` store; verified per-channel adapters publish a redacted `channel.interaction.received` envelope; the only persisted inbound state is a body-free receipt ledger unique on `(channel_account_id, provider_event_id)`; one shared verification gate (a library) verifies provenance before any database work; providers without verifiable authentication stay gated or deferred; replies only on the arrival channel; and the commerce inbox stays the downstream conversation authority. It adds a per-platform inbound capability audit, a sequence diagram, ten invariants for #1164 and open questions for the maintainer. Documentation only, English and Indonesian: no module, table, migration, route or connector is added.
