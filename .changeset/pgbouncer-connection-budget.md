---
"awcms": minor
---

feat(database): `bun run database:capacity:check` and a verified PgBouncer transaction-pooling path (Issue #1286, ADR-0161 stage S2).

**Capacity check.** `scripts/database-capacity-check.ts` is a thin CLI over `capacity-config.ts`: instances x per-process pool size per client kind plus reserved headroom against PostgreSQL `max_connections`, or against the PgBouncer limits when `DATABASE_PGBOUNCER=true`. Offline by default (config and env only); `--live` also reads `max_connections` and caps the budget at what the server accepts; `--json` for machines. It exits 1 with a clear finding when the budget is exceeded at the configured max instance counts and 2 on a usage error or an unreadable live server. PgBouncer's `default_pool_size` is per (database, user) pool, so the backend ceiling is now `default_pool_size x pools`, with the pool count derived from the distinct roles in `DATABASE_URL`/`WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` (`DATABASE_CAPACITY_PGBOUNCER_POOL_COUNT` overrides). A deployment with one role is unchanged. No pool default changes.

**PgBouncer fix (only under `DATABASE_PGBOUNCER=true`).** Verified against a real PgBouncer 1.25: it refuses `statement_timeout` as a connection startup parameter, so the pool never opened. In that mode the client no longer sends it at connect time and `withTenant` applies `SET LOCAL statement_timeout` per transaction instead. Direct deployments (the default) are unchanged byte for byte. `bun run database:pgbouncer:verify` proves, through the production client, that `SET LOCAL app.current_tenant_id` does not leak between interleaved tenant transactions on shared backend connections.

**Example.** `deploy/pgbouncer/docker-compose.yml` (pinned image, internal network, read-only) and an updated `pgbouncer.ini.example`. EN and `.id.md` docs updated; the runbook no longer says the CLI does not exist. There is still no `production:preflight` script, so the check is a documented manual step. The Postgres-backed integration suite itself was not run through PgBouncer (its harness opens its own connections); see `docs/awcms/database-pooling.md` section 7.
