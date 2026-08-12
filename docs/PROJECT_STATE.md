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

**Keluarga AWCMS yang dikembangkan hari ini adalah DUA repo, dan hanya dua**
([ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)): `ahliweb/awcms`
(repo ini) sebagai **system of record** — seluruh permukaan otorisasi, API, dan layar
admin **SISTEM** — dan [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro)
yang memikul **halaman publik sebagai fungsi utama** serta **permukaan admin USER bila
sebuah situs menyatakannya** ([ADR-0070](adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)).
Pasangan keduanya adalah **pengganti multiguna** dari ketiga template lama.

**`awcms-mini` dan `awcms-micro` ARSIP** — tidak dilanjutkan, bukan standar, bukan sumber
port (ADR-0055 §1, men-supersede [ADR-0047](adr/0047-mini-micro-frozen-foundation-built-here.md)).
Posisi "tiga template sejajar" yang ditetapkan
[ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(men-supersede ADR-0013/0014/0015/0022/0025) karena itu **sudah tidak berlaku**; yang tetap
berlaku darinya adalah pencabutan jalur repo turunan. `awcms` = template lini
**ERP/back-office**.

Disempurnakan oleh [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
(positioning `awcms`): mode operasi `awcms` = **hybrid online + offline dengan prioritas
online-first** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS
terintegrasi**, dan `awcms` menjadi **superset** keluarga: klaster website/e-commerce, UI/UX, dan
pengerasan auth `awcms-micro` **sudah diserap sejauh yang mendarat**, dan sisanya dibangun
di sini lewat ADR admission-nya sendiri (ADR-0055 §1). Peta di
[`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md) karena itu dibaca
sebagai **daftar kebutuhan**, bukan antrean port — sejalan dengan status ARSIP di atas.
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

**Perubahan 1 Agustus 2026 — seluruh layar admin SISTEM dibangun di sini:**

- [ADR-0051](adr/0051-admin-screens-consolidated-in-awcms.md): **setiap layar admin —
  tenant maupun owner/internal/platform — dibangun di repo ini**, di bawah satu shell
  `/admin/*`. Sejak [ADR-0070](adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
  kata "setiap" dipersempit menjadi **setiap layar admin SISTEM**: batasnya APA YANG
  DIKELOLA, bukan siapa yang memakainya, sehingga permukaan admin **USER** boleh hidup di
  `awcms-astro` bila situsnya menyatakannya (`owner` ditolak gerbang di sana). Ketiga
  gerbang pengganti ADR-0051 TIDAK dilonggarkan. Alasan yang mengubah substansinya: **memindahkan layar tidak pernah menjadi
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

<!-- project-state-inventory:mulai -->

<!-- Dihasilkan `bun run project-state:inventory:generate`. JANGAN diedit tangan; gerbangnya `bun run project-state:inventory:check`. -->

| Aspek                              | Nilai (ter-generate)                                                                    | Sumber kebenaran                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Versi                              | **8.1.0**                                                                               | `package.json`                                                                          |
| Changeset menunggu (per tipe bump) | _jalankan perintah di kolom kanan_                                                      | `grep -h '^"awcms":' .changeset/*.md \| sort \| uniq -c`                                |
| Commit sejak rilis terakhir        | _jalankan perintah di kolom kanan_                                                      | `git rev-list --count v8.1.0..HEAD`                                                     |
| Modul base                         | **22** (lihat daftar di ARCHITECTURE.md)                                                | `src/modules/index.ts`                                                                  |
| Migrasi                            | **115** (`sql/001`–`115`)                                                               | `ls sql/`                                                                               |
| ADR                                | **0000**–**0088** (`0000` = template; status ADR tertinggi: **Diterima (2026-08-12).**) | `ls docs/adr/`                                                                          |
| Layar admin                        | **34** berkas `.astro` di `src/pages/admin/`; **0 dari 22** modul tanpa `navigation:`   | `find src/pages/admin -name '*.astro'`, `grep -L 'navigation:' src/modules/*/module.ts` |
| Berkas `.astro`                    | **47** (25.909 baris) — soal typecheck lihat §6                                         | `find src -name '*.astro'`                                                              |
| Gerbang                            | **41** di rantai `bun run check`                                                        | `scripts.check` di `package.json`, dipisah pada `&&`                                    |
| Kontrak                            | OpenAPI modular per-modul + AsyncAPI; `MODULE_CONTRACT_VERSION` **3.1.0**               | `openapi/`, `asyncapi/`, `_shared/module-contract.ts`                                   |

<!-- project-state-inventory:selesai -->

> **Angka tabel ini pernah basi tanpa ada yang merah.** Sebelum PR #339 barisnya
> berbunyi "20 berkas / 7 dari 21 modul" sementara `main` sudah memuat 22 berkas dan
> hanya 6 modul tanpa `navigation`, dan baris ADR berhenti di `0052` padahal `0055`
> sudah mendarat. Tak ada gerbang yang memeriksa tabel ini — kolom "Sumber kebenaran"
> kini memuat perintah yang **menghasilkan** angkanya, jadi memverifikasinya butuh satu
> tempel, bukan satu penghitungan manual.
>
> **Dan ia basi lagi dalam satu hari, di baris yang PR #339 tidak sentuh.** Baris
> Versi berbunyi "53 changeset menunggu" sementara `.changeset/` memuat **68**.
> Selisihnya bukan kosmetik: salah satunya bertipe `major`, jadi rilis berikutnya
> adalah **`v7.0.0`**, bukan `6.5.0` — angka yang salah di sini menyesatkan
> perencanaan rilis, bukan cuma pembaca. Kolom "Sumber kebenaran" baris itu kini
> memuat perintah yang menghitungnya per tipe bump.
>
> **Dan basi untuk KETIGA kalinya, di baris yang sama, sembilan hari kemudian.**
> Asesmen putaran kedua (4 Agustus 2026) menemukan **100** changeset, bukan 68 —
> dan tiga baris lain ikut basi: ADR berhenti di `0060` padahal `0067` sudah ada,
> `MODULE_CONTRACT_VERSION` tertulis `2.4.0` padahal sumbernya `2.5.0`. Pola ini
> tidak akan berhenti dengan menuliskan angka yang lebih baru; ia berhenti hanya
> bila tabel ini **di-generate**. Sampai itu terjadi: **jangan pernah mengutip
> tabel ini sebagai fakta — jalankan perintah di kolom kanan.** Untuk angka yang
> memang sudah ter-generate, pakai
> [`awcms/repo-inventory.md`](awcms/repo-inventory.md). Putaran ketiga
> (5 Agustus 2026) menemukan episode **keempat** pada baris yang sama —
> changeset 100→101, commit 108→113 — plus baris ADR yang berhenti di `0067`
> padahal `0068` sudah `Accepted`; instruksi di atas berlaku tanpa pengecualian.
>
> **Penutup (5 Agustus 2026): episode keempat menjadi yang terakhir.** Kebasian
> keempat itu (changeset 100→101, commit 108→113, baris ADR) adalah alasan tabel
> ini akhirnya **di-generate**: `bun run project-state:inventory:generate`
> menulis blok di antara marker, dan `bun run project-state:inventory:check` di
> rantai `check` memerahkan CI bila ia basi. Baris CEPAT — jumlah changeset per
> tipe bump dan jumlah commit sejak rilis — **dihapus angkanya**, bukan
> di-generate: angka yang bergerak tiap commit di dokumen ter-versioning akan
> selalu basi, dan menggerbanginya berarti memaksa tiap PR meregenerasi dokumen
> ini. Sel nilainya kini menyuruh menjalankan perintah di kolom kanan, yang
> dipertahankan (ini cabang "dihapus dari tabel" dari usulan blockquote di
> atas). Ketiga blockquote sejarah di atas sengaja dipertahankan apa adanya.

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

> Catatan: [`awcms/repo-inventory.md`](awcms/repo-inventory.md) kini
> **ter-generate** (`bun run repo:inventory:generate`, gerbang `:check` di rantai
> `check`) — angka modul/migrasi/tabel-RLS/test/route di sana diturunkan dari
> repo, jadi ia boleh dipakai sebagai sumber angka. Tabel §2 di atas kini
> mengikuti pola yang sama (`bun run project-state:inventory:generate`, gerbang
> `project-state:inventory:check` di rantai `check`): baris di antara marker
> diturunkan dari repo, dan dua baris cepat sengaja tanpa angka — jalankan
> perintah di kolom "Sumber kebenaran".

## 3. Yang sudah selesai (jangan dibangun ulang)

- **22 modul** terdaftar dengan RLS `FORCE`, pemisahan role DB
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
  ter-migrasi penuh (69 per 2026-07-26; repo kini memuat 90 migrasi — angka ini bergerak,
  verifikasi dengan `ls sql/`) dan berjalan sebagai role least-privilege terpisah. Rincian,
  termasuk jebakan "user Coolify itu superuser sehingga RLS inert", di
  [`awcms/environments.md`](awcms/environments.md).

## 4. Backlog / langkah berikutnya

- **PUTARAN 12 Agustus 2026 (kesebelas) — GELOMBANG 7 SELESAI. PR 7.4 mendarat,
  dan rencananya salah untuk KEDUA kalinya dengan cara yang sama.**

  [ADR-0088](adr/0088-tenant-selection-and-switching.md) (`sql/115`): login tanpa
  header tenant → `409 MEMBERSHIP_SELECTION_REQUIRED` + token seleksi (≤120
  detik, sekali pakai, **dua kolom di `awcms_principals`** — bukan tabel kelima
  yang tumbuh mengikuti trafik), ditukar di `POST /auth/session/tenant`;
  `POST /auth/session/switch` memindahkan sesi hidup.

  **Invarian yang dijaga: token seleksi tidak pernah mengautentikasi
  `authorizeInTransaction`** — namespace hash `pt-sha256:` ditolak di pernyataan
  PERTAMA gerbang, tanpa satu query pun, sehingga "nol baris decision log" benar
  secara konstruksi. Test-nya memakai transaksi yang menggagalkan test bila
  gerbang menyentuh DB sama sekali.

  **Temuan: rencana mengasumsikan pembacaan lintas-tenant yang FORCE RLS larang
  — lagi.** ADR-0087 sudah menolak "baris audit di setiap tenant terjangkau";
  PR 7.4 seharusnya membawa daftar keanggotaan di respons 409, dan komentar
  index PR 7.1 sendiri menulis bahwa `awcms_identities (principal_id)` melayani
  query itu. Diukur pada basis data nyata: **1 baris di dalam konteks tenant,
  NOL tanpa konteks.** Proyeksi keanggotaan global akan membuatnya mungkin dan
  ditolak — ia direktori keanggotaan lintas-tenant yang ADR-0087 tolak dalam
  wujud lain. **Pemanggil menyebut tenantnya**, dan itu pilihan pemilik repo,
  bukan default yang tak dipikirkan.

  Aturan non-switchable (`sso`/`handoff` tidak boleh berpindah) menutup
  pengambilalihan lintas-tenant yang setiap langkahnya sah. Gerbang MFA tenant
  tujuan berlaku di kedua jalur — tanpa itu perpindahan tenant adalah bypass
  MFA. Rantai tetap **41**; suite DB-gated bertambah satu berkas (terdaftar di
  kedua workflow). Koreksi searah: `standar-performa-dan-keamanan.md` menyebut
  "18 berkas rute" ber-rate-limit; nyatanya **26**, sudah basi enam berkas
  sebelum PR ini menambah dua.

  **Gelombang 7 TUTUP.** Berikutnya Gelombang 8 (partner/EaaS + akses
  terdelegasi), yang belum dimulai.

- **PUTARAN 12 Agustus 2026 (kesepuluh) — PR 7.3 MENDARAT: MFA pindah ke
  principal, dan sebuah kewajiban yang DITULIS RENCANA ternyata tak bisa
  dibangun.**

  [ADR-0087](adr/0087-mfa-moves-to-the-principal.md) (`sql/114`): faktor MFA dan
  recovery code menjadi milik **manusia** —
  `awcms_principal_mfa_factors`/`awcms_principal_mfa_recovery_codes`, GLOBAL
  tanpa RLS, memakai ulang keempat kontrol ADR-0085. Enkripsi `sql/024` tidak
  disentuh. `awcms_mfa_challenges` dan `awcms_tenant_mfa_policies` **tidak** ikut
  pindah, masing-masing dengan serangan konkret sebagai alasannya. Permukaan HTTP
  tidak berubah satu berkas pun.

  **Temuan putaran ini — "diaudit di log kedua tenant" MUSTAHIL, dan juga tidak
  seharusnya.** Rencana Gelombang 7 memintanya dan edisi pertama ADR-0087
  menyalinnya. Basis data membantah: `awcms_identities` FORCE RLS membuat
  `WHERE principal_id = … AND tenant_id <> …` mengembalikan **nol baris
  selamanya** — kode itu akan hijau di 41 gerbang sambil tak pernah menemukan
  apa pun — dan `awcms_audit_events` menolak `INSERT` ber-`tenant_id` lain.
  Yang lebih penting: daftar tenant lain tempat sebuah alamat punya identitas
  adalah **oracle keanggotaan lintas-tenant**, diserahkan kepada pemegang
  `mfa_admin.reset` lewat endpoint yang tugasnya memulihkan orang. Diganti
  `crossTenantReach` di baris audit + `disabled_by_tenant_id` di baris global:
  menyatakan BAHWA ia menjangkau keluar, bukan ke mana. **Pelajarannya sejalan
  dengan §6: periksa policy-nya, jangan percayai rencananya.**

  **Temuan kedua, dan ia hanya muncul karena skripnya DIJALANKAN.** Kedua sensus
  preflight — yang baru DAN `identity:principals:preflight` yang sudah mendarat
  di PR 7.1 — mengulang tenant di dalam `withTenantOrThrow` dan bersandar pada
  RLS untuk memotong barisnya. Superuser dan role migrasi **melewati RLS
  sepenuhnya**, dan menjalankan skrip ops sebagai owner adalah setup lumrah:
  setiap iterasi membaca seluruh baris instalasi lalu menandainya dengan tenant
  yang sedang giliran. Sensus MFA melipatgandakan hitungannya (dua faktor
  dilaporkan empat, tenant salah); yang lebih buruk sensus principal —
  **satu manusia yang sah bekerja di dua tenant dilaporkan sebagai DUA tabrakan
  MEMBLOKIR**, menyuruh operator memutuskan akun nyata mana yang duplikat, tepat
  pada kasus yang menjadi alasan principal ada. Keduanya kini ber-predikat
  `tenant_id` eksplisit, dengan regresi berbasis source yang mutasinya
  memerahkan. Pelajaran §6 yang berulang: **jalankan, jangan dibaca** — tak satu
  pun dari keduanya terlihat di diff.

  Perkakas baru: `bun run identity:mfa-collisions:preflight` (READ-ONLY, sensus
  siapa kehilangan authenticator sebelum jendela deploy). Gerbang
  `identity:principal-access:check` kini menjaga **tiga** tabel dengan allow-list
  **terpisah per tabel** — rantai tetap **41**, tidak bertambah.
  `BOUNDED_BY_DESIGN` 11 → 13 dengan argumen kelas ketiga (bound ditegakkan
  SKEMA, bukan authorship/derivasi).

  **Yang tersisa dari Gelombang 7:** PR 7.4 (pemilihan + perpindahan tenant).
  Belum dimulai. Larangan yang PR 7.4 warisi dari ADR-0087 dan tidak boleh
  dilonggarkan: **challenge tenant A tidak boleh bisa ditukar menjadi sesi di
  tenant B.**

- **PUTARAN 12 Agustus 2026 (kesembilan) — GELOMBANG 7 DIBUKA, #430 DITUTUP, dan
  satu putaran konsistensi yang tidak menyentuh satu baris kode pun.**

  **Dua PR mendarat.** [ADR-0085](adr/0085-one-human-one-credential-many-tenants.md)
  (#524, PR 7.1, `sql/112`) mendaratkan `awcms_principals` — GLOBAL, tanpa RLS,
  satu baris per manusia — beserta gerbang baru `identity:principal-access:check`
  (**rantai 40 → 41**). [ADR-0086](adr/0086-the-lockout-counter-is-global.md)
  (#525, PR 7.2, `sql/113`) memindahkan penghitung lockout ke sana dan
  **menutup [#430](https://github.com/ahliweb/awcms/issues/430)**.

  **Yang tersisa dari Gelombang 7** (saat putaran itu ditulis): PR 7.3 (MFA
  pindah ke principal) dan PR 7.4 (pemilihan + perpindahan tenant). PR 7.3 sejak
  itu mendarat — lihat putaran kesepuluh di atas.

  ### Putaran konsistensi: yang DIPERIKSA dan tidak ditemukan

  Putaran ini dimulai dari permintaan "selesaikan semua masalah konflik", dan
  separuh hasilnya adalah **ketiadaan temuan** — dicatat di sini karena putaran
  berikutnya yang menurunkan ulang kesimpulan yang sama membayar audit penuh
  untuk jawaban yang sudah diketahui.

  - **Konflik git: NIHIL.** Working tree bersih, nol PR terbuka, dan repositori
    di GitHub hanya punya **satu** branch: `main`.
  - **Dan satu jebakan perkakas yang hampir menjadi temuan palsu.** Audit ini
    mula-mula melaporkan **87 branch remote menumpuk**, lalu mengujinya satu per
    satu dengan `git merge-tree` dan menyimpulkan "nol yang bentrok". Kedua
    kalimat itu berdiri di atas premis yang salah: `git fetch` **tanpa
    `--prune`** meninggalkan remote-tracking ref untuk branch yang sudah lama
    dihapus GitHub saat merge, dan `git branch -r` menampilkannya persis seperti
    branch hidup. Yang menumpuk adalah **ref basi di klon lokal**, bukan apa pun
    di server — dibuktikan dengan `gh api repos/.../branches`, yang mengembalikan
    `main` saja, dan dibersihkan `git fetch --prune`. Pelajarannya sejalan dengan
    yang sudah tercatat berkali-kali di §6: **tanya sumbernya, jangan baca cache
    lokalnya** — sebuah audit yang percaya diri bisa lahir utuh dari perkakas
    yang kebetulan basi.
  - **Rantai gerbang: hijau penuh** (41/41 + 3973 test, 0 gagal), CI dan CodeQL
    hijau di `68c9c50`.
  - **ADR-0086 tidak meninggalkan pembaca tertinggal.** Kelima jalur reset
    lockout diperiksa satu per satu terhadap penghitung principal: login sukses,
    reset password, ganti password, callback SSO, dan verifikasi enrolment MFA.
    Satu jalur yang TAMPAK tertinggal — `mfa/totp/verify.ts` yang hanya menulis
    `awcms_identities.failed_login_count` — ternyata benar: `login.ts` sudah
    memanggil `clearPrincipalLockout` **saat password terbukti**, sebelum
    challenge diterbitkan, sehingga kolom identitas di jalur itu memang tinggal
    sejarah. Catatan ini ada supaya pembaca berikutnya tidak "memperbaikinya".
  - **SoD tidak buta terhadap grant lewat user group.** `resolveOrdinaryRbacFacts`
    membaca `activeRoleGrants`, dan fragmen itu meng-`UNION ALL` grant langsung
    dengan grant turunan `awcms_user_groups` — jadi kekambuhan ADR-0079 yang
    dulu membuat SoD melapor "tak ada konflik" tidak terjadi lagi lewat ADR-0081.

  ### Yang DITEMUKAN: enam dokumen yang menjelaskan dunia yang tidak ada

  Semuanya kelas yang sama — **penulisnya pindah, dokumennya tidak** — dan
  semuanya tentang lockout yang sejak `sql/113` tidak lagi per-identitas:

  | Dokumen                                    | Klaim yang sudah salah                                              |
  | ------------------------------------------ | ------------------------------------------------------------------- |
  | `standar-performa-dan-keamanan.md`         | A07/V2/V11 "lockout per-identitas"; **34 gerbang**; **69 ADR**      |
  | `20_threat_model_security_architecture.md` | A07 "lockout per-identitas"                                         |
  | `turnstile-bot-protection.md`              | "lockout per-identity"                                              |
  | `18_configuration_env_reference.md`        | `AUTH_LOGIN_MAX_ATTEMPTS` "per identitas"                           |
  | `04_erd_data_dictionary.md`                | `awcms_principals` tak ada; kolom lockout identitas masih "penting" |
  | `ARCHITECTURE.md`                          | jalur auth tanpa principal sama sekali                              |

  **Kenapa ini bukan kerapian.** `standar-performa-dan-keamanan.md` adalah
  dokumen yang dipakai untuk menjawab auditor, dan barisnya berbunyi "Terpenuhi"
  di sebelah deskripsi kontrol yang **lebih lemah** daripada yang sebenarnya
  berjalan. Dokumen yang meremehkan kontrolnya sendiri akan dikoreksi ke arah
  yang salah oleh orang berikutnya yang mempercayainya — persis mode kegagalan
  yang sudah tercatat untuk skill basi.

- **PUTARAN 12 Agustus 2026 (kedelapan) — GELOMBANG 5 (ENTITLEMENT/SaaS) SELESAI. Mesinnya berdiri, dan entitlement nyata
  pertama terpasang tanpa menolak satu tenant pun.**
  [ADR-0084](adr/0084-an-entitlement-refuses-it-never-grants.md), empat PR:
  #517 (skema + cabang penolakan + gerbang deny-only), #518 (tangga langganan +
  job), #519 (grandfathering + laporan blast-radius), #521 (pelekatan pertama).

  **Sebuah entitlement MENOLAK, ia tidak pernah memberi.** Setiap fungsi
  keputusan yang diekspor `identity-access/domain/entitlement.ts` bertipe
  `EntitlementDenial | null` — tak ada bentuk nilai yang berarti "ya". Properti
  itu diperiksa mesin oleh gerbang baru `access:entitlement:deny-only:check`
  (rantai **39 → 40**), bukan diserahkan pada review, karena mutasi yang
  merusaknya satu baris dan terbaca seperti kerapian. Ia adalah bentuk dari
  penolakan yang §4 ini sudah catat: `subject.entitlements` DITOLAK sebagai
  atribut ABAC.

  **Mendarat INERT, dan dibuktikan bukan diklaim.** Nol modul mendeklarasikan
  `requiresEntitlement`, dan `resolveModuleAvailability` pada jalur null
  mengeluarkan **pernyataan SQL yang SAMA** seperti sebelum gelombang ini —
  dibandingkan sebagai TEKS di test.

  ### Empat tempat rencana tidak diikuti
  1. **Job tangga langganan TIDAK memanggil `suspendTenant`**, dan alasannya
     sebuah HAK, bukan preferensi. Itu menuntut `UPDATE` pada `awcms_tenants`
     untuk `awcms_worker`, sementara `WORKER_ROLE_GRANTS` menuliskan sendiri
     aturan yang dilanggarnya — dan `awcms_tenants` adalah tabel akar TANPA RLS,
     jadi tak ada policy di antara satu UPDATE keliru dan setiap tenant di
     instalasi. Konsekuensinya tetap tiba lewat gerbang entitlement (`suspended`
     dan `cancelled` di luar `ENTITLING_SUBSCRIPTION_STATUSES`), dan itu juga
     jawaban yang PROPORSIONAL: tagihan tak terbayar merenggut fitur yang
     berhenti dibayar, bukan situs publik, login, dan akses data.
  2. **Ceiling `BOUNDED_BY_DESIGN` dinaikkan 5 → 10**, dengan derivasi yang akan
     menghindarinya dicatat sebagai DITOLAK: "request path tak bisa menulis,
     jadi tak tumbuh dengan traffic" salah, dan counter-example-nya ada di repo
     ini — `awcms_idn_admin_regions` melarang `awcms_app` ketiga verba tulis dan
     memuat ~91.000 baris, karena daftar itu mengikat `awcms_app` sementara job
     import berjalan sebagai `awcms_worker`.
  3. **Batas blast-radius pada job** (`MAX_ENTITLEMENT_LOSSES_PER_RUN = 25`)
     tidak ada di rencana. Ia bukan rate limit melainkan detektor "ini bug, bukan
     hari Selasa": atrisi nyata menetes, setiap mode kegagalan yang penting tiba
     sebagai tebing. Semua-atau-tidak-sama-sekali, dan menghitung KERUGIAN bukan
     transisi.
  4. **Deklarasi `requiresEntitlement` pada modul `isCore` memerahkan
     `modules:compose:check`**, bukan hanya diabaikan runtime. Deklarasi yang
     diabaikan runtime lebih buruk daripada tidak ada deklarasi — ia terbaca
     sebagai kontrol yang ada.

  ### Dua cacat, keduanya ditemukan dengan MENJALANKAN
  - **`sql/109` tidak mencabut hak yang default privileges berikan.** `sql/019`
    memasang `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLES TO awcms_app`, jadi tiga tabel katalog GLOBAL lahir dengan keempat
    verba sementara `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` menyatakannya read-only.
    **Keempat puluh gerbang murni hijau** selama deklarasi dan basis data saling
    bertentangan; hanya `checkRuntimeRoleGrants` — di suite DB-gated CI — yang
    BERTANYA kepada Postgres apa yang sebenarnya dipegang. Ini pengulangan
    persis pelajaran "jalankan, jangan dibaca".
  - **Test urutan gerbang struktural menemukan cacatnya sendiri saat ditulis.**
    Cabang entitlement tidak memuat sentinelnya secara tekstual karena ia
    MENERUSKAN `entitlementDenial.matchedPolicy`. Detektornya dikunci pada kode
    error alih-alih dilonggarkan: meniru literalnya demi keseragaman dengan empat
    cabang lama justru akan MENGEMBALIKAN drift yang dihapus konstanta itu.

  ### PR 5.4 berubah bentuk DUA KALI, dan gerbang yang menemukan keduanya

  Rencana menulisnya sebagai "pelekatan entitlement nyata pertama pada satu modul
  non-core". Bentuk itu salah, dan **koreksinya sendiri lalu ikut salah** —
  keduanya dicatat karena keduanya adalah cara repo ini menemukan sesuatu.

  **Koreksi pertama (dari membaca kode).** Memasang `requiresEntitlement` tanpa
  apa pun yang lain akan menolak modul itu dari SETIAP tenant di SETIAP instalasi
  turunan: `resolveModuleAvailability` menuntut plan efektif yang memuat kuncinya,
  dan **tak ada tenant yang punya baris langganan sama sekali**. Jawaban pertama:
  `createTenantWithOwner` membuat langganan pada plan default, plus migrasi
  backfill lintas-tenant.

  **Koreksi kedua (dari `modules:table-writes:check`).** Jawaban itu membuat
  `awcms_tenant_subscriptions` ditulis oleh `tenant_admin` DAN `identity_access`
  — shared-table write yang dilarang ADR-0013 §6. Gerbangnya menolak, dan
  penolakannya menunjuk ke desain yang lebih baik: **turunkan default-nya,
  jangan tuliskan.** Tenant tanpa baris langganan diperlakukan berada di plan
  `is_default` — konvensi "baris yang hilang bukan sebuah keputusan" yang sama
  persis dipakai `awcms_tenant_modules` sejak `sql/008`.

  Hasilnya: tepat SATU penulis tabel itu (job tangga langganan), nol backfill
  lintas-tenant, nol toggle `NO FORCE`, dan satu konvensi baru diganti konvensi
  yang sudah diajarkan repo ini. Fallback-nya sengaja TIDAK berlaku saat baris
  langganan ADA tetapi statusnya tak memberi hak — kasus itu lapse, dan jatuh
  kembali ke plan default akan diam-diam membatalkannya.

  **Yang terpasang:** `tenant_domain` → `custom_domain`. Seluruh permukaan
  TERJAGA-nya adalah manajemen domain; resolusi host untuk domain yang sudah
  dikonfigurasi adalah jalur baca publik yang tak pernah mencapai chokepoint,
  jadi tenant tanpa entitlement tetap dilayani di domain yang sudah ia punya.
  Kehilangan kemampuan menambah domain adalah plan wall; kehilangan domain yang
  sudah dipakai adalah gangguan layanan. `site_search` dan `comments` ditolak
  justru karena keduanya punya permukaan publik tak-terautentikasi yang melewati
  chokepoint — entitlement di sana akan ditegakkan pada separuh modul dan
  diabaikan diam-diam pada separuh lain.

  Test "gelombang ini inert" DIGANTI, bukan dihapus: yang layak dijaga tak pernah
  "inert" melainkan **"nol orang ditolak"**, dan itu kini di-assert terhadap TEKS
  migrasinya — dibuktikan dengan memutasi `sql/111`.

  ### YANG TERSISA dari Gelombang 5: layar `/admin/subscriptions`

  Sengaja DIPISAH dari #521 dan belum dibangun. Alasan pemisahannya mekanis dan
  layak diketahui: permission baru wajib diklaim sebuah layar atau masuk ledger
  (`admin:screen-coverage:check`), jadi permukaan admin dan permission-nya harus
  mendarat bersama — sementara pelekatan entitlement tidak menambah permission
  sama sekali dan karena itu bisa mendarat sendiri, lebih kecil dan lebih mudah
  di-review.

  Bentuknya: menugaskan tenant ke sebuah plan (`awcms_tenant_subscriptions`,
  tenant-scoped, bisa ditulis). Ia **TIDAK PERNAH** bisa mengubah ISI sebuah plan
  — katalog itu migration-only, dan itu properti ADR-0084 yang paling mudah
  dirusak oleh layar admin yang "melengkapi" dirinya sendiri.

  ### Status gelombang

  | Gelombang | Status                                                                                                |
  | --------- | ----------------------------------------------------------------------------------------------------- |
  | 0–4       | selesai                                                                                               |
  | **5**     | **selesai — empat PR mendarat (#517, #518, #519, #521); sisa `/admin/subscriptions`, lihat di atas**  |
  | 6         | belum — metering & kuota (IaaS)                                                                       |
  | 7         | belum — principal global; **#430 ditutup di sini (PR 7.2)**, tidak bisa mendahului `awcms_principals` |
  | 8         | belum — partner/EaaS + akses terdelegasi                                                              |

  ### Catatan merge

  Keempat PR di-merge berurutan dengan CI hijau penuh di tiap langkah (10/10
  check, termasuk suite integrasi ber-Postgres). Dua hal yang memperlambatnya dan
  layak diketahui berikutnya: **ruleset `main` memakai
  `strict_required_status_checks_policy`**, jadi setiap PR harus di-rebase ke
  `main` terbaru setelah pendahulunya merge (status `BEHIND` bukan kegagalan);
  dan **squash-merge menulis ulang commit pendahulunya**, jadi `git rebase
origin/main` pada PR bertumpuk akan konflik — yang benar
  `git rebase --onto origin/main <tip-lama-pendahulu>`.

- **PUTARAN 11 Agustus 2026 (ketujuh) — SATU ENVIRONMENT, PROFIL `staging`
  DIHAPUS, DAN AKAR BERHENTI 404.** Keputusan pemilik repo, mendarat sebagai
  [ADR-0083](adr/0083-this-template-deploys-to-one-environment.md).

  **Repo ini punya tepat satu deployment hidup: production di
  `awcms.ahlikoding.com`.** Tidak ada staging — bukan hanya "tidak punya
  sendiri": profilnya pun sudah tidak ada, lihat dua paragraf berikutnya.
  Alasannya diberikan pemilik dan dituliskan utuh di ADR: repo ini **template**;
  deployment hidupnya menunjukkan dan memvalidasi template, bukan melayani
  bisnis. Yang akan "di-stage" adalah templatenya sendiri — dan itu divalidasi
  39 gerbang + suite integrasi ber-Postgres di CI, bukan salinan kedua yang
  berjalan. Staging di sini bukan jaring pengaman, melainkan environment kedua
  yang harus dirawat: satu set secret lagi, satu database lagi yang butuh
  backup, satu antrean migrasi lagi.

  **ADR-0083 DIAMANDEMEN DI TEMPAT, DAN PEMBALIKANNYA DICATAT DI SINI.** Edisi
  pertama ADR itu — ditulis pagi yang sama, dalam putaran ini juga —
  **MEMPERTAHANKAN** `staging` sebagai `DeploymentProfile` yang sah di
  `module-contract.ts`, dengan argumen bahwa yang berubah adalah topologi repo
  ini dan bukan kapabilitas templatenya, sehingga menghapusnya akan mencabut
  sesuatu dari SETIAP pemakai template. **Pemilik repo membatalkan argumen
  itu.** `staging` dihapus **SELURUHNYA**: bukan hanya environment milik repo
  ini, melainkan profil deployment-nya sendiri dan setiap rujukan kepadanya.

  **Alasan yang mengoreksi premis edisi pertama: profil deployment yang tak
  pernah dijalankan siapa pun adalah KLAIM, bukan kapabilitas.** Yang
  ditawarkan `staging` selama ini hanyalah sebuah literal string yang lolos
  pemeriksaan tipe — nol jalur kode yang memperlakukannya berbeda dari
  `production`, nol deployment yang pernah menegakkannya sebagai staging
  sungguhan, dan (temuan putaran keenam) satu `APP_ENV=staging` yang justru
  MELAYANI domain produksi di atas database staging. Kapabilitas yang hanya
  bisa dibuktikan dengan menunjuk union tipe bukan kapabilitas; ia janji.
  Pemakai template yang benar-benar butuh environment kedua membuatnya dengan
  `APP_ENV=production` kedua dan basis data kedua — persis yang selama ini
  sudah terjadi — tanpa perlu sebuah nama yang tak dibaca kode mana pun.

  **Kenapa DIAMANDEMEN, bukan di-supersede.** ADR-0083 belum ter-commit dan
  belum dirilis saat keputusan ini datang, jadi ia disunting di tempat alih-alih
  dijawab ADR baru. Yang tidak boleh terjadi justru bentuk yang lebih rapi:
  membiarkan sebuah ADR berbunyi "`staging` tetap sah" bersebelahan dengan kode
  yang tak lagi memuatnya. Repo ini sudah berkali-kali digigit dokumen yang
  percaya diri dan salah — dan sebuah ADR adalah dokumen yang paling dipercaya
  pembaca berikutnya.

  **Yang sebenarnya dikoreksi ADR ini adalah dokumen yang menjelaskan dunia yang
  tidak ada.** Topologi dua-environment sudah berhenti berlaku sebelum putaran
  ini: baris app produksi tidak ada di `applications`, tidak ada database
  produksi, dan domain produksi dilayani deployment staging. ADR membuat dokumen
  dan kenyataan sepakat **dengan memilih satu**, bukan membangun kembali yang
  kedua.

  **`/` berhenti menjadi 404.** ADR-0071 menerima 404 dengan premis terbuka
  bahwa `awcms-astro` memikul akar domain. Premis itu benar untuk sebuah SITUS,
  tidak untuk host deployment template ini — tak ada `awcms-astro` di depannya
  (kedua app-nya `exited`). Pintu depan yang menjawab 404 kepada siapa pun yang
  mengetik nama domain adalah cacat, bukan keputusan. `src/pages/index.astro`
  kini melayaninya: **nol query basis data, nol konteks tenant, nol enumerasi**
  (tak menyebut nama/jumlah tenant, versi, atau status modul), dan **nol skrip
  klien BARU** — satu-satunya skrip adalah `THEME_INIT_SCRIPT_BODY` yang
  hash-nya sudah ada di `script-src`, jadi CSP tidak berubah sama sekali.
  Diverifikasi dengan MENJALANKAN server hasil build: `/` → **200**,
  `/nope-xyz` → **404** (catch-all utuh), enam kartu ter-render, satu `<h1>`,
  satu `<script>`, nol `src=` eksternal.

  **Gerbang yang menagih, dan ia benar menagih.** `modules:routes:check` menolak
  `/index` sebagai rute tak-terklaim. Ia masuk `PLATFORM_ROUTES` dengan alasan,
  bukan diberikan ke sebuah modul: memberikannya ke modul membuat pintu depan
  **bisa dinonaktifkan**, yaitu persis kegagalan (404 di akar) yang halaman ini
  ada untuk memperbaikinya.

  **Yang DITOLAK, dengan alasannya:** membangun ulang produksi terpisah +
  staging (memulihkan biaya yang tak dibeli siapa pun); membiarkan domain
  produksi dilayani `APP_ENV=staging` (nama environment yang berhenti berarti
  apa pun lebih buruk dari nama yang hilang — pembaca `APP_ENV` berikutnya akan
  salah dengan percaya diri); menjadikan landing sebagai halaman tenant ber-tema
  (mengikat pintu depan pada `theming` + resolusi tenant); dan meredirect `/` ke
  `/login` (menyodorkan formulir kredensial kepada orang yang belum tahu AWCMS
  itu apa).

  **Yang sempat ditolak lalu DIBALIK, dan ia tidak dihapus diam-diam:**
  "menghapus `staging` dari union tipe" adalah butir 2 daftar tolakan edisi
  pertama ADR-0083. Butir itulah yang kini justru dikerjakan. Ia ditulis begini
  — sebagai tolakan yang dibatalkan, bukan sebagai tolakan yang tak pernah ada —
  karena nilai dokumen ini adalah ia merekam pembalikan alih-alih memulusnya.
  Pembaca berikutnya yang mengusulkan mengembalikan `staging` berhak tahu bahwa
  argumen "kapabilitas template" sudah diajukan, ditulis, lalu ditimbang dan
  ditolak — bukan tidak terpikir.

  **Biaya yang diterima dan dinyatakan:** tak ada lagi latihan pra-produksi
  untuk migrasi. Penggantinya suite integrasi CI + kewajiban backup
  ter-verifikasi-restore sebelum migrasi (`deploy/backup/restore-postgres.sh`
  mode verify-only). Itu mitigasi, **bukan pengganti setara**.

  **Infrastruktur: SELESAI 11 Agustus 2026, v8.0.0 hidup di produksi.**
  Diverifikasi, bukan diklaim: `https://awcms.ahlikoding.com/api/v1/health`
  menjawab `moduleCount: 22` (v7.0.0 menjawab 21), `/` menjawab **200**
  (halaman landing, bukan 404 lagi), tag image container
  `1d9534f1717282440376263f8e18c8b812a8b997` = commit rilis `v8.0.0` persis, dan
  `awcms-staging.ahlikoding.com` kini **503** karena tak ada lagi router yang
  menyebutnya. `awcms_app` diperiksa `rolsuper=f, rolbypassrls=f`, jadi FORCE RLS
  di 124 tabel benar-benar berlaku.

  **Latihan migrasi terakhir yang ADR-0083 lepaskan — dipakai sekali sebelum
  dilepas.** Karena staging masih ada, 18 migrasi (`091`–`108`) dijalankan lebih
  dulu terhadap SALINAN data produksi (`awcms_rehearsal`) dan diperiksa
  invariannya — `migrations=108`, `unbackfilled=0`, `force_rls=124`,
  `awcms_invitations → awcms_worker = DELETE,SELECT` — baru kemudian dijalankan
  sungguhan, dengan hasil identik. Latihan itu tak akan bisa diulang: staging
  sudah tidak ada.

  **Empat env var yang bolong sejak v7.0.0 ditutup saat standup:**
  `TRUSTED_PROXY_ENABLED=true` + `TRUSTED_PROXY_HOP_COUNT=1` (tanpanya seluruh
  klien runtuh ke satu bucket rate-limit di belakang Traefik),
  `AUTH_COOKIE_SECURE=true`, dan `AUTH_SOURCE_RATE_LIMIT_MAX=60`.

  **Tenant-nya sendiri ber-`tenant_code = staging`** dan bernama "AWCMS
  Staging" — referensi staging di dalam DATA produksi. Diubah menjadi
  `ahliweb` / "AWCMS", dan `PUBLIC_DEFAULT_TENANT_CODE` mengikuti. Konsekuensi
  yang diterima: URL `/blog/staging/**` menjadi `/blog/ahliweb/**`.

  **Backup diambil dan DIVERIFIKASI lebih dulu, sebelum apa pun dihapus:**

  - berkas `/home/admin1/backups/awcms/awcms-preprod-20260811-090628.dump`
  - sha256 `08f677c5f13d7386c77dd41841090b60f95159550bdab3e90b7bfb6353a0bd68`
  - **di-restore-drill ke database scratch** (`awcms_tenants` = 1 baris terbaca
    dari hasil restore) — bukan sekadar `pg_dump` yang exit 0.
  - keputusan pemilik repo: data itu **dipromosikan**, bukan dibuang — produksi
    menerima restore backup ini, sehingga tenant + akun owner yang ada tetap
    bisa masuk dan setup wizard tidak perlu dijalankan.

  Urutan itu bagian dari keputusannya, bukan kehati-hatian tambahan: ADR-0083
  melepaskan latihan pra-produksi untuk migrasi, sehingga backup yang TERBUKTI
  bisa di-restore adalah satu-satunya jaring yang tersisa — dan jaring yang
  belum pernah ditarik bukan jaring. Ia juga satu-satunya salinan data yang
  pernah dilayani `awcms.ahlikoding.com` selama periode putaran keenam,
  ketika domain produksi berjalan di atas database staging.

  **Jebakan yang dibuat sendiri saat membongkar, dan cara ia ketahuan.**
  Menghapus database `awcms_staging` membuat healthcheck container Postgres —
  `psql -U awcms_staging -d awcms_staging -c "SELECT 1"`, dipanggang Coolify saat
  container dibuat — menunjuk database yang tak ada lagi. Container masih
  melapor `healthy` beberapa menit (interval belum lewat) sementara
  `FailingStreak` sudah 4. Diperbaiki dengan meng-update `postgres_db` di
  Coolify lalu me-restart resource-nya, dan **diverifikasi dengan membaca ulang
  `Config.Healthcheck.Test` container barunya**, bukan dengan melihat kata
  "healthy". Pelajarannya sama seperti putaran keenam: status hijau yang belum
  sempat berubah bukan bukti.

  **DUA sisa staging yang TIDAK bisa/tidak boleh dihapus, dan alasannya:**

  1. **Record DNS `awcms-staging.ahlikoding.com` masih ada.** Token Cloudflare di
     host hanya ber-scope zona `dinkes.top`, jadi zona `ahlikoding.com` di luar
     jangkauan. Hostname-nya sendiri sudah mati (503, tak ada router). Hapus
     record-nya secara manual untuk menuntaskan.
  2. **Role Postgres `awcms_staging` sengaja DIPERTAHANKAN.** Ia adalah
     `POSTGRES_USER` container (superuser/pemilik). Me-rename-nya membuat
     `POSTGRES_USER`, healthcheck, dan connection string Coolify saling tidak
     cocok — menukar nama kosmetik dengan risiko produksi tak bisa start. Nama
     itu tinggal label; yang penting `awcms_app` (bukan ia) yang melayani
     request, dan itu sudah diperiksa tidak menembus RLS.

  **Titik-lanjut.** Verifikasi produksi selalu kepada
  `applications`/`standalone_postgresqls` Coolify, **bukan kepada `curl`** —
  pelajaran putaran keenam yang menyesatkan berjam-jam: `https://awcms.ahlikoding.com`
  menjawab 200 dan sehat sepanjang waktu produksi tidak ada. Job
  `sign-attest-publish` v8.0.0 menunggu approval maintainer di environment
  `release`; image-nya sendiri sudah terbit karena job `build` mendahului
  gerbang itu.

- **PUTARAN 11 Agustus 2026 (keenam) — AUDIT KESIAPAN DEPLOY. Kodenya siap;
  yang tidak ada adalah TEMPATNYA.** Dipicu pertanyaan "apakah bisa deploy
  sekarang". Audit 64 agen berverifikasi adversarial: **55 dari 56 temuan
  TERBANTAHKAN**, satu bertahan. Tak ada satu pun pemblokir di kode.

  **Temuan terbesar tidak ada di repo ini.** Environment **produksi awcms sudah
  tidak ada**: tabel `applications` Coolify tak punya baris untuk
  `got4etcblum9kowdv4mrixqo` (bukan soft-delete — barisnya hilang), dan
  `standalone_postgresqls` tak punya database produksi, hanya `awcms_staging`.
  Sementara itu `awcms-staging-varnish` memasang rule Traefik
  ``Host(`awcms-staging.ahlikoding.com`) || Host(`awcms.ahlikoding.com`)`` —
  jadi **domain produksi dilayani staging, memakai database staging**
  (`APP_ENV=staging`). Yang berjalan adalah commit rilis v7.0.0 (`ea25fff6`),
  **90 commit di belakang HEAD**; image v7.0.1 ter-build tapi tak pernah
  di-deploy. Basis datanya di migrasi **090**. Belum diputuskan: disengaja atau
  insiden. **Jangan berasumsi ada produksi untuk di-deploy.**

  **Yang menghalangi secara prosedural, bukan teknis:** `release:verify` untuk
  v7.1.0 exit 1 (package.json masih 7.0.1, CHANGELOG belum punya seksi, 72
  changeset belum dikonsumsi → bump MINOR); image hanya dibangun dari tag rilis;
  dan **migrasi WAJIB jalan SEBELUM container ditukar** karena
  `grant-source.ts:111,119-123` membaca `awcms_access_policies` tanpa syarat di
  jalur request terautentikasi. Precheck ke basis data hidup: `awcms_sync_outbox`
  **0 baris** (jadi `sql/099` tidak abort), 1 tenant, 1 access assignment.

  **Delapan perbaikan mendarat, semua `bun run check` hijau (3888 pass/0 fail):**

  1. **CSP `img-src` — satu-satunya temuan yang lolos verifikasi.** `default-src
'self'` tanpa `img-src` memblokir tiap gambar R2 lintas-origin milik
     sendiri. **`media-src` punya cacat IDENTIK** dan ikut ditutup: renderer yang
     sama memancarkan `<img>` dan `<video src=…>` dari URL R2 yang sama, jadi
     menambal `img-src` saja meninggalkan kebijakan setengah-benar — gambar
     tampil, video di sebelahnya tetap diblokir, tanpa error. `data:` sengaja
     TIDAK dibawa ke `media-src`: tak ada yang memancarkan video data-URI.
  2. **`sql/108`** — `awcms_invitations` tak pernah diberi GRANT ke
     `awcms_worker` padahal deskriptornya `executionMode: "generic"`, dan
     `archive-purge-job.ts` **nol `catch`** → satu `permission denied` membunuh
     SELURUH purge. Verb-nya diturunkan dari kode, bukan analogi:
     `SELECT, DELETE` saja — worker ber-`INSERT`/`UPDATE` bisa mengalamatkan
     tawaran keanggotaan ke mailbox mana pun atau merotasi `token_hash`.
  3. **Authoring artikel hidup.** Form create mengirim `contentText: ""` → 422
     SELALU; kini ada `<textarea>` + jalur PATCH di `/admin/blog` dan
     `/admin/blog-pages`. Validator TIDAK dilonggarkan — `content-quality-checklist.ts`
     tak punya aturan konten-ada, jadi melonggarkannya meloloskan post kosong.
  4. **Sitemap** tak lagi terpotong senyap di 200 URL (cursor diperlakukan opaque).
  5. **Ops**: `deploy/backup/*.sh` + `deploy/cron/awcms.crontab` (23 job yang
     selama ini tak punya penjadwal sama sekali) + `lock_timeout`/`statement_timeout`
     di `db-migrate.ts`.
  6. **Lima klaim docs yang salah** diperbaiki — `production:preflight` MEMANG
     tak ada, dan lolos karena `scripts/skills-check.ts:134` men-whitelist-nya.
  7. **Gerbang env berhenti buta.** `config:env:coverage:check` melapor OK atas
     53 variabel sementara kode membaca **173**; header skripnya sendiri mencatat
     batas itu sebagai "diterima". Kini ia **meresolusi alias** (`const env =
process.env`, `env: NodeJS.ProcessEnv = process.env`) alih-alih mencocokkan
     `env.X` apa pun — presisi lama dipertahankan, dibuktikan dua test negatif.
     26 variabel deployment nyata masuk `.env.example`, termasuk **seluruh
     `REDIS_*`**: tanpa `REDIS_ENABLED=true`, rate limiter lintas-instance
     diam-diam jadi N× limit per replica.
  8. Dua rentang `sql/NNN` basi di `ARCHITECTURE.md` + `.claude/skills/README.md`.

  **Yang DITOLAK, dengan alasannya:**

  1. **Membangun ulang infrastruktur produksi & memicu deploy** — sulit dibalik,
     dan menunggu keputusan apakah hilangnya environment itu disengaja.
  2. **#430** — kedua workaround (rekey identifier, lockout global) sudah
     ditolak tertulis di §816-821/§884-889; perbaikan sebenarnya principal
     global, Gelombang 7. Jangan diusulkan ulang.
  3. **Melonggarkan `validateContentTextField`** — lihat butir 3 di atas.
  4. **Membalik default `SYNC_HMAC_ALLOW_LEGACY`** menjadi fail-closed —
     `sync-auth.ts:29-31` memang fail-OPEN (absennya menerima v1 yang
     cross-tenant forgeable, GHSA-c972-3q5p-g3h4), tetapi membaliknya memutus
     node v1 yang sudah ter-deploy di instalasi lain; laten di sini karena sync
     mati. Butuh keputusan sadar, bukan efek samping putaran ini.

  **Batas yang WAJIB dibaca.** Gerbang env yang kini melihat 173 variabel TETAP
  buta terhadap pembacaan terkomputasi (`process.env[prefix + suffix]`). Dan
  `EMAIL_ENABLED` default `false` + `APP_URL` default `http://localhost:4321`
  berarti **undangan Gelombang 4 ditulis lalu tak pernah terkirim**, dengan
  tautan menunjuk localhost — fitur mati bukan karena bug, tapi karena config.

  **Titik-lanjut.** Sisa rencana remediasi yang BELUM dikerjakan: gerbang yang
  menurunkan verb worker dari tiap deskriptor `generic` (kelas cacat ini sudah
  lolos DUA kali — `sql/091`, lalu `sql/106`), health/readiness yang benar-benar
  503 saat DB mati/migrasi drift, deskriptor retensi untuk `awcms_sessions` dkk,
  dan `/metrics`. Gelombang 5 (entitlement/SaaS) tetap berikutnya.

- **PUTARAN 11 Agustus 2026 (kelima) — GELOMBANG 4 SELESAI.** Tiga PR
  (#512/#513 + entri ini); nol PR terbuka. ADR-0082.

  **Undangan mendarat utuh dalam dua PR.** `awcms_invitations` +
  `awcms_invitation_policies` (`sql/106`, permission `sql/107`), lalu
  penerimaan. Undangan menyebut alamat dan membawa peran yang akan dipegang
  orang itu; peran itu **inert** sampai penerimaan memanggil `grantRolePolicy`,
  penulis yang sama dengan setiap grant lain — sehingga `activeRoleGrants`
  tidak pernah perlu tahu tabel ini ada, dan tak ada jalur grant kedua yang
  lahir.

  **Empat tempat rencana program tidak diikuti, semuanya dengan alasan yang
  diperiksa terhadap kode:**

  1. **Kolom scope ADA, tetapi DIPATOK** `CHECK (scope_type = 'tenant' AND
scope_id = tenant_id)`. Ini jawaban atas batas yang ADR-0080 tulis
     sendiri — PR yang menambahkan penulis grant ber-scope tak boleh mendarat
     tanpa menjawabnya — dan jawabannya adalah **menolak menjadi penulis itu**.
     Menghilangkan kolomnya juga dipertimbangkan: argumen "kolom yang diabaikan
     penulisnya berbohong" benar untuk kolom TAK-dibatasi, dan CHECK
     menghapusnya. Bentuk ADR-0078 dipertahankan, jadi pelebaran nanti satu
     `DROP`/`ADD CONSTRAINT`.
  2. **`resend` bukan action tersendiri.** Ia tidak ada di `AccessAction`, dan
     menambahkannya berarti menyatakan mengirim ulang adalah otoritas berbeda
     dari menerbitkan. Ia bukan — resend mencetak rahasia baru dengan daya yang
     sama, jadi digerbangi `create`.
  3. **Rate limit memakai `checkAuthRateLimit`, bukan `checkSharedRateLimit`
     telanjang** seperti tertulis di rencana. Rencana itu mendahului #447:
     header tenant adalah kunci yang bisa DIPILIH penyerang, dan
     `checkAuthRateLimit` memeriksa plafon per-SUMBER lebih dulu. Prosanya
     dikoreksi di ADR-0066 §C.
  4. **`approveRegistrationRequest` TIDAK diarahkan ulang ke
     `materializeMembership`.** Itu akan menjadikan PR penutup gelombang sebuah
     refactor self-registration + SSO, dan memerahkan
     `access-assignment-writers.test.ts` yang menyebut `self-registration.ts`
     sebagai pemanggil langsung `grantRolePolicy`. Konvergensinya milik
     Gelombang 7, yang memang menjadwalkannya.

  **Dua cacat ditemukan, keduanya oleh MENJALANKAN bukan membaca:**

  1. **Tautan undangan tak membawa tenant.** `buildInvitationUrl` hanya memuat
     `?token=` sementara kedua endpoint publiknya menuntut header
     `X-AWCMS-Tenant-ID` — tautannya menghasilkan halaman yang tak bisa
     melakukan panggilan yang menjadi alasan keberadaannya. Ditemukan saat
     MENULIS halamannya, bukan saat mereview penulisnya; 39 gerbang hijau
     selama itu, karena tak satu pun gerbang menghubungkan bentuk tautan dengan
     apa yang halamannya butuhkan.
  2. **Satu asersi test saya sendiri salah, ke arah yang benar.** Saya menuntut
     penerimaan konkuren yang kalah menjawab `identifier_taken`; ia menjawab
     `invalid` — ia menunggu kunci baris, membaca ulang baris ber-`status =
'accepted'`, dan **tak pernah sampai ke INSERT identity**. Itu jawaban
     yang lebih baik, dan ia milik kuncinya: menghapus `FOR UPDATE OF i`
     membuatnya MELEMPAR (23505 di tengah transaksi = 500 bagi orang yang
     menekan tombol dua kali).

  **Yang DITOLAK, dengan alasannya:**

  1. **Penerimaan menerbitkan sesi** — akan melangkahi kebijakan MFA tenant
     (`required_for_all` menghasilkan anggota ber-sesi penuh tanpa faktor
     kedua), `isPasswordLoginDisabledForIdentity` pada tenant SSO-only, dan
     rate limit login. Undangan mencetak AKUN; siapa boleh memegang sesi milik
     `/login`.
  2. **`410 Gone` untuk token kedaluwarsa** — memberi tahu pemegang token bahwa
     token itu PERNAH sah. 404 seragam untuk kelima kelas kegagalan.
  3. **Mengembalikan alamat di preview** — pemanggilnya tak terautentikasi.
     Pemegang tautan sah sudah membacanya di mailbox-nya; pemegang tautan
     CURIAN tidak.
  4. **`recipientTenantUserId` yang nullable pada `AuthNotificationPort`** —
     akan meninggalkan tiap pemanggil lama satu salah-ketik dari mengantre
     pesan tanpa tujuan. Operasi KEDUA sebagai gantinya.
  5. **`update` dan `delete` untuk undangan** — menyunting undangan yang sudah
     terkirim membuat tautan di inbox seseorang tak lagi cocok dengan yang
     di-review; menghapusnya menghancurkan satu-satunya catatan bahwa tawaran
     pernah dibuat.
  6. **Feature switch ala `AUTH_SELF_REGISTRATION_ENABLED`** — saklar itu ada
     karena registrasi adalah endpoint PUBLIK yang menulis baris untuk pemanggil
     anonim. Undangan hanya bisa diterbitkan pemegang permission, jadi tak ada
     permukaan untuk dilindungi saklar.
  7. **Deskriptor lifecycle tersendiri untuk `awcms_invitation_policies`** —
     purge `generic` menghapus murni menurut usia, jadi ia akan melucuti peran
     dari undangan yang masih pending dan menghasilkan penerimaan yang
     diam-diam tak memberi apa pun. `BOUNDED_BY_DESIGN` + `ON DELETE CASCADE`.

  **Gerbang yang tumbuh:** `BOUNDED_BY_DESIGN` 4 → 5 (plafonnya, dan kenaikan
  berikutnya harus lebih sulit — ADR-0081 sudah menuliskan itu);
  `NOT_YET_SCREENED` +4; `EXPECTED_PLATFORM_KEYS` +1; ledger rate limit 11 → 13
  dan 7 → 9. Permission 214 → 218.

  **Batas yang WAJIB dibaca.** `config:env:coverage:check` hanya mencocokkan
  `process.env.X` dan **buta** terhadap `env.X` yang dilewatkan sebagai
  parameter — batas yang gerbangnya catat sendiri di header. Tiga env undangan
  dituliskan TANGAN di `.env.example` karena itu. Config module berikutnya yang
  memakai pola `env: NodeJS.ProcessEnv = process.env` akan punya masalah yang
  sama, dan tak ada yang akan memberitahunya.

  **Titik-lanjut.** Gelombang 4 tuntas. Berikutnya **Gelombang 5**
  (entitlement/SaaS — mendarat INERT). Tiga hal yang masih menggantung dari
  gelombang sebelumnya dan belum dikerjakan: layar `/admin/invitations` (4
  permission di ledger), permukaan admin untuk grant ber-scope (dengan jawaban
  atas batas ADR-0080 — yang PR ini TUNDA, tidak selesaikan), dan keputusan
  lifecycle `delete` grup. #430 tetap Gelombang 7.

- **PUTARAN 10 Agustus 2026 (keempat) — GELOMBANG 3 SELESAI, dan tiga cacat
  hidup ditemukan sambil menutupnya.** Empat PR (#508/#509/#510 + entri ini);
  nol PR terbuka. ADR-0079, ADR-0080, ADR-0081.

  **Yang direncanakan adalah backfill. Yang ditemukan lebih besar.** PR 3.2
  (#506) memindahkan setiap PENULIS grant ke `awcms_access_policies`. **LIMA
  pembaca tidak ikut**, jadi untuk setiap tenant yang dibuat sesudah PR itu
  mereka menjawab tentang tabel yang tak ditulis siapa pun — dan tiap satunya
  salah dengan cara berbeda:

  1. `GET /api/v1/auth/session` melaporkan owner **tanpa satu pun peran**;
  2. `/admin/users` menampilkan setiap pengguna dengan daftar peran kosong;
  3. `TenantContext.roles` kosong → kebijakan ABAC `subject.roles` berhenti
     cocok. Yang `allow` itu penyempitan (aman); yang **`deny` menjadi INERT,
     yaitu PELEBARAN**;
  4. SoD berhenti melihat grant RBAC biasa dan melapor "tak ada konflik";
  5. guard `last_admin_blocked` menyimpulkan tenant tak punya administrator →
     **owner terakhir bisa dinonaktifkan**, tenant terkunci tanpa pemulihan
     in-app.

  **38 gerbang hijau selama itu**, `bun run check` lewat, test unit lewat —
  karena setiap satunya meng-assert sebuah pembaca terhadap **dirinya sendiri**.
  Tak ada yang menulis grant lewat penulis sungguhan lalu BERTANYA kepada para
  pembacanya. Itu bentuk test yang kini ada
  (`tests/integration/grant-readers.integration.test.ts`), dan mengembalikan
  satu pembaca ke tabel lama memerahkannya — diuji, bukan diklaim.

  **Cacat kedua, dan gerbangnya tak bisa melihatnya.** `awcms_setup` tak pernah
  diberi privilege pada tabel Policy, jadi setup wizard gagal
  `permission denied` di setiap deployment ber-`SETUP_DATABASE_URL` sejak #506.
  `checkWorkerSetupRoleGrants` memeriksa apakah grant COCOK dengan matriksnya —
  dan kedua sisi masih setuju satu sama lain. Tak ada yang memeriksa apakah
  matriksnya cocok dengan yang DIBUTUHKAN kode.

  **Cacat ketiga, ditemukan saat menulis test bukan saat membaca:** stub `tx`
  di `business-scope-facts-guard.test.ts` menjawab SETIAP statement dengan baris
  yang sama, jadi query kedua apa pun akan dijawab dengan baris query pertama.
  Assertion-nya tidak berubah; stub-nya yang berhenti berbohong.

  **Yang mendarat.** ADR-0079: `sql/103` menyalin setiap baris
  `awcms_access_assignments` ke Policy dengan **`id` dipertahankan**, lalu
  mencabut tulis; `UNION ALL` runtuh **di perubahan yang sama** karena baris
  lama dipertahankan sebagai sejarah, dan baris dipertahankan yang masih
  dihitung adalah grant yang tak bisa dicabut siapa pun. ADR-0080: kualifikasi
  scope, satu klausa yang **tidak punya cabang penghasil cakupan**, dibuktikan
  sebagai properti atas korpus plus assertion anti-hampa; kill switch
  **build-time** (dua instance tak boleh berbeda pendapat). ADR-0081: grup
  sebagai SUBJEK yang memberi PERAN, menjangkau setiap pembaca lewat **satu
  cabang** — imbalan ADR-0079, yang tanpanya PR itu harus menyentuh tujuh
  pembaca.

  **Tiga tempat rencana program tidak diikuti, semuanya dengan alasan yang
  diperiksa terhadap kode:**

  1. **PR 3.3 memensiunkan SATU tabel, bukan dua.**
     `awcms_business_scope_assignments.role_id` tidak memberi satu pun
     permission key hari ini, jadi memindahkannya akan memberi setiap subjek
     ber-scope peran itu **di seluruh tenant** selama scope belum dikualifikasi;
     dan `role_id`-nya nullable sedangkan tujuannya tidak.
  2. **`fetchGrantedPermissionKeys` tetap `Set<string>`**, bukan
     `{ keys, scopes }`. Peta itu akan menduplikasi apa yang sudah dijawab
     `resolveBusinessScopeFacts` dari sumber yang sama — dan dua turunan satu
     nilai adalah persis pelajaran ADR-0079.
  3. **Gerbang `access:sod-fact-parity:check` tidak dibangun.** ADR-0079 sudah
     menutup celahnya lebih rapat: pembaca tak lagi menyebut tabel grant sama
     sekali. "Merujuk konstanta yang sama" bisa benar sementara kedua query
     berbeda; "memakai fragmen yang sama" tidak bisa.

  **Yang DITOLAK, dengan alasannya:**

  1. **VIEW basis data sebagai definisi tunggal grant** — view pertama di repo
     ini harus menjawab `security_invoker` di perubahan yang sama, dan tanpanya
     ia berjalan sebagai PEMILIKNYA dan **melewati FORCE RLS** sementara setiap
     test RLS tetap hijau.
  2. **Menghapus baris lama alih-alih menyimpannya** — tabel kosong bukan
     sejarah, dan rujukan audit ke `id` akan mati.
  3. **Mencabut `SELECT` juga** — membuat sejarahnya tak terjangkau, bukan tak
     bisa diubah.
  4. **Menyaring grant ber-scope keluar dari `fetchGrantedPermissionKeys`** —
     gerbang RBAC berjalan lebih dulu, jadi jalur ber-scope jadi mustahil
     dijangkau dan grant ber-scope akan menolak segalanya termasuk di scope-nya
     sendiri.
  5. **Env var untuk kill switch scope** — dua instance dalam satu deployment
     bisa berbeda pendapat.
  6. **Grup memberi permission KEY langsung** — `subject.roles` kosong membuat
     kebijakan DENY inert; itu pelebaran yang tak diamati siapa pun.
  7. **Permission `user_groups.grant` tersendiri** — administrator grup yang
     juga bisa memberi peran ke grupnya sendiri bisa memberi `owner` ke grup
     yang ia anggotai.
  8. **`delete` untuk grup** — tiga keputusan yang belum dijawab (grant-nya,
     keanggotaannya, `external_id` yang besok disodorkan direktori lagi).
  9. **Menerima `source` dari request** saat membuat grup — pemanggil akan
     menyatakan grup tak-bisa-disunting tanpa direktori di belakangnya.
  10. **Mengaudit daftar anggota saat grant peran diberikan ke grup** — daftar
      itu berhenti benar begitu ada yang bergabung; yang diaudit GRUP-nya.

  **Dua gerbang tumbuh, dan keduanya karena permukaannya berubah, bukan karena
  gerbangnya rewel.** `RETIRED_TENANT_TABLE_PRIVILEGES` (kelas baru: tabel
  tenant-scoped yang sengaja read-only harus DIDEKLARASIKAN, ditegakkan dua
  arah), dan `GRANT_TABLES` bertambah dua nama grup — mengubah siapa yang ada di
  sebuah grup adalah mengubah otorisasi. Plafon `BOUNDED_BY_DESIGN` naik 3 → 5,
  dan menaikkan baris itu adalah tindakan yang direview: keempat entri satu
  argumen dalam dua paruh (tabel ber-grant + tabel yang dibatasi olehnya).

  **Batas yang WAJIB dibaca sebelum permukaan penulis grant ber-scope
  dibangun.** Kualifikasi scope hanya sekuat rute yang **menyatakan** required
  scope. `fetchGrantedPermissionKeys` tetap mengembalikan kunci dari semua grant
  — ia harus, karena gerbang RBAC berjalan lebih dulu — sehingga pada rute yang
  tak menyatakan scope, grant ber-scope memberi permission itu di seluruh
  tenant. Hari ini inert (nol penulis, di-assert terhadap basis data), tetapi PR
  permukaan admin **tidak boleh mendarat tanpa menjawabnya**.

  **Titik-lanjut.** Gelombang 3 tuntas. Berikutnya **Gelombang 4** (undangan —
  `awcms_invitations` + `awcms_invitation_policies`, undangan membawa
  Policy-nya). Dua hal yang harus ikut: permukaan admin untuk grant ber-scope
  (dengan jawaban atas batas di atas) dan keputusan lifecycle `delete` grup.
  #430 tetap Gelombang 7.

- **PUTARAN 10 Agustus 2026 (ketiga) — lima PR dependabot dibereskan, dua cacat
  review diperbaiki, GELOMBANG 3 SEPARUH JALAN.** Lima PR
  (#502/#503/#504/#505/#506 + entri ini); nol PR terbuka.

  **Lima PR dependabot digabung jadi dua, dan alasannya sama untuk keduanya:
  tak satu pun bisa hijau sendirian.** `codeql-action/init` dan `analyze`
  dipecah dependabot per-path, tetapi CodeQL menolak jalan dengan pasangan SHA
  yang tak sepadan — jadi PR yang pertama merge tetap merah SAMPAI yang kedua
  ikut, dan satu-satunya urutan yang hijau adalah satu PR (#502, bersama
  `attest-build-provenance` di kedua langkah `release.yml`). Astro dan
  `@astrojs/node` (#503) sama: `family:conformance:check` membandingkan manifes
  keluarga dengan `package.json` field demi field. Ikut mendarat: divergensi
  `astro-files-not-type-checked` menyatakan 42 berkas `.astro` (22.328 baris);
  sesungguhnya **44 (24.359)** — entri itu ada untuk mencatat BESARNYA paparan
  yang tak diperiksa `tsc`, jadi ringkasan yang mengecilkannya adalah
  satu-satunya kesalahan yang merugikan di sana.

  **Dua cacat dari review terhadap PR hari ini (#504), keduanya hijau di 38
  gerbang:**

  1. **`<tr hidden>` TIDAK tersembunyi di dalam tabel stacked.**
     `.data-table--stack tr { display: block }` (0,1,1) mengalahkan
     `[hidden] { display: none }` user-agent (0,1,0), jadi di ponsel panel sesi
     `/admin/users` tak pernah tertutup: tiap baris user menumbuhkan strip
     kosong permanen yang tak bisa ditutup tombol mana pun. Test regresinya
     menegakkan sifat UMUM untuk semua layar admin — dan draf pertamanya
     **dipuaskan oleh komentar CSS-nya sendiri**, sehingga mutasi yang MENGHAPUS
     perbaikannya tetap hijau. Kali keenam bentuk itu muncul di repo ini.
  2. **`POST /auth/password/change` membaca body di DALAM transaksi.**
     `await request.json()` menunggu KLIEN, jadi ia menahan koneksi pool
     tercadang berikut slot work-class-nya selama pemanggil memilih mengirim
     body-nya. Seam self-service kini punya `prepare`, sama bentuknya dengan
     `defineTenantRoute`.

  **Gelombang 3 separuh jalan.** [ADR-0078](adr/0078-a-grant-carries-its-own-scope.md):
  `sql/102` menurunkan `awcms_access_policies`, `fetchGrantedPermissionKeys`
  membaca kedua bentuk grant lewat `UNION ALL` (#505), dan setiap grant baru
  kini mendarat sebagai Policy (#506). 3.1 dan 3.2 mendarat sebagai **satu unit
  komitmen**, seperti yang dicatat putaran sebelumnya.

  **Tiga tempat rencana program tidak diikuti, semuanya ke arah "jangan kirim
  yang belum bisa dipakai":** `subject_type` hanya menerima `'tenant_user'`
  (`'user_group'` tiba bersama tabelnya); tipe kembalian
  `fetchGrantedPermissionKeys` **belum** menjadi `{ keys, scopes }` (field yang
  tak dibaca apa pun + sebelas call site teraduk di PR paling berisiko); dan
  gerbang `access:grant-readers:check` dipindahkan **keluar** dari PR 3.1
  (#500, putaran sebelumnya).

  **Yang DITOLAK, dengan alasannya:**

  1. **Dual write ke kedua tabel grant** — dua tulis yang bisa berhasil
     terpisah meninggalkan subjek yang memegang peran menurut satu tabel dan
     tidak menurut yang lain, tanpa cara menentukan mana yang benar. Itulah
     kegagalan yang dihindari ADR-0078 dengan memilih tabel ketiga.
  2. **Purge berbasis usia untuk kedua tabel Policy** —
     `executionMode: 'generic'` menghapus murni berdasarkan usia tanpa predikat
     status, jadi ia akan menghapus grant HIDUP; dan baris tercabut adalah
     satu-satunya yang menjawab "apakah orang ini punya akses Maret lalu".
     Keduanya masuk `BOUNDED_BY_DESIGN` (2 dari plafon 3) dengan mekanisme
     batasnya disebut.
  3. **`platform-bootstrap.ts` memanggil penulis bersama** — `tenant_admin`
     tidak boleh mengimpor kode aplikasi `identity_access`; DAG modul berjalan
     ke arah sebaliknya. INSERT-nya inline dan dipatok test penulis.
  4. **Menaikkan `TABLES_PREDATING_THE_RULE`** — ledger itu tertutup untuk
     tabel baru, dan memakainya berarti melewati pertanyaan yang gerbangnya
     ada untuk memaksa.

  **Empat gerbang memerah di #506 dan tiap satunya benar** — termasuk penanda
  "penulis" di `access-assignment-writers.test.ts` yang harus berubah DUA kali:
  tabelnya pindah, DAN sebuah berkas kini bisa menyebabkan grant tanpa memuat
  satu pun `INSERT`. Penanda yang cuma melihat INSERT akan diam-diam
  mempersempit aturan empat-penulis jadi dua, dan `user-admin.ts` — pembawa
  penolakan system-role utama repo ini — akan keluar dari aturannya.

  **Satu cacat ditangkap CI, bukan lokal:** FK komposit `awcms_access_policies`
  → `awcms_roles` memerahkan teardown dua suite e2e ber-DB yang menghapus role.
  Lokal suite itu sudah merah karena artefak harness, jadi sinyalnya hanya
  terbaca di CI.

  **Titik-lanjut.** Gelombang 3 PR **3.3** — backfill baris lama ke Policy
  (mempertahankan `id` agar rujukan audit selamat), lalu
  `REVOKE INSERT,UPDATE,DELETE … FROM awcms_app` pada dua tabel lama sehingga
  keduanya menjadi sejarah read-only. Oracle ekuivalensi dijalankan **sekali
  lagi sesudah** backfill. Sesudah itu 3.4 (kualifikasi scope, kill switch
  build-time) dan 3.5 (User Groups). #430 tetap Gelombang 7.

- **PUTARAN 10 Agustus 2026 (lanjutan) — GELOMBANG 2 SELESAI, prasyarat
  Gelombang 3 mendarat.** Lima PR (#496/#497/#498/#499/#500 + entri ini).
  Permukaan sesi & kredensial dari
  [program model keanggotaan](awcms/program-model-keanggotaan-2026-08-09.md)
  lengkap; #430 dan #423 tetap terbuka secara sadar.

  **Yang mendarat.** `GET`/`POST /api/v1/users/{id}/sessions[/revoke-all]`
  (dua izin `user_sessions`, `sql/101`, plus panel sesi di `/admin/users`);
  `POST /api/v1/auth/sessions/revoke-all`; `POST /api/v1/auth/password/change`.
  Bersama PR 2.1 (#491) itu seluruh isi Gelombang 2. Plus gerbang ke-38
  `access:grant-readers:check` (#500) — prasyarat Gelombang 3, dijelaskan di
  bawah.

  **Gerbang ke-38 dipindahkan KELUAR dari PR 3.1.** Rencana menempatkan
  `access:grant-readers:check` di dalam PR paling berisiko di seluruh program.
  Ia mendarat sendiri, lebih dulu, atas argumen yang sama yang menempatkan
  `access:decision-log:coverage:check` sebelum cabang deny yang dijaganya:
  gerbang yang harus hijau HARI INI paling murah ditambahkan hari ini, dan
  daftar yang ditulis SESUDAH perubahan berisiko ditulis orang yang sudah punya
  alasan memendekkannya. Hasilnya: **sebelas** berkas menyebut tabel grant, tiga
  di antaranya DI LUAR `identity_access` — termasuk satu RUTE
  (`access/policies/simulate.ts`) yang merakit join-nya sendiri untuk
  mensimulasikan ABAC, sehingga pratinjau sebuah policy bisa berbeda dari
  perilakunya di produksi. Tak satu pun melanggar gerbang yang sudah ada:
  semuanya menjangkau tabelnya lewat template SQL, bukan impor, jadi DAG modul
  tak punya pendapat dan `modules:table-writes:check` hanya mengatur TULIS.

  **Tiga koreksi terhadap rencana, masing-masing terverifikasi terhadap kode:**

  1. **Pemecahan izin `user_sessions` TERBALIK dari yang diduga.** Rencana
     mengutip alasan `machine_credentials` ("yang bisa membunuh kredensial bocor
     tanpa bisa mencetaknya"). Di sini sumbunya lain: hanya satu dari keduanya
     MENGUNGKAPKAN sesuatu. `read` adalah jendela permanen ke gerak-gerik
     kolega; `revoke` menghancurkan akses dan mengembalikan angka. Jadi yang
     dibeli adalah `revoke` **tanpa** `read` — responder insiden tanpa
     pandangan ke pergerakan semua orang.
  2. **Flag `?exceptCurrent=true` TIDAK dibangun.** Nilai satunya juga
     mengakhiri sesi yang sedang meminta, dan itu `POST /auth/logout` — yang
     JUGA membersihkan cookie yang tak bisa dilihat rute itu. Default yang tak
     boleh dibalik lebih jujur ditulis sebagai tiadanya parameter.
  3. **Step-up aal2 pada ganti password mendarat BERSYARAT.** `requireStepUp`
     menolak setiap sesi yang tidak sedang `aal2`, dan orang tanpa faktor
     terdaftar tak akan pernah bisa mencapainya — tanpa syarat, setiap pengguna
     tanpa MFA permanen tak bisa mengganti passwordnya, dan yang paling butuh
     justru yang baru tahu passwordnya bocor. Jebakan ADR-0058 §E berbaju lain.
     Mutasi `if (mfa.enabled)` → `if (true)` memerahkan 4 test.

  **Temuan tentang #430 yang mengubah nilainya.** Mitigasi sementara yang
  diusulkan issue-nya sendiri — kunci rate-limit `(ip, login_identifier)` alih-alih
  `(ip, tenant, identifier)` — **sudah tertutup** oleh plafon per-SUMBER yang
  mendarat di #447: `auth-source:${clientIp}` berlaku lintas SEMUA rute auth dan
  tak peduli tenant, jadi rotasi header sudah dibatasi di sana. Docblock
  `auth-rate-limit.ts` bahkan mengoreksi #430 secara langsung ("not 'bound N
  times looser', as issue #430 described, but not bound"). Yang TERSISA di #430
  adalah penghitung lockout di basis data (N × `maxFailedAttempts` sebelum satu
  akun terkunci) dan asimetri MFA per-tenant — keduanya hanya ditutup principal
  global.

  **Yang DITOLAK, dengan alasannya:**

  1. **Menumbuhkan ledger `NOT_YET_SCREENED` untuk dua izin baru** — layar
     `/admin/users` sudah ada dan merupakan rumah alaminya; permukaan tanpa
     layar adalah persis kelas utang yang ledger itu ada untuk menghitung.
  2. **Menolak target = diri sendiri pada revoke-all admin (409)** — lebih
     sederhana, tetapi meninggalkan celah sampai PR 2.3 mendarat dan memaksa
     operator menghafal asimetri. `token_hash <> caller` inert untuk target lain,
     jadi gratis.
  3. **Mengaudit revoke-all SELF-SERVICE** — jejak audit mencatat apa yang
     dilakukan administrator terhadap ORANG LAIN; mencatat tiap pembersihan
     sendiri memenuhi jejak yang dibaca investigator dengan orang yang bertindak
     atas dirinya sendiri.
  4. **Membersihkan lockout pada revoke-all self-service** — orang yang
     membereskan sesi liar belum membuktikan apa pun tentang kredensialnya;
     menyatukannya menjadikan kebersihan sesi sebuah oracle reset lockout.
     (Ganti password MEMBERSIHKANNYA, karena di sana kredensialnya dibuktikan.)
  5. **Menyatukan `revoke-all` self-service dan admin jadi satu endpoint
     ber-parameter opsional** — subjeknya berbeda (bearer vs URL), gerbangnya
     berbeda (nol izin vs dua), auditnya berbeda. Satu rute dengan tiga
     percabangan itu adalah tiga rute yang berbagi bug.

  **Perubahan seam.** `defineTenantRoute` kini menyerahkan `tokenHash` ke
  handler-nya — nilainya sudah dihitung seam untuk `authorizeInTransaction`, dan
  menurunkannya kedua kali di dalam rute adalah cara dua turunan satu nilai mulai
  berbeda pendapat. Penambahan murni, nol call site berubah.

  **Titik-lanjut — dan satu batasan urutan yang WAJIB dibaca dulu.** Berikutnya
  Gelombang 3 (bentuk Policy Cloudflare — `awcms_access_policies`, User Groups,
  kualifikasi scope), **risiko tertinggi di program**. Kedua prasyaratnya sudah
  terpenuhi dan keduanya diverifikasi, bukan diasumsikan: Gelombang 1 tuntas
  (32/32 layar `src/pages/admin/**/*.astro` memakai `loadAdminScreen`,
  `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` KOSONG), dan gerbang pembaca grant sudah
  mengunci daftar pembacanya.

  **PR 3.1 tidak boleh mendarat sendirian.** Ia menurunkan tabel
  `awcms_access_policies` yang KOSONG dengan reader `UNION ALL` — sengaja, supaya
  oracle ekuivalensinya bisa membuktikan hasilnya identik dengan hari ini. Tapi
  berhenti di situ meninggalkan tabel yang tak ditulis siapa pun, yaitu **persis
  cacat yang putaran sebelumnya HAPUS** di #477 (`awcms_sync_outbox`). Jadi 3.1
  dan 3.2 (para penulis grant + `POST /api/v1/access/policies`) adalah satu unit
  komitmen, bukan dua PR yang kebetulan berurutan — dan kalau hanya ada ruang
  untuk satu, jangan mulai.

  #430 tetap Gelombang 7.

- **PUTARAN 10 Agustus 2026 (analisis isu) — #477 ditutup dengan MENGHAPUS
  tabelnya, sensus #430 dilengkapi, Gelombang 2 dimulai.** Empat PR
  (#487/#490/#491 + entri ini); satu issue ditutup (#477); dua tetap terbuka
  secara sadar (#430, #423).

  **#477 — pertanyaannya bukan "bagaimana mengisinya".**
  [ADR-0077](adr/0077-one-outbox-sync-pull-reads-domain-events.md): `awcms_sync_outbox`
  dihapus (`sql/099`), `/sync/pull` membaca `awcms_domain_events`. Perilakunya
  tidak berubah — tetap `200` dengan daftar kosong — yang berubah **kenapa**:
  dari "tak ada jalur" menjadi "`SYNC_REPLICABLE_EVENT_TYPES` kosong".

  Allow-list itu kosong karena **mekanismenya belum benar**, dan itu hasil
  paling berharga dari issue-nya: `event_sequence` diberikan saat `INSERT`
  tetapi terlihat saat `COMMIT`, jadi cursor `event_sequence > checkpoint` bisa
  **melewati** event yang commit-nya terlambat — dorman di tabel lama karena nol
  penulis, NYATA di `awcms_domain_events`. Repo ini sudah punya jawaban yang
  benar dan bukan cursor: `appendDomainEvent` menulis baris pengiriman per
  consumer **di transaksi yang sama**.

  **#430 — sensusnya mengklaim sesuatu yang salah.** `looksLikeEmail` (sensus)
  dan `isMailableLoginIdentifier` (jalur reset password) adalah dua himpunan
  berbeda: `a@localhost` bukan email menurut sensus tetapi **bisa** dikirimi
  surat. Predikat otoritatifnya kini **diimpor**, bukan disalin, dan kategori
  ketiga (`not_mailable`) dilaporkan terpisah.

  **Gelombang 2 PR 2.1 mendarat** (#491): `GET`/`DELETE /api/v1/auth/sessions`,
  **nol permission baru**, plus tiga kolom sidik jari (`sql/100`). Detail yang
  tak ada di rencana: `hashClientIp` memakai kunci acak per-proses tanpa
  `AUTH_IP_HASH_SECRET` — dapat ditoleransi untuk audit, TIDAK untuk kolom
  persisten, jadi `persistableClientIpHash` mengembalikan `null` alih-alih hash
  yang tak bisa dibandingkan sesudah restart.

  **Empat koreksi terhadap rencana Gelombang 2**, diverifikasi terhadap kode:
  penerbit sesi ada **dua** `INSERT` lewat **lima** entry point (bukan "tiga
  penerbit"); `summarizeUserAgent` butuh `Request` sehingga tiap penerbit
  menghitung sendiri lalu mengoper; `access:permissions:enforcement:check`
  berskor **208/208** (bukan 203/203); dan `origin_auth: 'switch'` +
  `switchable` **nol produsen** hari ini, jadi keduanya belum mendarat.

  **Yang DITOLAK, dengan alasannya:**

  1. **Memberi `awcms_sync_outbox` sebuah produsen** — repo ini sudah punya
     outbox transaksional; outbox kedua yang tak pernah tersambung sebaiknya
     dihapus, bukan diisi.
  2. **Mengisi allow-list replikasi dengan satu event "untuk membuktikan
     mekanismenya"** — mekanismenya belum benar, dan satu entri akan
     mendaratkan kehilangan event yang senyap dan permanen.
  3. **Bucket rate-limit ketiga ber-key identifier untuk menutup #430 lebih
     awal** — varian yang benar-benar menutupnya (key identifier-SAJA) memberi
     penyerang anonim tuas menahan satu manusia tertolak login di SEMUA tenant,
     yaitu keberatan yang PERSIS sama yang sudah dicatat menolak tabel lockout
     global; varian yang aman `(ip, identifier)` nyaris inert di atas plafon
     per-sumber #448 dan membeli KESAN bahwa #430 sudah ditangani.
  4. **`last_seen_at` pada `awcms_sessions`** — satu UPDATE per request per sesi
     di jalur baca otorisasi, selamanya, untuk kolom kosmetik.
  5. **Nilai `switch` di CHECK `origin_auth`** — CHECK yang memuat nilai yang
     tak bisa diproduksi apa pun terbaca sebagai kapabilitas yang sudah ada.

  **Titik-lanjut.** Gelombang 2 PR 2.2 (permukaan admin untuk sesi orang lain —
  `read` dan `revoke` sebagai DUA permission terpisah), lalu Gelombang 3
  (bentuk Policy). #430 tetap Gelombang 7; angka yang menentukan besarnya
  (`principalsSpanningMultipleTenants`) baru bisa diukur dengan menjalankan
  sensusnya terhadap data produksi — lokal nol tenant, nol identitas.

- **PUTARAN 10 Agustus 2026 (lanjutan) — kedua pemblokir #468 diputuskan, #468
  ditutup, dan satu cacat konkurensi ditemukan sambil jalan.** Empat PR
  (#482/#484/#485 + entri ini), dua issue ditutup (#468, #483), satu issue baru
  difile (#483) dari temuan yang tidak diminta siapa pun.

  **Yang diputuskan, dan kenapa keduanya butuh jawaban berbeda.**
  `TABLES_PREDATING_THE_RULE` tidak bisa membedakan tabel yang **belum**
  dideskripsikan dari yang **tidak bisa**; keduanya satu baris, dan selama
  begitu hitungannya berhenti bisa dibaca sebagai utang.
  `awcms_edge_cache_purges` (#479) mendapat registry kedua ber-`ownerPath`
  ([ADR-0076](adr/0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)),
  dengan `ownerOfFile()` — fungsi yang sama yang dipakai
  `modules:table-writes:check` — sebagai penentu siapa boleh ada di sana;
  `awcms_sync_outbox` (#477) pindah ke `BOUNDED_BY_DESIGN` sebagai entri
  pertamanya, satu-satunya yang premisnya diperiksa mesin.

  **Satu premis issue sendiri ternyata keliru.** #479 menulis bahwa tak ada yang
  menghapus `awcms_edge_cache_purges`; `bun run edge-cache:purge` sudah
  memangkas baris `done` sejak ADR-0042. Yang hilang adalah kemampuan
  MENYATAKANNYA. Koreksi itu mengubah bentuk keputusannya — dari "tulis purge"
  menjadi "beri kontraknya cara menyebut pemilik non-modul".

  **Temuan yang tak diminta: lockout login bukan atomik** (#483). Jalur password
  memakai read-modify-write di JS, jadi K percobaan gagal PARALEL berbiaya SATU
  increment — diukur terhadap PostgreSQL nyata: empat percobaan → penghitung
  `1`. Lebih buruk dari cacatnya: **empat dokumen menyatakannya "atomik di DB"**,
  salah satunya menamai persis bentuk yang seharusnya dihindari, dan
  `rate-limit.ts` menyandarkan postur fail-open Redis-nya pada kalimat itu.
  Semua diperbaiki, dan kini menyebut statement-nya alih-alih kata "atomik".

  **Gerbang yang hijau di atas jawaban yang salah, dua kali.**
  `checkLoginLockoutImplemented` (severity `critical`) hanya memanggil fungsi
  murni — hijau dua tahun di atas lockout yang bisa ditahan di satu; kini ia
  memeriksa mekanismenya. Dan seluruh test lockout murni domain, **nol**
  menaikkan penghitung lewat rute nyata, jadi suite-nya tidak akan pernah
  melihat cacat itu maupun perbaikannya.

  **Yang DITOLAK, dengan alasannya:**

  1. **Melonggarkan `ownerModuleKey` menjadi opsional** — menghemat satu berkas
     dan membuat setiap deskriptor modul kehilangan penjagaannya: deskriptor
     yang LUPA menyebut pemilik berhenti jadi kesalahan dan mulai berarti
     "infrastruktur". Kesalahan ketik menjadi klaim kepemilikan.
  2. **Menetapkan `awcms_edge_cache_purges` ke salah satu dari tiga modul
     penulisnya** — sudah ditolak putaran sebelumnya; tetap ditolak.
  3. **Menjadikan `src/lib/edge-cache/` sebuah modul** —
     [ADR-0043](adr/0043-lib-boundary-and-module-presentation-layer.md) memerahkan
     namespace `src/lib/<x>/` yang bertabrakan dengan `moduleKey`, dan
     `scripts/module-job-registry-check.ts` sudah menolak "buat modul demi
     kenyamanan dokumentasi" untuk tabel yang sama. Tetap terbuka sebagai
     keputusan arsitektural, bukan sebagai cara menghijaukan gerbang.
  4. **Tabel lockout GLOBAL tanpa RLS untuk menutup #430 lebih awal** — ia
     memberi penyerang senjata yang hari ini tidak ada: mengunci satu manusia
     dari SEMUA tenant, dari konteks tenant mana pun, tanpa endpoint unlock dan
     dengan password reset yang hanya membersihkan `awcms_identities`. #430
     menunggu Gelombang 7, dan sensus `identity:principals:preflight` yang
     menentukan besarnya pengganda nyata belum dijalankan pada data produksi.
  5. **Mengubah deskripsi operasi `/sync/pull` di OpenAPI** — snapshot kontrak
     pra-migrasi beku dan mewajibkan tiap path byte-identical. Notice-nya
     dipindah ke deskripsi TAG, yang tidak dibekukan dan justru ter-render ke
     `awcms/api-reference.md`.
  6. **Menyunting `awcms/repo-assessment-2026-08-04.md`** yang mengulang klaim
     "atomik" — ia catatan bertanggal, dan menyunting temuan lama adalah
     memalsukan rekaman.

  **Titik-lanjut.** Gelombang 1 program model keanggotaan **SUDAH TUTUP** (#450,
  33 layar, dua ledger nol) — dokumen programnya dikoreksi di PR ini karena ia
  masih menjanjikan helper bernama `defineAdminScreen` yang tidak pernah ada.
  Berikutnya **Gelombang 2** (permukaan sesi & kredensial). #477 tetap terbuka
  untuk keputusan sambung-atau-pensiunkan; #430 terjadwal Gelombang 7.

- **PUTARAN 10 Agustus 2026 — program notifikasi push (#463) tuntas, retensi
  outbox 4 dari 6, SSE mendarat dengan ADR-nya.** Dua belas PR, semuanya
  ter-merge; lima issue ditutup (#464, #465, #466, #467, sebagian #468) dan tiga
  issue baru difile karena temuannya bukan pekerjaan yang tersisa melainkan
  keputusan yang belum diambil.

  **Kenapa daftarnya ada DI SINI.** Aturan yang sama dengan dua putaran
  sebelumnya: daftar yang tidak ditulis ke repo harus diturunkan ulang, dan
  menurunkan ulang berharga satu audit penuh sementara menuliskannya berharga
  satu paragraf. Penolakan ikut tertulis, karena penolakan yang tidak tercatat
  akan diusulkan lagi.

  **Apa yang mendarat.** Modul `push_delivery` lengkap: outbox KEDUA ber-lease
  (ADR-0074), adapter FCM HTTP v1 dan Web Push/VAPID tanpa satu dependensi baru,
  lima endpoint, service worker same-origin, dan konsol
  `/admin/push-notifications` — modul berpindah `experimental` → `active` hanya
  setelah konsolnya ada, karena ADR-0021 kriteria 1 menolak modul `active` tanpa
  layar admin tanpa pengecualian. Lalu retensi untuk empat tabel outbox
  (`email` ×2, `object_sync_queue`, `domain_event_deliveries`), semuanya
  `delegated`. Lalu SSE dengan ADR-0075.

  **Enam hal yang hanya ketahuan dengan MENJALANKAN, bukan membaca**, dan itulah
  isi putaran ini yang paling layak diingat:
  - **`bun run check` hijau penuh dengan migrasi yang tidak bisa apply.**
    `ADD CONSTRAINT … UNIQUE (tenant_id, id)` ditaruh sesudah tabel anak yang
    mereferensikannya. Ke-37 gerbang lewat; hanya `db:migrate` terhadap Postgres
    nyata yang menunjukkannya.
  - **`isBlockedAddress` gagal-tertutup untuk apa pun yang bukan literal IP.**
    Dipanggil langsung untuk memvalidasi endpoint push, ia menolak SETIAP push
    service nyata — pendaftaran akan mustahil, dengan pesan error yang menyebut
    alamat privat.
  - **Urutan pemetaan error FCM terbalik terhadap docblock-nya sendiri.**
    `status === 401` diperiksa sebelum kode error, jadi `THIRD_PARTY_AUTH_ERROR`
    dilaporkan sebagai token kedaluwarsa.
  - **`withTenant` MENGEMBALIKAN `Response` saat pool menolak, bukan melempar.**
    Rancangan pertama loop SSE hanya punya `catch`, yang berarti jalur penolakan
    utama terlewat.
  - **`awcms_sync_outbox` punya NOL produsen** (#477) dan
    **`awcms_edge_cache_purges` dimiliki infrastruktur, bukan modul** (#479).
    Keduanya terlihat seperti tabel yang BELUM dapat deskriptor retensi; keduanya
    sebenarnya tabel yang TIDAK BISA — dan perbedaan itu tak terlihat dari ledger.
  - **`check:docs` buta terhadap dokumen baru.** Ia membaca `git ls-files`, yaitu
    index, jadi ADR-0075 lolos lokal dengan tautan rusak lalu memerahkan CI.
    Hijau lokal lalu merah di CI adalah kegagalan gerbang: ia melatih orang untuk
    tidak mempercayai run lokalnya. Ditutup di PR yang sama.

  **Yang DITOLAK, dengan angkanya, supaya tidak diusulkan ulang:**
  - **SDK FCM Web** (ADR-0074 §Yang DITOLAK) — 45.041 B halaman + 46.292 B
    service worker melawan plafon 21.000 B per berkas, dan tiga origin pihak
    ketiga melawan CSP yang mengunci nol (ADR-0029). Web Push/VAPID memberi hasil
    sama dengan **10.174 B** total dan **nol** origin baru.
  - **TTL koneksi pendek + reconnect** sebagai alternatif re-otorisasi per-tick
    (ADR-0075) — ia memindahkan pertanyaannya alih-alih menjawabnya, dan menukar
    satu angka yang harus dijaga konsisten dengan dua.
  - **Permission `push_delivery.subscriptions.*`** — mendaftarkan perangkat
    sendiri adalah self-service; permission untuknya adalah tembok di depan
    fiturnya, dan aksi yang tak di-seed menolak semua orang termasuk owner
    (jebakan latent-authz, ADR-0058 §E).
  - **Menetapkan `awcms_edge_cache_purges` ke salah satu dari tiga modul yang
    menulisnya** supaya gerbangnya hijau — deskriptor yang menyebut pemilik yang
    salah adalah klaim palsu yang terbaca sebagai keputusan.
  - **Deskriptor retensi untuk `awcms_sync_outbox`** — fiksi dua kali (predikat
    status yang tak pernah cocok, pada tabel yang tak bisa tumbuh) dan ia akan
    mengeluarkan tabel itu dari ledger, yaitu dari pandangan siapa pun.

  **Yang tersisa dari putaran ini:** #468 menunggu keputusan #477 dan #479
  sebelum bisa ditutup; keduanya keputusan produk/arsitektur, bukan pekerjaan
  yang tinggal dikerjakan.

- **PUTARAN REKOMENDASI 9 Agustus 2026 — program model keanggotaan
  (Cloudflare-shape). Rancangan penuh:
  [`awcms/program-model-keanggotaan-2026-08-09.md`](awcms/program-model-keanggotaan-2026-08-09.md).**
  Pemetaan dua sisi terhadap dokumentasi Cloudflare _Manage members_ + _Tenant
  API_ memberi jawaban yang tidak diduga: **mesin otorisasi repo ini lebih kuat
  daripada milik Cloudflare** (ABAC deny-overrides, SoD, FORCE RLS, decision log,
  37 gerbang — Cloudflare tidak punya satu pun dari keempat yang pertama). Yang
  hilang adalah **bentuk keanggotaannya** — lapisan yang membuat sebuah sistem
  bisa dijual sebagai layanan. ±43 PR atomic dalam 9 gelombang.

  **Sembilan temuan terverifikasi yang membentuk rancangan.** Yang paling
  menentukan, karena masing-masing membatalkan satu pendekatan "jelas":
  - **184 berkas rute memanggil `authorizeInTransaction` langsung** (255 total;
    hanya 16 lewat `defineTenantRoute`) — jadi setiap input baru wajib lewat bag
    `options?`, tidak pernah parameter posisional.
  - **`scripts/access-chokepoint-check.ts` mengunci literal
    `fetchGrantedPermissionKeys(`.** Mengganti nama fungsi itu membuat gerbang
    **hijau sambil buta** — kelas cacat yang sudah dicatat R9 di bawah. Nama
    dipertahankan; tipe kembaliannya yang berubah.
  - **`awcms_tenants.status='suspended'` tidak pernah ditegakkan di luar login.**
    Situs publik tenant langsung mati, tapi sesi admin yang sudah terbit tetap
    penuh akses sampai kedaluwarsa sendiri, dan machine credential tidak
    tersentuh. Asimetri ini adalah cacat hidup, dan menutupnya nyaris gratis.
  - **Lockout login per-`(tenant, email)`** — merotasi header
    `x-awcms-tenant-id` memberi penyerang N × `AUTH_LOGIN_MAX_ATTEMPTS` terhadap
    manusia yang sama. Principal global memperbaikinya, bukan membebaninya.
  - **`awcms_business_scope_assignments` (`sql/027`) sudah memiliki setiap kolom
    yang dibutuhkan sebuah Policy Cloudflare** — ia tabel Policy yang kebetulan
    hanya pernah diarahkan ke satu jenis subjek. Dan cakupannya hari ini
    **permission-agnostic**: ia bertanya "punya scope fact yang mencakup?",
    tidak pernah "untuk permission INI". Menutupnya adalah perubahan satu klausa
    yang hanya bisa menolak lebih banyak.
  - **`awcms_abac_decision_logs` tanpa retensi apa pun** (~8,6 juta baris/hari
    @100 rps) **dan** menjadi sumber cursor proyeksi `reporting` yang
    deskripsinya menyebutnya "never deleted". Retensi dan otoritas proyeksi
    adalah **satu** keputusan. Tambahan: `sql/022` hanya memberi `awcms_worker`
    SELECT, jadi job purge hari ini tidak akan bisa menghapus apa pun.

  **Empat keputusan yang mengunci cakupan:** (1) target **principal global**,
  dieksekusi sebagai pengangkatan otoritas yang tidak memindahkan satu foreign
  key pun; (2) Cloudflare dipakai sebagai **MODEL, bukan target integrasi** —
  Tenant API partner tidak dibangun; (3) lapisan komersial **penuh** termasuk
  partner/EaaS; (4) mulai dari **Gelombang 0**.

  **Gelombang 0 — SELESAI, sepuluh PR mendarat (epic #423).** Tidak ada yang
  melebar; semuanya mengetatkan. Tiap PR ber-`bun run check` PENUH hijau:

  - **#433** (#424) — `api:tenant-route:check` mendapat `SCAN_ROOTS`, jadi ia
    melihat `src/pages/admin/**/*.astro` juga. **32** layar diseed ke ledger,
    bukan 31: issue-nya salah hitung karena `src/pages/admin/tenant/domains.astro`
    bersarang satu tingkat dan luput dari `ls src/pages/admin/*.astro`. Penjaga
    nol-berkas menjadi **per-root** — root yang tak menemukan satu berkas pun
    adalah gerbang buta, bukan gerbang yang lulus.
  - **#434** (#425) — asersi `ownershipGrant` menjadi struktural (tepat satu
    `allowed: true`, indeksnya > indeks `evaluateAccess(`), dan gerbangnya
    menolak `deciding.length === 0`. Sebelumnya ia bisa melaporkan "0 handler
    memutuskan permission" lalu keluar 0.
  - **#435** (#426) — gerbang baru `access:decision-log:coverage:check` (rantai
    36 → 37 segmen). **Dominansi leksikal, bukan regex urutan**: log yang
    tekstual lebih awal tetapi duduk di cabang saudara tidak dihitung.
  - **#436** (#427, **ADR-0072**) — `sql/091` memberi `awcms_worker` hak
    `DELETE`; deskriptor retensi 365 hari. Sengketa otoritas proyeksi
    diselesaikan di dokumen yang sama: inkremental otoritatif sepanjang-masa,
    rebuild otoritatif **sejak horizon retensi**.
  - **#439** (#429, **ADR-0073**) — `suspended` ditegakkan di chokepoint untuk
    sesi DAN machine credential, plus satu baris di `resolveSsrContext` yang
    mencakup ke-32 layar. `sql/092`.
  - **#440** (#430) — `identity:principals:preflight`. **Sensus, bukan
    perbaikan**: #430 tetap terbuka sampai Gelombang 7.
  - **#441** (#431) — R8 **DITUTUP**, dan **tanpa migrasi**: batasannya tentang
    tenant mana yang boleh memegang permission platform, bukan tentang role.
  - **#443** (#442) — `scripts:inventory:check` membandingkan blok ter-generate,
    bukan hanya barisnya. Ditemukan **saat merge gelombang ini**: dua PR
    menuliskan kalimat hitungan yang identik dari base berbeda, git menggabungkan
    barisnya dan membiarkan kalimatnya — blok separuh-benar tanpa satu pun
    konflik. Gerbang lama meliputi tepat bagian yang git tidak bisa salah gabung.
  - **#444** (#438) — IP klien rate limit dihitung dari **kanan**
    `X-Forwarded-For` (`TRUSTED_PROXY_HOP_COUNT`, default 1). Di belakang proxy
    yang MENAMBAH — yaitu profil nginx produksi repo ini — entri paling kiri
    adalah apa pun yang diketik penyerang.

  **Dua koreksi terhadap rencananya sendiri, dicatat karena keduanya menghemat
  pekerjaan.** Index `(tenant_id, created_at)` MENAIK untuk purge tidak jadi
  ditulis (btree PostgreSQL bisa dipindai mundur — index `DESC` `sql/005` sudah
  melayaninya; index kedua hanya menambah beban tulis pada tabel paling sering
  ditulis di repo). Kolom `attachable_scope_types`/`permission_scope` per-role
  untuk R8 juga tidak (ia akan inert — kelas cacat yang sama dengan yang
  ditutupnya).

  **Dan satu issue yang saya salah tulis:** #428 melaporkan `identity_access`
  mengimpor `resolveClientIp` dari `visitor-analytics` — pelanggaran ADR-0011.
  Verifikasi menemukan **nol** pelanggaran: `resolveClientIp` sudah di
  `src/lib/security/`, dan `resolveAnalyticsClientIp` hanya diimpor rute modulnya
  sendiri. Temuan itu lahir dari `grep -rl` atas dua nama mirip. Ditutup sebagai
  premis salah, diganti #438 — yang menemukan hal lebih penting.

  **Dua PR sesudahnya, dan keduanya lahir dari MEMERIKSA issue yang tersisa —
  bukan dari mengerjakannya.**

  - **#446** (#437) — gerbang `data-lifecycle:table-coverage:check` (rantai
    37 → 38). Rencananya meminta gerbang atas tabel VOLUME-TINGGI yang daftarnya
    diturunkan. Tiga turunan dibangun dan diukur, dan **ketiganya gagal**:
    append-only di sumber (46 tabel — `ON CONFLICT DO UPDATE` terbaca sebagai
    append), tanpa jalur hapus (94 — repo ini memakai `ON DELETE CASCADE` di
    satu migrasi saja), tak-terbatas menurut skema (121 dari 128 — tabel
    terbatas berkunci pada teks terkurasi). Gerbang yang pengecualiannya 90%
    skema adalah daftar tulis-tangan yang menyamar. Jadi pertanyaannya diganti:
    turunkan bahwa sebuah tabel **ada**, lalu buat kewajibannya mustahil
    dilewati. 114 tabel lama duduk di ledger yang hanya boleh menyusut dan
    panjangnya dipatok test; tabel baru wajib membawa deskriptor atau
    pengecualian beralasan.
  - **#448** (#447) — plafon rate limit per-SUMBER untuk tujuh rute auth publik.
    Ditemukan saat memeriksa #430, dan **lebih tajam dari #430**: kunci bucket
    adalah header `x-awcms-tenant-id` mentah, jadi ia dipilih penyerang dan
    limiternya tidak mengikat sama sekali — sementara tiap request yang lolos
    tetap membayar argon2id `m=64MB`. Terbukti inert pada satu tenant, sehingga
    mendarat tanpa flag. Rutenya ternyata **tujuh, bukan enam**; test
    strukturalnya yang menemukan yang ketujuh setelah enam pertama dikonversi
    tangan.

  **#430 menyusut, dan salah satu premisnya ternyata terlalu lunak.** Ia menulis
  "N × `AUTH_LOGIN_MAX_ATTEMPTS`"; efek sebenarnya bukan pengali melainkan
  pencabutan limiter (#447). Dua dari tiga sumbu penggandaan kini tertutup —
  rotasi `X-Forwarded-For` (#444) dan rotasi header tenant untuk bucket rate
  limit (#448). Yang tersisa persis satu: penghitung **lockout** per-`(tenant,
email)`, yang tidak bisa dibuat global tanpa `awcms_principals`. Ditambal
  dengan penghitung Redis? Sengaja tidak — `checkSharedRateLimit` **fail-open**
  saat Redis bermasalah, jadi kontrolnya akan mati justru saat dibutuhkan.
  Gelombang 7 PR 7.2.

  **Ditolak, dan penolakannya adalah bagian dari hasil.** Membangun modul
  provisioning Cloudflare Tenant API (menuntut perjanjian partner yang
  ditandatangani; kredensialnya bisa menghapus permanen akun pelanggan — blast
  radius kategori lain, jadi modul kedua, bukan perluasan adaptor DNS yang ada).
  Menambah nilai `partner` ke `ModulePermissionScope` (`scope` mengatur siapa
  yang boleh _memegang_ permission; kemitraan mengatur _objek mana_ yang
  disentuhnya — menyatukannya menghasilkan permission yang dipegang dengan benar
  dan dijalankan terhadap tenant yang salah, tanpa satu pun policy RLS
  keberatan). Menambah `subject.groups` dan `subject.entitlements` ke allow-list
  ABAC (grup dimodelkan sebagai pemberi role sehingga `subject.roles` cukup;
  entitlement adalah gerbang struktural deny-only, dan mengekspornya memberi dua
  jawaban untuk satu pertanyaan). Membundel penyambungan `env.ipTrusted`
  sungguhan ke PR mana pun (ia perubahan otorisasi hidup yang menyamar sebagai
  pekerjaan infrastruktur). Membuat 43 issue di muka alih-alih per gelombang
  (backlog yang menua ke arah berbahaya — kelas cacat yang sudah dicatat #289).

- **PUTARAN REKOMENDASI 8 Agustus 2026 — R1–R10, enam mendarat, empat tersisa.**
  Audit enam sumbu (dokumen-vs-kode, permukaan-tanpa-UI, gerbang buta,
  backlog-vs-kode, keamanan/otorisasi, interop `awcms-astro`), tiap temuan lewat
  verifikator skeptis: **24 bertahan → 10 entri kerja**.

  **Kenapa daftarnya ada DI SINI dan bukan di catatan sesi.** Putaran ini dimulai
  dengan menurunkan ulang daftar rekomendasi putaran sebelumnya — karena daftar
  itu tidak pernah ditulis ke repo, dan lima PR yang mendarat darinya (#411–#415)
  hanya bisa dibaca ulang dari pesan commit. Menuliskannya di sini adalah harga
  satu paragraf; menurunkannya ulang adalah harga satu audit.

  **Mendarat (hijau penuh, tiap PR ber-`bun run check` PENUH):**
  - **R1** (#416) — `registration_requests.approve` bisa memberikan `owner`.
    Prinsipal yang hanya memegang `{read,approve}` bisa mencetak akun ber-katalog
    penuh, dan `owner` tampil di dropdown `/admin/registrations`. Ditutup +
    gerbang kelasnya (`tests/access-assignment-writers.test.ts`: tiap penulis
    `awcms_access_assignments` wajib membaca `is_system`).
  - **R2** (#417) — lima berkas DB-gated (**36 test**) tak pernah dieksekusi
    pipeline mana pun: MFA lockout/replay, lintas-tenant OIDC, Turnstile di
    handler login, konformansi respons office. Daftar eksplisit di kedua workflow
    drift sejak #188–#191. Gerbang paritas dua arah + kedua workflow diperbaiki.
    Suite legacy 10→15 berkas, 64→100 test.
  - **R4** (#418 + #419) — `/news/**` masih "hidup" di AGENTS.md (berkas pertama
    yang dibaca tiap agen, **menjadwalkan pekerjaan yang sudah selesai**),
    ARCHITECTURE, dokumen ini, standar-performa, dan frontmatter skill; tiga
    surface cache tepi inert; dan gerbangnya sendiri mengikat empat NAMA BERKAS
    sehingga sebuah `index.astro` menghidupkannya kembali tanpa satu asersi pun
    bergerak (diverifikasi: 9 pass/0 fail).
  - **R5** (#420) — aturan 5 `skills:check`: tiap URL `/admin/…` berbacktick
    wajib resolve, korpusnya termasuk `src/modules/<nama>/README.md`.
  - **R6** (#421) — `bun run admin:screen-coverage:check`: **32 layar mengklaim
    133 dari 203 permission**; 16 keputusan ber-alasan, **54 di ledger satu-arah**
    (`scripts/admin-screen-coverage-ledger.ts`) yang hanya boleh mengecil.

  **Tersisa, urut menurut akibat.** Rinciannya (bukti, perbaikan, gerbang yang
  harus ikut mendarat) ada di badan PR yang menyebut nomornya:
  - ~~**R3 — layar admin memutuskan dengan `ssr.permissions.has()` saja**~~ —
    **DITUTUP** (issue #450, Gelombang 1, sembilan PR: #451, #452, #454–#461).
    Ke-32 layar kini memutuskan di `authorizeInTransaction`, jadi saat MEMBACA
    mereka tidak lagi melewati `evaluateAccess` (policy `deny` tenant),
    `resolveModuleAvailability`, fakta business-scope, SoD, dan
    `recordDecisionLog`. Kedua ledger — `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` dan
    bagian layar `NOT_YET_MIGRATED` — **kosong**.

    Yang perlu diingat kalau menyentuh area ini lagi:
    - `loadAdminScreen` (`src/lib/auth/admin-screen.ts`) memutuskan dan membaca
      dalam SATU transaksi. `authorize` menerima **array = any-of** untuk delapan
      konsol yang menolak hanya bila SEMUA panel ditolak; array kosong menolak.
    - Kelonggaran se-berkas **ditutup untuk layar** dan **dipertahankan untuk
      rute**. Ditemukan lewat mutasi: layar yang terute tapi tetap membaca
      `ssr.permissions.has()` untuk satu afordans membuat gerbangnya keluar 0
      sambil melaporkan "1 still decide outside the chokepoint".
    - Dua alarm menjadi inert saat ledger mencapai nol dan diganti: self-test
      detektor kini **probe sintetis**, dan gerbang menuntut tiap layar
      benar-benar TERUTE (bukan sekadar diam).

  - **R7 — kredensial mesin, suppression email, komposer homepage tanpa layar.**
    Kini otomatis terlihat di ledger R6, jadi ia bisa mendarat bertahap.
  - ~~**R8 — permission platform bisa diberikan lewat editor role**~~ —
    **DITUTUP** (#431). `listPermissionCatalog` kini menuntut keputusan `scope`
    yang eksplisit dan `grantPermissionToRole` memeriksa ulang di server dengan
    409 `PLATFORM_SCOPE_REQUIRED`. Nol migrasi: batasannya tentang TENANT mana
    yang boleh memegang permission platform, bukan tentang role.
  - **R9 — lima gerbang menjanjikan cakupan yang tak mereka periksa**, mis.
    `logging:lint:check` yang `SCAN_ROOTS`-nya melewatkan `src/middleware.ts`
    dan seluruh `src/pages` (probe identik: `src/lib/` → EXIT 1,
    `src/middleware.ts` → EXIT 0).
  - **R10 — C7/RUM tercatat "menunggu keputusan pemilik produk"** padahal
    ADR-0067 sudah `Accepted` sejak 8 Agustus 2026.

  **Ditolak, dan alasannya bagian dari hasilnya:** menuntut layar untuk keenam
  `workflow.definition.*` (absennya sudah keputusan ber-pemeriksa), menulis ulang
  §C ADR-0066 (ADR adalah catatan pada satu titik waktu — perubahan kebijakan =
  ADR baru), menaruh perintah shell di `awcms-family-compatibility.yaml`
  (eksekusi arbitrer dari berkas data ke dalam gerbang), dan melebarkan gerbang
  teks ke seluruh `docs/awcms/` (§10 sudah menolaknya).

- **ASESMEN MENYELURUH 4 Agustus 2026 — [`awcms/repo-assessment-2026-08-04.md`](awcms/repo-assessment-2026-08-04.md).**
  Repo dinilai terhadap empat sumbu (standar AWCMS, hubungan `awcms-astro`, performa
  internasional, keamanan internasional). Tujuh rekomendasi berperingkat.

  > **PUTARAN 1 SELESAI — enam dari tujuh mendarat di hari yang sama.**
  > ADR-0063 (#380) chokepoint per-handler, `overrides` postcss (#381),
  > ADR-0064 (#382) gerbang index-FK, ADR-0065 (#383) kontrak konsumen beku,
  > ADR-0066 (#384) rate limit berbagi lewat Redis, anggaran query (#385).
  > Yang ketujuh — Core Web Vitals — sengaja **tidak** mendarat: ia jadi
  > [ADR-0067](adr/0067-core-web-vitals-collection.md) `Proposed` yang menunggu
  > keputusan pemilik produk. Teks P0/P1 di bawah dipertahankan sebagai konteks;
  > jangan dibaca sebagai pekerjaan tersisa.

  > **PUTARAN 2 — tiga belas temuan baru, [`§9 dokumen asesmen`](awcms/repo-assessment-2026-08-04.md).**
  > Dinilai ulang SETELAH keenam perbaikan masuk. Empat teratas, yang mengubah
  > backlog:
  >
  > 1. **SELESAI (commit 769292d7, celah C1 DITUTUP).** Teks asli dipertahankan
  >    sebagai konteks: `scripts/validate-env.ts` kini menolak produksi dengan
  >    `AUTH_COOKIE_SECURE !== "true"` — termasuk saat variabel **tidak diset**
  >    (gagal-tertutup); keadaan-absen digerbangi `tests/validate-env.test.ts`.
  >    **`AUTH_COOKIE_SECURE` gagal-TERBUKA saat tidak diset.** Aturan produksi
  >    di `validate-env.ts` hanya menolak string literal `"false"`, sementara
  >    runtime menuntut `"true"` — jadi variabel yang **tidak diset** memberi
  >    cookie sesi tanpa `Secure` dengan `config:validate` hijau. Tetangganya di
  >    berkas yang sama (`TRUSTED_PROXY_ENABLED`) justru memerahkan saat kosong.
  > 2. **CATATAN (5 Agustus 2026): temuan ini di-reframe, C3 diturunkan.**
  >    Pembaca produksi/staging TERNYATA menerima gzip — dari Cloudflare, karena
  >    kedua host proxied (`Cloudflare (proxied) → Traefik :443 → varnish:80 → app`,
  >    [`awcms/environments.md`](awcms/environments.md) §Cache tepi). Yang tersisa
  >    dan tetap benar: repo ini sendiri tak mengompresi apa pun, kompresinya
  >    diwarisi dari lapisan yang tak diperiksa gerbang mana pun, dan deployment
  >    template di luar CDN pengompresi tidak mendapat kompresi. Teks asli:
  >    **Tidak ada kompresi respons di mana pun** — bukan di aplikasi, bukan di
  >    `infra/varnish/default.vcl` (nol kemunculan `gzip`), bukan sebagai
  >    middleware Traefik yang dideklarasikan. Sementara itu
  >    `edge-cache/response-headers.ts` sudah memancarkan `Vary: Accept-Encoding`
  >    — janji tanpa penepat. Diukur: aset teks `dist/client` 139 KB → 49,7 KB
  >    (2,79×), dan HTML/JSON/sitemap kompres lebih baik lagi.
  > 3. **CATATAN (5 Agustus 2026): TERBLOKIR eksternal.** `@astrojs/check`
  >    menuntut API TypeScript 6.x sedangkan repo sudah di 7.0.2 — celah C4
  >    tak bisa ditutup dari sini hari ini; keadaan itu dicatat sebagai
  >    divergence keluarga di ADR-0068 §C (`awcms-family-compatibility.yaml`,
  >    reviewDate 2027-02-04). Teks asli:
  >    **42 berkas `.astro` (22.328 baris) tidak pernah diperiksa tipe.** `tsc`
  >    tidak bisa mengurai `.astro` dan melewatinya diam-diam; `@astrojs/check`
  >    tidak terpasang. `awcms-astro` menjalankan `astro check`; repo ini —
  >    dengan berkas `.astro` jauh lebih banyak — tidak.
  > 4. **SELESAI (ADR-0068, celah C8 DITUTUP).** `scripts/api-consumer-contract.ts`
  >    kini memisahkan `CONSUMED_PATHS` (3: `/api/v1/blog/posts`,
  >    `/api/v1/media/objects`, `/api/v1/media/public-origin`) dari
  >    `COMMITTED_PATHS` (2: `/api/v1/auth/session`,
  >    `/api/v1/access/machine-credentials`, tiap entri ber-ADR) — ADR-0065 +
  >    ADR-0068. Teks asli:
  >    **Kontrak konsumen membekukan enam permukaan; `awcms-astro` memanggil
  >    tiga.** Daftar di sana diekstrak dari kode **dengan komentar dibuang** dan
  >    digerbangi dua arah; daftar di sini disusun dengan mem-grep repo sana
  >    tanpa membuang komentar, sehingga tiga entri membekukan panggilan yang
  >    tidak pernah terjadi (satu di antaranya dihapus ADR-0018 di repo sana).
  >
  > Status kontrol pindah ke dokumen yang memang dirancang untuk dimutakhirkan:
  > [`awcms/standar-performa-dan-keamanan.md`](awcms/standar-performa-dan-keamanan.md)
  > — peta kontrol ↔ standar (OWASP Top 10 2021 / API Top 10 2023 / ASVS 4.0.3 /
  > ISO 27001:2022 / ISO 25010 / NIST SSDF / RFC 9111 / Core Web Vitals), tiga
  > belas celah ber-pemeriksa, dan daftar kontrol yang **sengaja ditolak**.
  - **P0 (SELESAI, ADR-0063) — satu rute MELEWATI chokepoint otorisasi.**
    `POST /api/v1/blog/posts/{id}/submit-review` tidak memanggil
    `authorizeInTransaction` sama sekali; ia menyusun jalurnya sendiri
    (`fetchGrantedPermissionKeys` + `evaluatePostUpdateAccess`). Yang dilewati:
    **evaluator ABAC** (`evaluateAccess`), gerbang platform-scope (ADR-0053),
    business-scope facts (ADR-0060), dan SoD (#181). Akibat konkretnya —
    **policy ABAC `deny` atas `blog_content.posts.update` dihormati di
    `PATCH /{id}` dan diam-diam diabaikan di rute ini.** Severity moderat (blast
    radius sempit, RBAC + aturan kepemilikan tetap berlaku); yang serius adalah
    KELASNYA. `access:permissions:enforcement:check` tak bisa melihatnya: ia
    bertanya "apakah permission ini punya penegak", bukan "apakah setiap situs
    penegakan memakai chokepoint" — pengulangan persis pelajaran PR #351.
    Perbaikannya dua bagian: routekan lewat chokepoint, DAN gerbangi kelasnya.
    Himpunan pelanggar hari ini **tepat dua** berkas, satu di antaranya
    (`auth/login.ts`) memang pra-autentikasi — jadi daftar pengecualiannya lahir
    dengan satu entri.
  - **P1 (SELESAI, ADR-0065) — kontrak yang dipakai `awcms-astro` tidak dijaga test apa pun.**
    Snapshot OpenAPI beku adalah snapshot **PRA-migrasi #182**, sedangkan kelima
    permukaan yang benar-benar dikonsumsi repo itu mendarat SESUDAHNYA
    (`/auth/session`, `/media/objects`, `/media/public-origin`,
    `/access/machine-credentials`, dan traversal `/blog/posts`). Diverifikasi: nol
    kemunculan di berkas snapshot. Mengubah bentuk respons salah satunya **hijau di
    CI sini dan merusak build repo sana** — kegagalan yang muncul di tempat orang
    yang menyebabkannya tidak melihat. Perbaikan: snapshot kontrak KONSUMEN kedua
    (jangan perluas yang pra-migrasi — tugasnya berbeda dan ia harus tetap beku).
  - **P1 (SELESAI, ADR-0066) — rate limiter tidak bertahan lintas instans.** `src/lib/security/rate-limit.ts`
    memakai `Map` dalam-proses (berkasnya sendiri mencatatnya): dengan N replika,
    batas efektif jadi N × batas terkonfigurasi, sehingga deployment yang paling
    butuh perlindungan justru paling lemah. Redis SUDAH ada di repo. Tiga endpoint
    autentikasi belum ber-limiter sama sekali (`session-handoff/issue`/`redeem`,
    `sso/{providerKey}/callback`) — kelengkapan, bukan lubang (masing-masing punya
    mitigasi lain), tapi ASVS menuntut anti-automation di seluruh permukaan auth.

  Catatan asesmen ini sudah **TIDAK BERLAKU** dan angkanya jangan dipakai. Teks
  asli dipertahankan di bawah sebagai konteks. Status performa yang berlaku ada
  di [`awcms/standar-performa-dan-keamanan.md`](awcms/standar-performa-dan-keamanan.md)
  §8 "Gerbang performa: dari satu menjadi empat permukaan" — **satu-satunya**
  tempat hitungan itu dipelihara. Menduplikasinya di sini adalah yang membuatnya
  basi: paragraf ini membantah §4 di berkas yang sama, yang sudah mencatat
  anggaran query mendarat, dan `query-budget-admin.integration.test.ts` sudah
  mencakup pembangun sitemap yang di bawah disebut belum beranggaran.

  > Teks asli: "dari **34** gerbang rantai `check` (per tabel §2 yang kini
  > ter-generate), **satu** memeriksa performa (`db:fk-index:check`). Anggaran
  > query (#385) hidup sebagai **test integrasi DB-gated**, bukan gerbang
  > rantai — pada mesin tanpa PostgreSQL ia di-`skip` dan `bun run check` tetap
  > hijau. Cakupannya pun hanya jalur baca publik blog: 31 layar admin dan
  > pembangun sitemap belum beranggaran."

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
    (sebelas permission dari **41** — bukan 43: `sql/089` MENCABUT
    `blog_content.seo.configure` dan `.posts.export` saat ADR-0058 mengosongkan
    daftar pengecualian gerbang permission). Sisanya menunggu layar saudaranya
    (pages, taxonomy, presentation, settings, homepage) — **`pages` ternyata
    butuh permukaannya lebih dulu**, lihat entri ADR-0057 di bawah. Satu absen
    yang digerbangi contract test: `search.read` punya rute tapi daftar admin
    sudah punya pencarian sendiri yang mentoleransi query kosong. (`posts.export`
    dulu absen kedua di sini; ia tidak lagi ada untuk diabsenkan — dicabut
    `sql/089` justru karena tak ada endpoint yang menegakkannya.)
  - ~~`media-library`~~ **SELESAI (#345)** — `/admin/media`. Dan ini bukan sekadar
    layar ([ADR-0056](adr/0056-media-library-admin-surface.md)): lima dari sebelas
    permission-nya tidak digerbangi apa pun (`attach`/`detach`/`delete`/`restore`/
    `purge`), lima fungsi aplikasi yang memanggilnya nol, dan tidak ada fungsi
    `list*` sama sekali — `GET /api/v1/media/objects` menuntut `?ids=`, ia resolver
    batch untuk build `awcms-astro`. ADR-0056 memecahnya tiga: cabut
    `attach`/`detach` (usang sejak inversi ADR-0036), beri permukaan
    `delete`/`restore`/`purge` (lubang nyata), tambah rute daftar sendiri. Layar
    menyusul SETELAH ketiganya.

    **Kemajuan: §A + §B SELESAI.** §B memberi `delete`/`restore`/`purge`
    endpoint ter-guard, ter-audit, ber-`Idempotency-Key`
    (`DELETE /api/v1/media/objects/{id}`, `.../{id}/restore`, `.../{id}/purge`).
    Nol permission `media_library` kini tak-tergerbangi. `purge` memurnikan
    REGISTRY saja — job rekonsiliasi tetap satu-satunya penulis bucket — dan
    berjalan dalam SAVEPOINT karena FK keras dari
    `awcms_news_portal_ad_placements` membuat `23503` MEMBATALKAN transaksi
    (tanpa savepoint, 409 yang bisa ditindaklanjuti berubah jadi 500 saat
    COMMIT).

    **§C SELESAI juga.** `listMediaObjects` (keyset, 50/halaman) +
    `GET /api/v1/media/objects/list` — rute SENDIRI, bukan mode-ganda pada
    `?ids=`. Sebelumnya lapisan aplikasi hanya punya point lookup, jadi layar
    browse memang TIDAK BISA dibangun di atas permukaan lama, apa pun kata
    permission-nya. Daftar ini sengaja MELAMPAUI aturan aman resolver (status
    apa pun, plus soft-deleted bila diminta): justru objek tak-sehat itulah
    alasan administrator membukanya. `/list` tak bisa bentrok dengan id karena
    rute `/{id}` kini menuntut uuid. Kursor membawa teks presisi mikrodetik —
    integration test menyisipkan 107 baris dalam SATU statement lalu menyusuri
    tiap halaman; mengembalikan kursor ke `Date` kehilangan 57 baris (jebakan
    #158, dan registry media adalah tempat paling mungkin ia kambuh).

    **Layar (#345).** Konsol siklus hidup objek: browse ber-filter, lalu
    delete/restore/purge — empat permission, tiap mutasi ber-`Idempotency-Key`
    baru (tak ada opt-out seperti `/admin/blog`, dan tak ada endpoint yang
    menolak header seperti `/admin/sync`). TIGA absen sengaja, digerbangi
    contract test agar tetap keputusan: **unggah** (`create`/`verify`/`cancel`)
    — alur tiga langkah di browser, tombol yang memulai sesi tapi tak bisa
    menuntaskannya meninggalkan baris `pending_upload` tiap salah klik;
    **`enforcement.*`** — saklar kebijakan tenant SATU ARAH, bukan aksi objek,
    tempatnya di `/admin/security`; dan **tanpa pratinjau `<img>`** — baris bisa
    `pending_upload`/`failed`, bytes-nya mungkin tak ada, belum terverifikasi,
    atau justru hal yang sedang dihapus operator.

    **ADR-0056 SELESAI SELURUHNYA, dan dengan itu kriteria 1 ADR-0021 nol
    pengecualian tak-disengaja** — `idn-admin-regions` satu-satunya modul tanpa
    layar, dan itu memang keputusan (ADR-0052). Contract test layar ini ikut
    menegakkannya lintas-modul, jadi modul berikutnya yang mendarat tanpa
    `navigation` memerahkan CI alih-alih diam-diam menambah pengecualian.

    > **Temuan sampingan, sudah diperbaiki di PR yang sama.** SQLSTATE Postgres
    > ada di `error.errno`, BUKAN `error.code` — Bun mengisi `code` dengan
    > konstanta miliknya sendiri (`ERR_POSTGRES_SERVER_ERROR`) untuk SEMUA error
    > server. Jadi `error.code === "23505"` bukan cek yang agak salah, melainkan
    > cek yang TAK PERNAH bisa benar. Sepuluh situs di repo ini sudah benar
    > (`String(error.errno)`); satu tidak: `tenant-provisioning.ts` —
    > `POST /api/v1/tenants` menjanjikan 409 untuk `tenant_code` duplikat tapi
    > menyajikan 500 pada kasus balapan (pre-check SELECT menutupi kasus biasa).
    > Ditemukan dengan MEMPROBE database nyata, bukan dengan membaca; digerbangi
    > `tests/postgres-sqlstate-detection.test.ts`.

    **§A SELESAI.** `sql/087` mencabut `attach`/`detach` dari katalog
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

  - **`blog-content` — empat layar saudara tersisa, dan `pages` BUKAN salah satu
    layar yang cuma hilang halamannya** ([ADR-0057](adr/0057-blog-page-lifecycle.md)).
    Audit `pages.*` sebelum menulis layarnya mengulang temuan ADR-0056, lebih
    tajam: **empat dari delapan permission `pages.*` tidak digerbangi apa pun**
    (`publish`/`archive`/`restore`/`purge`), dan tak seperti `media_library` —
    yang fungsi aplikasinya ada tapi nol pemanggil — di sini fungsinya **tidak
    ada sama sekali**.

    Akibatnya fungsional, bukan sekadar permission menganggur: `createBlogPage`
    menulis literal `'draft'`, `updateBlogPage` tak pernah menyentuh `status`
    atau `published_at`, dan `blog-scheduled-publish.ts` hanya membaca
    `awcms_blog_posts`. **Tidak ada penulis lain untuk
    `awcms_blog_pages.status` di seluruh repo — sebuah page tidak pernah bisa
    meninggalkan `draft`.** Itu sudah hidup di permukaan publik: `blog-search.ts`
    menyaring cabang page dengan `status = 'published' … AND published_at IS NOT
NULL`, jadi pencarian publik untuk page **selalu** nol baris — di atas index
    `awcms_blog_pages_tenant_status_published_idx` yang `sql/035` bangun persis
    untuk query itu.

    ADR-0057 memberi keempatnya permukaan (bukan mencabutnya — mencabut
    `pages.publish` memberkati cacat itu sebagai desain), dengan siklus hidup
    yang sengaja **lebih sempit** dari post: tanpa `review`, tanpa `scheduled`,
    karena `sql/036` tak pernah men-seed `pages.schedule`. `purge` **melaporkan,
    tidak menolak**, jumlah ad placement yang jadi inert — draf pertama ADR itu
    memilih 409, dan `ad-placement-reference-validation.ts` membantahnya: modul
    itu sudah memutuskan target yang hilang belakangan "is not an error and never
    becomes one", dan soft delete hari ini punya efek render yang sama persis.
    **Nol migrasi** — kolom, CHECK,
    index dan baris katalog sudah ada; yang hilang murni lapisan aplikasi + route.
    Urutan mengikat: permukaan dulu, `/admin/blog-pages` menyusul.

    **ADR-0057 SELESAI SELURUHNYA — tiga PR, nol migrasi.** Permukaan (#350):
    empat rute ter-guard/ter-audit/ber-`Idempotency-Key` lewat
    `defineTenantRoute`, plus `domain/page-status.ts` dan tiga fungsi directory.
    Layar (#352): **`/admin/blog-pages`** menggerakkan **kedelapan** permission,
    dua tampilan (hidup + bin), edit STRUKTUR (judul/slug/tipe/urutan menu)
    bukan editor badan, tanpa re-parenting (API tak punya deteksi siklus).
    Contract test-nya memuat satu asersi maju: permission `pages.*` KESEMBILAN
    yang di-seed akan memerahkan CI, karena begitulah empat yang ini lolos
    berbulan-bulan.

- **Bug yang ditemukan dalam perjalanan, sudah diperbaiki (#351).** Tombol
  **Restore** di `/admin/blog` (#340, enam hari sebelumnya) **tidak pernah bisa
  bekerja**. `listBlogPostsForAdmin` menyaring keras `deleted_at IS NULL` dan
  layar itu tak punya filter "deleted", jadi Restore digantungkan pada
  `status === "archived"` — sumbu yang BERBEDA. Endpoint-nya menuntut
  `canRestorePost` (`deleted_at IS NOT NULL`), sehingga tombolnya dirender
  persis pada baris yang pasti 404 dan tak pernah pada baris yang akan
  berhasil. Teks konfirmasi hapusnya bahkan menjanjikan sebaliknya
  ("recoverable until it is purged"). Diperbaiki dengan filter `deletedOnly`
  di kedua fungsi daftar admin + tampilan `?view=deleted` di kedua layar.

  > **Gate §F TIDAK menangkap ini, dan itu batas yang perlu diketahui.** Ia
  > bertanya "apakah permission ini punya penegak" — dan `posts.restore` punya;
  > endpoint-nya ada dan benar. Yang salah adalah LAYAR memanggilnya pada baris
  > yang salah. Itu lapisan contract-test per-layar, dan contract test yang ada
  > tidak menanyakannya. Sekarang menanyakan, di kedua layar, mutation-proven.
  > Pelajaran umumnya: gate cakupan permission dan contract test layar menjawab
  > **dua pertanyaan berbeda**, dan sebuah kontrol bisa lulus yang pertama
  > sambil mustahil dipakai.

- **Gate cakupan permission — SELESAI SELURUHNYA, daftar pengecualiannya KOSONG
  ([ADR-0058](adr/0058-unenforced-permissions-disposition.md), PR #359–#363).**
  `bun run access:permissions:enforcement:check` (ADR-0057 §F) menuntut tiap
  permission terdeklarasi punya call site `authorizeInTransaction` atau
  terdaftar sebagai pengecualian ber-alasan. Murni (registry + teks sumber),
  masuk rantai `check`. Skor: **203/203 tergerbangi, 0 pengecualian**.

  Enam entri pertamanya habis, dan **tak satu pun dimaafkan**. ADR-0058
  membelahnya jadi dua kelas yang berbeda — bukan satu:
  - `profile_identity.profile_management.restore` — **PERMUKAAN** (§A, #361).
    Lubang nyata: `party-directory.ts` mengekspor `softDeleteParty` tanpa
    pasangan, jadi `restored_at`/`restored_by` (`sql/003`) tak pernah bisa
    ditulis dan profil yang di-soft-delete permanen.
  - `comments.moderation.delete` — **PERMUKAAN** (§B, #362). Seluruh mesinnya
    ada sejak ADR-0041 (transisi legal dari keempat status non-terminal,
    antrean bisa memfilter `deleted`); satu-satunya aktor yang bisa
    memproduksinya adalah **penulis** komentar.
  - `blog_content.seo.configure` — **DICABUT** (§C, `sql/089`). Sumbu otorisasi
    KEDUA atas kolom yang `settings.configure` sudah kelola.
  - `blog_content.posts.export` — **DICABUT** (§D, `sql/089`). Nol mesin ekspor
    di mana pun; membangun fiturnya untuk membenarkan baris katalog adalah ekor
    menggerakkan anjing.
  - `visitor_analytics.settings.read`/`.update` — **BUKAN GAP** (#359), lihat
    catatan di bawah.

  Nilai daftar yang **kosong** lebih besar dari daftar yang pendek: pengecualian
  BERIKUTNYA akan jadi satu-satunya entri di situ, jadi ia tak bisa lewat tanpa
  terlihat di tengah daftar yang sudah tampak mapan.

  > **Skor pertamanya 199/205 dengan 6 pengecualian, dan DUA di antaranya
  > adalah bug gate-nya sendiri.** `visitor_analytics.settings.read`/`.update`
  > **tergerbangi** — `src/pages/api/v1/analytics/settings.ts` membangun
  > `READ_GUARD`/`UPDATE_GUARD` tepat pada activity itu. Yang salah: scanner
  > membaca konstanta seluruh repo sebagai **satu namespace datar**, sementara
  > `MODULE_KEY` terikat ke **empat nilai berbeda di lima berkas**, sehingga
  > aturan "nama berkonflik = tak-terpecahkan" mematikannya di **semua** berkas
  > — termasuk berkas yang mengikatnya sendiri satu baris di atas guard-nya.
  > Alasan tertulis kedua pengecualian itu bahkan menyatakan, tentang rute yang
  > ada, bahwa "no route names a settings activity".
  >
  > Ini persis peringatan yang tertulis di header berkas scanner itu sendiri,
  > dan ia tetap dipercaya. Draf 4 kini beku sebagai test bersama tiga draf
  > sebelumnya: konstanta diselesaikan **file-first**
  > (`resolveConstantsForSource`), tabel lintas-berkas hanya untuk nama yang
  > tak diikat berkas itu — yakni persis himpunan yang cuma bisa datang lewat
  > `import`. Nama yang diikat DUA KALI di dalam satu berkas tetap
  > tak-terpecahkan; menebak di situ hanya menukar satu jawaban salah dengan
  > lawannya. Mutation-proven di dua lapis: helper DAN
  > `evaluateEnforcementCoverage`, karena helper yang benar dengan satu-satunya
  > pemanggilnya masih meneruskan tabel datar akan **tampak** diperbaiki.
  >
  > Pelajaran yang lebih umum, dan ini yang ketiga kalinya di repo ini: sebuah
  > gate yang menjawab "tak tergerbangi" untuk yang tergerbangi tidak berhenti
  > pada satu laporan salah — ia **melahirkan dokumen**. Kedua entri itu ditulis
  > sebagai KEPUTUSAN ber-alasan, bukan sebagai temuan yang menunggu verifikasi.

  > **Gate-nya sendiri butuh tiga kali tulis ulang, dan itu pelajarannya.**
  > Draf 1 hanya membaca literal string → **39 false positive**, termasuk tiga
  > permission yang endpoint-nya mendarat minggu itu juga (banyak modul menulis
  > `moduleKey: THEMING_MODULE_KEY`). Draf 2 mencocokkan kurung terdalam →
  > setiap guard ber-field bersarang tak terlihat (`workflow.approval.approve`).
  > Draf 3 menuntut action literal → dua guard kondisional
  > (`comments.moderation.approve`/`.reject`) terlewat. Scanner yang menjawab
  > "tak tergerbangi" untuk yang tergerbangi LEBIH buruk daripada tak ada
  > scanner: ia melatih pembacanya menambah pengecualian sampai gate-nya tak
  > menanyakan apa pun. Ketiga draf itu dibekukan sebagai test di
  > `tests/permission-enforcement-coverage.test.ts`.

  Tiga saudara `blog_content` sisanya (taxonomy, presentation, settings/homepage)
  permukaannya lengkap — dan itu kini klaim yang **dijaga**, bukan hasil audit
  manual sekali jalan.

  - ~~`idn-admin-regions`~~ **SUDAH PUNYA LAYAR** — `/admin/idn-regions`, mendarat
    di #332. Entri ini sebelumnya berbunyi "sengaja tanpa layar"; itu **usang**,
    dan sempat diulang dalam badan PR #345 ("satu-satunya modul tanpa layar").
    Diverifikasi ke kode: `grep -L 'navigation:' src/modules/*/module.ts` kini
    mengembalikan **nol** baris. ADR-0052 memindahkan LIFECYCLE dataset-nya ke
    job operator — bukan seluruh modulnya — dan dua permission baca yang tersisa
    justru digerakkan layar itu.

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
    langkah (MFA/OIDC/Turnstile harus disalin ke repo kedua). **SISI `awcms` SELESAI
    (#347)** — `sql/088` (`awcms_bff_clients` + `awcms_session_handoff_codes`),
    `POST /api/v1/auth/session-handoff/issue` (self-service: identitas dari SESI, tak
    pernah dari body) dan `.../redeem` (klien terdaftar, server-ke-server, satu-satunya
    endpoint di repo ini yang diautentikasi client secret). Kode ≤60 detik, sekali pakai
    lewat `UPDATE … WHERE redeemed_at IS NULL`, allow-list `redirect_uri` cocok-persis,
    dan barisnya menyimpan `identity_id` + assurance — bukan token — sehingga tak ada
    kredensial hidup tersimpan dan login `aal1` tak bisa dicuci jadi sesi `aal2`.
    Yang tersisa milik `awcms-astro`: `/internal/login`, sesi BFF server-side, cookie
    portal, CSRF.

    > **Jebakan yang ditemukan integration test, bukan pembacaan.** `created_at` DEFAULT
    > `now()` adalah instant MULAI TRANSAKSI, sementara `expires_at` diturunkan dari jam
    > aplikasi — dua jam berbeda, jadi CHECK `expires_at <= created_at + 60 detik`
    > menolak kode normal begitu transaksi terbuka sesaat. Aplikasi kini menulis
    > keduanya dari satu jam.
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
  `admin@ahlikoding.com` dengan role `owner` 197/197 (angka-angka itu potret saat
  fase disetarakan; per 5 Agustus 2026 repo memuat **90** migrasi dan **203**
  permission — verifikasi dengan `ls sql/` dan katalog, jangan kutip dari sini), dan
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
  surface ter-deklarasi WAJIB punya call-site purge. Rinci di
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md).

  **Permukaan host-resolved boleh di-cache ([ADR-0061](adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md)).**
  Yang ditemukan saat mengerjakannya lebih besar dari "satu keluarga rute belum
  di-cache": **sumber tenant nomor satu ADR-0042 §8 tidak pernah punya penulis.**
  `locals.edgeCacheTenantId` dideklarasikan di `src/env.d.ts`, dibaca
  `src/middleware.ts`, didahulukan `resolveEdgeCacheTenantId` — dan nol rute
  pernah meng-assign-nya, jadi cabang itu tak bisa dieksekusi sejak ADR-0042
  mendarat. Akibatnya persis terbalik dari arah ADR-0059: cache tepi mempercepat
  `/blog/{tenantCode}/**` (bentuk warisan) dan **tidak menyentuh** satu pun
  permukaan host-resolved.

  **SELESAI SELURUHNYA.** §A — keluarga `/news/**` (3 entri, dimiliki
  `blog_content`) — **entri itu kemudian DICABUT**: ADR-0071 menghapus rutenya,
  dan ketiga surface bertahan beberapa hari lebih lama daripada rute yang
  mereka layani. Inert, bukan berbahaya (`requiresTenant` gagal-tertutup) —
  tetapi entri inert adalah izin berdiri bagi cache BERSAMA untuk menyimpan
  path yang tak seorang pun sajikan, dan gerbang yang melapor OK atas 11
  surface terbaca sebagai cakupan 11 hal, bukan 8. `edge-cache:surfaces:check`
  kini menolak surface yang modul pemiliknya tak mendeklarasikan rute penyaji.
  §B — enam rute discovery root (`seo-robots`/`seo-sitemap`/
  `seo-feed`); `serveDiscovery` menerima `locals` dan mempublikasikan setelah
  `build(ctx)` memberi payload, sehingga `/sitemap-99999.xml` cocok pola tapi tak
  pernah menerbitkan tenant — menyusuri nomor halaman tak bisa mengisi cache.

  **Temuan §B yang berlaku untuk setiap surface agregat berikutnya: badan
  discovery punya DUA penulis.** Konfigurasinya milik `seo_distribution`
  (`PUT /api/v1/seo/config` kini mem-purge), tetapi ISI-nya diagregasi dari setiap
  penyedia `seo_facts` — menerbitkan post mengubah `/sitemap.xml` tanpa menyentuh
  satu baris pun milik `seo_distribution`, dan purge modul menandai
  `t:<tenant>:m:<moduleKey>` sehingga purge `blog_content` tak menjangkaunya.
  Tanpa perbaikan: `/blog/{code}/feed.xml` ter-purge saat publish sementara
  `/feed.xml` — konten sama, ejaan host-resolved — basi sampai TTL, tanpa satu
  pun laporan. `enqueueModuleContentPurge` kini juga mem-purge modul yang
  `consumes` modul yang berubah DAN memiliki surface: dibaca dari REGISTRY (jadi
  `blog_content` tak pernah menyebut `seo_distribution`) dan dibatasi ke pemilik
  surface (ban untuk key yang tak menandai objek apa pun = upacara yang terlihat
  seperti cakupan, aturan yang sama yang sudah dipakai untuk `media_library`).

  > **Dua jebakan yang tak terbaca dari kode, keduanya kini ditegakkan test.**
  > (1) Prasyarat "VCL mem-hash `Host`" itu **dua** properti: `hash_data(req.http.host)`
  > ADA, tetapi sub itu juga harus TIDAK `return (lookup)` — sub kustom yang
  > `return` mengakhiri rantai sehingga `vcl_hash` milik `builtin.vcl` (yang
  > mem-hash `req.url`) tak pernah jalan, dan seluruh path pada satu host runtuh
  > ke SATU entri cache. Menambahkan baris itu terbaca seperti melengkapi
  > subroutine. (2) **Kapan** rute mempublikasikan tenant adalah pertanyaan
  > disclosure, bukan gaya: 404 boleh di-cache, jadi publikasi sebelum cabang
  > "post/term tidak ada" membuat 404 resource-hilang ber-`Surrogate-Control`
  > sementara 404 host-tak-dikenal ber-`private, no-store` — menjawab "apakah
  > hostname ini memetakan ke tenant hidup?" dari SATU permintaan, lewat kanal
  > kedua atas pertanyaan yang `padUnresolvedHostRouteLatency` justru dibangun
  > untuk menutup. Satu baris beberapa baris terlalu tinggi; tetap meng-compile,
  > tetap menyajikan HTML benar, lolos setiap test fungsional.
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

- **~~Rute publik host-resolved~~ — DICABUT ([ADR-0071](adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
  men-supersede ADR-0059; §4 `SUDAH DILAKSANAKAN`).** Kosakata URL publik
  dibelah per repo: **`/blog/**` permanen di sini, `/news/**` milik
  `ahliweb/awcms-astro`** — satu keluarga per repo, tidak pernah keduanya di
  satu repo. Keempat berkas rute, gerbang `withHostResolvedBlogTenant`, dan
  saklar `publicRouteMode` **dihapus**; yang berjalan sekarang hanyalah 301
  `seo_distribution` ke `/blog/{tenantCode}/**`, karena URL keluarga itu pernah
  hidup dan kita iklankan sendiri di sitemap dan feed.
  `legacyTenantRouteEnabled` bertahan sebagai satu-satunya saklar keluarga
  `/blog/{tenantCode}`. Konteks aslinya dipertahankan di bawah — pelajaran di
  bawahnya tetap berlaku dan tidak bergantung pada rutenya:

  <!-- historis:mulai -->

  > Teks asli: "**Rute publik host-resolved — SELESAI (ADR-0059).** Keluarga
  > `/news/**` (indeks, detail post, kategori, tag) kini ada: tanpa segmen
  > `tenantCode`, tenant diresolusi dari request lewat
  > `withHostResolvedBlogTenant` (sebentuk `site_search`/`comments`, ber-padding
  > latensi), digerbangi saklar per-tenant `publicRouteMode` yang simetris
  > dengan `legacyTenantRouteEnabled`. **Nol migrasi, nol permission, nol
  > perubahan OpenAPI.** `/news/feed.xml`/`sitemap-news.xml`/`search` sengaja
  > TIDAK dibangun — root host sudah melayani ketiganya host-resolved."

  <!-- historis:selesai -->

  Yang paling penting untuk dibawa ke pekerjaan berikutnya, dan itu bukan
  fiturnya:

  > **Cacat yang dicatat entri sebelumnya di sini TIDAK ADA.** Entri itu
  > berbunyi "untuk tenant host-resolved, **setiap URL di sitemap dan feed
  > menunjuk halaman yang 404**" karena `createBlogContentSeoFactsAdapter`
  > memakai default `/blog`. Diverifikasi ke kode: rute discovery tidak pernah
  > memakai default itu — `discovery-providers.ts` memanggilnya dengan
  > `` `/blog/${tenantCode}` `` **sejak modulnya mendarat** (`git log -S`,
  > #223), docblock-nya bahkan menuliskan alasannya, dan singleton ber-default
  > `/blog` itu **nol pemanggil di `src/`**. Enam rute discovery lewat satu
  > choke point, jadi tak ada jalur kedua. Ini pengulangan ADR-0058 §1: sebuah
  > dugaan yang ditulis sebagai temuan, lalu tersalin ke dokumen ini sebagai
  > keputusan. Yang benar-benar hilang adalah **keluarga rutenya**, bukan
  > kebenaran URL-nya.

  Gantinya, invarian yang sekarang dijaga: **jangan pernah mengiklankan URL
  yang tak kita layani.** `resolveEnabledSeoProviders` kini MEMILIH base path
  dari keluarga yang benar-benar melayani, dan bila tenant mematikan KEDUA
  keluarga ia menyumbang **nol provider** — sitemap kosong, bukan sitemap
  berisi 404. Mutation-proven (kembalikan base path ke konstanta lama → dua
  test integrasi merah).

  Dan satu bukti yang menutup permintaan backlog aslinya: `/blog/{slug}`
  **tak bisa** jadi bentuknya. Diprobe langsung — Astro memperingatkan rute itu
  "is defined in both" berkas dengan `/blog/[tenantCode]/index.ts` dan **build
  tetap sukses**, satu menaungi yang lain diam-diam, dengan catatan "a
  collision will result in a hard error in following versions of Astro".

- **Kesiapan `ahliweb/awcms-astro` — dianalisis 3 Agustus 2026, dan hasilnya
  membalik asumsi yang wajar.** ADR-0021 di repo itu **menahan** seluruh
  pengembangannya sampai "fondasi `awcms` selesai", dengan dua indikator:
  (1) tiap modul punya layar — **SUDAH nol pengecualian**; (2) §4 dokumen ini
  habis — belum.

  Yang diverifikasi ke kode, bukan ke daftarnya: **seluruh kontrak konten dan
  sesi yang benar-benar dipanggil `awcms-astro` sudah lengkap.** Repo itu hanya
  menyentuh lima permukaan — `/api/v1/blog/posts` (traversal `view=full` +
  cursor + `?locale=`), `/api/v1/media/objects`, `/api/v1/auth/session`,
  `/api/v1/access/machine-credentials`, dan `/api/v1/blog/posts/{id}` — dan
  kelimanya mendarat (#317/#318/#346, ADR-0049/0050).

  Satu gap nyata ditemukan dan **sudah ditutup** (#370): `publicUrl` media
  dibangun dari `NEWS_MEDIA_R2_PUBLIC_BASE_URL`, env sisi server, sehingga
  klien build tak punya cara menemukan origin media — padahal CSP-nya wajib
  menyebutnya di `img-src` **saat build**, sebelum satu objek pun ditarik.
  Satu-satunya alternatif adalah menyalin env var itu dengan tangan; bentuk
  yang sama dengan `MAX_REASON_LENGTH` di lima berkas, dengan kegagalan
  (gambar diblokir diam-diam) yang tak menyebut sebabnya.
  `GET /api/v1/media/public-origin` menutupnya.

  **Yang tersisa dan BUKAN milik repo ini:** resolusi gambar artikel, kartu
  share, dan pilihan `img-src` semuanya keputusan sisi `awcms-astro`. Yang
  tersisa DAN milik repo ini: **nol**. Rute konten host-based mendarat lewat
  ADR-0059, dan business-scope resolver — yang diperlukan BFF portal Jualanku,
  bukan situs statisnya — lewat ADR-0060. Bentuk scope merchant Jualanku sendiri
  tetap butuh ADR admission-nya sendiri, tapi fondasinya tak lagi menolak
  segalanya.
  `newsletter`/`social-publishing`/pustaka `src/components/ui/` tetap belum
  ada (21 modul, `src/components/ui` tidak ada), tapi tak satu pun memblokir
  `awcms-astro`.

- **~~Port generator `repo:inventory`~~ — SELESAI, dan dibangun di sini (bukan
  port).** `bun run repo:inventory:generate|:check` (`scripts/repo-inventory.ts`)
  mengisi blok ber-penanda di [`awcms/repo-inventory.md`](awcms/repo-inventory.md)
  dari registry modul, `sql/`, `tests/`, `src/pages/`, dan `docs/adr/`;
  `:check` masuk rantai `bun run check`. Dokumen itu sebelumnya membawa banner
  "GENERATED FILE" tanpa generator, dan isinya menua ke arah paling merugikan:
  "belum ada tabel"/"belum ada test file" terhadap 126 tabel dan 296 berkas
  test, jumlah migrasi **45** di satu paragraf dan **89** di paragraf lain,
  serta **20** modul saat registry memuat 21. Status RLS diparse dari teks
  migrasi secara **kumulatif** (sql/020 mematikan FORCE untuk perbaikan data
  lalu menyalakannya lagi — pembaca statement pertama ATAU terakhir saja akan
  melaporkan kebalikan dari kebenaran); `security:readiness` tetap otoritas
  untuk deployment nyata. Satu test lintas-artefak menjaga klaimnya: himpunan
  tabel RLS-free yang diturunkan generator wajib SAMA dengan kunci
  `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` — satu sisi diturunkan dari migrasi, satu
  sisi dideklarasikan manusia dengan alasan per entri.
- **~~Seam yang menunggu penyedia~~ — business-scope resolver SUDAH PUNYA PENYEDIA
  ([ADR-0060](adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md)).**
  `tenant_admin` me-resolve scope type `office` terhadap `awcms_offices`; NO-OP
  lama dihapus. Yang ditemukan saat mengerjakannya lebih besar dari "seam kosong":
  `POST /api/v1/identity/business-scope/assignments` — ter-guard, ter-audit,
  ber-RLS, dievaluasi SoD — **menolak SETIAP input di SETIAP deployment**, karena
  composition root-nya menyuntikkan NO-OP dan scope type cadangan `tenant`
  ditolak validator sebagai tak-bisa-di-assign (#180 F2). Seluruh subsistem di
  belakangnya ikut mati: nol baris untuk `businessScopeFacts`, nol untuk job
  expiry, nol scope untuk SoD `same_scope_only`. NO-OP itu benar saat ditulis
  (menunggu aplikasi turunan) lalu ADR-0034 menghapus jalur itu — dan
  `providedBy`-nya menamai `organization_structure`, modul yang ADR-0016
  `Accepted` tanpa satu baris kode. Hanya baris HIDUP yang resolve, tiap batas
  (siklus/kedalaman/jumlah) MENOLAK alih-alih memotong, plus pengerasan jalur
  baca: sentinel `tenant` hanya dipercaya bila menamai tenant itu sendiri.
  Mutation-proven terhadap Postgres nyata. Nol migrasi.
  SoD base tetap ship **1 rule** (`data_lifecycle.legal_hold_maker_checker`,
  ADR-0037) — rule ilustratif tambahan tetap di fixture.

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
  dengan `bun run check` tetap hijau. `docs/awcms/` tetap DI LUAR gerbang itu:
  isinya campuran sejarah + spesifikasi yang memang boleh menyebut tooling belum-ada
  (`production:preflight`, `performance:*`, dst. — daftar lengkapnya di
  [`../scripts/README.md`](../scripts/README.md) §Ditunda).
- **`.claude/skills/` KINI DIGERBANGI** ([ADR-0062](adr/0062-skills-are-gated-against-the-code-they-describe.md),
  `bun run skills:check`) — pengecualian lamanya dicabut karena ADR-0055 mencabut
  alasannya. Yang memaksanya: **sebelas ADR berurutan (0051–0061) mendarat tanpa SATU pun
  skill menyebutnya**, empat skill modul HIDUP menunjuk `src/lib/<modul>/…` untuk berkas
  yang sudah pindah ke `src/modules/<modul>/presentation/…`, dan beberapa mengumumkan layar
  admin "TIDAK di-port" berbulan-bulan setelah layarnya mendarat. **Skill DIIKUTI, dokumen
  dibaca** — dan arah menuanya terbalik: "modul ini belum ada di sini" mulai benar lalu
  menua jadi kebohongan percaya diri yang menyuruh agen membangun ulang hal yang sudah ada.
  Tiga aturannya bertumpu pada registry modul, bukan prosa: skill modul hidup wajib menunjuk
  path nyata (tanpa pengecualian), tiap `ADR-NNNN` wajib punya berkas, dan skill untuk kode
  yang TIDAK ada wajib terdaftar di `ASPIRATIONAL_SKILLS` dengan alasannya. Entri yang MATI
  (modulnya dibangun → aturan 1 mengambil alih) ikut dilaporkan — tiga entri sudah mati saat
  ditulis. **Efek samping yang perlu diketahui:** badan banyak skill memuat spesifikasi
  awcms-mini apa adanya, jadi path milik repo sumber kini harus ditulis `awcms-mini:src/…`,
  bukan `src/…`.
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
- **CI**: sepuluh required check sejak 8 Agustus 2026 (ruleset `main only`, id 11653326) — tiga di antaranya baru ditambahkan: `Integration tests (RLS + DB
role separation)`, `E2E smoke (Playwright)`, `Minimum-supported versions`.
  Sebelumnya ketiganya berjalan tanpa memblokir merge, dan karena job `quality`
  sengaja berjalan dengan `DATABASE_URL: ""`, required check yang ada **buta
  secara struktural** terhadap isolasi RLS, pemisahan role DB, dan anggaran
  query. Biaya yang diterima dan dinyatakan: job integrasi menarik image Postgres
  dari Docker Hub, jadi outage registry kini **memblokir merge** (terjadi sekali
  pada 8 Agustus, run 31234082007 — tiga retry, semuanya timeout).
  CodeQL run kadang orphan di antrean → picu ulang dengan empty commit; flake
  Postgres CI → `gh run rerun --failed`.
- **Subagent/sesi lain di working tree bersama** bisa memindahkan HEAD →
  **`git branch --show-current` TIDAK CUKUP.** Ia melaporkan nama branch yang
  baru saja kamu buat, yang selalu terlihat benar. Yang harus diverifikasi
  adalah **commit INDUKNYA**: `git rev-parse --short HEAD` sebelum `checkout -b`,
  dan `git merge-base HEAD origin/main` sesudahnya. Ini benar-benar terjadi pada
  8 Agustus 2026 — PR #409 dibuat saat HEAD sedang di branch sesi lain, sehingga
  ia membawa **32 berkas** bukan 10, dan merge-nya mendaratkan seluruh isi PR
  #408 (termasuk pembalikan status ADR-0067) ke `main` tanpa PR itu pernah
  di-review. Gejala yang terlewat: pesan squash memuat pesan commit PR LAIN
  sebagai butir. Sebelum merge, `gh pr diff <n> --name-only` dan
  `gh pr view <n> --json commits -q '.commits|length'`.
- **`.astro` adalah titik buta SETIAP gerbang berbasis tipe.** `bun run typecheck`
  adalah `tsc --noEmit`, dan `tsc` tidak bisa mengurai `.astro` — ia melewatinya
  **diam-diam**, meskipun `tsconfig.json` menulis `"include": ["src/**/*"]`.
  `astro build` juga tidak memeriksa tipe. Jadi 42 berkas / 22.328 baris (seluruh
  layar admin + login + halaman publik) menulis TypeScript yang tak pernah
  diperiksa siapa pun. Kelas yang paling mungkin lolos: `withTenant`
  (mengembalikan `T | Response`) dipakai di tempat `withTenantOrThrow`
  (melempar) yang benar — halaman tetap ter-compile dan merender data yang
  sebetulnya sebuah `Response`. Sampai `astro check` masuk rantai, **baca ulang
  tipe di `.astro` dengan mata**, jangan percaya CI hijau. Status 5 Agustus 2026:
  memasukkan `astro check` **TERBLOKIR eksternal** — `@astrojs/check` menuntut
  API TypeScript 6.x sedangkan repo di 7.0.2; keadaan ini tercatat sebagai
  divergence ADR-0068 §C (`awcms-family-compatibility.yaml`, reviewDate
  2027-02-04), jadi jebakan ini tetap berlaku penuh.
- **Repo ini tidak mengompresi apa pun — dan kompresi yang pembaca terima
  diwarisi dari lapisan yang tak diperiksa gerbang mana pun.**
  `edge-cache/response-headers.ts` memancarkan `Vary: Accept-Encoding` pada
  respons yang bisa di-cache, tetapi tak ada kompresi di aplikasi, tak ada
  `beresp.do_gzip` di `infra/varnish/default.vcl`, dan tak ada middleware
  `compress` Traefik yang dideklarasikan di repo; Varnish **tidak** mengompresi
  atas inisiatifnya sendiri. Pembaca produksi/staging TETAP menerima gzip —
  dari Cloudflare, karena kedua host proxied (`Cloudflare (proxied) → Traefik
:443 → varnish:80 → app`, [`awcms/environments.md`](awcms/environments.md)
  §Cache tepi). Konsekuensinya: deployment template ini di luar CDN pengompresi
  tidak mendapat kompresi sama sekali. Sejak 5 Agustus 2026 ketergantungan itu
  **dinyatakan, bukan disembunyikan** (celah C3 DITUTUP):
  `bun run security:readiness` memuat `checkResponseCompressionOwnership`, yang
  memindai lima lapisan yang repo ini kirim dan — karena tak satu pun
  mengompresi — menuntut blok bertanda `kompresi-tepi` di `environments.md`
  menyebut tier pengompresinya. Batasnya tetap harus dibaca: yang digerbangi
  adalah **deklarasinya**, bukan lapisan luarnya. Tidak ada gerbang di repo ini
  yang akan merah bila Cloudflare berhenti mengompresi atau dilepas dari depan
  Traefik — itu hanya terlihat dengan memeriksa `content-encoding` di tepi
  environment yang sebenarnya.

Detail lebih dalam ada di skill terkait (`awcms-new-migration`, `awcms-abac-guard`,
`awcms-testing`, `awcms-sync-hmac`, dst.) dan di ADR.

## 7. Cara melanjutkan

- Mulai unit kerja: skill `awcms-implement-issue` (orkestrator) → `awcms-new-module` /
  `awcms-new-migration` / `awcms-new-endpoint` / `awcms-new-event`.
- Kapabilitas dari arsip mini/micro: **bukan port** — [ADR-0055](adr/0055-development-confined-to-awcms-and-awcms-astro.md)
  menjadikan mini/micro arsip; kapabilitas baru masuk lewat **ADR admission dan
  dibangun di repo ini**. Skill `awcms-port-from-mini` HISTORIS (catatan cara
  port dulu dikerjakan; §Adaptasi-nya masih berguna saat membaca kode arsip).
- Review/keamanan: skill `awcms-pr-review`, `awcms-security-review`, subagent
  `awcms-reviewer` / `awcms-security-auditor`.
- Perbarui **dokumen ini** setiap ada perubahan state besar (modul/migrasi baru, keputusan
  tata kelola, backlog selesai) agar tetap jadi titik-lanjut yang akurat.
