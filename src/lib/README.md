# Shared Runtime Library (`src/lib/`)

Helper lintas-modul (Bun-only, tanpa secret) — fondasi teknis yang dipakai
setiap modul ERP sehingga pengembangan modul fokus pada logika bisnis, bukan
menulis ulang idempotency/pooling/observability. Diadaptasi dari
[awcms-mini](https://github.com/ahliweb/awcms-mini).

## Subsistem

| Folder           | Isi                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`          | `password.ts` (argon2id), `session-token.ts` (token buram + hash), `ssr-session.ts` (cookie SSR admin)                                                                                                                                             |
| `database/`      | `client.ts` (pool per-kind app/worker/setup, `resolvePoolMaxForKind`), `tenant-context.ts` (`withTenant` + RLS), pooling di bawah, role DB di bawah                                                                                                |
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

Pooling lanjutan **sudah dirangkai** ke jalur runtime: `withTenant()` kini
menerapkan gate work-class + circuit breaker di depan pool (503
`DATABASE_BUSY` + `Retry-After` saat breaker open / work-class saturasi),
lalu RLS `SET LOCAL`. Setiap route yang sudah memakai `withTenant` otomatis
terproteksi tanpa mengubah file route — teruskan `{ workClass }` untuk beban
non-interaktif (mis. laporan/`background_sync`/`maintenance`). Endpoint
`GET /api/v1/database/pool/health` mengekspos saturasi work-class + state
circuit breaker + kapasitas pool per-proses (dipakai `bun run db:pool:health`;
lihat [`docs/awcms/database-pooling.md`](../../docs/awcms/database-pooling.md)).

### Role database di balik `client.ts`

`client.ts` punya tiga _kind_ pool (`app`/`worker`/`setup`) tapi repo ini hanya
menyediakan **satu** role runtime: `awcms_app`, dibuat
[`sql/019_awcms_db_role_separation.sql`](../../sql/019_awcms_db_role_separation.sql)
(bukan superuser, bukan BYPASSRLS, bukan pemilik tabel, DML saja) dengan default
GUC fail-closed `app.current_tenant_id` = UUID nol — tanpa `withTenant()` hasilnya
nol baris, bukan error dan bukan data tenant lain. Baru dengan role inilah RLS
`FORCE` (migration 017) benar-benar menjadi batas keamanan, karena
SUPERUSER/BYPASSRLS melewati RLS apa pun FORCE-nya.

`WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` **opt-in** memetakan ke role
least-privilege `awcms_worker`/`awcms_setup`, dibuat
[`sql/022_awcms_db_worker_setup_roles.sql`](../../sql/022_awcms_db_worker_setup_roles.sql)
(Issue #163) — masing-masing hanya GRANT per-jalur-tulis yang dipakai kodenya,
nol akses ke katalog global lain. Kosong → keduanya fallback ke `DATABASE_URL`
(`awcms_app`), jadi tak breaking; kind terpisah tetap memberi **isolasi pool**
walau belum opt-in. Detail operator: doc 18 §Model role database.

`jobs`/`observability` tersedia sebagai **library** (dengan unit test) namun
belum ada runner terjadwal maupun endpoint `/metrics`: adapter Prometheus
(`observability/adapters/`) opt-in via `setMetricsPort`, dipasang saat
observability diaktifkan. Ini disengaja — fondasi disediakan lebih dulu agar
modul berikutnya tinggal memakainya.

Semua kode di folder ini wajib Bun-only, tidak menyimpan secret, dan mengikuti
lapisan service/repository di `docs/awcms/10_template_kode_coding_standard.md`
dan `docs/awcms/16_backend_data_access_integration.md`.
