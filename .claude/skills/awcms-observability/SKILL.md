---
name: awcms-observability
description: Manage the already-active AWCMS log/audit/metrics system — correlation IDs across hops, audit log retention/purge, extension points for external consumers (alerting/export/SIEM), and the metrics port (low-cardinality counter/histogram/gauge for request/pool/job/provider). Use when adding a new endpoint (correlation ID is automatic), scheduling an audit log purge, installing a log/audit consumer in a deployment/external consumer, or adding/consuming an operational metric. Different from awcms-audit-log (WHAT must be audited) — this skill is about HOW the log/audit/metrics system itself is managed, per Issue #447 and Issue #698.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Observability (Correlation ID, Retention, Extension Points, Metrics)

Source of truth: `src/lib/logging/logger.ts`, `src/lib/logging/correlation-response.ts`, `src/modules/logging/application/{audit-log,audit-purge}.ts`, `src/lib/observability/metrics-port.ts`, `docs/awcms/observability-metrics.md`, `docs/awcms/20_threat_model_security_architecture.md` §Compliance matrix A.8.15/A.8.16 + §Additional standards Issue #698. Reference implementation: Issue 10.1 (log/audit foundation) + Issue #447 (activation) + Issue #698 (metrics/SLO/job health/provider telemetry).

## Correlation ID — already automatic, do not wire it by hand

`X-Correlation-ID` is set by the middleware on **every** response header since Issue 10.1. Since Issue #447, `meta.correlationId` in the JSON **body** is also filled automatically for **every** `/api/*` endpoint that responds through `ok()`/`fail()` (`src/modules/_shared/api-response.ts`) — a single choke point in `src/middleware.ts` (`applyCorrelationIdToApiBody`) fills `meta.correlationId` when the handler has not filled it itself.

- **New endpoint**: no wiring at all is needed — just use `ok()`/`fail()` as usual (`awcms-new-endpoint`), `meta.correlationId` is filled automatically.
- **Need the correlation ID explicitly** (e.g. to pass into `recordAuditEvent`/a cross-module call within one request) → read `context.locals.correlationId`, **do not** generate a new UUID yourself in the handler.
- If a handler already sets `meta.correlationId` itself (the old `GET /logs/audit` pattern), the middleware does **not** overwrite it — it only fills empty ones.

## Retention/purge of `awcms_audit_events`

This append-only table **does have** a purge mechanism since Issue #447 — do not rebuild it:

- `purgeExpiredAuditEvents(sql, tenantId, legalHoldGuard, options)` (`src/modules/logging/application/audit-purge.ts`) — default retention **730 days** (`AUDIT_EVENT_DEFAULT_RETENTION_DAYS`, overridable via env `AUDIT_LOG_RETENTION_DAYS`), batched `DELETE ... LIMIT 5000` per call (`AUDIT_EVENT_PURGE_BATCH_LIMIT`) — never a single unbounded statement that locks an old table. **The `legalHoldGuard` param (`LegalHoldGuardPort`) is MANDATORY (ADR-0037)** — before the DELETE, the function checks whether `logging.audit_events` is under hold for that tenant; if it is, the batch is skipped (`purgedCount: 0`). The `legalHoldGuardPortAdapter` adapter (`data-lifecycle/application/legal-hold-guard-port-adapter.ts`) is injected at the composition root `scripts/audit-log-purge.ts` — do not import it directly from inside the `logging` `application`/`domain` tree (this prevents cyclic cross-imports, ADR-0011).
- Scheduled CLI `bun run logs:audit:purge` (`scripts/audit-log-purge.ts`) — same pattern as the Issue #436 dispatcher (`object-sync-dispatch.ts`): iterate `active` tenants, loop per tenant until one pass deletes nothing, report the result at the end. **Not** an HTTP endpoint — it is only invoked by cron/systemd timer/k8s CronJob, consistent with the dispatcher's "trusted internal worker" pattern. Since Issue #697 (epic #679) this script is built on the shared worker runner `src/lib/jobs/job-runner.ts` (advisory lock per job name, `--dry-run`, JSON telemetry) — see `docs/awcms/deployment-profiles.md` §Shared worker runner; the purge/retention/audit behaviour itself is UNCHANGED.
- A purge action **must** be recorded as a new audit event (`action: "purge"`, severity `warning`) in the same transaction — never purge silently (doc 04 "Purge... must be audited").
- Tenants with an active legal hold over `logging.audit_events`: the purge is **skipped automatically** by `legalHoldGuard` (ADR-0037) — there is no longer any need for a manual per-tenant opt-out; an active hold record (tenant-wide or targeting `logging.audit_events`) gates the DELETE programmatically.
- Adding a new append-only table that needs retention? Reuse this pattern (bounded batches + self-audit), do not build a separate purge mechanism per table.

