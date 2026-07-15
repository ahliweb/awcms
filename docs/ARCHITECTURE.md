# Arsitektur AWCMS (Sprint 1–2)

Status per ADR-0001: repo ini sedang membangun skeleton fondasi (Sprint 1)
dan modul fondasi Tenant/Identity/Profile (Sprint 2), mengikuti
`docs/awcms/11_implementation_blueprint.md`. Dokumen ini menjelaskan apa yang
**sudah ada di kode**, bukan target penuh — untuk target penuh lihat
`docs/awcms/` (diadaptasi dari `awcms-mini`).

## Stack

- Runtime: Bun (Bun-only, ADR-0002 di `awcms-mini`). Bin Astro/Vite dijalankan lewat `bun --bun`.
- Web: Astro 7, SSR via `@astrojs/node` (adapter, bukan runtime — lihat komentar di `astro.config.mjs`).
- Database: PostgreSQL, RLS wajib untuk setiap tabel tenant-scoped.
- Driver: `Bun.SQL` bawaan Bun.

## Modular monolith

```
src/modules/<module>/
  module.ts            # ModuleDescriptor (lihat _shared/module-contract.ts)
  domain/               # tipe & validasi murni, tanpa I/O
  application/          # service/orchestrasi, menerima Bun.SQL tx
  api/                  # (opsional) skema/handler bersama; route file tetap di src/pages
```

Modul yang sudah ada: `logging` (audit trail lintas modul), `tenant-admin`
(tenant/office/setup wizard/tenant settings), `profile-identity` (profil
person/organization + identifier + entity link), `identity-access` (login,
sesi, RBAC/ABAC dasar).

## Tenant context & RLS

Setiap request tenant-scoped berjalan lewat `withTenant()`
(`src/lib/database/tenant-context.ts`): melewati gate work-class + circuit
breaker (`src/lib/database/`) di depan pool — mengembalikan `503
DATABASE_BUSY` + `Retry-After` saat breaker open atau work-class saturasi,
alih-alih cascading timeout — lalu membuka transaksi, menjalankan
`SET LOCAL app.current_tenant_id = '<tenantId>'`, dan memanggil fungsi
handler (mencatat sukses/gagal ke breaker; error input Postgres 22/23
dikecualikan agar tidak men-trip breaker). Setiap tabel tenant-scoped punya
RLS policy yang membandingkan `tenant_id` dengan
`current_setting('app.current_tenant_id')`. RLS adalah lapis kedua — query
tetap wajib memfilter `tenant_id` secara eksplisit. State pool/breaker
diekspos di `GET /api/v1/database/pool/health`.

**Penting (diverifikasi manual terhadap PostgreSQL asli):** PostgreSQL
mengecualikan role superuser (dan role pemilik tabel tanpa `FORCE ROW LEVEL
SECURITY`) dari RLS. `DATABASE_URL` di `.env.example` untuk dev lokal boleh
memakai role superuser/pemilik migration — RLS baru benar-benar aktif bila
`awcms_app` (role runtime) adalah role terpisah, non-superuser, dan
idealnya bukan pemilik tabel (pola 4-role dari `awcms-mini`, lihat doc 18
§Model role database — belum diimplementasikan sebagai migration di sini,
menyusul saat role separation dibutuhkan). Jangan andalkan RLS sebagai
satu-satunya lapis proteksi sebelum role separation ini ada di produksi.

## Auth

Sesi berbasis token buram (bukan JWT): `POST /api/v1/auth/login` membuat
token acak, menyimpan hash SHA-256-nya di `awcms_sessions`, dan mengembalikan
token mentah sekali saja. Klien mengirim token lewat header
`Authorization: Bearer <token>` (API) atau cookie httpOnly
(`awcms_session`/`awcms_tenant_id`, untuk SSR admin shell). Tenant aktif wajib
dikirim lewat header `X-AWCMS-Tenant-ID` untuk endpoint non-cookie.

## RBAC/ABAC dasar

`identity-access/domain/access-control.ts` — `evaluateAccess()`: default deny,
deny overrides allow. Permission diidentifikasi `module_key.activity_code.action`.
Setiap keputusan (allow/deny) dicatat ke `awcms_abac_decision_logs`
(`application/decision-log.ts`). `authorizeInTransaction()`
(`application/access-guard.ts`) adalah satu-satunya chokepoint yang dipanggil
setiap route terproteksi: resolve sesi -> fetch permission -> evaluate ABAC ->
catat decision log -> kembalikan context atau `Response` gagal siap pakai.

Evaluator ABAC penuh (kebijakan berbasis atribut/scope kantor, business-scope
hierarchy, SoD) adalah target Sprint 3 — belum diimplementasikan di sini.

## Audit trail

`logging/application/audit-log.ts` — `recordAuditEvent()` menulis satu baris
ke `awcms_audit_events` (redaksi otomatis lewat `_shared/redaction.ts`).
Audit melengkapi, bukan menggantikan, log terstruktur (`src/lib/logging/logger.ts`)
maupun domain event (belum ada publisher event di Sprint 1/2).

## Kontrak API

`openapi/awcms-public-api.openapi.yaml` — satu file (belum dipecah per modul
seperti target `docs/awcms/05_openapi_asyncapi_detail.md`; pemecahan
fragment + bundler adalah pekerjaan lanjutan begitu jumlah modul bertambah).
`bun run api:spec:check` memvalidasi: setiap operasi punya `operationId`
unik, setiap operasi menyatakan security requirement (atau `security: []`
plus entri di allow-list publik), parameter path cocok dengan template path,
dan setiap route file di `src/pages/api/v1/**` punya pasangan path OpenAPI
(dan sebaliknya).

`asyncapi/awcms-domain-events.asyncapi.yaml` — baseline kosong; diisi begitu
modul pertama mempublikasikan domain event.

## Migration

`scripts/db-migrate.ts` membaca `sql/*.sql` terurut nama file
(`NNN_awcms_<area>_<deskripsi>.sql`), menghitung checksum SHA-256 tiap file,
menjalankan file yang belum tercatat di `awcms_schema_migrations` dalam satu
transaksi per file (dengan advisory lock lintas proses), dan menolak start
bila checksum file yang sudah ter-apply berubah (edit migration yang sudah
jalan harus lewat migration baru, bukan mengedit file lama).

## Yang sengaja belum ada (Sprint 1/2)

- Module Management (`awcms_tenant_modules` per-tenant enable/disable) — endpoint
  `authorizeInTransaction` belum mengecek status modul per tenant.
- MFA/OIDC/SSO/Turnstile pada login.
- Business-scope hierarchy, segregation-of-duties (SoD), sync/outbox, workflow,
  reporting projection.
- Fragmentasi OpenAPI per modul + bundler (`openapi:bundle`).

Semua di atas ada di basis teknologi `awcms-mini` dan bisa diadaptasi begitu
modul ERP yang membutuhkannya mulai dikerjakan (lihat peta sprint di
`docs/awcms/11_implementation_blueprint.md`).
