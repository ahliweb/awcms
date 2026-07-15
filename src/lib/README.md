# Shared Runtime Library (`src/lib/`)

Helper lintas-modul (Bun-only, tanpa secret) — fondasi teknis yang dipakai
setiap modul ERP sehingga pengembangan modul fokus pada logika bisnis, bukan
menulis ulang idempotency/pooling/observability. Diadaptasi dari
[awcms-mini](https://github.com/ahliweb/awcms-mini).

## Subsistem

| Folder           | Isi                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`          | `password.ts` (argon2id), `session-token.ts` (token buram + hash), `ssr-session.ts` (cookie SSR admin)                                                                                                                                             |
| `database/`      | `client.ts` (pool per-kind app/worker/setup, `resolvePoolMaxForKind`), `tenant-context.ts` (`withTenant` + RLS), pooling di bawah                                                                                                                  |
| `logging/`       | `logger.ts` (JSON terstruktur + `setLogSink` extension point), `error-sanitizer.ts` (`sanitizeErrorForLog`/`safeErrorDetail`), `error-log.ts` (`logAdminPageError`/`logScriptFailure`), `correlation-response.ts` (propagasi `meta.correlationId`) |
| `observability/` | `metrics-port.ts` (counter/gauge/histogram port), `in-memory-metrics-port.ts`, `adapters/prometheus-text-adapter.ts`                                                                                                                               |
| `jobs/`          | `job-runner.ts` (runner cron/worker), `advisory-lock.ts` (koordinasi lintas-proses), `batching.ts`, `retry-classification.ts`                                                                                                                      |
| `database/` pool | `capacity-config.ts` (sizing pool/backpressure), `circuit-breaker.ts` (3-state closed/open/half_open), `work-class.ts` (semaphore per kelas beban), `work-class-registry.ts`                                                                       |
| `integration/`   | `timeout.ts` (`withTimeout` untuk panggilan keluar/outbox)                                                                                                                                                                                         |
| `tenant/`        | `public-tenant-resolver.ts` (resolusi tenant rute publik tanpa sesi, ADR-0009)                                                                                                                                                                     |
| `html/`          | `escape.ts` (escaping), `error-responses.ts` (halaman error HTML)                                                                                                                                                                                  |
| `semver/`        | `compare.ts` (perbandingan versi kontrak/modul, ADR-0008)                                                                                                                                                                                          |
| `security/`      | `security-headers.ts`, `rate-limit.ts`, `request-body-limit.ts`                                                                                                                                                                                    |

Primitive lintas-modul lain ada di `src/modules/_shared/`: `idempotency.ts`
(dedup mutation high-risk), `keyset-pagination.ts` (cursor list endpoint),
`capability-contract-versions.ts` (versi capability port, ADR-0011),
`api-response.ts`, `soft-delete.ts`, `redaction.ts`, `module-contract.ts`,
`module-dependency-graph.ts`.

## Status wiring

Pooling lanjutan (`work-class`/`circuit-breaker`/`capacity-config`) dan
`jobs`/`observability` tersedia sebagai **library** dan sudah ada unit
test-nya, tetapi belum dirangkai otomatis ke jalur runtime: `withTenant()`
saat ini masih menerapkan RLS `SET LOCAL` saja — gate work-class + circuit
breaker di depan pool dirangkai saat modul ERP bervolume tinggi
membutuhkannya (lihat [`docs/awcms/database-pooling.md`](../../docs/awcms/database-pooling.md)).
Metrics-port juga belum punya endpoint `/metrics`; adapter Prometheus siap
dipasang saat observability diaktifkan. Ini disengaja — fondasi disediakan
lebih dulu agar modul berikutnya tinggal memakainya.

Semua kode di folder ini wajib Bun-only, tidak menyimpan secret, dan mengikuti
lapisan service/repository di `docs/awcms/10_template_kode_coding_standard.md`
dan `docs/awcms/16_backend_data_access_integration.md`.