## Extension point — a mounting point, NOT a SIEM implementation

This base is generic and **deliberately does not** build a real SIEM/alerting/export (doc 20 §Compliance matrix A.8.16 — outside the scope of this generic base, the responsibility of the deployment/external consumer). What is provided is the mounting point:

- `setLogSink(sink: LogSink | null)` / `getLogSink()` (`src/lib/logging/logger.ts`) — called every time `log()` writes one JSON line, **after** redaction. Default `null` (no-op, zero behaviour change).
- `setAuditExportHook(hook: AuditExportHook | null)` / `getAuditExportHook()` (`src/modules/logging/application/audit-log.ts`) — called on every successful `recordAuditEvent` INSERT, with the already-redacted row.

**Mandatory rules when mounting or implementing a consumer here**:

1. **Do not perform blocking external I/O directly inside the hook** — `AuditExportHook` is called **inside the same DB transaction** as the INSERT (ADR-0006: providers must not be called inside a transaction). If the consumer needs to send outward (an HTTP call to a SIEM, etc.), **enqueue** it through the existing outbox/dispatcher pattern (`awcms-integration`, `object-dispatch.ts`); do not call it directly from the hook.
2. **A hook must never take the application down** — the `notifyAuditExportHook`/`setLogSink` implementations already catch synchronous throws and promise rejections separately; if you write a new consumer that CALLS the hook (rather than merely registering it), the same error-catching pattern must be replicated.
3. The default stays `null` — do not mount a real sink/hook in this generic base; only provide/use the extension point. A real consumer implementation is deployment/external-consumer scope.

## Verification

- Any new endpoint (not just `GET /logs/audit`) returns a `meta.correlationId` equal to the `X-Correlation-ID` header — with no manual wiring.
- `bun run logs:audit:purge` against a real Postgres: rows older than the cutoff are deleted, new rows survive, and one new audit event (`action=purge`) shows up in `GET /logs/audit`.
- A sink/hook deliberately made to throw never takes down the calling request/transaction.
- `LOG_LEVEL` (env) is still honoured — `debug` only appears when `LOG_LEVEL=debug`.

## Caught exception -> log/console — use the helper, not raw console.error (Issue #687)

The `log()` above already redacts the `context` object by key (`redactSensitiveAttributes`), but it does NOT automatically clean the `.message`/`.stack` of an `Error` passed through as one of the `context` attributes — that free text can contain secrets that escape key-based redaction. For SSR admin pages and CLI workers, do not call raw `console.error(label, error)` or extract `error.message` by hand — use `logAdminPageError`/`logScriptFailure` (`src/lib/logging/error-log.ts`), which run `sanitizeErrorForLog`/`safeErrorDetail` (`src/lib/logging/error-sanitizer.ts`) first. `bun run logging:lint:check` (part of `bun run check`) rejects regressions to the old pattern in `src/pages/admin`, `src/pages/api/v1`, and `scripts/` — see doc 20 §Additional standards Issue #687.

## Metrics port — a different concept from logging, do not build a new mechanism (Issue #698)

