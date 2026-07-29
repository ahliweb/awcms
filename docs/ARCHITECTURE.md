# Arsitektur AWCMS

Status per [ADR-0001](adr/0001-rebuild-on-awcms-foundation-erp-scope.md), direposisi
oleh [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(men-supersede ADR-0013/0014/0015/0022/0025): AWCMS adalah salah satu dari **tiga template
keluarga AWCMS yang dipakai LANGSUNG** (template lini ERP/back-office). Sebagai template
yang di-ship, base menyediakan **modul fondasi reusable + kontrak netral kesiapan ERP** —
modul domain ERP (finance, inventory, procurement, manufacturing, hr-payroll, dst.)
**ditambahkan langsung di `src/modules/` template ini** saat dipakai, bukan di repo
ekstensi/turunan terpisah (jalur aplikasi-turunan DIHAPUS — lihat §Komposisi modul di
bawah). Repo ini punya **20 modul aktif**, migration `sql/001`-`sql/079`, RLS
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

20 modul terdaftar di `src/modules/index.ts` (urutan = urutan registrasi):

- **`logging`** — audit trail lintas modul (`awcms_audit_events`) + purge terjadwal.
- **`tenant_admin`** — tenant root, hierarki office, tenant settings, setup wizard sekali jalan.
- **`profile_identity`** — profil person/organization kanonik, identifier bertipe (masking/hash), entity link lintas modul.
- **`identity_access`** — login (sesi opaque token), password reset lewat email
  (enumeration-safe, single-use, mencabut semua sesi), self-registration
  ber-persetujuan admin (default MATI), tenant user membership, RBAC/ABAC dasar.
- **`module_management`** (`isCore`) — registry modul berbasis DB: sync descriptor, enable/disable per tenant, settings non-secret, sinkron permission, navigation, job registry, health/readiness.
- **`domain_event_runtime`** — outbox/dispatcher domain event transaksional, versi, multi-consumer, dead-letter + replay ter-audit.
- **`sync_storage`** — node sync offline-first, outbox/inbox HMAC-signed anti-replay, conflict tracking, antrian upload objek.
- **`workflow_approval`** — engine workflow definisi ber-versi (draft/publish/retire), node graph (approval/condition/parallel/join/notify), quorum, delegasi, eskalasi.
- **`email`** — layanan email provider-neutral (Mailketing + `log` adapter), template management, dispatcher outbox, pengumuman massal.
- **`reporting`** — lima view manajemen (aktivitas tenant, akses/audit, sync health, module usage, email health) plus mekanisme projection read-model (incremental cursor/event-driven, rebuild, freshness, reconciliation, export terjadwal).
- **`theming`** (`type: "domain"`) — modul **website** pertama yang hidup langsung di base (ADR-0034 Fase 3): konfigurasi tema per tenant (design token), lifecycle draft/preview/publish/retire/rollback ber-immutability, route `/api/v1/theming/*` + stylesheet publik `/theming/{tenantCode}/tokens.css` (eksternal, `style-src 'self'`). Validasi nilai CSS by-rejection, preview beku ber-SHA-256.
- **`blog-content`** (`type: "domain"`) — modul konten publik pertama, di-port dari mini (PR #214, `sql/035`-`sql/040`, 15 tabel `awcms_blog_*`): CRUD+lifecycle post/page (draft→review→scheduled/published→archived, soft-delete/restore/purge), kategori/tag hierarkis, full-text search, revisi append-only, presentasi/monetisasi (template/menu/widget/ads/theme), auto internal-tag-linking, per-tenant settings. Rute publik **path-based** `/blog/{tenantCode}/*` (ADR-0009): index, detail, arsip kategori/tag, search, RSS feed, sitemap. Rute `/news/**` host-resolved TIDAK di-port (butuh `tenant_domain`). **Sejak [ADR-0044](adr/0044-merge-news-portal-into-blog-content.md) (#300) modul ini juga MEMILIKI seluruh bekas `news_portal`**: homepage-section composer + ad placement ber-`media_object_id` terverifikasi (menggantikan jalur `image_url` bebas), dengan penargetan iklan yang dilebarkan (#301) dan jalur tulis iklan free-URL ditutup (#303). `news_portal` **tidak lagi terdaftar** di `src/modules/index.ts`; registry objek media tetap milik `media_library` sejak [ADR-0036](adr/0036-media-library-module-admission-ownership-inversion.md).
- **`tenant-domain`** (`type: "domain"`) — di-port dari micro (#219, `sql/046`-`sql/048`): pendaftaran + verifikasi domain kustom per tenant, primary-host, fungsi lookup host→tenant. Fondasi host-resolved untuk SEO (host kanonik) & rute publik host-based.
- **`visitor-analytics`** (`type: "domain"`) — di-port dari micro (#220, `sql/049`-`sql/051`): telemetri kunjungan privacy-minimized (`awcms_visit_events`/`awcms_visitor_sessions`), rollup harian, job rollup + purge terjadwal (kini mengonsultasi legal-hold `data_lifecycle`).
- **`media-library`** (`type: "domain"`) — **inversi kepemilikan** ([ADR-0036](adr/0036-media-library-module-admission-ownership-inversion.md), #221, `sql/052`-`sql/054`): satu modul memiliki SELURUH objek media per-tenant (registry R2 + presign/finalize/cancel + magic-byte MIME sniff + SHA-256), menyediakan capability `media_library` (dikonsumsi `blog-content`, `seo-distribution`). Enforcement managed-media per-tenant (`POST /api/v1/media/enforcement`, idempotent). `news_media` dipensiunkan.
- **`data-lifecycle`** (`type: "domain"`) — di-port dari micro ([ADR-0037](adr/0037-data-lifecycle-module-admission.md), #222, `sql/055`-`sql/056`): retensi/arsip/purge generik lintas modul via descriptor `dataLifecycle` pada `ModuleDescriptor` + **legal-hold non-bypassable** (guard `LegalHoldGuardPort` dikonsultasi setiap purge). Base kini ship **1 aturan SoD** `data_lifecycle.legal_hold_maker_checker`.
- **`seo-distribution`** (`type: "domain"`) — di-port dari micro ([ADR-0038](adr/0038-seo-distribution-module-admission-discovery-scope.md) discovery + [ADR-0039](adr/0039-seo-distribution-redirect-governance.md) redirect governance, #223/#224, `sql/057`-`sql/061`): renderer metadata SEO terpusat (canonical/hreflang/robots/OG/JSON-LD terkontrol, host diturunkan **server** dari `tenant_domain`) + rute discovery publik tak-terautentikasi (`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`) + config admin `/api/v1/seo/config` + **tata kelola redirect** (aturan exact-path `awcms_seo_redirects`, telemetri 404, hook `src/middleware.ts` fail-open, guard open-redirect beku). **Konsumen/agregator** capability `seo_facts` (disediakan `blog_content`) — tidak mengimpor modul konten mana pun.

- **`form-drafts`** (`type: "system"`) — di-port dari micro (#230, `sql/062`-`sql/063`): penyimpan draft form multi-langkah yang generik & bebas-domain (create/read/update/submit/delete payload JSONB tenant-scoped), dibatasi ukuran dan divalidasi denylist terhadap nama field berbentuk-rahasia, dengan job retensi dua-fase expire-lalu-purge (descriptor `dataLifecycle` bertipe `delegated` — purge nyata + cek legal-hold tetap di modul ini). Tanpa logika domain: modul yang membuat draft yang memiliki arti payload-nya. Pustaka KOMPONEN wizard awcms-micro **tidak** termasuk port ini (baris Gelombang-0 yang masih terbuka).
- **`site-search`** (`type: "domain"`) — di-port dari micro ([ADR-0040](adr/0040-site-search-module-admission.md), #231, `sql/064`-`sql/065`): full-text search PostgreSQL lintas-konten per tenant atas konten website **yang sudah terbit**. Memiliki indeks terpadu `awcms_site_search_documents` (`tsvector`/GIN + indeks judul `pg_trgm` untuk suggest), config per-tenant, ledger index run, diagnostik item gagal, dan query log terminimalisasi yang opt-in. **Konsumen/agregator** descriptor `searchSources` — pemetaan tabel/kolom + filter publikasi murni-data yang dideklarasikan modul konten (bukan capability `provides`, karena penyedia jamak justru diharapkan), dibaca generik lewat `listModules()`. Reconcile/rebuild deterministik & idempoten (`site-search:reconcile`) menjaga indeks tetap proyeksi setia: archive/delete/unpublish hilang dari hasil publik tanpa sisa. Halaman publik `/search` + endpoint JSON `/api/v1/site-search/query` & `/suggest` ter-scope tenant+locale; teks query **selalu** parameter terikat ke `websearch_to_tsquery`, snippet `ts_headline` di-escape sebelum HTML apa pun dipancarkan. URL publik dibangun dari `urlTemplate` tiap descriptor dengan `:tenantCode` yang diresolusi server (rute konten publik base ini path-tenant-scoped, ADR-0009 — bukan host-resolved seperti micro). **DI-DROP saat port** (terdokumentasi): script typeahead inline micro — CSP base ini melarang script inline dan halaman publiknya APIRoute polos tanpa langkah bundling, jadi `/search` ship pencarian inti no-JS dan `/suggest` tetap tersedia untuk klien ter-bundle milik tema. Indeks pencarian adalah proyeksi konten publik saja dan **tidak pernah** menjadi sumber otorisasi.

- **`comments`** (`type: "domain"`) — di-port dari micro ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`-`sql/067`): komentar **moderation-first** di atas resource yang **sudah terbit & publik**. Memiliki thread, komentar ber-kedalaman-terbatas (hard cap 4), riwayat moderasi append-only, laporan penyalahgunaan, setting per-tenant, telemetri anti-abuse terminimalisasi, dan langganan notifikasi-balasan terenkripsi. **Konsumen/agregator** descriptor `commentableResources` (`MODULE_CONTRACT_VERSION` 2.3.0) — modul konten MENDEKLARASIKAN resource mana yang boleh dikomentari; `comments` menemukannya lewat `listModules()`. Tulang punggung keamanannya: batas publikasi ditegakkan di perbatasan resource→thread (draft/privat/terhapus tak pernah menerima maupun mengekspos komentar); body disimpan **teks polos** dan di-escape saat render (tak ada HTML tersimpan → tak ada XSS tersimpan), hanya autolink http(s) `rel="nofollow ugc noopener noreferrer"`; respons submit publik **seragam** sehingga endpoint tak bisa dipakai sebagai oracle blocked-term atau konten belum-terbit; PII penulis diminimalkan (sha256 + mask, tak pernah mentah). Notifikasi balasan lewat outbox event (payload tanpa alamat), retensi meng-**anonimkan** di tempat (bukan menghapus) dan menghormati legal hold. Admin `/admin/comments` + API `/api/v1/comments/*`.

Modul lain di ekosistem keluarga (mis. `newsletter`,
`social-publishing`, `document-infrastructure`, `integration-hub`,
`idn-admin-regions`) **belum di-port** ke repo ini — lihat
skill masing-masing (ditandai "BACAAN SAJA") + [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md)
untuk spesifikasi target & urutan porting.

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
- **`tests/module-boundary.test.ts` menutup celah yang tak bisa dilihat ketiganya.**
  Gate di atas memvalidasi graf yang **DIDEKLARASIKAN** — dari `listModules()`
  saja, tanpa I/O. Tak satu pun membaca satu baris `import`, jadi sebuah modul
  bisa meng-import apa pun asal tidak menuliskannya. Tujuh edge seperti itu ada
  saat gate ini mendarat (#251). Sekarang tiap import lintas-modul wajib
  dideklarasikan sebagai `dependencies`, sebagai `capabilities.consumes`, atau
  dikecualikan eksplisit dengan alasan yang bisa dibantah reviewer.
- **`modules:table-writes:check` menutup celah KEDUA: kopling lewat SQL, bukan
  lewat `import`.** Dua modul bisa sepenuhnya bebas dari import satu sama lain
  dan tetap menulis TABEL yang sama — coupling yang tak terlihat gate mana pun
  di atas. `_shared/module-contract.ts` menyebut aturan "ADR-0013 §6 no
  shared-table write" **empat kali** sebagai alasan tiap seam
  (`dataLifecycle`/`searchSources`/`commentableResources`/`reportingProjections`)
  mengoper METADATA ke engine pusat alih-alih menjangkau skema modul lain —
  tapi SQL tulis-tangan di luar seam itu tak pernah diperiksa, dan enam tabel
  ditulis lebih dari satu modul saat gate ini mendarat. Kepemilikan **diturunkan,
  bukan dideklarasikan** (aturannya "paling banyak satu penulis", jadi
  penulisnya sendiri adalah buktinya; tabel baru tak perlu didaftarkan untuk
  ikut tercakup). Rute di `src/pages` diatribusikan lewat `api.routes`, jadi
  `INSERT` di rute milik sebuah modul bukan penulis kedua. Tulis DINAMIS
  (`${tableName}` milik engine `data_lifecycle`/`reporting`) sengaja di luar
  cakupan — itu justru mekanisme yang diresepkan §6, dan sudah digerbangi
  registry-check masing-masing.

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

**Penolakan pool BUKAN sebuah nilai — dua bentuk, dipilih compiler.**
`withTenant()` mengembalikan `T | Response`: pemanggil di jalur request
meneruskan `503`-nya apa adanya (`if (result instanceof Response) return
result;`), dan ~390 handler yang callback-nya memang mengembalikan `Response`
tak berubah sama sekali. Segala sesuatu yang BUKAN handler HTTP — worker, job
terjadwal, frontmatter SSR, resolver tenant, fixture test — memakai
`withTenantOrThrow()`, yang melempar `DatabaseBusyError` (membawa `response`
`503` yang identik, jadi kedua bentuk tak bisa menyimpang) dan diklasifikasi
`retryable` oleh job runner. Sebelumnya satu fungsi generik meng-`as T`
penolakan itu menjadi tipe apa pun yang diminta pemanggil: `purgeExpiredAuditEvents`
berjanji `Promise<number>` tapi mengembalikan `Response`, `runBoundedBatches`
berhenti pada `count === 0` yang tak pernah cocok, dan job yang seluruh tujuannya
mengalah justru menjalankan 50 pass per tenant ke database yang baru saja
menolak — lalu melaporkan sukses dengan total berupa string
`"0[object Response]…"` (karena `number + Response` itu konkatenasi).
`db:tenant-context:check` menutup dua sisa yang tak terlihat compiler: hasil
`withTenant` yang **dibuang** (`await withTenant(...)` sebagai statement —
`503`-nya hilang tanpa jejak) dan pemanggilan dari `.astro`, yang tak pernah
dibaca `tsc --noEmit`.

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

Gelombang 2 (delta auth/admin, `sql/073`–`075`) menambah tiga permukaan yang
seluruhnya duduk di atas jalur di atas, tanpa mengubahnya: **password reset
lewat email** (`/api/v1/auth/password/{forgot,reset}` + `/forgot-password`,
`/reset-password`) — enumeration-safe secara konstruksi, single-use ditegakkan
lewat row lock `FOR UPDATE` di DB (bukan read-modify-write JS), mencabut semua
sesi, dan menolak identity SSO-only di jalur permintaan **dan** penebusan;
**self-registration ber-persetujuan admin** (`/register`,
`/api/v1/registration-requests/*`) — default MATI, jalur publiknya tak pernah
menyimpan kredensial maupun membuat akun, approval yang membuat identity dengan
password tak terpakai lalu mengirim link reset; dan layar **`/admin/security`**
yang memberi policy tenant (SSO/MFA/break-glass) sebuah UI — endpoint-nya sudah
ada sejak #184/#185, layarnya tidak, jadi sebelumnya policy hanya bisa diubah
lewat `curl`. Pengiriman email keduanya lewat capability port
`auth_notification` (adapter dimiliki `email`), bukan INSERT lintas-modul.

**Admin shell (Issue #166, #171).** Halaman auth publik `login`,
`forgot-password`, `reset-password`, `register` (tiga terakhir menyusul di
Gelombang 2 — lihat §Auth) + 13 layar `src/pages/admin/*.astro` (dashboard,
offices, profiles, users, roles, abac-policies, registrations, security,
modules, sidebar-menu, email-templates, comments, analytics) memakai
`AdminLayout` + design token doc 14. Layar-layar ini
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
- **Klaster website/konten `awcms-micro` yang sudah terserap** (ADR-0035,
  roadmap penyerapan): `blog-content` (`sql/035`–`045`, kini termasuk bekas
  `news-portal` — ADR-0044),
  `tenant-domain` (`sql/046`–`048`), `visitor-analytics` (`sql/049`–`051`),
  `media-library` (`sql/052`–`054`, inversi kepemilikan ADR-0036),
  `data-lifecycle` (`sql/055`–`056`, ADR-0037), `seo-distribution`
  (`sql/057`–`061`, ADR-0038/0039), `form-drafts` (`sql/062`–`063`), dan
  `site-search` (`sql/064`–`065`, ADR-0040), dan `comments` (`sql/066`–`067`,
  ADR-0041) — semuanya modul aktif.
- **Delta auth/admin `awcms-micro` (Gelombang 2)** — penataan sidebar
  per-tenant (`sql/071`–`072`), password reset lewat email (`sql/073`),
  self-registration ber-persetujuan admin (`sql/074`–`075`), dan layar
  `/admin/security`. Lihat §Auth.

Gap yang genuinely masih ada (jangan diklaim selesai):

- Modul keluarga yang belum di-port (`newsletter`, `social-publishing`,
  `document-infrastructure`, `integration-hub`, `idn-admin-regions`) — lihat skill masing-masing
  (BACAAN SAJA) untuk spesifikasi target, dan
  [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md)
  untuk urutannya. Pasca-[ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  modul domain/website ini ditambahkan **langsung di `src/modules/`** template
  ini saat dibutuhkan, bukan di repo turunan.
- Pustaka komponen UI `src/components/ui/` + paritas design-token (baris
  Gelombang-0 roadmap penyerapan) belum ada; `form-drafts` ship **store**-nya
  saja, tanpa komponen wizard.
- Business-scope hierarchy resolver base masih **NO-OP fail-closed** (menunggu
  modul penyedia hierarki organisasi); SoD base ship **0 rule** (rule nyata
  ilustratif di fixture) — keduanya seam siap-pakai, bukan bug.
