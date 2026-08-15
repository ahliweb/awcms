🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](redis-readiness.id.md)

# Redis Readiness — Optional Bun-Native Capability

> Status: draft implementation of Issue #197. Redis is **not enabled by default**
> and does not change PostgreSQL as the AWCMS source of truth.

## 1. Purpose

AWCMS prepares an optional Redis layer for derived applications that need a
bounded read cache or temporary coordination once they start running on more than
one instance. The implementation uses [Bun's native `RedisClient`](https://bun.sh/docs/runtime/redis),
so it adds no `redis`, `ioredis`, or Node.js adapter runtime package.

Bun provides a Promise-based Redis client with connection management,
auto-pipelining, TLS, reconnect, raw commands, and connection health/status.
Bun's native client requires a Redis server 7.2 or newer. Redis Sentinel and
Redis Cluster are not yet supported by this native client and are not part of the
scope of the initial foundation.

## 2. Architectural decisions

```mermaid
flowchart LR
  REQ[Request or worker] --> APP[AWCMS Bun + Astro]
  APP -->|authoritative read/write| PG[(PostgreSQL + RLS)]
  APP -. cache-aside / ephemeral coordination .-> REDIS[(Optional Redis)]
  PG --> OUTBOX[Durable outbox]
  OUTBOX --> PROVIDER[External provider]

  REDIS -. unavailable .-> MISS[Cache miss / write skip]
  MISS --> PG
```

Mandatory principles:

1. **Default disabled.** `REDIS_ENABLED=false` or left unset means AWCMS creates
   no client and makes no attempt to connect to Redis.
2. **PostgreSQL authoritative.** RLS, audit trail, durable outbox, workflow,
   session authority, idempotency records, and ERP/domain data all stay in
   PostgreSQL.
3. **Fail-open for the cache.** A Redis outage becomes a cache miss, a cache
   write skip, or an invalidation skip; business transactions do not fail with it.
4. **Tenant-aware keys.** Tenant data must use `tenantId` through
   `buildRedisKey()`.
5. **TTL mandatory.** The JSON helpers use an atomic `SET ... EX`; there is no
   cache without an expiry.
6. **Not inside a database transaction.** Redis is not called as a mandatory
   dependency of a PostgreSQL transaction callback.
7. **No public port.** Redis may only be reachable over an internal/private
   network.
8. **No hidden fallback.** AWCMS does not use Bun's built-in `redis` singleton,
   which can point at localhost automatically. The client is created explicitly
   only when `REDIS_ENABLED=true` and `REDIS_URL` is valid.

## 3. Implementation components

| Component                             | Function                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/redis/config.ts`             | URL parsing, validation, redaction, and the tenant-aware key builder        |
| `src/lib/redis/client.ts`             | Bun-native `RedisClient` singleton, lifecycle, timeouts, and health         |
| `src/lib/redis/cache.ts`              | JSON cache-aside helpers, invalidation, and fail-open                       |
| `scripts/redis-health.ts`             | Configuration preflight and an authenticated `PING` with no credential leak |
| `config/redis.env.example`            | An optional env example kept separate from the default profile              |
| `deploy/redis/docker-compose.yml`     | Hardened standalone Redis with no published port                            |
| `tests/unit/redis-foundation.test.ts` | Unit tests with no live Redis/network                                       |

There is no new runtime dependency and `bun.lock` does not need to change.

## 4. Configuration

| Variable                      | Default | Description                                      |
| ----------------------------- | ------: | ------------------------------------------------ |
| `REDIS_ENABLED`               | `false` | Feature gate; false means there is no connection |
| `REDIS_URL`                   |    none | Explicit URL; mandatory when Redis is enabled    |
| `REDIS_KEY_PREFIX`            | `awcms` | Application namespace and ACL key boundary       |
| `REDIS_CONNECTION_TIMEOUT_MS` |  `2000` | Initial connection bound, 100–30000 ms           |
| `REDIS_COMMAND_TIMEOUT_MS`    |  `1000` | Application command bound, 50–30000 ms           |
| `REDIS_MAX_RETRIES`           |     `3` | Maximum reconnects, 0–20                         |
| `REDIS_CACHE_DEFAULT_TTL_SEC` |   `300` | Default JSON cache TTL, 1–86400 seconds          |

Accepted URLs:

- `redis://`
- `rediss://`
- `redis+tls://`
- `redis+unix://`
- `redis+tls+unix://`

Use `rediss://` or a trusted internal network for every online deployment
(production, and any second environment standing beside it). Credentials must
come from the environment/secret manager, not from source code, documentation,
module settings, or commits.

## 5. Health and preflight

```bash
bun run redis:health
```

Statuses:

- `disabled`: valid, exit code 0, no connection attempted;
- `healthy`: the configuration is valid and `PING` returns `PONG`;
- `unhealthy`: the connection or command failed, exit code 1;
- `invalid_configuration`: enabled but the configuration is invalid, exit code 1.

The username and password in the URL are always redacted. Cache payloads and
secrets are never printed by the health command.

## 6. Implementation examples

### 6.1 Aggregate report cache

```ts
import { redisCacheAside } from "../../lib/redis/cache";
import { buildRedisKey } from "../../lib/redis/config";

const key = buildRedisKey({
  namespace: "reporting",
  tenantId,
  key: `activity:${range}`
});

const report = await redisCacheAside(
  key,
  () => loadActivityReportFromPostgres(tenantId, range),
  { ttlSec: 60 }
);
```

Suitable for dashboards that are expensive to compute and may be 30–300 seconds
stale.

### 6.2 Reference metadata cache

```ts
const key = buildRedisKey({
  namespace: "reference-data",
  tenantId,
  key: "active-uom"
});

const items = await redisCacheAside(key, loadActiveUomFromPostgres, {
  ttlSec: 300
});
```

A mutation must write PostgreSQL first, then delete or refresh the cache after
commit. The TTL remains the fallback if invalidation fails.

### 6.3 Invalidation after a successful mutation

```ts
const result = await updateAuthoritativeRecordInPostgres(input);
await deleteRedisCache(
  buildRedisKey({ namespace: "reference-data", tenantId, key: "active-uom" })
);
return result;
```

Failing to delete the cache must not turn the PostgreSQL mutation into a failure.

### 6.4 Idempotency acceleration

Redis may act as a short-lived positive/negative cache to cut down on repeated
reads, but the key, the status, the replay response, and the authoritative
transaction result must still be stored in PostgreSQL. A concrete implementation
needs its own issue and separate race-condition tests.

### 6.5 Distributed rate limiting or locks

Bun-native Redis can be used in a later phase, but not through the generic cache
helpers. Rate limiting must be atomic and must carry a fail-open or fail-closed
policy per endpoint. A lock must use an ownership token, a TTL, an atomic
release, and a fencing token for high-impact cases. PostgreSQL constraints,
unique indexes, row locks, and transaction serialisation remain the primary
controls.

## 7. Uses forbidden without a new design

Redis must not be used directly as:

- the single source of authentication sessions;
- storage for audit logs or security events;
- a replacement for the PostgreSQL outbox/inbox;
- storage for workflow approvals;
- storage for transactions, ledgers, balances, stock, payroll, or posted
  documents;
- a replacement for RLS, RBAC, or ABAC;
- a queue with an exactly-once claim;
- a place to store passwords, provider tokens, NIK, health data, or raw personal
  data;
- a mandatory synchronous dependency inside a PostgreSQL transaction.

Changes in those areas require an issue of their own, a threat model, data
classification, RTO/RPO, a recovery plan, failure testing, and API/event
contracts where relevant.

## 8. Standalone deployment

AWCMS does not yet have a canonical root Compose stack. Redis is therefore
provided as a separate deployment, not as an overlay that assumes a particular
`app` or PostgreSQL service.

```bash
cp config/redis.env.example .env.redis
# Replace REDIS_PASSWORD with a long secret from the secret manager.

docker compose \
  --env-file .env.redis \
  -f deploy/redis/docker-compose.yml \
  up -d
```

The deployment creates a network named `awcms-redis-internal` by default. The
AWCMS application must join the same network and use:

```env
REDIS_ENABLED=true
REDIS_URL=redis://awcms_app:${REDIS_PASSWORD}@redis:6379/0
REDIS_KEY_PREFIX=awcms
```

For a different network name, set `AWCMS_REDIS_NETWORK`. On Coolify, use a
Redis/Compose resource inside the same internal network and keep every secret in
Environment Variables/Secrets. Do not expose port 6379.

Deployment hardening:

- the default Redis user is disabled;
- the `awcms_app` user is restricted to `${REDIS_KEY_PREFIX}:*`;
- dangerous command categories are rejected;
- the ACL file contains only the SHA-256 hash of the password;
- AOF `everysec` and snapshots are enabled for operational recovery;
- `protected-mode=yes`;
- an authenticated health check;
- resource limits;
- `cap_drop: [ALL]` and `no-new-privileges`;
- separate data and configuration volumes;
- no `ports:`.

## 9. Consistency and invalidation

The default pattern is cache-aside:

1. Build a versioned, tenant-aware key.
2. Read Redis.
3. On a miss, read PostgreSQL through the tenant context + RLS.
4. Once the authoritative value is available, write Redis with a TTL.
5. A mutation writes PostgreSQL first.
6. After a successful commit, delete or refresh the related key.
7. If invalidation fails, the TTL bounds the staleness.

Do not build a PostgreSQL + Redis dual write as a pseudo-transaction. The two
have no shared atomic commit. For cross-process invalidation, use an
event/outbox after commit, in a separate issue.

## 10. Capacity, eviction, and purpose separation

Start at `maxmemory=256mb` and `noeviction`, then measure. An instance confirmed
to be cache-only may choose LRU/LFU after review. Do not mix a cache that may be
evicted with lock/rate-limit state that needs a different policy without a
capacity analysis.

| Purpose              | Persistence                | Eviction                 | Impact of data loss                    |
| -------------------- | -------------------------- | ------------------------ | -------------------------------------- |
| Report cache         | optional                   | LRU/LFU acceptable       | re-query PostgreSQL                    |
| Rate limiting        | usually not required       | avoid premature eviction | the limit is temporarily less accurate |
| Lock/coordination    | not for recovery           | `noeviction`             | duplicate work may occur               |
| Pub/Sub invalidation | not persistent             | not relevant             | the TTL fixes it eventually            |
| Durable queue        | do not use this foundation | `noeviction`             | needs a separate queue design          |

Minimum monitoring: latency, `used_memory`, `evicted_keys`, rejected connections,
persistence errors, reconnects, buffered amount, and restart count.

## 11. Security and compliance mapping

| Control                 | Practical implementation                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| ISO/IEC 27001 & 27002   | least-privilege ACL, secret management, logging redaction, network isolation               |
| ISO/IEC 27005           | threat model before sessions, locks, queues, or sensitive data are moved to Redis          |
| ISO/IEC 27017/27018     | environment separation, cloud secrets, data minimisation, no raw PII stored                |
| ISO/IEC 27701 & UU PDP  | purpose limitation, TTL, payload minimisation, no credentials/PII in keys                  |
| ISO/IEC 20000           | health command, monitoring, configuration records, rollback feature flag                   |
| ISO 22301               | Redis is not a single point of failure; core services keep running without the cache       |
| PP PSTE / UU ITE        | access protection, service reliability, recording and protection of electronic information |
| OWASP ASVS/API Security | default-off, timeouts, no error leakage, least privilege, dependency isolation             |

## 12. Testing and rollback

Unit tests do not need a live Redis:

```bash
bun test tests/unit/redis-foundation.test.ts
bun run typecheck
```

Optional deployment verification:

```bash
bun run redis:health
```

Rollback needs no database migration:

1. Set `REDIS_ENABLED=false`.
2. Redeploy the application.
3. Stop the Redis resource if it is no longer used.
4. Authoritative values remain available in PostgreSQL.