`src/lib/observability/metrics-port.ts` adds low-cardinality numeric aggregates (counter/histogram/gauge) — a **complement** to, not a replacement for, the `log()`/audit trail above: log/audit are per-occurrence events with high detail; metrics are "how many/how fast/how saturated" aggregates to be scraped into a time-series backend. Full detail (architecture, the per-metric cardinality/privacy table, initial SLI/SLO + burn-rate, dashboard/runbook, sample Prometheus/OpenTelemetry adapters): `docs/awcms/observability-metrics.md`.

- **Default is ALWAYS no-op** (`createNoopMetricsPort`) — never mount a real adapter in this generic base, exactly like `setLogSink`/`setAuditExportHook` above. A real consumer implementation is deployment/external-consumer scope.
- **Adding a new metric**: you MUST add an entry to `METRIC_DEFINITIONS` (name, type, `allowedLabelKeys`, `approxCardinality`, `privacyNote`) BEFORE calling it — `MetricName` is a literal union of that registry's keys, so calling an unregistered name is a compile error, not a convention that can be broken silently.
- **Label cardinality/privacy guardrail — different from value redaction above**: redaction (`redactSensitiveAttributes`/`redactSecretsInText`) is for free text in LOGS; in metrics the problem is CARDINALITY EXPLOSION (one series per tenant/id forever) plus the privacy of the label itself. Every label MUST come from an enum/fixed-code value (module name, job name, HTTP status code, work-class name, provider family) — **never** a tenant ID, a path with a real request ID, an email/IP, an object key, a token, or free-form content. `recordCounter`/`recordHistogram`/`recordGauge` already drop (rather than reject with an error) label keys not declared in that metric's `allowedLabelKeys` — defence in depth, but do not lean on it as an excuse to throw arbitrary labels at the call site.
- **Providers with a tenant-scoped registry key** (e.g. `getProviderCircuitBreaker` for SSO, Issue #610: `sso-oidc-discovery:<tenantId>:<providerKey>`) — NEVER use that raw key as a label. Use `deriveProviderFamilyLabel` (`src/lib/database/circuit-breaker.ts`), which truncates to the literal prefix before the first `:`. Every new provider call site that follows the "literal category prefix, optional dynamic `:` suffix" convention is automatically safe through that function — there is no manual provider list to extend.
- **Hook into the mechanisms that ALREADY EXIST, do not duplicate logic**: job run status/backlog is hooked through `src/lib/jobs/job-runner.ts`'s `buildResult` (a single choke point for every `runJob` outcome); provider outcome/latency/circuit state is hooked through `decorateWithMetrics` in `src/lib/database/circuit-breaker.ts` (a wrapper between `getDatabaseCircuitBreaker`/`getProviderCircuitBreaker` and the pure `createCircuitBreaker` — `createCircuitBreaker` itself STAYS pure/timerless, unchanged); DB pool saturation is hooked through `emitWorkClassGauges` in `src/lib/database/work-class.ts` (called at every point where `active`/`queue.length` changes). New domain modules/endpoints that need similar metrics must look for an existing choke point like these, not add bespoke instrumentation at many call sites.
- **Metrics are NOT an authorization source** — never read a metric value to make an ABAC/RLS/authentication decision in any code.
- The **authorized endpoint** `GET /api/v1/logs/observability/dependency-health` (permission `logging.observability.read`) distinguishes a "local dependency" (the database) from an "optional external provider" — a pattern for similar endpoints in a deployment/external consumer that needs to distinguish local dependencies from optional providers in a single response.

## Related skills

`awcms-audit-log` (WHAT must be audited + redaction), `awcms-integration` (the dispatcher/outbox pattern for external I/O, ADR-0006), `awcms-security-hardening` (the A.8.16 centralised SIEM/monitoring scope boundary), `awcms-performance` (pool/backpressure tuning that the `db_pool_work_class_*` metrics now make observable).
