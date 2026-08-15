🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Shared Runtime Library (`src/lib/`)

Cross-module helpers (Bun-only, no secrets) — the technical foundation used by
every ERP module so that module development focuses on business logic instead of
rewriting idempotency/pooling/observability. Adapted from
[awcms-mini](https://github.com/ahliweb/awcms-mini).

## Boundary: technical infrastructure only (ADR-0043, Issue #257)

`src/lib` is **only** for technical infrastructure that **does not carry a domain
name**. Presentation/delivery code belonging to a module — route composition
roots, middleware glue, browser client scripts — lives in
`src/modules/<module>/presentation/`.

Why the rule needs machine enforcement: `src/lib` had grown into **a second
module system guarded by no gate at all**. Four namespaces (`seo`, `theming`,
`comments`, `search`) carried the name of an existing module and contained code
owned by that module, and `seo_distribution` even referenced UPWARDS into
`src/lib/seo/` through a path the DAG validator cannot see. The cause was
structural, not a matter of discipline: the module contract had no place for
presentation code, so `src/lib/<module-name>/` was the only home available.

`bun run modules:dag:check` now FAILS when a `src/lib/<x>/` namespace collides by
name with a `moduleKey` — exactly, or through a registered domain alias
(`seo`→`seo_distribution`, `search`→`site_search`, etc.). Without the aliases,
two of the four real cases would have slipped through.

One recorded exception: **`logging/`** — a database-free logger primitive used by
~139 files including `src/lib` itself; the `logging` module is an audit trail
service, a different thing that happens to share the word.
`tests/lib-namespace-ownership.test.ts` proves `logging` **IS DETECTED** and is
only silenced by the exception table, not a blind spot in detection.

## Subsystems

| Folder           | Contents                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`          | `password.ts` (argon2id), `session-token.ts` (opaque token + hash), `ssr-session.ts` (admin SSR cookie)                                                                                                                                             |
| `database/`      | `client.ts` (per-kind pool app/worker/setup, `resolvePoolMaxForKind`), `tenant-context.ts` (`withTenant` + RLS), pooling below, DB roles below                                                                                                      |
| `logging/`       | `logger.ts` (structured JSON + `setLogSink` extension point), `error-sanitizer.ts` (`sanitizeErrorForLog`/`safeErrorDetail`), `error-log.ts` (`logAdminPageError`/`logScriptFailure`), `correlation-response.ts` (`meta.correlationId` propagation) |
| `observability/` | `metrics-port.ts` (counter/gauge/histogram port), `in-memory-metrics-port.ts`, `adapters/prometheus-text-adapter.ts`                                                                                                                                |
| `jobs/`          | `job-runner.ts` (cron/worker runner), `advisory-lock.ts` (cross-process coordination), `batching.ts`, `retry-classification.ts`                                                                                                                     |
| `database/` pool | `capacity-config.ts` (pool/backpressure sizing), `circuit-breaker.ts` (3-state closed/open/half_open), `work-class.ts` (per-load-class semaphore), `work-class-registry.ts`                                                                         |
| `integration/`   | `timeout.ts` (`withTimeout` for outbound calls/outbox)                                                                                                                                                                                              |
| `tenant/`        | `public-tenant-resolver.ts` (tenant resolution for public routes without a session, ADR-0009)                                                                                                                                                       |
| `html/`          | `escape.ts` (escaping), `error-responses.ts` (HTML error pages)                                                                                                                                                                                     |
| `semver/`        | `compare.ts` (contract/module version comparison, ADR-0008)                                                                                                                                                                                         |
| `security/`      | `security-headers.ts`, `rate-limit.ts`, `request-body-limit.ts`                                                                                                                                                                                     |

Other cross-module primitives live in `src/modules/_shared/`: `idempotency.ts`
(high-risk mutation dedup), `keyset-pagination.ts` (list endpoint cursor),
`capability-contract-versions.ts` (capability port versions, ADR-0011),
`api-response.ts`, `soft-delete.ts`, `redaction.ts`, `module-contract.ts`,
`module-dependency-graph.ts`.

## Wiring status

Advanced pooling **is already wired** into the runtime path: `withTenant()` now
applies the work-class gate + circuit breaker in front of the pool (503
`DATABASE_BUSY` + `Retry-After` when the breaker is open / the work class is
saturated), then RLS `SET LOCAL`. Every route already using `withTenant` is
automatically protected without changing the route file — pass `{ workClass }`
for non-interactive load (e.g. reports/`background_sync`/`maintenance`). The
`GET /api/v1/database/pool/health` endpoint exposes work-class saturation +
circuit breaker state + per-process pool capacity (used by `bun run db:pool:health`;
see [`docs/awcms/database-pooling.md`](../../docs/awcms/database-pooling.md)).

### The database roles behind `client.ts`

`client.ts` has three pool _kinds_ (`app`/`worker`/`setup`) but this repo only
provides **one** runtime role: `awcms_app`, created by
[`sql/019_awcms_db_role_separation.sql`](../../sql/019_awcms_db_role_separation.sql)
(not a superuser, not BYPASSRLS, not the table owner, DML only) with a fail-closed
default GUC `app.current_tenant_id` = the zero UUID — without `withTenant()` the
result is zero rows, not an error and not another tenant's data. Only with this
role does RLS `FORCE` (migration 017) actually become a security boundary, because
SUPERUSER/BYPASSRLS bypasses RLS no matter how FORCEd it is.

`WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` **opt in** to mapping onto the
least-privilege roles `awcms_worker`/`awcms_setup`, created by
[`sql/022_awcms_db_worker_setup_roles.sql`](../../sql/022_awcms_db_worker_setup_roles.sql)
(Issue #163) — each one only GRANTs the per-write-path privileges its code uses,
with zero access to any other global catalogue. Empty → both fall back to
`DATABASE_URL` (`awcms_app`), so nothing breaks; the separate kinds still give
**pool isolation** even before opting in. Operator details: doc 18 §Database role
model.

`jobs`/`observability` are available as a **library** (with unit tests) but there
is no scheduled runner and no `/metrics` endpoint yet: the Prometheus adapter
(`observability/adapters/`) is opt-in via `setMetricsPort`, installed when
observability is enabled. This is deliberate — the foundation is provided first so
that the next module only has to use it.

All code in this folder must be Bun-only, must store no secrets, and must follow
the service/repository layering in `docs/awcms/10_template_kode_coding_standard.md`
and `docs/awcms/16_backend_data_access_integration.md`.
