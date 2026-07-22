# Arsitektur AWCMS

Status per [ADR-0001](adr/0001-rebuild-on-awcms-foundation-erp-scope.md), direposisi
oleh [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(men-supersede ADR-0013/0014/0015/0022/0025): AWCMS adalah salah satu dari **tiga template
keluarga AWCMS yang dipakai LANGSUNG** (template lini ERP/back-office). Sebagai template
yang di-ship, base menyediakan **modul fondasi reusable + kontrak netral kesiapan ERP** —
modul domain ERP (finance, inventory, procurement, manufacturing, hr-payroll, dst.)
**ditambahkan langsung di `src/modules/` template ini** saat dipakai, bukan di repo
ekstensi/turunan terpisah (jalur aplikasi-turunan DIHAPUS — lihat §Komposisi modul di
bawah). Repo ini punya **13 modul aktif**, migration `sql/001`-`sql/045`, RLS
`FORCE` di seluruh tabel tenant-scoped, pemisahan role database, dan admin UI read+write
(Issue #166, #171). Dokumen ini menjelaskan apa yang **ada di kode saat ini**. Untuk detail
per modul, lihat `README.md` masing-masing di `src/modules/<module>/`.

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

13 modul terdaftar di `src/modules/index.ts` (urutan = urutan registrasi):

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
- **`theming`** (`type: "domain"`) — modul **website** pertama yang hidup langsung di base (ADR-0034 Fase 3): konfigurasi tema per tenant (design token), lifecycle draft/preview/publish/retire/rollback ber-immutability, route `/api/v1/theming/*` + stylesheet publik `/theming/{tenantCode}/tokens.css` (eksternal, `style-src 'self'`). Validasi nilai CSS by-rejection, preview beku ber-SHA-256.
- **`blog-content`** (`type: "domain"`) — modul konten publik pertama, di-port dari mini (PR #214, `sql/035`-`sql/040`, 15 tabel `awcms_blog_*`): CRUD+lifecycle post/page (draft→review→scheduled/published→archived, soft-delete/restore/purge), kategori/tag hierarkis, full-text search, revisi append-only, presentasi/monetisasi (template/menu/widget/ads/theme), auto internal-tag-linking, per-tenant settings. Rute publik **path-based** `/blog/{tenantCode}/*` (ADR-0009): index, detail, arsip kategori/tag, search, RSS feed, sitemap. Rute `/news/**` host-resolved TIDAK di-port (butuh `tenant_domain`).
- **`news-portal`** (`type: "domain"`) — di-port dari mini (PR #214, `sql/041`-`sql/045`, 4 tabel `awcms_news_*`): media object registry R2 + presigned upload direct-to-R2 (magic-byte MIME sniff + SHA-256), homepage-section composer, ad-placement preset, job reconcile media. Menyediakan capability `news_media` yang dikonsumsi `blog-content` via adapter nyata. DI-DROP saat port: rute `/news/**` (butuh `tenant_domain`), aktivasi preset full-online-R2 (butuh preset subsystem `module_management`) — tabel state ada tapi tanpa writer, mode R2-only fail-closed inactive.

Modul lain di ekosistem `awcms-mini` (mis. `data-lifecycle`,
`document-infrastructure`, `form-drafts`, `integration-hub`,
`social-publishing`, `tenant-domain` routing, `visitor-analytics`,
`idn-admin-regions`) **belum di-port** ke repo ini — lihat skill masing-masing
(ditandai "BACAAN SAJA") untuk spesifikasi target saat porting.

### Komposisi & validasi registry modul (ADR-0034)

Registry modul adalah **registry base tunggal** (`src/modules/index.ts`),
disusun 100% saat build/compile (tanpa runtime discovery/`eval`/file scanning).
ADR-0034 **menghapus** jalur aplikasi-turunan: tidak ada lagi
`src/modules/application-registry.ts`, `mergeModuleRegistries`, namespace
migration turunan `900+`, manifest kompatibilitas, maupun command
`extension:check` (men-supersede ADR-0014/0015/0025). Yang **dipertahankan**
adalah mekanisme validasi registry base — kini memvalidasi registry base itu
sendiri, bukan hasil merge dengan registry aplikasi:

- `src/modules/index.ts` mengekspor `listBaseModules()`/`listModules()` (11
  modul, urutan tetap = urutan registrasi). Tetap **data murni** — hanya daftar,
  tidak pernah memvalidasi/melempar saat load.
- `src/modules/module-management/domain/module-composition.ts`
  (`composeModuleRegistry`) adalah mesin validasi yang dipakai gate, bukan jalur
  load modul. Menolak: key ganda, dependency hilang/siklik (memakai ulang
  validator DAG `_shared/module-dependency-graph.ts`), capability provider
  conflict/missing, navigation path conflict, dan job descriptor invalid
  (memakai ulang `job-registry.ts`).
- Gate yang menegakkannya di `bun run check` dan CI: `modules:dag:check`,
  `modules:compose:check`, dan `modules:composition:inventory:generate`/`:check`
  (inventory deterministik `docs/awcms/module-composition-inventory.json`).

Komposisi build-time (modul apa yang ada di kode) dan tenant lifecycle
enable/disable (`module_management`, state DB per tenant) adalah **dua lapis
berbeda** — komposisi tidak pernah bergantung pada input tenant.

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
Di atas password, jalur auth kini punya: **MFA TOTP + recovery codes + session
assurance (aal1/aal2) + step-up** (`sql/024`, route `/api/v1/auth/mfa/*`,
enforcement digerakkan state enrollment DB — fail-closed), **OIDC/SSO
tenant-aware dengan account linking fail-closed + SSRF guard + break-glass**
(`sql/025`/`026`, route `/api/v1/auth/sso/*`), dan **Cloudflare Turnstile bot
protection sadar profil deployment** (`src/lib/security/turnstile.ts`, LAN/offline
exempt). JWT diverifikasi native (RS256+ES256) tanpa dependensi.

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

Di atas guard built-in, evaluator kini mengonsumsi tiga lapis authorization
tambahan yang sudah diport:

- **ABAC dinamis berbasis DSL** (`sql/031`/`032`, `domain/abac-evaluator.ts`,
  route `/api/v1/access/policies/*` DSL + `/api/v1/abac/policies` CRUD flat
  lawas): policy kondisi terbatas (AST jsonb, allow-list atribut server-side,
  op eq/ne/in/nin/lt/lte/gt/gte/exists), precedence deny-overrides fail-closed,
  cache tenant-keyed invalidasi post-commit. Evaluator memuat HANYA policy
  `is_active AND is_dsl_managed` (flat CRUD lawas inert by design).
- **Business-scope hierarchy** (`sql/027`/`028`, `domain/business-scope-assignment.ts`):
  parameter fakta scope ke `evaluateAccess`; base resolver fail-closed NO-OP
  sampai modul penyedia hierarki mengisinya.
- **Segregation of Duties (SoD)** (`sql/029`/`030`, `domain/sod-conflict-evaluation.ts`,
  `application/high-risk-sod-guard.ts`): enforcement dua titik (assignment
  `sod_conflict` 409 + deny-overrides action-time pada aksi high-risk); base
  ship 0 rule (guard inert base-murni; rule ilustratif di fixture).

Endpoint manajemen role/user (`/api/v1/roles`, `/api/v1/users`) sudah ada
(read Issue #166, write Issue #171).

## Audit trail

`logging/application/audit-log.ts` — `recordAuditEvent()` menulis satu baris
ke `awcms_audit_events` (redaksi otomatis lewat `_shared/redaction.ts`,
retensi `AUDIT_LOG_RETENTION_DAYS` dengan job purge terjadwal
`bun run logs:audit:purge`). Audit melengkapi, bukan menggantikan, log
terstruktur (`src/lib/logging/logger.ts`) maupun domain event: `domain_event_runtime`
kini benar-benar mempublikasikan event nyata (lihat §Kontrak API di bawah),
dan salah satu consumer referensinya adalah projector audit lintas modul.

## Kontrak API (modular, Issue #182 / ADR-0026)

Kontrak OpenAPI **dipecah per modul**. Sumbernya adalah fragment —
`openapi/awcms-public-api.src.yaml` (root: info/servers/tags/security +
`components.securitySchemes`/`parameters`/`responses` + schema shared seperti
`ApiError`/`ApiMeta`) dan `openapi/modules/<module>.openapi.yaml` (satu berkas
per modul base, plus `foundation.openapi.yaml` untuk operasi tak-bermodul).
Tiap modul menunjuk fragmentnya lewat `ModuleDescriptor.api.openApiPath`.

`openapi/awcms-public-api.openapi.yaml` kini **GENERATED** oleh
`bun run openapi:bundle` (deterministik/idempoten — kunci ter-sort, tanpa
timestamp) di path lama yang sama, jadi setiap consumer tak berubah. `bun run
api:docs:generate` menghasilkan referensi Markdown `docs/awcms/api-reference.md`
dari bundle + AsyncAPI (contoh sintetik).

`bun run api:spec:check` memvalidasi: **bundle freshness** (bundle commit ==
hasil generate dari fragment), setiap operasi punya `operationId` unik, setiap
operasi menyatakan security requirement (atau `security: []` plus entri
allow-list publik yang benar-benar dipakai), **standard error schema** (semua
response 4xx/5xx resolve ke `ApiError`), parameter path cocok dengan template,
dan setiap route file di `src/pages/api/v1/**` punya pasangan path OpenAPI (dan
sebaliknya). `bun run api:docs:check` menggagalkan build bila referensi Markdown
basi. Bundler menyediakan seam `buildBundledDocument({ extraFragmentFiles })`
untuk menggabungkan fragment tambahan tanpa mengedit fragment base; fragment yang
menimpa path/schema base ditolak (`BundleConflictError`). Detail:
[`openapi/README.md`](../openapi/README.md),
[`docs/awcms/api-contribution-guide.md`](awcms/api-contribution-guide.md).

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
(`NNN_awcms_<area>_<deskripsi>.sql`, saat ini `001`-`034`), menghitung
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
- **Authorization lanjutan**: MFA TOTP + session assurance/step-up,
  OIDC/SSO tenant-aware, Turnstile bot protection (`sql/024`–`026`), ABAC
  dinamis berbasis DSL, business-scope hierarchy, dan SoD conflict
  enforcement (`sql/027`–`032`) — lihat §Auth & §RBAC/ABAC.
- **Kontrak OpenAPI modular** per modul + bundler deterministik
  (`openapi:bundle`, ADR-0026) — bukan lagi gap.
- Modul website **`theming`** hidup langsung di base (`sql/033`–`034`),
  modul website pertama pasca-ADR-0034.

Gap yang genuinely masih ada (jangan diklaim selesai):

- Modul lain milik `awcms-mini` yang belum di-port (`blog-content`,
  `news-portal`, `social-publishing`, `visitor-analytics`, `tenant-domain`
  routing, `data-lifecycle`, `document-infrastructure`, `form-drafts`,
  `integration-hub`, `idn-admin-regions`) — lihat skill masing-masing
  (BACAAN SAJA) untuk spesifikasi target. Pasca-[ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  modul domain/website ini ditambahkan **langsung di `src/modules/`** template
  ini saat dibutuhkan, bukan di repo turunan.
- Business-scope hierarchy resolver base masih **NO-OP fail-closed** (menunggu
  modul penyedia hierarki organisasi); SoD base ship **0 rule** (rule nyata
  ilustratif di fixture) — keduanya seam siap-pakai, bukan bug.
