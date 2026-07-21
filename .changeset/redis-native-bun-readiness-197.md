---
"awcms": minor
---

feat(redis): add optional Bun-native Redis readiness foundation (#197)

Adds an opt-in, fail-open Redis capability for scalable AWCMS-derived applications without changing PostgreSQL as the authoritative transactional store. The additive foundation includes typed configuration, tenant-aware key namespacing, JSON cache-aside helpers with mandatory TTL, a credential-safe Redis health CLI, unit tests without a live Redis dependency, a hardened standalone Compose deployment, and operational/security guidance for LAN and Coolify deployments.

Redis remains disabled by default. No session, audit, workflow, durable outbox, authorization boundary, or authoritative ERP/domain state is migrated to Redis, and no third-party runtime dependency is added.
