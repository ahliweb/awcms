# AWCMS — Project State & Continuation

> **Untuk apa dokumen ini.** Ringkasan **state proyek yang tahan-lama** + cara
> melanjutkan pekerjaan — dirancang sebagai **titik-lanjut ter-versioning** (alternatif
> catatan sesi privat/worktree yang tidak ikut ter-commit). Baca ini **lebih dulu** saat
> memulai/melanjutkan pekerjaan besar. Ia **melengkapi**, bukan menggantikan:
>
> - [`ARCHITECTURE.md`](ARCHITECTURE.md) — apa yang **ada di kode** (teknis, per-subsistem).
> - [`AGENTS.md`](../AGENTS.md) — **kontrak kerja** (aturan wajib, guardrail, alur task).
> - `docs/adr/` — **keputusan** arsitektural (kenapa).
>
> Sumber kebenaran state tetap **kode + `sql/` + `bun run check`**. Bila dokumen ini
> berbeda dari kode, kode yang benar — perbarui dokumen ini.

## 1. Model tata kelola saat ini (WAJIB dipahami)

Sejak [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(men-supersede ADR-0013/0014/0015/0022/0025): **`awcms-mini`, `awcms`, `awcms-micro` =
tiga template keluarga AWCMS yang dipakai LANGSUNG**, bukan hierarki base-dan-turunan.
`awcms` = template lini **ERP/back-office**.

Disempurnakan oleh [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
(positioning `awcms`): mode operasi `awcms` = **hybrid online + offline dengan prioritas
online-first** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS
terintegrasi**, dan `awcms` menjadi **superset** keluarga yang **menyerap** klaster
website/e-commerce, UI/UX, dan pengerasan auth `awcms-micro` (peta di
[`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md)). `awcms-mini`
tetap hybrid offline-first (siap SaaS); `awcms-micro` tetap website full-online ramping.
Model tata kelola dipakai-langsung/tanpa-repo-turunan (ADR-0034 §2/§3) **tidak berubah**.

- Modul domain — **ERP, website/e-commerce, dan konten** — **ditambahkan langsung di
  `src/modules/`** template ini saat dipakai, lalu didaftarkan di `src/modules/index.ts`.
- **Jalur aplikasi-turunan DIHAPUS**: tidak ada lagi `src/modules/application-registry.ts`,
  command `extension:check`, namespace migrasi `900+`, manifest kompatibilitas turunan.
  `ModuleType` valid = `base | system | domain | integration` (tidak ada `derived`).
- Dokumen/skill yang masih menyebut "repo turunan / derived" sebagai jalur aktif adalah
  **usang** — perlakukan sebagai catatan historis (banyak sudah bertanda DEPRECATED).

**Perubahan 31 Juli 2026 — dua ADR yang mengubah cara kerja, bukan cuma isi kode:**

- ~~ADR-0047~~ (`awcms-mini`/`awcms-micro` dibekukan sebagai referensi yang MASIH boleh
  di-port keluar) — **di-supersede [ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)
  pada 2 Agustus 2026**: pengembangan kini hanya di `ahliweb/awcms` +
  `ahliweb/awcms-astro`, dan mini/micro adalah **arsip** (bukan sumber port). Penjagaan
  ADR-0047 §3 TETAP; hanya kewajiban §4 (catat divergence saat mendarat) yang dicabut —
  ADR-nya sendiri kini catatan itu. Konteks aslinya dipertahankan di bawah:
  `awcms-mini` dan `awcms-micro` dibekukan sebagai referensi (boleh dibaca & di-port
  _keluar_, tidak menerima perubahan). Konsekuensinya aturan **mini-first ditangguhkan** — selama
  pembekuan, fitur fondasi **dirintis langsung di repo ini**. Ini **bukan** pelonggaran:
  ADR §3 mendaftarkan ulang setiap penjagaan yang dulu dibawa jalur mini-first secara
  eksplisit (ADR wajib untuk perubahan standar, security review tambahan untuk
  `auth`/`access`/`sync`, `bun run check` penuh, OpenAPI/AsyncAPI sinkron, RLS `FORCE`,
  ABAC default-deny). ADR §4: **setiap fitur fondasi yang mendarat selama pembekuan
  WAJIB dicatat sebagai divergence** di `awcms-family-compatibility.yaml` **saat ia
  mendarat**, bukan belakangan.
- ~~ADR-0048~~ (pembagian peran frontend: layar platform/operator internal dibangun di
  `awcms-astro`) — **di-supersede [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md)
  pada 1 Agustus 2026**, lihat butir berikutnya. Peran `awcms-astro` sebagai experience
  layer + BFF (ADR-0045) tidak ikut berubah.

**Perubahan 1 Agustus 2026 — seluruh layar admin dibangun di sini:**

- [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md): **setiap layar admin —
  tenant maupun owner/internal/platform — dibangun di repo ini**, di bawah satu shell
  `/admin/*`. Alasan yang mengubah substansinya: **memindahkan layar tidak pernah menjadi
  kontrol keamanan.** `sql/081` men-seed `idn_admin_regions.dataset.configure`/`.restore`
  ke katalog ABAC global dan `POST /api/v1/setup/initialize` memberikan seluruh katalog ke
  role `owner` tiap tenant baru — jadi owner tenant biasa SUDAH memegang wewenang mengganti
  dataset yang dilayani ke seluruh tenant, persis risiko yang ADR-0048 ingin cegah, karena
  ABAC mengevaluasi permission bukan asal-usul frontend. Gerbang penggantinya normatif:
  aksi lintas-tenant **wajib** punya gerbang platform-scoped dan **tidak boleh** masuk
  katalog yang di-seed ke role tenant.
- [ADR-0052](adr/0052-idn-region-dataset-lifecycle-is-an-operator-job.md) menutup temuan
  terbuka itu di kode: aktivasi/rollback dataset wilayah jadi **job operator**
  (`bun run idn-regions:activate` / `:rollback`, dry-run default), endpoint HTTP-nya
  dihapus, dan kedua permission dicabut dari katalog (`sql/084`). Menggerbanginya dengan
  kredensial mesin DITOLAK: kredensial mesin baca-saja (ADR-0049), jadi melebarkannya
  justru membuat token build yang bocor bisa mengganti dataset global. Biaya yang
  diterima & dinyatakan: baris audit hilang, karena `awcms_audit_events` tenant-scoped
  sedangkan aksinya global.

## 2. Inventori ringkas

| Aspek       | Nilai (per commit ini)                                                              | Sumber kebenaran                                                                        |
| ----------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Versi       | **6.4.0** (2026-07-26); **53 changeset menunggu** rilis berikutnya                  | `package.json`, `CHANGELOG.md`, tag `v*`                                                |
| Modul base  | **21** (lihat daftar di ARCHITECTURE.md)                                            | `src/modules/index.ts`                                                                  |
| Migrasi     | **87** (`sql/001`–`087`)                                                            | `ls sql/`                                                                               |
| ADR         | **0000**–**0056** (`0000` = template)                                               | `ls docs/adr/`                                                                          |
| Layar admin | **27** berkas `.astro` di `src/pages/admin/`; **1 dari 21 modul** masih tanpa layar | `find src/pages/admin -name '*.astro'`, `grep -L 'navigation:' src/modules/*/module.ts` |
| Kontrak     | OpenAPI modular per-modul + AsyncAPI; `MODULE_CONTRACT_VERSION` **2.4.0**           | `openapi/`, `asyncapi/`, `_shared/module-contract.ts`                                   |

> **Angka tabel ini pernah basi tanpa ada yang merah.** Sebelum PR #339 barisnya
> berbunyi "20 berkas / 7 dari 21 modul" sementara `main` sudah memuat 22 berkas dan
> hanya 6 modul tanpa `navigation`, dan baris ADR berhenti di `0052` padahal `0055`
> sudah mendarat. Tak ada gerbang yang memeriksa tabel ini — kolom "Sumber kebenaran"
> kini memuat perintah yang **menghasilkan** angkanya, jadi memverifikasinya butuh satu
> tempel, bukan satu penghitungan manual.

> **Rilis:** `v6.0.0` (2026-07-21) adalah **rilis nyata pertama** yang menjalankan
> `.github/workflows/release.yml` end-to-end (validate → build+SBOM×2 → sign/attest/publish,
> image `ghcr.io/ahliweb/awcms:6.0.0` + GitHub Release). MAJOR karena breaking ADR-0034
> (jalur turunan dihapus, `MODULE_CONTRACT_VERSION` 1.3.0→2.0.0). Prosedur tag di
> [`docs/awcms/09_roadmap_repository_commit.md`](awcms/09_roadmap_repository_commit.md) /
> skill `awcms-release` (tag `vX.Y.Z` dibuat **manual** via `git tag -a` — tidak ada script
> `changeset:tag`). **Approval gate:** Environment `release` kini punya required
> reviewer (`ahliweb`, dikonfigurasi & diverifikasi via rehearsal 2026-07-21) — publish
> job pause di "Waiting for review" sebelum sign/attest/publish (lihat
> [`release-process.md`](awcms/release-process.md) §Environment approval).

Modul (21, urutan `src/modules/index.ts`): `logging`, `tenant-admin`,
`profile-identity`, `identity-access`, `module-management`, `domain-event-runtime`,
`sync-storage`, `workflow-approval`, `email`, `reporting`, `theming`,
**`media-library`**, `blog-content`, **`tenant-domain`**, **`visitor-analytics`**,
**`data-lifecycle`**, **`seo-distribution`**, **`form-drafts`**, **`site-search`**,
**`comments`**, `idn-admin-regions`.
(Delapan yang di-bold = gelombang penyerapan awcms-micro, 2026-07-24/25 — lihat §3/§4.
`news-portal` **tidak lagi ada**: dilebur ke `blog-content` oleh
[ADR-0044](adr/0044-merge-news-portal-into-blog-content.md), #300.
`idn-admin-regions` (#312, ADR-0046) **bukan** hasil port — ia modul pertama yang
dirintis langsung di sini setelah pembekuan ADR-0047.)

> Catatan: generator `repo:inventory` **belum diport** dari `awcms-mini`, jadi
> [`awcms/repo-inventory.md`](awcms/repo-inventory.md) adalah placeholder — jangan
> jadikan sumber angka. Gunakan ARCHITECTURE.md / registry / `sql/`.

## 3. Yang sudah selesai (jangan dibangun ulang)

- **21 modul** aktif dengan RLS `FORCE`, pemisahan role DB
  (`awcms_app`/`awcms_worker`/`awcms_setup`), admin SSR read+write (Issue #166/#171).
- **Auth lanjutan**: MFA TOTP + session-assurance/step-up (`sql/024`), OIDC/SSO
  tenant-aware + SSRF guard + break-glass (`sql/025`/`026`), Turnstile bot protection
  sadar-profil (LAN/offline exempt). Lihat [`awcms/mfa-totp-step-up.md`](awcms/mfa-totp-step-up.md),
  [`awcms/oidc-sso.md`](awcms/oidc-sso.md), [`awcms/turnstile-bot-protection.md`](awcms/turnstile-bot-protection.md).
- **Authorization**: ABAC dinamis berbasis DSL (`sql/031`/`032`), business-scope hierarchy
  (`sql/027`/`028`), SoD conflict enforcement (`sql/029`/`030`).
- **`theming`** — modul website pertama di base (`sql/033`/`034`, ADR-0034 Fase 3).
- **`blog-content`** — modul konten publik, di-port dari mini (PR #214,
  `sql/035`–`sql/045`, 19 tabel FORCE RLS). Rute publik path-based
  `/blog/{tenantCode}` (ADR-0009). Sejak [ADR-0044](adr/0044-merge-news-portal-into-blog-content.md)
  (#300) modul ini **menyerap seluruh `news-portal`** (homepage-section composer +
  ad placement ber-media terverifikasi); registry media tetap milik `media_library`
  (ADR-0036). DI-DROP saat port (butuh modul lain yang belum ada): rute `/news/**`
  host-resolved, aktivasi preset full-online-R2 (`module_management` preset subsystem).
  Lihat skill `awcms-blog-content` §DELTA PORT.
- **UI/UX overhaul** (PR #215) — login + 8 layar admin + blog publik: mobile-first,
  animasi CSS-only, a11y AA, auto tenant picker di `/login` (sembunyi saat 1 tenant).
  Presentasi-only; jaminan CSP single-owner "zero third-party origin" dipertahankan.
- **Paritas admin shell dengan awcms-micro** (PR #229) — `.admin-shell` + topbar sticky,
  badge tenant, sidebar dua-level (section → modul pemilik → link) + footer versi,
  breadcrumb, dashboard KPI/detail/module-usage, dan **toggle tema terang/gelap yang
  benar-benar berfungsi**. Token `:root[data-theme="dark"]` sudah ada sebelumnya tanpa
  apa pun yang menyetel atribut; toggle butuh script head yang jalan sebelum paint,
  sehingga `script-src` kini **selalu** dipancarkan berisi `'self'` + **SHA-256 satu
  script inline itu** (hash, BUKAN `'unsafe-inline'` — hanya satu urutan byte persis yang
  diizinkan). `tests/theme-init-script.test.ts` merah bila body script dan hash melenceng;
  tanpa gate itu, ketidakcocokan hash gagal senyap (script diblokir, tanpa error/log).
  DI-DROP karena capability pendukungnya belum ada: LanguageSwitcher (belum ada katalog
  i18n), SyncIndicator, link profil (`/admin/profile` belum ada), penataan sidebar
  per-tenant. Drawer JS micro **ditolak**: drawer checkbox CSS-only awcms tak butuh script
  sama sekali — lebih baik di bawah CSP ini.
- **Kontrak OpenAPI modular** per-modul + bundler deterministik (ADR-0026), **family
  compatibility manifest + CI conformance** (ADR-0032).
- **Penyerapan awcms-micro — Wave 0/1 (2026-07-24/25, PR #218–#231, `sql/046`–`sql/065`).**
  Tujuh modul baru diserap satu-PR-atomic-per-modul lewat pipeline delta → coder →
  reviewer + security-auditor → validasi Postgres nyata:
  - **`tenant-domain`** (#219, `sql/046`–`048`) — routing host→tenant + lookup domain
    terverifikasi (fondasi host-resolved untuk SEO/rute publik).
  - **`visitor-analytics`** (#220, `sql/049`–`051`) — telemetri kunjungan + rollup +
    purge terjadwal.
  - **`media-library`** (#221, ADR-0036, `sql/052`–`054`) — **inversi kepemilikan media**:
    satu modul memiliki seluruh objek media per-tenant; port `media_library`; `news_media`
    dipensiunkan.
  - **`data-lifecycle`** (#222, ADR-0037, `sql/055`–`056`) — retensi/arsip/purge generik +
    **legal-hold non-bypassable** (guard + 1 aturan SoD maker-checker di base).
  - **`seo-distribution`** (#223 discovery + #224 redirect governance, ADR-0038/0039,
    `sql/057`–`061`) — renderer metadata SEO terpusat (canonical/hreflang/robots/OG/JSON-LD,
    host diturunkan server) + rute discovery publik (`robots.txt`/sitemap/feed) + **tata
    kelola redirect** (aturan exact-path, telemetri 404, hook `src/middleware.ts` fail-open,
    guard open-redirect beku). Mengonsumsi capability `seo_facts` (disediakan `blog_content`).
  - **`form-drafts`** (#230, `sql/062`–`063`) — draft store server-side generik untuk form
    multi-langkah (payload JSONB opaque, penolakan key mirip-rahasia, purge dua fase).
  - **`site-search`** (#231, ADR-0040, `sql/064`–`065`) — indeks PostgreSQL FTS
    **lintas-konten** per tenant atas konten publik terbit + query/suggest publik
    host-resolved + halaman `/search` + admin index/settings/diagnostics. Seam kontribusi
    baru `ModuleDescriptor.searchSources` (`MODULE_CONTRACT_VERSION` 2.2.0): modul konten
    MENDEKLARASIKAN sumber, agregator menemukannya lewat `listModules()` — tidak ada modul
    yang bergantung pada `site_search`.
  - **`comments`** ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`–`067`) —
    komentar **moderation-first** di atas resource TERBIT & publik: thread, komentar
    ber-kedalaman-terbatas, riwayat moderasi append-only, laporan, setting per-tenant,
    telemetri anti-abuse terminimalisasi, langganan notifikasi-balasan terenkripsi, antrean
    moderasi admin `/admin/comments`. Seam kontribusi `commentableResources`
    (`MODULE_CONTRACT_VERSION` 2.3.0), **nol `AccessAction` baru**. Tulang punggung
    keamanan: batas publikasi di perbatasan resource→thread, simpan-teks-polos +
    escape-saat-render (tak ada XSS tersimpan), respons publik seragam (tanpa oracle),
    PII penulis di-hash/mask. Diverifikasi terhadap Postgres nyata: 67 migrasi bersih,
    FORCE RLS di 7 tabel, grant worker persis matriks.

- **Cache tepi Varnish auto-aktivasi** ([ADR-0042](adr/0042-varnish-edge-cache-auto-activation.md),
  #234/#237, `sql/068`) — subsistem `src/lib/edge-cache/`, VCL `infra/varnish/`, antrean purge
  transaksional `awcms_edge_cache_purges` (FORCE RLS), worker `bun run edge-cache:purge`, gate
  `bun run edge-cache:surfaces:check`, skill `awcms-edge-cache`, dokumen
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md). **Default `off` =
  no-op total.** Tiga lapis default-deny independen; sinyal tekanan hanya mengubah _berapa
  lama_, tidak pernah _apa_ yang boleh di-cache. Emisi purge terpasang di jalur tulis
  `blog_content` dan `theming` (publish/rollback/retire, #246). `media_library`
  sengaja TIDAK — ia tidak memiliki surface ter-deklarasi, jadi ban untuk key-nya tak
  akan cocok apa pun sementara antrean melapor sukses. Gate `edge-cache:surfaces:check`
  menuntut call-site purge dari tiap modul yang MEMILIKI surface, sehingga kewajibannya
  muncul sendiri begitu salah satunya mendeklarasikan surface.
  **AKTIF di staging sejak 2026-07-26** (`EDGE_CACHE_MODE=on`, Varnish 7.5 di
  depan Traefik, worker purge tiap menit) — dan pengaktifan itulah yang
  membongkar TIGA bug yang lolos review dan `bun run check`: ekspresi ban
  dengan spasi literal (ditolak Varnish, tetap balas 200), method `BAN` yang
  Bun kirim sebagai `GET`, dan policy RLS `sql/068` yang memakai GUC
  `awcms.tenant_id` sehingga **publish blog gagal 500** saat cache menyala
  (diperbaiki `sql/070`). Ketiganya melapor sukses sambil tidak bekerja. Detail
  - gate baru di [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md)
    §Pelajaran.
- **Rekonsiliasi DNS subdomain tenant** (#236, `sql/069`) — `ensureServingRecord`
  desired-state (drift → `PUT`, tidak pernah `POST` kedua), `reconcileServingRecords`,
  `bun run tenant-domain:dns:sync` sebagai `awcms_worker` SELECT-only. Tanpa
  `TENANT_DOMAIN_SERVING_TARGET` job no-op — tidak ada default, karena menebak berarti
  outage seluruh platform.
- **`idn-admin-regions`** ([ADR-0046](adr/0046-idn-admin-regions-module-admission.md), #312,
  `sql/080` skema + `sql/081` permission) — master data wilayah administratif Indonesia
  ber-versi, ter-provenance, bisa di-rollback; dataset `cahyadsn/wilayah` (MIT) di-vendor
  di `data/idn-admin-regions/`. **Dua tabelnya GLOBAL** (tanpa `tenant_id`, tanpa RLS —
  terdaftar di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`), otorisasi tetap per-tenant
  default-deny. Impor = job deployment dry-run-by-default (`bun run idn-regions:import`,
  `awcms_worker`); aktivasi/rollback = aksi admin ter-audit ber-idempotency-key. Modul
  pertama yang **dirintis langsung di sini** (bukan port) di bawah ADR-0047. Sengaja
  **tanpa `navigation`**, dan alasannya kini berubah: bukan lagi "layarnya milik
  `awcms-astro`" (ADR-0048, sudah di-supersede) melainkan karena ADR-0052 memindahkan
  aktivasi/rollback ke job operator — yang tersisa untuk tenant hanyalah dua permission
  baca.
- **Kredensial mesin baca-saja + introspeksi sesi** ([ADR-0049](adr/0049-machine-credentials-and-session-introspection.md),
  `sql/082` skema + `sql/083` permission) — bearer KEDUA yang bukan sesi manusia, terikat
  ke satu service account. Rinci di §4 dan di `src/modules/identity-access/README.md`.
- **Gelombang layar admin (1–2 Agustus 2026, PR #321–#330).** Audit permukaan admin
  menemukan **13 dari 21 modul tanpa satu pun layar** — 125 berkas route yang hanya bisa
  dipakai lewat `curl`. [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md)
  memutuskan seluruhnya dibangun di sini; sembilan PR atomic mendarat berurutan:
  `/admin/audit-trail` (#324, `logging`), `/admin/form-drafts` (#325),
  `/admin/site-search` (#322), `/admin/theming` (#327), `/admin/seo` (#329),
  `/admin/data-lifecycle` (#330), plus perbaikan dashboard sync zero-node (#323) dan
  ADR-0052/`sql/084` (#328). **Nol migrasi** untuk layarnya sendiri — permukaan
  otorisasinya sudah ada, yang hilang hanya layarnya.
  Pola yang dipakai seragam dan patut diikuti layar berikutnya: baca lewat fungsi
  aplikasi modul sendiri di **satu** `withTenantOrThrow` (await berurutan — query paralel
  di satu koneksi transaksi membocorkannya), tulis lewat endpoint ter-guard dengan
  `Idempotency-Key` segar per klik, gerbang permission di halaman **UX-only** (endpoint
  tetap otoritasnya), entri `navigation` mendarat di PR yang SAMA (entri tanpa halaman =
  404 permanen di menu, digerbangi `tests/admin-navigation-registry.test.ts` dua arah),
  dan satu `tests/admin-<modul>-page-contract.test.ts` yang mengikat tiap key halaman ke
  yang route tegakkan DAN descriptor deklarasikan — penangkal bug latent-authz yang repo
  ini sudah dua kali kirim. `/admin/data-lifecycle` menambah satu pelajaran khusus:
  `legal_hold.create` dan `.release` digerbangi **terpisah**, karena SoD menjadikan
  memegang keduanya konflik `critical` — satu gerbang gabungan yang terlihat lebih rapi
  justru salah untuk setiap operator nyata.
- **Gelombang layar admin kedua (2 Agustus 2026, PR #335–#338).** Empat modul yang
  gelombang pertama tinggalkan mendapat layarnya: `/admin/reporting` (#335, seluruh
  mesin proyeksi/ekspor Issue #753 + view `email-health` yang tak pernah dirender),
  `/admin/approvals` (#336, inbox + recovery + delegasi), `/admin/domain-events`
  (#337, consumer/delivery/outbox) dan `/admin/sync` (#338, node/conflict/object
  queue). **Nol migrasi** lagi — permukaan otorisasinya sudah ada.
  Tiga hal yang layar berikutnya harus tiru:
  - **Konstanta bound di-hoist ke `domain/`, lalu diimpor DUA arah** (route yang
    memvalidasinya dan form yang merendernya sebagai `min`/`max`/`maxlength`).
    `MAX_REASON_LENGTH` ditulis ulang sebagai `500` telanjang di **lima** berkas
    `workflow-approval` dan dua di `domain-event-runtime`; lima salinan sebuah angka
    sepakat sampai salah satunya diedit, dan salinan keenam di markup berarti browser
    menerima apa yang server tolak dengan 400 yang tak bisa ditindak operator.
  - **Satu fungsi baca dipakai bersama halaman DAN endpoint.** `/admin/sync` menambah
    `fetchSyncConflicts` ke `sync-directory.ts` dan me-repoint
    `GET /api/v1/sync/conflicts` ke sana. Jebakannya: fungsi itu mengembalikan `null`
    untuk kolom resolusi yang kosong (bentuk yang diinginkan halaman) sedangkan
    endpoint selama ini MENGHILANGKAN key-nya (`?? undefined`), jadi route memetakan
    balik — `null` di tempat klien menunggu key absen itu perubahan kontrak, bukan
    refactor.
  - **Permukaan yang bukan untuk browser tidak diberi kontrol.** `/admin/sync` sengaja
    tak menyentuh `push`/`pull`/`objects`/`status`: itu protokol NODE ber-HMAC, bukan
    sesi administrator, dan tombolnya akan jadi kontrol yang tak bisa dipakai browser
    mana pun — kegagalannya terbaca sebagai bug, bukan salah kategori.

- **Dua environment ter-deploy nyata** — produksi `awcms.ahlikoding.com`, staging
  `awcms-staging.ahlikoding.com` (Coolify, host yang sama, DB & secret terpisah). Staging
  ter-migrasi penuh (69) dan berjalan sebagai role least-privilege terpisah. Rincian,
  termasuk jebakan "user Coolify itu superuser sehingga RLS inert", di
  [`awcms/environments.md`](awcms/environments.md).

## 4. Backlog / langkah berikutnya

- **Layar admin yang masih kosong (lanjutan langsung ADR-0051).** Gelombang kedua
  (PR #335–#338, 2 Agustus 2026) menutup EMPAT dari tujuh — verifikasi ulang dengan
  `grep -L 'navigation:' src/modules/*/module.ts`, bukan dari daftar ini:
  - ~~`reporting`~~ **SELESAI (#335)** — `/admin/reporting`. Bukan dashboard kedua:
    `/admin` sudah merender empat dari lima view, jadi layar ini mengambil seluruh
    mesin proyeksi/ekspor Issue #753 **plus** `email-health`, satu-satunya view yang
    tak pernah dirender di mana pun.
  - ~~`workflow-approval`~~ **SELESAI (#336)** — `/admin/approvals` (inbox + recovery
    - delegasi). Enam permission `definition.*` **sengaja ditinggalkan**: menyusun
      node graph butuh editor sungguhan, dan textarea JSON yang menerima graph rusak
      sampai `publish` menolaknya lebih buruk daripada tak ada sama sekali. Contract
      test menegakkan bahwa keenamnya TIDAK bocor ke layar ini, sehingga pemisahan itu
      tetap keputusan, bukan celah.
  - ~~`domain-event-runtime`~~ **SELESAI (#337)** — `/admin/domain-events`.
  - ~~`sync-storage`~~ **SELESAI (#338)** — `/admin/sync`.
  - ~~`blog-content`~~ **SELESAI (#340)** — `/admin/blog`, konsol siklus hidup post
    (sebelas permission dari 43). Sisanya menunggu layar saudaranya (pages,
    taxonomy, presentation, settings, homepage). Dua absen yang digerbangi contract
    test karena BEDA KELAS: `posts.export` dideklarasikan + di-seed `sql/036` dan
    **tak ada endpoint mana pun yang menegakkannya**; `search.read` punya rute tapi
    daftar admin sudah punya pencarian sendiri yang mentoleransi query kosong.
  - `media-library` — **BELUM, dan bukan sekadar layar
    ([ADR-0056](adr/0056-media-library-admin-surface.md)).** Lima dari sebelas
    permission-nya tidak digerbangi apa pun (`attach`/`detach`/`delete`/`restore`/
    `purge`), lima fungsi aplikasi yang memanggilnya nol, dan tidak ada fungsi
    `list*` sama sekali — `GET /api/v1/media/objects` menuntut `?ids=`, ia resolver
    batch untuk build `awcms-astro`. ADR-0056 memecahnya tiga: cabut
    `attach`/`detach` (usang sejak inversi ADR-0036), beri permukaan
    `delete`/`restore`/`purge` (lubang nyata), tambah rute daftar sendiri. Layar
    menyusul SETELAH ketiganya.

    **Kemajuan: §A SELESAI.** `sql/087` mencabut `attach`/`detach` dari katalog
    dan dari tiap grant role; dua fungsi nol-pemanggil dihapus. Modul kini
    mendeklarasikan **9 permission (7 `media.*` + 2 `enforcement.*`)**, dan yang
    belum tergerbangi tinggal **tiga**: `delete`/`restore`/`purge` — semuanya
    tercakup §B. Status `attached` sengaja TIDAK ikut dicabut (CHECK `sql/041`
    masih menerimanya, baris lama tetap resolve); yang hilang cuma kemampuan
    menulisnya. ADR §A edisi pertama menulis "kelima fungsi mati dihapus" —
    keliru, itu bertabrakan dengan §B yang justru memakai tiga di antaranya;
    ADR sudah dikoreksi.

    > **Koreksi angka di atas.** Entri sebelumnya (#339) menulis "**enam**...
    > termasuk `verify`". Itu salah: `media.verify` DIGERBANGI — di dalam fungsi
    > aplikasi `media-finalize-upload-session.ts`, bukan di berkas route. Memindai
    > berkas route saja memberi jawaban salah di dua arah sekaligus, karena
    > `media-object-directory.ts` juga penuh string `action: "..."` yang merupakan
    > nama aksi AUDIT, bukan gerbang permission.

  - `idn-admin-regions` — sengaja tanpa layar, lihat §3 (ADR-0052 memindahkan
    lifecycle-nya ke job operator; sisanya dua permission baca).

  Ikuti pola gelombang #321–#330 di §3 — termasuk contract test per layar, yang
  **mutation-proven** (kembalikan cacat aslinya dan pastikan MERAH) sebelum di-commit.

  **Dua pelajaran baru dari gelombang kedua, keduanya berlaku untuk layar berikutnya:**
  - **README modul bisa mengklaim layar yang tak pernah ada.** `reporting/README.md`
    memerikan `/admin/reporting/projections` + helper `submitJson`, dan
    `workflow-approval/README.md` memerikan `/admin/workflows` —
    tak satu pun pernah ada di repo ini; teksnya ikut terbawa saat port. Karena kedua
    modul tak mendeklarasikan `navigation`, gerbang `admin-navigation-registry.test.ts`
    yang menangkap path menggantung **tak punya apa pun untuk diperiksa**. Docs tidak
    digerbangi sebagaimana descriptor digerbangi — jadi baca README modul sebagai
    klaim yang harus diverifikasi ke `ls src/pages/admin/`, persis seperti
    [[awcms-stale-skill-flips-direction]] untuk skill.
  - **Nilai `Idempotency-Key` bukan seragam per repo, melainkan per endpoint, dan
    layar harus meniru pembagiannya persis.** Tiga bentuk sudah muncul:
    `/admin/reporting` (lima wajib, `reconcile` tanpa — ia hanya meng-append snapshot),
    `/admin/domain-events` (tiga arah: `replay` wajib karena tiap panggilan kerja BARU,
    `pause`/`resume` tidak karena transisi status), dan `/admin/sync` (NOL — ketiga
    mutasinya transisi status yang idempoten alami). Contract test harus mengikat
    pembagian itu **per-request** (potong string dari URL-nya), bukan sebagai hitungan
    header global, dan sekalian menegaskan endpoint-nya masih setuju.

- **Kontrak yang menahan `awcms-astro` — SELESAI (2026-08-01, ADR-0049, `sql/082`/`083`).**
  Kredensial mesin baca-saja + `GET /api/v1/auth/session`. Kredensial
  MENGAUTENTIKASI, tidak pernah MENGOTORISASI (terikat ke satu service account;
  rantai module-enabled → RBAC → ABAC → decision log → SoD tak berubah); izin
  efektifnya IRISAN dengan izin akun itu (menyempitkan, tak pernah melebarkan);
  setiap permintaannya ditolak kecuali action `read`, diputus **sebelum** izin
  dilihat. Token **membawa tenant-nya sendiri** sehingga klien build cukup satu
  env var — itu menutup cacat header ADR-0047 untuk build tanpa menambah alias
  header (`x-awcms-tenant-id` tetap satu-satunya ejaan untuk sesi manusia).
  Diverifikasi terhadap Postgres nyata: 83 migrasi bersih + 18 test integrasi
  (irisan izin, baca-saja walau akunnya `owner`, pencabutan/kedaluwarsa,
  lintas-tenant, decision log ber-`machine_credential_id`, klaim aman
  introspeksi). Dicatat sebagai divergence di `awcms-family-compatibility.yaml`
  saat mendarat (ADR-0047 §4). **Sisa di `awcms-astro`:** memakai token itu di
  BFF + build feed.
- **Konteks cacat yang ditutupnya (ADR-0047, diverifikasi ke staging).**
  (1) `resolveAuthInputs` membaca `x-awcms-tenant-id` sementara `awcms-astro`
  mengirim `X-Tenant-Code`/`X-Tenant-Id` — setiap nilai `X-Tenant-Code` balas
  `400 TENANT_REQUIRED`; (2) **tidak ada kredensial yang bisa dipegang sebuah build** —
  bearer yang diterima `/api/v1/blog/posts` adalah token **sesi** ber-hash, dan skema di
  sini tak punya tabel token mesin sama sekali. Menutup (2) berarti konsep
  **machine credential** di `identity_access` — dan endpoint introspeksi sesi
  `GET /api/v1/auth/session` yang [ADR-0045](adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
  sudah putuskan (desain di [`awcms/jualanku/05-kontrak-sesi-dan-bff.md`](awcms/jualanku/05-kontrak-sesi-dan-bff.md) §3)
  juga membutuhkannya, sehingga keduanya **satu percakapan desain**, bukan dua.
  ADR-0048 menegaskan keduanya harus selesai sebelum layar internal pertama di
  `awcms-astro` bisa memanggil repo ini. Keduanya kini ada di kode (entri di atas).
- **Gelombang penutup kontrak `awcms-astro` — SELESAI (2026-08-01).** Lima perubahan
  berurutan, masing-masing satu PR atomic ber-CI penuh:
  - **#316** `bun run identity-access:permissions:backfill` — role `owner` menerima izinnya
    SEKALI saat tenant dibuat, jadi tiap tenant yang lebih tua dari sebuah modul kena 403.
    Hanya permission yang baris katalognya **lebih baru** dari role yang di-grant; yang
    lebih tua dianggap dicabut sengaja dan dilaporkan, bukan dikembalikan. Dry-run default.
  - **#317** cursor stabil `GET /api/v1/blog/posts?order=created_at` — build feed tidak lagi
    berhenti di 100 post. `?cursor=` di atas urutan `updated_at` ditolak 400: kunci keyset
    yang bisa berubah melewatkan/mengulang baris tanpa gejala.
  - **#318** `GET /api/v1/media/objects` — registry media tidak punya endpoint baca sama
    sekali, sehingga konsumen luar tahu sebuah post punya gambar tanpa bisa tahu URL-nya.
  - **#319** deaktivasi tenant user **mencabut sesinya seketika** — `resolveTenantContext`
    tak pernah membaca `status`, jadi pengguna yang dinonaktifkan tetap bekerja sampai
    sesinya kedaluwarsa.
  - **[ADR-0050](adr/0050-bff-session-handoff-code.md)** — BFF memperoleh sesi manusia lewat
    kode handoff sekali-pakai; proksi password ditolak karena login di sini bukan satu
    langkah (MFA/OIDC/Turnstile harus disalin ke repo kedua). **Dokumen, belum kode.**
- **Katalog tag OpenAPI & kepemilikan fragment — SELESAI (2026-07-30).** Temuan graphify
  2026-07-29 ternyata **lebih luas dari yang dilaporkan**: bukan hanya `blog_content` yang
  hilang dari `docs/awcms/api-reference.md`, melainkan **55 operasi dari empat modul** —
  `blog_content` (30 path), `visitor_analytics` (12), `tenant_domain` (7),
  `data_lifecycle` (6) — karena generator mengelompokkan menurut tag root yang
  **dideklarasikan**, sehingga operasi ber-tag tak-terdeklarasi hilang tanpa memerahkan
  apa pun. Diperbaiki dengan menambah empat tag itu, meng-atribusikan ulang tag
  `News Media`/`News Portal *` ke pemilik hari ini (`media_library`/`blog_content`;
  **nama tag & path publik sengaja TIDAK diubah** — ADR-0044 §3/§6 memindahkan
  kepemilikan, bukan permukaan), melebur `openapi/modules/news-portal.openapi.yaml` ke
  fragment `blog-content`, dan me-repoint `api.openApiPath` `blog_content` +
  `media_library` dari BUNDEL ke fragment mereka sendiri. Dua gerbang baru di
  `api:spec:check` menutup kelas cacatnya dua arah: `collectTagCatalogProblems` (tiap
  operasi ber-tag, tiap tag operasi terdeklarasi, **dan** tiap tag terdeklarasi dipakai)
  dan `collectFragmentOwnershipProblems` (satu fragment = satu modul terdaftar; hanya
  `foundation.openapi.yaml` yang dikecualikan). Bundel tidak berubah selain katalog tag —
  nol path, nol schema.
- **Keluarga kini Bun-only tanpa pengecualian (2026-07-29).** `awcms-astro` —
  template situs statis keluarga, repo keempat — dipindahkan dari Node 22 + npm ke
  Bun (ADR-0015 di repo itu): `bun.lock`, `bun:test`, `oven/bun` di image,
  `setup-bun` di CI, Dependabot `package-ecosystem: bun`. Jebakan yang tertangkap
  saat migrasi dan berlaku untuk SETIAP repo keluarga: `bun run` menyelesaikan
  nama ke script `package.json` **sebelum** `node_modules/.bin`, jadi script
  bernama sama dengan binernya (mis. `"astro": "bun --bun astro"`) menghasilkan
  rekursi tak terbatas yang mati sebagai `E2BIG: Argument list too long` — pesan
  yang tidak menyebut sebabnya sama sekali.
- **Porting Jualanku.info ([ADR-0045](adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md), 2026-07-29).**
  `awcms` = system of record + admin internal; `awcms-astro` = experience layer + BFF.
  Blueprint lengkap (arsitektur, otorisasi merchant, model data, kontrak API, kontrak
  sesi lintas-origin, UI/UX, roadmap & kepatuhan) di [`awcms/jualanku/`](awcms/jualanku/README.md).
  **Status: P0 — belum ada satu pun modul/tabel/rute `jualanku_*` di kode.** Lima bounded
  context yang direncanakan (`jualanku_directory`, `jualanku_catalog_growth`,
  `jualanku_affiliate`, `jualanku_commercial`, `jualanku_trust_operations`) masing-masing
  masih butuh ADR admission. Dua keputusan yang mengikat implementasi: **merchant =
  business scope** (mengisi resolver NO-OP fail-closed, bukan menambah atribut ABAC baru)
  dan **browser tidak pernah memanggil `awcms` langsung** (BFF di `awcms-astro`).
- **~~Serap tulang punggung awcms-mini~~ — DICABUT sebagai jalur (ADR-0055).** Yang di
  bawah ini kini **daftar KEBUTUHAN, bukan daftar port**: setiap kemampuan dinilai ulang
  dan **dibangun di sini** dengan ADR admission-nya sendiri. Bahwa `awcms-mini` kebetulan
  sudah punya implementasinya bukan lagi alasan untuk membangunnya — dan bukan pula
  desainnya. Konteks lama dipertahankan di bawah.
- **(historis) Serap tulang punggung awcms-mini → awcms (fondasi bisnis + SaaS control plane).**
  Peta eksekusi di
  [`awcms/absorb-awcms-mini-backbone-roadmap.md`](awcms/absorb-awcms-mini-backbone-roadmap.md).
  **Temuan audit 2026-07-25:** lima modul sudah di-`Accepted` oleh ADR di repo ini tetapi
  **tidak ada kodenya** — `organization_structure` (ADR-0016), `document_infrastructure`
  (ADR-0017), `data_exchange` (ADR-0018), `integration_hub` (ADR-0019), `reference_data`
  (ADR-0021); kelimanya matang di mini. [ADR-0020](adr/0020-erp-extension-readiness-contracts.md)
  (kontrak kesiapan ERP) juga `Accepted` tanpa implementasi `_shared`. Klaster SaaS control
  plane (7 modul mini) **belum di-admit sama sekali** di sini dan butuh ADR admission baru
  sebelum baris implementasinya boleh dikerjakan.
- **Serap awcms-micro → awcms (program utama, [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)).**
  Peta bergelombang & urutan dependensi ada di
  [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md) — satu PR
  atomic per modul, adaptasi (rename `awcms_micro_` → `awcms_`, migrasi lanjut dari nomor
  berikutnya setelah `sql/070`), lulus `bun run check`. Progres:
  - **Wave 0 — SUDAH:** `tenant-domain` (#219), paritas admin shell/chrome (#229).
    **BELUM:** pustaka komponen `src/components/ui/` + paritas design-token (#229 menyentuh
    shell admin, bukan pustaka komponen reusable). Seam kontribusi descriptor
    (`dataLifecycle`, capability `seo_facts`, `searchSources`, `commentableResources`) sudah
    mendarat sepanjang Wave 1; `newsletterContentSources` belum.
  - **Wave 1 — SUDAH:** `visitor-analytics` (#220), `media-library` (#221, inversi ADR-0036),
    `data-lifecycle` (#222, ADR-0037), `seo-distribution` (#223/#224, ADR-0038/0039 — discovery
    **dan** redirect governance, LENGKAP), `form-drafts` (#230), `site-search` (#231, ADR-0040).
    `comments` ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`–`067`).
    **BELUM:** `newsletter`, `social-publishing` (mengaktifkan hook publish yang
    kini no-op di `blog-content`).
- **Environment ter-deploy — SELESAI, tiga fase setara.** Produksi
  `awcms.ahlikoding.com`, staging `awcms-staging.ahlikoding.com`, dan
  development lokal kini identik: migrasi **70**, 118 tabel, 197 permission, RLS
  `ENABLE`+`FORCE` 109/118, runtime sebagai `awcms_app` (bukan superuser), owner
  `admin@ahlikoding.com` dengan role `owner` 197/197, dan
  `PUBLIC_DEFAULT_TENANT_*` di-pin per fase. Isolasi dibuktikan sebagai
  `awcms_app` (`0 / 1 / 0`), bukan diasumsikan. Suite DB-gated jalan di dev
  (harness 142 + legacy 64, nol gagal). Detail dan jebakannya di
  [`awcms/environments.md`](awcms/environments.md).
- **Cache tepi Varnish ([ADR-0042](adr/0042-varnish-edge-cache-auto-activation.md), `sql/068`).**
  Tier cache OPSIONAL di depan aplikasi, default MATI dan no-op saat mati. Allow-list
  surface fail-closed (`src/lib/edge-cache/`), aktivasi otomatis berbasis tekanan origin,
  VCL default-deny (`infra/varnish/`), antrean invalidasi tahan-lama + worker
  `bun run edge-cache:purge`, gate `bun run edge-cache:surfaces:check`.
  **SUDAH sejak #246:** emisi purge dari `theming` (publish/rollback/retire, satu
  transaksi dengan perubahannya) dan gate kepemilikan — tiap modul yang memiliki
  surface ter-deklarasi WAJIB punya call-site purge. **BELUM:** surface discovery
  ber-resolusi-host (`serveDiscovery` tak menerima `locals`). Rinci di
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md).
  - **Wave 2 — INTI SELESAI:** delta auth/admin. **SUDAH:** penataan sidebar per-tenant
    (#272, `sql/071`–`072`); **password reset lewat email** (`sql/073`) — dua endpoint publik
    enumeration-safe + `/forgot-password`/`/reset-password`, single-use ditegakkan dengan row
    lock, reset mencabut semua sesi, identity SSO-only ditolak di jalur permintaan DAN
    penebusan, pengiriman lewat capability port `auth_notification` (bukan INSERT lintas-modul
    ke `awcms_email_messages`); **self-registration ber-persetujuan admin** (`sql/074`–`075`,
    default MATI, tak pernah menyimpan kredensial — approval membuat akun dengan password tak
    terpakai lalu mengirim link reset); layar `/admin/security` (postur deployment read-only +
    policy autentikasi tenant + enforcement MFA + daftar provider OIDC read-only) —
    endpoint-nya ada sejak #184/#185, layarnya tidak, jadi policy hanya bisa diubah lewat
    `curl`. **Inti Gelombang 2 SELESAI**; sisa opsional: login OIDC Google spesifik, reframe
    default `online-security-config`, paritas halaman admin modul Gelombang 0–1.
  - **Wave 3 — BELUM:** trajektori e-commerce/toko online (ADR sendiri).
  - Sebelum tiap port berikutnya: **cek inversi-vs-net-baru** (mis. media sudah jadi satu modul
    pemilik — konsumen wajib lewat port `media_library`, jangan buat tabel media baru).
    (`blog-content` SUDAH di-port — PR #214; `news-portal` dilebur ke dalamnya, ADR-0044.)
- **Rute publik host-resolved**: `tenant-domain` sudah mendarat; adopsi rute `/news/**` +
  rute konten host-based `/blog/{slug}` (agar `<loc>` sitemap SEO resolve tanpa tenantCode)
  masih follow-up (lihat README `seo-distribution` §follow-up).
- **Port generator `repo:inventory`** dari mini agar `repo-inventory.md` jadi ter-generate.
- **Seam yang menunggu penyedia**: business-scope resolver base masih NO-OP fail-closed;
  SoD base kini ship **1 rule** (`data_lifecycle.legal_hold_maker_checker`, ADR-0037) — bukan
  lagi 0 (rule ilustratif tambahan tetap di fixture).

## 5. Kontrak alur kerja (ringkas)

1. **Mini-first DICABUT** ([ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md),
   2 Agustus 2026, men-supersede ADR-0047): pengembangan hanya di `ahliweb/awcms` +
   `ahliweb/awcms-astro`. `awcms-mini`/`awcms-micro` adalah **arsip** — boleh dibaca
   sebagai sejarah, tetapi **tidak ada pekerjaan yang dijadwalkan "di-port dari" sana**;
   kemampuan yang diinginkan **dibangun di sini** dengan ADR admission sendiri.
   [`awcms/alur-pengembangan-mini-first.md`](awcms/alur-pengembangan-mini-first.md)
   dipertahankan sebagai catatan sejarah. Penjagaannya TETAP: **ADR wajib** untuk
   perubahan standar, security review tambahan untuk `auth`/`access`/`sync`,
   `bun run check` penuh, OpenAPI/AsyncAPI sinkron, RLS `FORCE`, ABAC default-deny.
   Kewajiban entri divergence di `awcms-family-compatibility.yaml` **dicabut** — ADR-nya
   sendiri yang menjadi catatan.
2. **Branch dulu** (jangan commit ke `main`); satu PR = satu perubahan atomic.
3. **`bun run check` PENUH** sebelum PR (lint + docs + kontrak + typecheck + test + build;
   `bun run format` dulu bila perlu). Changeset wajib untuk perubahan perilaku.
4. Migration/OpenAPI/AsyncAPI disinkronkan setiap perubahan schema/API/event.

## 6. Jebakan yang tak terlihat dari kode (baca sebelum menyentuh area terkait)

- **Migration terapan itu immutable**: edit `sql/NNN` yang sudah jalan (bahkan komentar)
  memblokir `db:migrate` di deployment jalan — koreksi lewat migration baru.
- **RLS `ENABLE` tanpa `FORCE` itu inert** untuk table owner; wajib `FORCE` +
  role non-owner (`awcms_app`). Uji RLS di bawah role `awcms_app` LOGIN, bukan superuser.
- **4xx yang di-`return` dari dalam `withTenant` itu COMMIT** — bukan rollback.
- **Keyset cursor**: timestamptz mikrodetik vs `Date` JS milidetik → bawa `created_at`
  sebagai teks presisi penuh, jangan re-parse ke `Date`.
- **Snapshot OpenAPI beku**: test subset add-only — jangan edit snapshot; evolusi via
  `INTENTIONALLY_EVOLVED_PATHS` allow-list.
- **Tag OpenAPI = syarat visibilitas dokumen**: `api-docs-generate` mengelompokkan
  menurut tag yang **dideklarasikan** di `openapi/awcms-public-api.src.yaml`, jadi tag
  operasi yang lupa didaftarkan membuat seluruh permukaan modul hilang dari
  `api-reference.md` tanpa satu pun gate merah (pernah menimpa 55 operasi/4 modul).
  Digerbangi dua arah sejak PR #308, berbarengan dengan gate kepemilikan fragment
  (`api.openApiPath` wajib menunjuk fragment sendiri, bukan bundel).
- **Seed permission tidak menjangkau tenant lama, dan "grant semua yang hilang" itu
  SALAH.** Migrasi seed hanya memperluas katalog global; role `owner` sebuah tenant
  dapat izinnya sekali saat tenant dibuat. Backfill-nya kini punya tooling:
  `bun run identity-access:permissions:backfill` (dry-run default, `--commit` menulis,
  `--tenant` untuk bertahap). Ia sengaja **tidak** memberikan setiap permission yang
  hilang — hanya yang baris katalognya lebih baru dari role-nya. Yang lebih tua dan
  hilang dianggap dicabut admin dengan sengaja dan dilaporkan, tidak dikembalikan;
  menghidupkannya kembali adalah perubahan otorisasi yang tak seorang pun minta dan
  tak seorang pun lihat.
- **Rujukan `bun run <target>` di KOMENTAR KODE ikut digerbangi** sejak sinkronisasi
  scripts↔docs: `check:docs` memeriksa berkas current-state — lima berkas markdown akar,
  dokumen ini, `scripts/README.md`, README modul `src/**`, **dan seluruh sumber
  `src/`/`scripts/`**. Sebelumnya hanya lima markdown akar, sehingga enam komentar di
  `src/modules/module-management/` bisa menyuruh pembacanya menjalankan target
  `modules:sync` yang tak pernah ada (mekanisme sesungguhnya `POST /api/v1/modules/sync`)
  dengan `bun run check` tetap hijau. `docs/awcms/` + `.claude/skills/` tetap DI LUAR
  gerbang: isinya target adaptasi awcms-mini yang memang boleh menyebut tooling belum-ada
  (`production:preflight`, `repo:inventory:*`, `performance:*`, dst. — daftar lengkapnya
  di [`../scripts/README.md`](../scripts/README.md) §Ditunda).
- **Kurung tak-terkutip mematikan SELURUH diagram mermaid** di GitHub (bukan sebagian):
  di `flowchart`/`graph`, `(` adalah token pembuka bentuk node, jadi
  `-->|online (primary)|` atau `{... (x)?}` gagal parse dan diganti kotak "Unable to
  render rich display". Kutip labelnya; kurung yang memang BENTUK (`[( )]`, `([ ])`,
  `(( ))`, `[[ ]]`, `{{ }}`) jangan disentuh. Digerbangi `check:docs` sejak PR #309 —
  sebelum itu gate hanya memeriksa pagar blok dan tipe diagram, sehingga dua diagram
  rusak hidup berdampingan dengan `bun run check` hijau.
- **Postgres lokal**: host bisa rusak, dan koneksi host→container kini bisa timeout di
  sandbox → jalankan `db:migrate` + test DB-gated **di dalam** container bun yang berbagi
  network namespace dengan container Postgres (`docker run --network container:<pg> oven/bun …`).
  Catatan: image bun tanpa git → 2 test `check-docs-integration` gagal palsu di container
  (verifikasi di host/CI).
- **CI**: GitGuardian & CodeQL adalah required check; CodeQL run kadang orphan di antrean →
  picu ulang dengan empty commit; flake Postgres CI → `gh run rerun --failed`.
- **Subagent di working tree bersama** bisa memindahkan HEAD → verifikasi
  `git branch --show-current` sebelum commit.

Detail lebih dalam ada di skill terkait (`awcms-new-migration`, `awcms-abac-guard`,
`awcms-testing`, `awcms-sync-hmac`, dst.) dan di ADR.

## 7. Cara melanjutkan

- Mulai unit kerja: skill `awcms-implement-issue` (orkestrator) → `awcms-new-module` /
  `awcms-new-migration` / `awcms-new-endpoint` / `awcms-new-event`.
- Port dari mini: skill `awcms-port-from-mini`.
- Review/keamanan: skill `awcms-pr-review`, `awcms-security-review`, subagent
  `awcms-reviewer` / `awcms-security-auditor`.
- Perbarui **dokumen ini** setiap ada perubahan state besar (modul/migrasi baru, keputusan
  tata kelola, backlog selesai) agar tetap jadi titik-lanjut yang akurat.
