---
"awcms": minor
---

feat(security): declared multi-instance deployments must use a shared Redis rate limiter (Issue #1285, ADR-0066). New optional `APP_INSTANCE_COUNT` (default 1). With a value above 1 and no `REDIS_ENABLED=true` + `REDIS_URL`, `bun run config:validate` fails, and a limiter that still runs per-process logs `security.rate_limit.multi_instance_without_redis` at `error` level once. Single-instance behaviour and ADR-0066's fail-open on a Redis outage are unchanged. Operator action: set `APP_INSTANCE_COUNT` to the replica count when running more than one instance.
