# Arsitektur AWCMS

Status per [ADR-0001](adr/0001-rebuild-on-awcms-foundation-erp-scope.md) (amended by
[ADR-0022](adr/0022-erp-modules-live-in-extension-repos.md)): repo ini adalah **fondasi
modular monolith reusable** — bukan platform ERP itu sendiri. Modul domain ERP (finance,
inventory, procurement, manufacturing, hr-payroll, dst.) dikembangkan di **repo
ekstensi/turunan terpisah** di atas base ini (build-time module composition,
lihat `src/modules/application-registry.ts` dan skill `awcms-module-management`),
bukan di `src/modules/` repo ini. Repo ini sudah melewati fase skeleton Sprint 1-2:
10 modul fondasi aktif, migration `sql/001`-`sql/023`, RLS `FORCE` di seluruh tabel
tenant-scoped, pemisahan role database, dan admin UI read+write (Issue #166, #171).
Dokumen ini menjelaskan apa yang **ada di kode saat ini**. Untuk daftar
modul/migration/tabel/route yang selalu ter-generate ulang, lihat
`docs/awcms/repo-inventory.md`; untuk detail per modul, lihat `README.md`
masing-masing di `src/modules/<module>/`.

## Stack

- Runtime: Bun (Bun-only). Bin Astro/Vite dijalankan lewat `bun --bun`.
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

10 modul terdaftar di `src/modules/index.ts` (urutan = urutan registrasi):

- **`logging`** — audit trail lintas modul (`awcms_audit_events`) + purge terjadwal.
- **`tenant_admin`** — tenant root, hierarki office, tenant settings, setup wizard sekali jalan.
- **`profile_identity`** — profil person/organization kanonik, identifier bertipe (masking/hash), entity link lintas modul.
- **`identity_access`** — login (sesi opaque token), tenant user membership, RBAC/ABAC dasar.
- **`module_management`** (`isCore`) — registry modul berbasis DB: sync descriptor, enable/disable per tenant, settings non-secret, sinkron permission, navigation, job registry, health/readiness.
- **`domain_event_runtime`** — outbox/dispatcher domain event transaksional, versi, multi-consumer, dead-letter + replay ter-audit.
- **`sync_storage`** — node sync offline-first, outbox/inbox HMAC-signed anti-replay, conflict tracking, antrian upload objek.
- **`workflow_approval`** — engine workflow definisi ber-versi (draft/publish/retire), node graph (approval/condition/parallel/join/notify), quorum, delegasi, eskalasi.
- **`email`** — layanan email provider-neutral (Mailketing + `log` adapter), template management, dispatcher outbox, pengumuman massal.
- **`reporting`** — lima view manajemen (aktivitas tenant, akses/audit, sync health, module usage, email health) plus mekanisme projection read-model (incremental cursor/event-driven, rebuild, freshness, reconciliation, export terjadwal).

Modul lain di ekosistem `awcms-mini` (mis. `blog-content`, `data-lifecycle`,
`document-infrastructure`, `form-drafts`, `integration-hub`, `news-portal`,
`social-publishing`, `tenant-domain` routing, `visitor-analytics`) **belum
di-port** ke repo ini — lihat skill masing-masing (ditandai "BACAAN SAJA") untuk
spesifikasi target saat porting.

## Tenant context & RLS

Setiap request tenant-scoped berjalan lewat `withTenant()`
(`src/lib/database/tenant-context.ts`): melewati gate work-class + circuit
breaker (`src/lib/database/`) di depan pool — mengembalikan `503
DATABASE_BUSY` + `Retry-After` saat breaker open atau work-class saturasi,
alih-alih cascading timeout — lalu membuka transaksi, menjalankan
`SET LOCAL app.current_tenant_id = '<tenantId>'`, dan memanggil fungsi
handler (mencatat sukses/gagal ke breaker; error input Postgres kelas 22/23
dikecualikan agar tidak men-trip breaker; race idempotency yang kalah juga
dikecualikan). Setiap tabel tenant-scoped punya RLS policy yang
membandingkan `tenant_id` dengan `current_setting('app.current_tenant_id')`.
RLS adalah lapis kedua — query tetap wajib memfilter `tenant_id` secara
eksplisit. State pool/breaker diekspos di `GET /api/v1/database/pool/health`.

**Pengecualian RLS yang disengaja (allow-list eksplisit).** Dua tabel global
sengaja tanpa RLS: `awcms_tenants` (root multi-tenant — endpoint wajib
`WHERE id = <tenantId>` eksplisit) dan `awcms_setup_state` (singleton
first-run, dijamin satu baris oleh CHECK, dibaca/ditulis sebelum tenant mana
pun ada). Semua tabel tenant-scoped lain memakai RLS `FORCE`.

**RLS FORCE + pemisahan role database (bukan lagi sekadar rencana).**
`sql/017_awcms_enforce_rls_force.sql` menutup celah "PostgreSQL bypass RLS
untuk table owner" dengan `ALTER TABLE ... FORCE ROW LEVEL SECURITY` di
seluruh tabel tenant-scoped. Itu saja tidak cukup — superuser/`BYPASSRLS`
tetap bypass RLS terlepas dari `FORCE`. `sql/019_awcms_db_role_separation.sql`
membuat role runtime `awcms_app` (non-superuser, non-owner, `NOLOGIN` sampai
diaktifkan deployment) dengan default GUC fail-closed
(`app.current_tenant_id` default all-zero UUID, bukan crash) sehingga RLS
baru benar-benar aktif. `sql/021_awcms_db_role_grants_narrow.sql` menyempitkan
grant blanket `awcms_app` di tabel global RLS-free (DELETE dicabut dari
`awcms_permissions`/`awcms_schema_migrations`/`awcms_tenants`, dsb — hanya
verb yang benar-benar dipakai jalur kode nyata). `sql/022_awcms_db_worker_setup_roles.sql`
menambah role terpisah `awcms_worker` (job background) dan `awcms_setup`
(bootstrap sekali-jalan) dengan grant per-jalur-tulis, opsional/opt-in lewat
`WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` (fallback ke `DATABASE_URL` bila
tak di-set — deployment lama tetap jalan). Lihat doc 18 §Model role database
untuk cara mengaktifkan role ini di deployment nyata (`DATABASE_URL` masih
boleh memakai role migration-owner untuk `bun run db:migrate`).

## Auth

Sesi berbasis token buram (bukan JWT): `POST /api/v1/auth/login` membuat
token acak, menyimpan hash SHA-256-nya di `awcms_sessions`, dan mengembalikan
token mentah sekali saja. Klien mengirim token lewat header
`Authorization: Bearer <token>` (API) atau cookie httpOnly
(`awcms_session`/`awcms_tenant_id`, untuk SSR admin shell). Tenant aktif wajib
dikirim lewat header `X-AWCMS-Tenant-ID` untuk endpoint non-cookie. Login
punya pengerasan (rate limit, lockout, dummy-hash anti-enumerasi, redaksi IP)
— lihat `src/modules/identity-access/README.md` §Audit & pengerasan login.
MFA/OIDC/SSO/Turnstile masih genuinely belum ada.

**Admin shell (Issue #166, #171).** `src/pages/login.astro` + `src/pages/admin/*.astro`
(dashboard, offices, profiles, users, roles, abac-policies, modules,
email-templates) memakai `AdminLayout` + design token doc 14. Layar-layar ini
bukan lagi read-only: roles/abac-policies/users/modules/email-templates punya
form tulis (create/update/enable-disable/assign) yang memanggil endpoint
`authorizeInTransaction`-gated yang sama dengan API — gate UI hanya UX,
endpoint tetap otoritas satu-satunya. `src/middleware.ts` menjaga `/admin/*`
(resolve sesi via `resolveSsrContext`, redirect `/login` bila tak ada). CSP
`default-src 'self'` dijaga satu sumber di middleware; halaman tak punya
inline script/style (`build.inlineStylesheets: "never"` + script di-bundle
eksternal, lewat `src/lib/ui/admin-form-client.ts` untuk PATCH/DELETE). E2E
Playwright (`tests/e2e/`, job CI `e2e-smoke`, env-gated) memverifikasi alur
browser sungguhan.

## RBAC/ABAC

`identity-access/domain/access-control.ts` — `evaluateAccess()`: default
deny, deny overrides allow. Permission diidentifikasi
`module_key.activity_code.action` terhadap katalog `awcms_permissions` yang
diseed migration. Selain permission role, evaluator punya dua guard
struktural built-in: **tenant-isolation check** (`resourceAttributes.tenantId`
harus cocok tenant aktif) dan **self-approval guard** (aktor tidak bisa
approve/force-decide permintaannya sendiri, dipakai `workflow_approval`).
Setiap keputusan (allow/deny) dicatat ke `awcms_abac_decision_logs`
(`application/decision-log.ts`), dan setiap action ditandai high-risk atau
tidak (`isHighRiskAction`) untuk kebutuhan audit.

`authorizeInTransaction()` (`application/access-guard.ts`) adalah satu-satunya
chokepoint yang dipanggil setiap route terproteksi: resolve sesi -> **cek
status modul aktif/nonaktif untuk tenant** (`resolveModuleEnabled`, sebelum
permission di-lookup — modul yang dinonaktifkan ditolak `403 MODULE_DISABLED`
apa pun permission yang dipegang aktor, dan tetap tercatat di decision log)
-> fetch permission -> evaluate ABAC -> catat decision log -> kembalikan
context atau `Response` gagal siap pakai. `module_management` sendiri
`isCore` (tidak bisa dinonaktifkan), jadi tenant tak pernah terkunci dari
mengaktifkannya kembali.

**Yang belum ada:** tabel `awcms_abac_policies` sudah punya CRUD admin
(Issue #171, `/api/v1/abac/policies`) tapi **belum dikonsumsi evaluator** —
`evaluateAccess()` masih memakai aturan built-in generik di atas, bukan
policy berbasis atribut/scope kantor dari tabel itu. Business-scope
hierarchy dan segregation-of-duties (SoD) juga belum diimplementasikan.
Endpoint manajemen role/user (`/api/v1/roles`, `/api/v1/users`) sendiri
**sudah ada** (read Issue #166, write Issue #171) — bukan gap lagi.

## Audit trail

`logging/application/audit-log.ts` — `recordAuditEvent()` menulis satu baris
ke `awcms_audit_events` (redaksi otomatis lewat `_shared/redaction.ts`,
retensi `AUDIT_LOG_RETENTION_DAYS` dengan job purge terjadwal
`bun run logs:audit:purge`). Audit melengkapi, bukan menggantikan, log
terstruktur (`src/lib/logging/logger.ts`) maupun domain event: `domain_event_runtime`
kini benar-benar mempublikasikan event nyata (lihat §Kontrak API di bawah),
dan salah satu consumer referensinya adalah projector audit lintas modul.

## Kontrak API

`openapi/awcms-public-api.openapi.yaml` — masih satu file (belum dipecah per
modul seperti target `docs/awcms/05_openapi_asyncapi_detail.md`; tidak ada
script `openapi:bundle` — pemecahan fragment + bundler tetap pekerjaan
lanjutan). `bun run api:spec:check` memvalidasi: setiap operasi punya
`operationId` unik, setiap operasi menyatakan security requirement (atau
`security: []` plus entri di allow-list publik), parameter path cocok dengan
template path, dan setiap route file di `src/pages/api/v1/**` punya
pasangan path OpenAPI (dan sebaliknya).

`asyncapi/awcms-domain-events.asyncapi.yaml` — **bukan lagi baseline kosong.**
Berisi channel nyata untuk `domain_event_runtime` (`sample.recorded`,
reference event), `workflow` (instance started/advanced/approved/rejected/
cancelled, task escalated, delegation created/revoked), dan `email` (message
queued/sent/failed/suppressed/cancelled) — dipublikasikan lewat
`appendDomainEvent` di transaksi bisnis yang sama (ADR-0006, same-commit
outbox write) dan dikirim `bun run domain-events:dispatch` dengan
per-order-key ordering, backoff, dead-letter + replay ter-audit.

## Migration

`scripts/db-migrate.ts` membaca `sql/*.sql` terurut nama file
(`NNN_awcms_<area>_<deskripsi>.sql`, saat ini `001`-`023`), menghitung
checksum SHA-256 tiap file, menjalankan file yang belum tercatat di
`awcms_schema_migrations` dalam satu transaksi per file (dengan advisory
lock lintas proses), dan menolak start bila checksum file yang sudah ter-apply
berubah — edit migration yang sudah jalan (bahkan komentar) harus lewat
migration baru, bukan mengedit file lama; lihat catatan proyek
`awcms-applied-migration-immutable`.

## Status implementasi & gap yang tersisa

Sudah live dan diverifikasi terhadap kode (bukan rencana):

- Module Management enable/disable **ditegakkan** di `authorizeInTransaction`
  (`403 MODULE_DISABLED` sebelum permission lookup), bukan cuma sinyal UI.
- RLS `FORCE` di seluruh tabel tenant-scoped (`sql/017`) + pemisahan role
  database tiga-peran `awcms_app`/`awcms_worker`/`awcms_setup` (`sql/019`,
  `021`, `022`).
- Domain event publishing nyata (`domain_event_runtime`) dengan AsyncAPI
  yang mencerminkan channel sungguhan, bukan baseline kosong.
- Sync/outbox HMAC-signed (`sync_storage`) dan workflow approval ber-versi
  (`workflow_approval`) — keduanya modul aktif, bukan lagi "belum ada".
- Reporting projection read-model (incremental, idempotent rebuild,
  freshness/staleness, reconciliation) di atas lima view reporting dasar.
- Admin UI read **dan tulis** untuk offices/profiles/users/roles/
  abac-policies/modules/email-templates (Issue #166, #171).

Gap yang genuinely masih ada (jangan diklaim selesai):

- Evaluator ABAC berbasis atribut/scope kantor (`awcms_abac_policies`),
  business-scope hierarchy, dan segregation-of-duties (SoD) belum
  dikonsumsi evaluator — lihat §RBAC/ABAC.
- MFA/OIDC/SSO/Turnstile pada login.
- Fragmentasi OpenAPI per modul + bundler (`openapi:bundle`).
- Modul domain ERP dan modul lain milik `awcms-mini` yang belum di-port
  (lihat §Modular monolith) — sesuai ADR-0022, modul ERP memang diarahkan
  ke repo ekstensi terpisah, bukan gap yang perlu ditutup di repo ini.
