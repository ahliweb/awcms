🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](PROJECT_STATE.md)

<!-- i18n-source-hash: sha256:d0614fd07157de0ee5ede46ec948681b16e398bc94154684033ca0935f187d03 -->

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

| Aspek                              | Nilai (ter-generate)                                                                  | Sumber kebenaran                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Versi                              | **9.1.2**                                                                             | `package.json`                                                                          |
| Changeset menunggu (per tipe bump) | _jalankan perintah di kolom kanan_                                                    | `grep -h '^"awcms":' .changeset/*.md \| sort \| uniq -c`                                |
| Commit sejak rilis terakhir        | _jalankan perintah di kolom kanan_                                                    | `git rev-list --count v9.1.2..HEAD`                                                     |
| Modul base                         | **24** (lihat daftar di ARCHITECTURE.md)                                              | `src/modules/index.ts`                                                                  |
| Migrasi                            | **148** (`sql/001`–`148`)                                                             | `ls sql/`                                                                               |
| ADR                                | **0000**–**0115** (`0000` = template; status ADR tertinggi: **Accepted**)             | `ls docs/adr/`                                                                          |
| Layar admin                        | **49** berkas `.astro` di `src/pages/admin/`; **0 dari 24** modul tanpa `navigation:` | `find src/pages/admin -name '*.astro'`, `grep -L 'navigation:' src/modules/*/module.ts` |
| Berkas `.astro`                    | **62** (35.126 baris) — soal typecheck lihat §6                                       | `find src -name '*.astro'`                                                              |
| Gerbang                            | **59** di rantai `bun run check`                                                      | `scripts.check` di `package.json`, dipisah pada `&&`                                    |
| Kontrak                            | OpenAPI modular per-modul + AsyncAPI; `MODULE_CONTRACT_VERSION` **4.1.0**             | `openapi/`, `asyncapi/`, `_shared/module-contract.ts`                                   |

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

- **24 modul** terdaftar dengan RLS `FORCE`, pemisahan role DB
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

- **PUTARAN KONSUMEN — 26 Agustus 2026: importer menghasilkan 25.029 artikel
  yang repo PENYAJINYA tidak membangun satu halaman pun untuknya, dan tujuan yang
  dituju artikel-artikel itu tak pernah dipilih.**

  PUTARAN ORIGIN di bawah ditutup dengan leave-list berisi dua item kode dan tiga
  item operasional. Kedua item kode itu kini SUDAH dibangun. Yang ditemukan
  sambil membangunnya lebih besar daripada keduanya: **arsipnya akan terimpor
  bersih ke dalam situs yang tidak merender satu pun darinya.**

  **`content_json` adalah `{ blocks: [] }` yang di-hardcode, di bawah docblock
  yang menyatakan sebaliknya.** Komentar `importLegacyBlogPost` sendiri berbunyi
  _"proyeksi lossy yang sama dengan yang dihasilkan setiap jalur tulis lain …
  sehingga baris hasil impor tak terbedakan bentuknya dari baris hasil
  penulisan"_. `blog-post-directory.ts:235` dan `blog-page-directory.ts:201`
  sama-sama memanggil `withProjectedBlocks`; berkas ini tidak memanggil apa pun.
  **Komentar bukan panggilan** — kelas yang kini sudah empat kali dicatat repo
  ini, dan instans ini menentukan seluruh cutover.

  Satu literal itu mengendalikan DUA hal terpisah di `ahliweb/awcms-astro`:

  - `renderContentBlocks(post.contentJson)` membaca `contentJson.blocks` dan
    mengembalikan `""` untuk non-array atau array kosong. Setiap artikel hasil
    impor akan menjadi **halaman KOSONG**.
  - `getArticles(tab, locale)` hanya menyimpan post ketika
    `readBlock(post).kategori === tab`, membaca `contentJson.awcmsAstro`. Tanpa
    kunci itu ia `undefined === tab` untuk setiap tab terkonfigurasi, jadi
    post-nya **tidak dibangun sama sekali** — dan arsip kategori pun tidak,
    karena `artikelSemuaSeksi` menyusunnya dari himpunan ter-filter-tab yang sama.

  **Dijalankan, bukan dinalar.** Sebuah probe sekali-pakai didirikan di dalam
  harness test repo itu sendiri lalu dihapus: post yang membawa sidecar membangun
  **1** artikel; post yang ditulis persis seperti importer ini menulisnya
  membangun **0**, di setiap tab terkonfigurasi. Jadi 63 aturan rubrik ADR-0113
  DAN peta artikel ber-kunci-id ADR-0114 masing-masing akan me-redirect ke
  halaman yang tak pernah dibangkitkan — `CUTOVER_VERDICT_REASON.target_missing`
  dengan kata-katanya sendiri, dan itulah satu hasil yang DoD kedua issue larang.
  Fixture repo itu sendiri tak mungkin menangkapnya: `buatPost` di
  `tests/kontrak-awcms.test.mjs` menulis
  `contentJson: { awcmsAstro: { … kategori: "panduan" } }` pada setiap baris,
  jadi suite-nya tak pernah melihat post tanpa itu.

  **Mengapa tak ada gerbang di sini yang bisa melihatnya, dan ini ANAK TANGGA
  BARU pada tangga yang sudah didaki dokumen ini.** `/blog/{code}/{slug}`
  merender dari `body_portable_text` dan hanya jatuh ke proyeksi untuk baris yang
  belum di-backfill (`blog-body-rendering.ts`), jadi post hasil impor tampak
  SEMPURNA DI SINI. Pelajaran yang bisa dipindahkan dari PUTARAN ORIGIN adalah
  _"apakah pemanggilnya ada di jalur permintaan?"_. Yang ini satu langkah lebih
  jauh: **apakah repo yang MENYAJIKAN ini membaca field yang dilewatkan penulis
  ini?** Tiga putaran, tiga anak tangga — apakah ia dipanggil, apakah pemanggilnya
  di jalur, apakah konsumennya membacanya.

  **Tujuannya tak pernah diputuskan, dan kedua paruhnya berselisih.** ADR-0113
  mengirim listing rubrik ke `/kategori/{slug}` di `awcms-astro`; tidak ada yang
  menyebut ke mana ARTIKELNYA pergi, dan satu-satunya penurunan artikel di repo
  ini membangun `` `/blog/${tenantCode}/${row.slug}` `` — permukaan repo ini.
  Satu cutover, **dua origin**, dan setiap tautan keluar dari sebuah arsip
  kategori akan meninggalkan origin yang merendernya. **ADR-0115** memutuskan
  satu origin: `/{section}/{slug}/` di `awcms-astro`, sesuai paruh yang sudah
  di-commit.

  **Aturan prefix yang benar di sini dan salah di sana.**
  `withPublicLocalePrefix` (ADR-0098) mem-prefix SETIAP locale termasuk yang
  bawaan; `localePath` milik `awcms-astro` mengembalikan path apa adanya untuk
  locale bawaannya dan hanya mem-prefix selainnya. Seluruh 25.029 artikel berada
  di locale bawaan, jadi artefak yang dibangun dengan aturan repo ini akan
  me-301 setiap satunya ke dalam 404. Tertangkap oleh test yang ditulis
  berdasarkan asumsinya lalu DIJALANKAN — peta rubrik ter-commit sudah
  mengatakannya sejak awal (`/kategori/daerah`, bukan `/id/kategori/daerah`).
  Karena itu `--default-locale` adalah flag WAJIB pada generator-nya, bukan
  konstanta: ia nilai milik repo penyaji, dan jawaban salahnya senyap.

  **Kedua item kode leave-list SUDAH dibangun.**

  1. `bun run blog:legacy:article-paths` — artefak id→path ADR-0114, diturunkan
     dari tenant, preview secara bawaan, beserta provenance. Ia MENOLAK
     memancarkan selama masih ada baris tanpa section: artefak yang 96% benar
     adalah artefak yang tak diaudit siapa pun. Ia tidak memancarkan VCL, nginx
     `map`, maupun CSV bulk-redirect — `infra/varnish/default.vcl` adalah berkas
     yang berjalan di produksi dan meng-`import std` dan tidak lebih, jadi 25.029
     lookup ber-kunci tidak terekspresikan di dalamnya, dan memilih tier atas nama
     operator adalah kelas tebakan yang sama dengan yang menjadi alasan
     keberadaan ADR-0114.
  2. `bun run blog:legacy:edge:verify` — verifier tingkat-HTTP. Ia meminta setiap
     URL legacy dengan `redirect: "manual"`, menyusuri rantainya, dan memakai
     ulang `classifyCutoverOutcome` sehingga run tepi dan run basis data
     melaporkan dalam satu kosakata. **Inilah pemutaran ulang yang memfalsifikasi
     ADR-0113, dibuat dapat diulang.** Sengaja TIDAK ada di rantai
     `bun run check`, dan memang tidak bisa: ia baru bermakna setelah tepinya
     diawatkan, yang oleh ADR-0114 disebut langkah operasional yang tak bisa
     ditutup repo ini. Ia perintah OPERATOR yang keluar non-nol, bukan gerbang
     — inventaris skrip ter-generate repo ini punya kolom Gate, dan baris ini
     berisi `—`. Diuji terhadap `Bun.serve` sungguhan, tidak
     pernah `fetch` tiruan, dengan alasan yang diberikan
     `edge-cache-purge-client.test.ts`: tiruan yang menegakkan
     `init.redirect === "manual"` lulus selamanya di atas klien yang tetap
     mengikuti redirect, dan laporannya lalu menunjukkan satu hop untuk rantai
     tiga hop.

  **Dua cacat yang ditemukan test baru di kode yang SUDAH ada.**

  - `listLegacyRedirectMappings` menjanjikan _"hanya post PUBLISHED dan tidak
    terhapus: redirect yang menunjuk draft mengirim mesin pencari ke 404"_ di atas
    persis dua kondisi itu, sementara rute yang menyajikan tujuannya menuntut
    EMPAT (`visibility IN ('public','unlisted')` dan `published_at <= now()`
    juga). Post `private` dan post bertanggal masa depan masing-masing mendapat
    aturan yang tujuannya 404 — paragraf yang menamai kegagalan yang dihasilkan
    fungsinya sendiri.
  - `CutoverFacts` tak punya cara mengatakan "tidak ada yang teramati". Kegagalan
    DNS, koneksi ditolak, timeout dan 502 semuanya tiba dengan nol hop, dan
    `hops === 0` satu-satunya yang dibaca `no_rule` — yang teks alasannya berbunyi
    percaya diri _"URL ini akan menjawab 404 setelah cutover, dan peringkatnya
    hilang"_. Sebuah 502 saat origin sedang restart akan mengirim operator
    membetulkan aturan yang sudah benar. Verdict baru: `unreachable`, argumen
    `target_unverifiable` satu baris ke samping. **Ditemukan dengan menulis
    testnya lebih dulu lalu menjalankannya**, bukan dengan membaca classifier-nya.

  **Sebuah review adversarial atas putaran ini menemukan TIGA cacat nyata di
  dalamnya, dan yang paling berguna adalah koreksi yang merusak dirinya sendiri.**

  - **Verifier tepi MENGIKUTI `Location` bermusuhan ke mana pun.** `probeUrlFor`
    menyaring KORPUS ke `http:`/`https:`; walker-nya lalu MEMBUANG keputusan itu
    untuk setiap hop yang benar-benar diterbitkannya. Terukur:
    `file:///etc/hostname` dan `data:text/plain,hi` sama-sama resolve dan
    tercatat sebagai 200, redirect ke port loopback mencapai server yang
    mendengarkan di sana, dan semuanya terklasifikasi **`ok`** — "resolve dalam
    satu hop ke halaman yang disajikan deployment ini". `hopRefusalFor` kini
    berjalan SEBELUM setiap permintaan, termasuk yang pertama, dan verdict baru
    `unsafe_redirect` MENGUNGGULI `loop` dan `chain_too_long` karena origin
    bermusuhan bisa menghasilkan keduanya. Ia mengimpor `isBlockedAddress`
    alih-alih menyatakannya ulang; `validateOutboundUrl` tidak bisa dipakai apa
    adanya karena ia MENOLAK `http:`, yang justru bentuk yang dipegang crawler,
    dan `ssrfSafeFetch` mengikuti redirect secara internal, yang memusnahkan
    visibilitas per-hop yang menjadi alasan keberadaan job ini. Hostname sengaja
    TIDAK di-resolve, dan itu ditulis sebagai BATAS alih-alih dibiarkan sebagai
    lubang.
  - **`buildArticlePaths` memvalidasi DUA dari TIGA segmen yang dibangunnya.**
    Locale-nya masuk mentah di bawah komentar berbunyi "Kedua paruhnya menjadi
    segmen URL, dan keduanya diperiksa" — **komentar yang menyatakan pengikatan
    yang tak dilakukan panggilan mana pun, di dalam berkas yang ditambahkan untuk
    memperbaiki instans persis itu.** `awcms_blog_posts.locale` tidak punya
    CHECK constraint.
  - **Koreksi simbol itu merusak dirinya sendiri, dan itulah paruh yang bisa
    dipindahkan.** Rename-nya diterapkan atas keempat berkas TERMASUK satu
    kemunculan yang harus tetap salah supaya kalimatnya bermakna, sehingga kedua
    salinan menyatakan bahwa nama yang BENAR tidak ada. **Cari-dan-ganti atas
    prosa tidak tahu kemunculan mana yang KUTIPAN dan mana yang KLAIM** — nama
    yang salah kini dieja sebagai dua penggalan tersambung supaya yang berikutnya
    tak bisa menjangkaunya.

  Review itu juga menemukan dua array verdict tulisan-tangan di
  `tests/cutover-verification.test.ts` tertinggal dari union-nya: satu mendaftar
  tujuh anggota dan satunya enam (ia sengaja menghilangkan `ok`) terhadap union
  berisi delapan. Keduanya kini DITURUNKAN dari kunci `CUTOVER_VERDICT_REASON` — yang
  dibuat ekshaustif oleh `Record<CutoverVerdict, string>` — dan perubahan itu
  membuktikan dirinya dalam hitungan jam dengan MEMERAH saat `unsafe_redirect`
  mendarat.

  **Setiap perbaikan membawa mutasi yang TERBUKTI gagal pada cacat yang
  sesungguhnya**, dan pelajaran GRAIN yang dicatat PUTARAN ORIGIN diterapkan
  alih-alih diulang. Mutasi diterapkan dan dijalankan — **23 di sepanjang putaran
  ini**, masing-masing pada GRAIN terkecil yang menyisakan setiap identifier yang
  disebut test-nya.

  Tidak ada daftar yang diberi angka di depannya di sini, dengan sengaja. Draf
  pertama paragraf ini berbunyi "sembilan mutasi" lalu mengenumerasi SEPULUH,
  yang merupakan kelas yang sama dengan segala hal lain yang dicatat putaran ini:
  sebuah angka dan sebuah daftar, yang dijaga tetap sepakat oleh TIDAK SIAPA PUN.
  Angka di atas bisa diperiksa sendiri; ketiga contoh di bawah adalah CONTOH.

  **Salah satunya adalah SELURUH argumen bagi test integrasi.** Biarkan
  `legacyContentJson` benar dan tetap ter-ekspor, lalu ubah HANYA INSERT-nya
  supaya berhenti memanggilnya: suite DB-free **13 pass / 0 fail** — hijau di
  atas builder yang tak dipanggil siapa pun, yang persis keadaan yang dikirim —
  sementara `tests/integration/legacy-import.integration.test.ts` memerah pada
  kolom yang dibacanya kembali dari Postgres. Test murni atas fungsi murni tak
  bisa membedakan "ini benar" dari "ini benar dan tak terpakai".

  **Sebuah ADR ter-merge MENYEBUT simbol yang TIDAK ADA, di dalam paragraf yang
  menyuruh pembacanya jangan.** ADR-0114 dan kedua salinan PROJECT_STATE
  menempatkan regex slug inline itu di dalam fungsi yang mereka sebut
  `validate`+`LegacyPostImportRecord` — tidak ada simbol semacam itu di mana pun
  di repo ini. Fungsi yang diekspor adalah `parseLegacyImportRecord`
  (`src/modules/blog-content/domain/legacy-import-record.ts`). Paragraf yang
  membawa kekeliruan itu dibuka dengan _"Sebut simbol itu dengan TEPAT, karena
  nama yang salah mengirim agen ke berkas yang salah."_ Dikoreksi di keempat
  berkas; changeset ter-merge sengaja tidak ditulis ulang.

  **Dan koreksinya merusak dirinya sendiri lebih dulu, dan itulah bagian yang
  layak disimpan.** Perbaikannya diterapkan sebagai rename menyeluruh atas
  keempat berkas — TERMASUK satu kemunculan yang HARUS tetap salah supaya
  kalimatnya bermakna. Kedua salinan lalu berbunyi "mereka menyebutnya di dalam
  X; fungsi yang diekspor adalah X, dan tidak ada simbol semacam itu",
  menyatakan bahwa nama yang BENAR tidak ada. Sebuah review menangkapnya. Nama
  yang salah dieja di sini sebagai dua penggalan yang disambung justru supaya
  rename menyeluruh berikutnya tidak bisa menjangkaunya: **cari-dan-ganti atas
  prosa tidak tahu kemunculan mana yang KUTIPAN dan mana yang KLAIM.**

  **Yang tersisa, dan repo ini TETAP tidak bisa menutup cutover-nya.**

  - **KODE:** tidak ada dari leave-list sebelumnya. Duplikasi slug yang
    disebut-tapi-ditunda (`legacy-import-record.ts` membawa salinannya sendiri
    atas regex `slug-policy.ts`, dan atas batas 200 karakternya) masih terbuka
    dan masih sengaja di luar lingkup di sini — meruntuhkannya menuntut
    `slug-policy.ts` mengekspor keduanya, yang merupakan perubahan pada simbol
    dengan **14 call site di sembilan berkas pada tree tempat entri ini dikirim**
    — 10 di 7 berkas pada HEAD, ditambah empat yang ditambahkan putaran ini di
    `legacy-section-map.ts` dan `blog-legacy-article-paths.ts`. ADR-0114
    menghitung delapan. Angka yang diukur SEBELUM sebuah perubahan lalu dikutip
    SESUDAHNYA adalah kelas yang sama dengan komentar yang bukan panggilan.
  - **OPERASIONAL, tidak berubah:** kesepuluh kategori tujuan; ~25.031 unggahan /
    4,1 GB, masih pemblokir KERAS karena importer menolak baris yang
    `featuredImageSrc`-nya tak terpetakan dan 25.029 dari 25.029 memilikinya;
    pengawatan tepi. **Dan DUA yang ditambahkan putaran ini.** (1) `awcms-astro`
    membangun halaman STATIS, jadi kesepuluh kategori yang ada itu perlu dan
    TIDAK cukup: arsipnya harus diimpor _dan_ situs itu di-rebuild serta
    di-redeploy sebelum satu pun tujuan benar-benar ada. (2) Bahkan sebelum itu,
    **kesepuluh slug section WAJIB ditambahkan ke `siteConfig.tabs` yang
    di-hardcode di repo itu** — `getArticles` berjalan sekali per tab
    terkonfigurasi dan hanya menyimpan post ketika
    `readBlock(post).kategori === tab`, jadi section yang tidak menamai satu pun
    tab terkonfigurasi membangun NOL, hasil nol-halaman yang sama dengan tanpa
    sidecar sama sekali. Sebuah perubahan KODE di repositori lain, berurutan
    sebelum rebuild-nya, dan tak ada apa pun di sini yang bisa memeriksanya.

- **PUTARAN ORIGIN — 26 Agustus 2026: peta cutover-nya BENAR soal ke mana
  pembaca dikirim dan SALAH soal SIAPA yang mengirimnya, dan tak ada gerbang di
  repo ini yang bisa melihatnya karena jawabannya hidup di repo lain.**

  **Sebuah ADR yang sudah di-merge itu SALAH.** ADR-0113 §Konsekuensi menyatakan,
  dalam kedua bahasa, _"`awcms-astro` tidak butuh perubahan untuk ini… redirect-nya
  diselesaikan di repo ini sebelum rute-rutenya tercapai."_ `awcms_seo_redirects`
  diterapkan di **tepat SATU call site** — `resolvePublicRedirectForRequest`, dari
  `src/middleware.ts:341` — yang berjalan DI SINI. Ke-62 aturan rubrik menyasar
  `/kategori/**`, yang disajikan `ahliweb/awcms-astro`: `output: "static"`,
  **tanpa berkas middleware sama sekali**, tanpa kunci `redirects:`, dan
  entrypoint produksi `server/penyaji.mjs` yang memuat NOL kemunculan `301`
  maupun `Location`. `grep -rn seputarborneo` atas seluruh `src/` dan `docs/`-nya
  mengembalikan nihil.

  Bukan diperdebatkan — DIJALANKAN. Seluruh 67 entri yang di-commit diputar ulang
  terhadap server hasil build repo itu: **404 pada setiap satunya, NOL header
  `Location`.**

  Dua keputusan mengikut, tercatat sebagai **ADR-0114**. **TEPI**
  (Coolify/Varnish) memikul 301 legacy-nya, karena hanya ia yang bisa meruntuhkan
  `http→https` + `www→apex` + `legacy→baru` menjadi SATU hop yang dituntut PRD
  §9.2 — sebuah aplikasi baru melihat permintaan setelah tepi bertindak atas skema
  dan host, jadi aturan apa pun yang ditulisnya paling baik adalah hop kedua. Dan
  resolusi artikel menjadi **berkunci-ID**, bukan path-eksak:
  `/news/{id}_{Judul}.html` dicocokkan pada digit terdepannya terhadap
  `legacy_source_id`.

  **Template artikel yang sudah dikirim mencocoki 0 dari 25.029 URL, dan gagal
  lebih buruk daripada 404.** Setiap judul legacy memuat spasi, jadi setiap segmen
  URL legacy membawa `_` — yang dilarang regex slug **INLINE** importer legacy di
  `legacy-import-record.ts` (`if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))` di
  dalam `parseLegacyImportRecord`; **TIDAK ADA** simbol bernama
  `SLUG_PATTERN` di berkas itu — satu-satunya yang ada adalah const PRIVAT di
  `slug-policy.ts`, yang diekspos sebagai `isValidSlug`, yang tak pernah dipanggil
  importer itu dan kedelapan call site-nya adalah post, page, term serta kunci
  menu SETIAP tenant LAIN), sementara `normalizeRedirectPath` mempertahankan
  kapitalisasi, tidak men-decode apa pun, dan mencocokkan dengan KESAMAAN.
  **Tidak ada slug lolos-validator yang bisa sama dengan segmen terindeks itu**;
  kedua slug itu terpisah secara KONSTRUKSI. Dikonfirmasi dari luar terhadap
  korpus ter-commit: dari 2.301 URL `/news/*` terarsip di dalamnya, 2.224 memakai
  bentuk underscore dan **NOL** memakai bentuk hyphen (semula tertulis "2.297 dari
  2.297"; kesimpulannya TIDAK berubah). Dan `/news/**` yang
  tak cocok tidak menjadi 404 — ia jatuh ke `resolveRetiredNewsRedirect` lalu 301
  ke `/blog/{code}/{id}_{Raw_Slug}.html`, yang persis
  `CUTOVER_VERDICT_REASON.target_missing` dengan kata-katanya sendiri: _"301 ke
  dalam 404, yang lebih buruk daripada 404 yang digantikannya"._ Kekeliruan
  penalarannya layak dinamai: **"id-nya adalah digit terdepan" itu benar tentang
  router LEGACY dan tidak berkata apa pun tentang awcms, yang kunci aturannya
  string EKSAK.**

  **Bentuk 4 TAK PERNAH ADA.** `^cari_berita/([^/]*)\.html$` adalah baris 7
  `.htaccess` dan catch-all dua-segmen baris 6, dan bahasa bentuk 4 adalah SUBSET
  ketat dari bahasa catch-all — jadi ia tak pernah tercapai, di setiap commit yang
  pernah menyentuh berkas itu, dan kedua vhost docker membawa pasangan yang sama
  dalam urutan yang sama. Ini soal URUTAN aturan, bukan flag `[L]`: pada baris 7,
  URL-nya sudah `/rubriks/?news=cari_berita&kt=…`. Di-brute-force atas 3.375 path
  kandidat (0 kecocokan, dengan self-test yang MEMANG menemukan counterexample
  saat bentuk 4 sengaja dilebarkan), dikonfirmasi hidup
  (`/cari_berita/sampit.html` dan `/rubriks/?news=cari_berita&kt=sampit` berbeda
  pada satu baris, `og:url`), dan dikonfirmasi terhadap 5.170 URL terarsip dalam
  korpus ter-commit — putarannya menyebut 5.174 sebelum tarikannya di-commit, dan
  NOL di antaranya `/cari_berita/*.html` dengan angka mana pun. Jadi keputusan
  bentuk-4 ADR-0113
  memutuskan himpunan KOSONG, dan butir terbuka #711 _"aturan `cari_berita` —
  butuh sitemap hidup"_ larut DUA KALI. Sisanya penting: `/cari_berita/X.html`
  tetap menyajikan 200 **sebagai URL bentuk-3** dan TIDAK BOLEH menjadi redirect
  `/cari?q=`, yang akan mengirim pembaca ke tempat yang tak pernah dituju situs
  legacy.

  **Dua gerbang akan melaporkan HIJAU atas semua itu.**
  `blog:legacy:cutover:verify` keluar dengan **0 pada SETIAP kesalahan
  penggunaan** — `usage()` di `scripts/blog-legacy-cutover-verify.ts:82-93` tidak
  memuat `process.exitCode = 1`, direproduksi untuk tanpa argumen, untuk setiap
  flag wajib yang hilang, dan untuk `--limit=abc`, sehingga
  `bun run blog:legacy:cutover:verify --sitemap=$F && deploy` tetap men-deploy
  saat flag-nya salah ketik. Dan `classifyCutoverOutcome`
  (`cutover-verification.ts:137`) hanya menangani `targetLive === false`;
  `targetLive === null` jatuh ke `return "ok"`, sementara `postSlugFromPath` milik
  skrip itu mengembalikan `null` untuk apa pun yang bukan
  `/blog/{tenantCode}/{slug}` — yaitu **SETIAP SATU** dari 62 target `/kategori/*`
  ADR-0113. Digabung, gerbang itu akan mencetak _"All N legacy URL(s) resolve in
  one hop to a page this deployment serves"_ sementara origin-nya 404 untuk
  ke-67-nya. **Gerbang yang HIJAU sementara jawabannya SALAH adalah
  mode kegagalannya**, dan ini instansi paling jelas yang pernah dihasilkan repo
  ini.

  **Keduanya KINI sudah diperbaiki** (branch yang sama, tepat sesudah putaran
  ini). `usage()` menyetel `process.exitCode = 1`; verdict
  `target_unverifiable` menggantikan `ok` yang senyap itu dan ia TIDAK bersih;
  dan pencarian liveness diperlebar dari satu rute menjadi kedelapan rute di
  bawah `src/pages/blog/[tenantCode]/`, sehingga verdict baru itu hanya menyala
  untuk tujuan yang memang BUKAN permukaan deployment ini — `/kategori/*`
  termasuk di dalamnya. Dua hal muncul dari meng-grep PANGGILANNYA alih-alih
  membacanya: rute-rutenya mengonsultasi `legacyTenantRouteEnabled` SEBELUM
  pencarian apa pun (jadi job-nya kini membacanya sekali per run dan
  memperingatkan bila permukaan publiknya mati), dan skripnya tidak pernah
  menutup klien SQL-nya. `--urls=<path>` ditambahkan di samping `--sitemap`,
  yang melarutkan _"butuh sitemap hidup"_ di mana pun ia muncul — flag itu
  selalu membaca berkas LOKAL. Setiap perbaikan membawa tes yang DIBUKTIKAN
  gagal pada cacat aslinya: empat mutasi diterapkan dan dijalankan, dan bukti
  ujung-ke-ujungnya adalah satu aturan nyata berbentuk persis seperti ADR-0113
  yang terhitung `ok` sebelum perubahan dan `target_unverifiable` sesudahnya.
  **Yang MASIH tidak bisa dilihat gerbang itu kini ada di docstring-nya
  sendiri:** ia membuat NOL permintaan HTTP, sehingga di bawah ADR-0114 sebuah
  run hijau tidak berkata apa pun tentang tepi yang benar-benar memancarkan
  301-nya.

  **Importer-nya membuang SETIAP foto utama secara senyap.** `featured_media_id`
  ADA (`sql/035:46`) dan disajikan ke `awcms-astro`, tetapi
  `LegacyPostImportInput` punya 12 field dan tak satu pun media, dan INSERT-nya
  menyebut 16 kolom tanpanya. **25.029 dari 25.029 artikel punya gambar utama** di
  `foto_berita`, dan `--images` hanya memindai HTML badan, jadi ia tak akan pernah
  menyebutnya: tugas media yang sesungguhnya ~25.031 unggahan / 4,1 GB, bukan 2
  yang ditemukan pemindaian badan. Tiga cacat lebih kecil duduk di sebelahnya —
  pengumpulan `--images` duduk DI BAWAH gerbang kategori
  (`blog-legacy-import.ts:443-458`), jadi run tanpa `--term-map` melaporkan NOL
  gambar, bug urutan yang sama yang sudah diperbaiki satu fungsi di atasnya pada
  `:435`; ada himpunan `seenLegacyIds` dan tidak ada `seenSlugs`, sedangkan arsip
  nyatanya punya 84 grup tabrakan atas 171 baris, jadi run sungguhan mati oleh
  23505 di tengah batch; dan docstring yang mengklaim _"SETIAP baris arsip
  CKEditor nyata adalah residu"_ terukur **4 dari 25.029 (0,02%)**.

  **Keempatnya KINI diperbaiki** (branch yang sama, setelah pekerjaan gerbang di
  atas). Record-nya membawa `featuredImageSrc`, ia diselesaikan lewat serah
  terima `--media-map` yang SAMA dan sapuan `isMediaReferenceSafe` yang SAMA
  seperti `<img>` badan — satu peta, satu gerbang, sengaja TANPA pemeriksaan
  kedua yang lebih lemah — yang terpetakan ditulis ke `featured_media_id`, dan
  yang tak terpetakan DITOLAK dengan baris laporan alih-alih diimpor tanpa
  fotonya. `--images` kini melaporkan foto utama dan gambar badan sebagai
  hitungan TERPISAH, karena satu total tunggal itulah yang membuat "2" terbaca
  sebagai "hampir tidak ada pekerjaan". Pengumpulannya pindah ke ATAS KEDUA
  gerbang yang `continue`, dan `--terms`/`--images` kini tidak membuka klien
  basis data sama sekali, sehingga flag yang dijalankan operator PALING AWAL tak
  lagi mati oleh `DATABASE_URL … is required` — yang sekaligus membuat urutannya
  bisa dibuktikan di suite tanpa-DB, bukan hanya melawan Postgres hidup. Peta
  `seenSlugs` duduk di sebelah `seenLegacyIds` dan menyebut baris yang
  ditabrak oleh baris kedua.

  Lima mutasi DITERAPKAN dan DIJALANKAN, bukan dinalar: urutannya dikembalikan
  (upload set → 0), `src` foto utama dibuang dari pengumpulan, klien dibuka
  eager, `featured_media_id` dihapus dari INSERT, dan `seenSlugs` dihapus — yang
  terakhir mereproduksi crash aslinya,
  `duplicate key value violates unique constraint "awcms_blog_posts_slug_dedup"`
  pada exit 1, yang kini menjadi baris laporan pada exit 0. **Bagian yang bisa
  dipindahkan:** tiga dari empat adalah URUTAN dan KELALAIAN, bukan logika —
  sebuah pernyataan yang ADA dan BENAR, duduk setelah `continue` yang
  melewatinya, dan sebuah kolom yang ADA di skema, di pembaca dan di port, tanpa
  penulis. Kedua bentuk itu tak terlihat oleh tes fungsi murni, dan begitulah
  keempatnya tetap hijau.

  **`IMPORT_CHUNK_SIZE = 200` diikat ke `MAX_IMPORT_ITEMS` HANYA OLEH KOMENTAR** —
  tanpa import, tanpa test. Kelas berulang repo ini, dinyatakan lagi: **komentar
  BUKAN panggilan.**

  **Tiga koreksi catatan.** Arsipnya **25.029**, bukan 23.906 (yang hidup sudah di
  id ≥ 25.474); ADR-0114 memikul koreksi tunggalnya dan changeset ter-merge
  SENGAJA tidak ditulis ulang. Peta rubrik yang di-commit punya satu celah nyata —
  `/Mitra-Borneo/Pemkab%20Lamandau.html` mengembalikan 200 dengan listing
  sungguhan dan TIDAK termasuk 67-nya, karena homepage memancarkannya tanpa
  `.html` sementara penangkapannya berkunci pada sufiks itu. Dan **Wayback CDX
  memuat 5.174 URL berbeda** untuk domain ini (diverifikasi tanpa terpotong: dua
  halaman, 2.975 + 2.200), yaitu ~8,86% korpus — bukti eksternal nyata yang MELURUH
  dan tak bisa direkonstruksi, jadi layak di-commit BESERTA caveat itu, dan ia
  bukan pengganti himpunan terindeks.

  **Higienenya SELESAI, dan dua klaim pada paragraf di atas SALAH.**
  `IMPORT_CHUNK_SIZE` kini `MAX_REDIRECT_IMPORT_ITEMS`, didefinisikan SEKALI di
  `seo-distribution/domain/redirect-rule.ts` dan di-import oleh endpoint MAUPUN
  pembangun payload-nya, dengan test yang menegaskan keduanya lewat IDENTITAS;
  mutasi pembuktinya — hardcode ulang `200` di pembangun, geser cap endpoint ke
  150 — diterapkan dan dijalankan MERAH. `--emit` kini menulis DI SAMPING
  petanya, bukan ke direktori kerja, dan path petanya diangkurkan ke skripnya,
  jadi satu run tak lagi bergantung pada tempat operatornya berdiri.

  **Celah Lamandau NYATA dan DESKRIPSINYA SALAH.**
  `/Mitra-Borneo/Pemkab%20Lamandau.html` mengembalikan 200 dengan listing
  **KOSONG**, bukan listing sungguhan: diambil langsung, ia identik byte dengan
  `Pemkab%20Seruyan.html` yang sudah diketahui nol kecuali nama kategorinya, dan
  probe ulang atas snapshot yang SAMA menjawab **0** baris melawan **133** untuk
  induknya. Yang ditautkan navigasinya adalah `Mitra-Borneo/Pemkab Lamandau`
  **tanpa `.html`**, dan bentuk itu **404** — `.htaccess` hanya menulis ulang
  `…\.html$`, jadi item nav itu sudah rusak bertahun-tahun. Entrinya menjadi yang
  ke-68 dan mendapat perlakuan PERSIS seperti 23 saudaranya
  (`/kategori/mitra-borneo`; destinasinya tetap sepuluh), ditandai
  `hrefLacksHtmlSuffix: true` dengan test yang memeriksa penanda itu TERHADAP
  href-nya. KELASNYA yang disapu, bukan instansnya: tepat satu literal tautan
  listing di pohon itu tak ber-`.html`, dan satu-satunya tautan relatif
  tanpa-ekstensi lainnya adalah `./video/?video=5`, yang memang di luar cakupan.
  **Karena itu peta ter-commit-nya 68 entri dan 63 aturan, dan setiap hitungan
  yang lebih awal di putaran ini (67 entri, 62 aturan, 32 mati, 27 dipindah ke
  induk) DIGANTIKAN olehnya** — hitung
  `data/seputarborneo-legacy/rubrik-redirects.json`, yang kini di-assert sebuah
  test pada 68.

  **Tarikan CDX-nya 5.170, bukan 5.174** — di-commit apa adanya sebagai
  `data/seputarborneo-legacy/wayback-cdx-2026-08-26.txt`. `showNumPages=true`
  MEMANG menjawab **2**, tetapi hanya pada query telanjang; tambahkan `collapse`
  atau `pageSize` dan ia menjawab `-`. Kedua halaman memuat 2.975 dan 2.196,
  berjumlah 5.171 karena `collapse` diterapkan per halaman, dan gabungannya
  identik dengan tarikan tanpa-paginasi itu. "~8,86% korpus" sebenarnya angka
  CAKUPAN ARTIKEL: **2.219 id artikel berbeda, 8,87% dari 25.029**. Dua caveat
  yang belum dimiliki putaran itu: banyak capture-nya HTTP 200 di atas halaman
  tantangan bot, jadi 200 dalam korpus ini TIDAK berarti sebuah halaman
  tersajikan; dan **22 dari 68 URL peta ini TIDAK ADA dalam korpus**, yang
  merupakan alasan konkret bahwa ia bukti dan bukan himpunan terindeks. Paruh
  eksternal ADR-0114 bertahan pada tarikan ini — 2.224 URL artikel terarsip
  berbentuk garis-bawah, **nol** berbentuk tanda-hubung.

  **URL yang TIDAK mendapat aturan, diputuskan alih-alih dibiarkan terbuka.** Dua
  typo yang hanya ada di Wayback BUKAN entri: `jenis_rubrik = 'aerah'` dan
  `'Olah Raya'` sama-sama mengembalikan 0 baris, jadi ADR-0113 menjadikannya
  yatim, dan menambahkannya berarti menukar aturan keanggotaan MEKANIS peta itu
  dengan yang sewenang-wenang. Jawaban dan alasan yang sama untuk 75 URL terarsip
  bersegmen ganda `/news/news/{id}_…`, yang 404 saat dirayapi dan 404 hari ini.
  Dan peta ARTIKEL tetap TIDAK di-commit atas kebalikan justifikasi peta rubrik —
  25.029 baris yang bisa diturunkan dari `legacy_source_id` dan masih bertambah,
  melawan himpunan yang sama sekali tak bisa diturunkan ulang.

  **Dua gerbang BARU putaran ini sendiri tidak menggerbangi apa yang diklaim
  komentarnya, dan dua paragraf di atas dikoreksi di sini.** Kedua mutasi yang
  "membuktikan" keduanya diterapkan pada BUTIRAN yang salah.

  `IMPORT_CHUNK_SIZE` dibuktikan dengan meng-hardcode ulang `200` milik builder
  **dan** memindahkan cap endpoint ke 150 — dua perubahan sekaligus. Hardcode
  ulang saja, dan tesnya tetap **hijau, 12 pass / 0 fail**, karena `200 === 200`.
  "Tes yang menegaskan keduanya secara identitas" menggambarkan KOMENTAR yang
  dibawa tes itu, bukan asersi yang dibuatnya:
  `expect(IMPORT_CHUNK_SIZE).toBe(MAX_REDIRECT_IMPORT_ITEMS)` membandingkan dua
  NILAI. Satu-satunya yang menangkap salinan itu adalah TS6133 dari `typecheck`
  atas import yang jadi tak terpakai — cengkeraman yang hilang begitu seseorang
  menghapus import itu bersama literalnya. Tes kini juga menegaskan, atas source
  builder dengan komentar dibuang lebih dulu (`scripts/lib/source-text`,
  pembuang komentar repo ini persis untuk ini), bahwa
  `IMPORT_CHUNK_SIZE = MAX_REDIRECT_IMPORT_ITEMS` benar-benar muncul: merah pada
  hardcode-ulang saja, dan merah lagi bila ikatan itu hanya ada di dalam
  komentar. Asersi nilai TETAP dipertahankan — masing-masing menangkap yang tak
  bisa ditangkap yang lain.

  Mutasi `seenSlugs` kasar dengan cara yang sama: seluruh Map dihapus. Hapus
  HANYA `continue;` dari cabang tabrakan — Map, dorongan penolakan, dan urutannya
  dibiarkan utuh — dan suite bebas-DB **hijau, 43 pass / 0 fail**, atas dedupe
  yang tidak men-dedupe, sementara
  `tests/integration/legacy-import-cli.integration.test.ts` benar-benar mati pada
  23505 yang nyata. Perilakunya MEMANG digerbangi, tetapi hanya oleh suite
  ber-DB: siapa pun yang menjalankan perintah lokal terdokumentasi
  `DATABASE_URL="" bun run check` sebelum push melihat hijau penuh, dan ini
  berdekatan dengan KEHILANGAN DATA — 84 grup tabrakan atas 171 baris mematikan
  run nyata di tengah batch, setelah batch-batch sebelumnya ter-commit. Tes lama
  menyematkan kehadiran identifier dan posisinya relatif terhadap
  `categoriesPerArticle.push`, dan setiap bagiannya SELAMAT dari mutasi itu.

  Perbaikannya struktural, bukan pencocokan string yang lebih baik. Keputusan
  per-baris dipindahkan keluar dari `main` ke fungsi murni ter-ekspor
  `planLegacyImportRows`, yang tidak butuh database karena peta media dan peta
  term yang dikonsultasinya SUDAH diverifikasi terhadap tenant oleh `main`
  sebelum baris pertama dibaca; `main` menyimpan dua sapuan verifikasi itu, satu
  query `findTakenSlugs`, dan tulis berbatch. Empat tes bebas-DB kini membaca
  `accepted`/`refusals`/`categoriesPerArticle` yang dikembalikan alih-alih teks
  source berkasnya, dan mutasi hanya-`continue` memerahkan dua di antaranya. Dua
  koreksi sampingan ikut serta: entrypoint skrip kini di balik `import.meta.main`,
  karena meng-import CLI tanpa penjaga MENJALANKANnya (`usage()`,
  `process.exitCode = 1`, seluruh suite non-nol dengan alasan yang tak disebut
  apa pun di dalamnya); dan klien yang dibuka malas pindah dari `let` telanjang
  ke sebuah objek, karena analisis alur-kendali TypeScript tak bisa melihat
  penugasan dari closure dan membaca `sql` sebagai persis `null` di `finally`
  begitu `main` cukup kecil untuk dianalisis. Diverifikasi terhadap Postgres
  nyata: berkas integrasi CLI 6/6, `tests/integration/` 593 pass / 0 fail.

  **Bagian yang bisa dipindahkan, dan ini BUKAN yang sudah dicatat putaran ini:**
  sebuah mutasi hanya setajam BUTIRANnya. Menghapus seluruh mekanisme — Map-nya,
  ikatan konstantanya — membuktikan mekanisme itu DIRUJUK, bukan bahwa ia
  MEMUTUSKAN apa pun. Mutasi yang menemukan tes yang mengklaim berlebih adalah
  mutasi TERKECIL yang membiarkan setiap identifier yang disebut tes itu tetap di
  tempatnya.

  **Yang kini ditinggalkan putaran ini.** Versi lebih awal penutup ini berbunyi
  _"artefak id→path ter-generate milik ADR-0114 dan pengawatan tepinya, keduanya
  butuh tenant hidup — selebihnya semua yang ia buka sudah ditutup"_. Itu SALAH
  dalam empat hal sekaligus, dan inilah daftar-sisa terpendek dan terbaru,
  sehingga inilah yang akan dieksekusi orang. Belah menurut **mana yang KODE**
  dan **mana yang OPERASIONAL**, dan pakai ulang kalimat ADR-0114 sendiri:
  **repo ini TIDAK BISA menutup cutover-nya. Issue mana pun yang menyatakan
  cutover "selesai" begitu artefaknya di-commit sedang menyatakan hal yang
  keliru.**

  **KODE, belum ditulis, dan tempatnya DI SINI:**

  1. **Generator id→path itu TIDAK ADA.** Artefak artikel ADR-0114 adalah tabel
     id → path post yang di-generate dari tenant;
     `data/seputarborneo-legacy/README.md` §"The ARTICLE map is deliberately NOT
     committed" menyatakannya terus terang — _"the generator is not built yet"_.
     Tenant hidup adalah apa yang ia generate TERHADAPnya, bukan apa yang sedang
     ia tunggu.
  2. **Verifier tingkat-HTTP untuk tepi juga TIDAK ADA, dan tanpanya tak ada apa
     pun di sini yang bisa menegaskan DoD #599.** ADR-0114 mencatat bahwa
     `blog:legacy:cutover:verify` _"memverifikasi lapis yang SALAH"_ untuk URL-URL
     ini, dan docstring skripnya sendiri kini menyatakan ia melakukan **NOL
     permintaan HTTP** dan bahwa membaca header `Location` yang akan diterima
     pembaca _"adalah tool yang BERBEDA, dan ini bukan tool itu"_. Jadi untuk
     tujuan `/kategori/**` — yaitu seluruh 63 aturan rubrik — vonis jujur yang
     dikirim branch ini adalah `target_unverifiable`, dan tidak ada alat di repo
     ini yang bisa mengubahnya menjadi lulus.

  **OPERASIONAL, dan ini memang butuh tenant hidup / infrastrukturnya:**

  3. **Kesepuluh kategori tujuan WAJIB sudah ada di tenant sebelum cutover**, atau
     setiap aturan 301 ke dalam 404 — ADR-0113 §Konsekuensi masih menyatakannya di
     branch ini, dan itu kegagalan ADR-0111 satu langkah di sebelahnya.
  4. **~25.031 unggahan / 4,1 GB media**, yang oleh putaran ini dijadikan
     **PEMBLOKIR KERAS**, bukan tindak lanjut: importer kini MENOLAK setiap baris
     yang `featuredImageSrc`-nya tidak tercakup `--media-map`
     (`scripts/blog-legacy-import.ts`, penolakan `featuredMediaId === null`), dan
     **25.029 dari 25.029 baris memilikinya**. Sampai media itu diunggah dan
     dipetakan, impor #599 sama sekali tidak berjalan — ia melaporkan 25.029
     penolakan.
  5. **Mengawatkan artefaknya ke Varnish/Coolify**, sebuah perubahan
     infrastruktur di luar kedua repositori.

  Bentuk yang bisa dipakai ulang, dan ini benar-benar baru: **setiap putaran
  sebelumnya di sini bertanya "apakah simbol ini DIPANGGIL?" — putaran ini
  menemukan sebuah keputusan yang targetnya disajikan ORIGIN yang sama sekali
  BERBEDA.** ADR-0113 benar soal harus me-redirect ke mana dan salah soal siapa
  yang akan melakukan redirect-nya, dan tak ada gerbang di repo ini yang bisa
  melihat itu, karena jawabannya adalah konfigurasi build di repositori lain.
  Pemeriksaannya bukan hanya "apakah ia dipanggil" tetapi **"apakah pemanggilnya
  bahkan berada di jalur permintaan"**.

- **PUTARAN SEAM — 26 Agustus 2026: tiga gerbang hanya membaca paruh Inggris,
  dan gerbang keempat sama sekali tidak punya PEMANGGIL.**

  Tindak lanjut yang dituntut audit #728. Kelasnya tak pernah "blok ter-generate
  di mirror" — kelasnya **setiap gerbang yang membaca berkas Inggris lalu
  berhenti**, dan kedua paruhnya selalu masing-masing benar tentang sisinya
  sendiri.

  **76 berkas mirror membuat klaim tentang KODE yang tak dibaca apa pun.**
  `skills:check` ada justru karena skill yang salah lebih buruk daripada dokumen
  basi — agen MENGIKUTI skill — dan ia mem-glob `SKILL.md` serta
  `src/modules/*/README.md`. Jadi 55 `SKILL.id.md` dan 21 `README.id.md` modul
  bisa menyebut target `bun run` yang tidak ada, atau path yang sudah diganti
  nama, dengan setiap gerbang hijau. Kedua korpus diperlebar, dan tiga
  kerusakan nyata kini menyebut mirror-nya dengan tepat.

  **Draf pertamanya MERUSAK berkas INGGRIS, dan itu bagian yang layak
  disimpan.** `checkCitedPaths` memakai argumen pertamanya SEKALIGUS sebagai
  label laporan DAN sebagai kunci `ASPIRATIONAL_SKILLS`/`subjectModuleKey`.
  Mengoper label berhias mematikan kedua pengecualian itu dan mengubah gerbang
  hijau menjadi 19 kegagalan PALSU pada berkas yang baik-baik saja. Identitas
  dan label kini parameter terpisah, dan sebuah test menegakkan bahwa
  pengecualiannya bertahan saat label diberikan. **Label BUKAN identitas**, dan
  mencampurnya tak terlihat sampai pengecualian yang diam-diam ia matikan
  justru yang sedang diuji.

  **Indeks ADR mirror kehilangan ADR-0100 sama sekali** — 113 baris di Inggris,
  112 di mirror. `check-docs.mjs` bahkan menjelaskan kebutaannya sendiri:
  _"mirror Indonesianya dipegang oleh `i18n-source-hash`, bukan oleh salinan
  kedua gerbang ini."_ Hash itu menjawab "apakah Inggrisnya berubah sejak
  diterjemahkan?", bukan "apakah mirror-nya mendaftar SETIAP ADR?".

  **Yang ditegakkan CAKUPAN, bukan CARA MENAUT**, dan bedanya menanggung beban
  alih-alih rewel. Mirror-nya menaut berkas INGGRIS untuk 98 barisnya dan
  salinan `.id.md` untuk sisanya, padahal mirror-nya ada untuk semuanya.
  Menuntut satu bentuk akan mengubah gerbang cakupan yang nyata menjadi
  tuntutan pemformatan-ulang 98 baris — dan kebisingan itulah cara sebuah
  gerbang dimatikan orang. Mirror boleh menaut salinan mana pun dan tak boleh
  MELEWATKAN sebuah ADR; indeks Inggris tetap wajib menaut Inggris, atau sebuah
  baris bisa diam-diam menunjuk terjemahan dan lolos.

  **Dan satu gerbang tak punya pemanggil.** `memory:docs:check` bukan gerbang
  bertitik-buta — target-nya ADA, tidak ada di `scripts.check` MAUPUN workflow
  mana pun, jadi ia tak pernah berjalan sekali pun. Ia sedang GAGAL. Headernya
  sendiri mendokumentasikan skip aman-CI _"supaya gerbang ini menangkap drift di
  device yang memang punya memory alih-alih memaksa CI memilikinya"_ — catatan
  desain yang hanya masuk akal bagi sesuatu yang dimaksudkan untuk dikawatkan.
  Kini ia dikawatkan, kedua paruhnya terverifikasi: snapshot rusak keluar 1,
  `HOME` kosong melewati dan keluar 0. Rantainya 58 → **59**.

  Bentuk yang bisa dipindahkan: **cari gerbang yang membaca SATU dari
  sepasang.** Tiga dari keempatnya ditemukan dengan bertanya, atas tiap `:check`
  di rantai, "apakah ada berkas KEDUA yang memuat klaim yang sama?" — bukan
  karena salah satunya gagal.

- **PUTARAN MIRROR — 26 Agustus 2026: blok yang berbunyi "JANGAN diedit tangan"
  ternyata tidak ada yang menghasilkannya, dan gerbang yang seharusnya
  menyadarinya memang sedang menanyakan pertanyaan LAIN — dengan sengaja.**

  `scripts/README.md` dan `docs/PROJECT_STATE.md` §2 ter-generate dan
  ter-gerbang. Mirror Indonesianya membawa blok yang SAMA, banner sekalian,
  dirawat tangan, tak tercakup apa pun — dan keduanya sudah melenceng: 107/48
  terhadap 121/54 yang sebenarnya, rentang ADR berakhir `0111` terhadap `0113`,
  48/61/57 terhadap 49/62/58, dan `MODULE_CONTRACT_VERSION` **4.0.0** terhadap
  **4.1.0**.

  Sebuah VERSI KONTRAK, dinyatakan salah, di dokumen yang seluruh tugasnya
  adalah menjadi titik lanjut yang akurat.

  **Mengapa tak ada gerbang yang bisa melihatnya — itu paruh yang menarik, dan
  itu BUKAN kelalaian.** `check:docs:translation` membandingkan sha256 SUMBER
  INGGRIS dengan penanda di mirror. Itu menjawab "apakah bahasa Inggrisnya
  berubah sejak ini diterjemahkan?" — pertanyaan yang persis tepat untuk PROSA,
  yang hanya menua saat sumbernya berubah. Konten TURUNAN menua saat REPO-nya
  berubah, dengan kedua berkas tak tersentuh, dan tak ada hash dari berkas mana
  pun yang bisa melihat itu.

  Lebih buruk: me-restamp setelah suntingan Inggris yang tak berhubungan
  diam-diam MEMBERKATINYA lagi. Saya nyaris mengirimkannya DUA KALI karena itu —
  menyinkronkan `scripts/README.id.md` dengan tangan di #726 lalu me-restamp
  menandai pasangan itu mutakhir sementara `PROJECT_STATE.id.md` masih salah.

  **Obatnya tabel LABEL, bukan renderer kedua.** Kedua generator kini merender
  setiap locale dari SATU kali pengumpulan, sehingga kedua dokumen boleh berbeda
  KATA dan tak bisa berbeda FAKTA. Dua renderer bisa saling bertentangan, dan
  dua salinan yang bertentangan adalah keseluruhan cacatnya. Permukaan
  terjemahannya ternyata mungil: sepuluh label baris, tiga header kolom, dua
  string prosa, dan satu sel sumber-kebenaran yang berupa prosa alih-alih
  perintah telanjang.

  Terbukti-mutasi DUA ARAH — merusak nilai di mirror memerahkan gerbangnya, dan
  membuat renderer mengabaikan locale-nya (memancarkan Inggris ke berkas
  Indonesia, cara BARU untuk salah yang diperkenalkan desain ini) memerahkan
  test yang ditulis untuk itu.

  **Audit yang diminta #727 menemukan sesuatu yang LEBIH BESAR dari #727.**
  Kelasnya bukan "blok ter-generate di mirror"; kelasnya "setiap gerbang yang
  hanya membaca paruh Inggris". Diverifikasi dengan membaca tiap gerbang:

  - `checkAdrIndexCoverage` hanya membaca `docs/adr/README.md`.
  - `skills:check` mem-glob `SKILL.md` dan `src/modules/*/README.md` — **55
    `SKILL.id.md` dan 21 `README.id.md` modul** tidak diperiksa apa pun,
    sehingga sebuah mirror bisa menyebut target `bun run` yang tidak ada. Itu
    persis bahaya yang sudah tercatat sebagai "skill basi membalik arah".
  - `graph:artifacts:check` meng-hardcode `docs/awcms/knowledge-graph.md`.
  - `memory:docs:check` ADA, aman-CI secara konstruksi, dan TIDAK ada di
    `scripts.check` maupun workflow mana pun — **gerbang yang belum pernah
    berjalan sekali pun.** Ia GAGAL hari ini.

  Yang terakhir kategorinya sendiri dan layak disebut terpisah: bukan gerbang
  dengan titik buta, melainkan gerbang tanpa PEMANGGIL.

- **PUTARAN CALL-SITE — 26 Agustus 2026: normalisasi ADR-0113 sudah salah tiga
  hari setelah di-merge, karena ia menyebut fungsi yang tak dipanggil apa pun —
  dan petanya yang terkoreksi kini di-commit.**

  KEPUTUSAN di ADR-0113 TIDAK berubah. Mekanismenya salah, dan cara ia salah
  kini sudah terjadi TIGA KALI di repo ini.

  **`seo_title()` adalah KODE MATI.** ADR itu menyatakan peta bentuk-2/3
  berkunci pada `seo_title(jenis_rubrik)`. Fungsi itu **didefinisikan sembilan
  kali** di pohon PHP legacy dan **dipanggil NOL kali** — dan kesembilan
  salinannya bahkan tidak seragam: `index.php` mengganti spasi dengan `_`
  sementara delapan lainnya memakai `-`. `rubriks/index.php` mengikat segmen URL
  MENTAH, setelah `trim()`, langsung ke
  `WHERE jenis_rubrik = ? AND kategori = ?`.

  Jadi segmen URL rubrik legacy adalah NILAI KOLOM, bukan slug darinya — dan
  peringatan runtuhnya `MITRA BORNEO` / `MITRA-BORNEO`, yang putaran sebelumnya
  sebut sebagai "satu hal yang ditunjukkan data yang tak mungkin ditunjukkan
  perencanaan", juga SALAH. Sebagai segmen mentah keduanya path berbeda yang tak
  pernah runtuh, dan keduanya tak ditautkan dari mana pun, jadi keduanya tak
  butuh aturan.

  **Polanya, kemunculan KETIGA.** `replaceMenuItems` adalah nama fungsi yang
  ditulis dari ingatan dan tidak ada. `awcms_blog_pages.legacy_source_*` adalah
  kolom yang keberadaannya ditegakkan oleh test atas TEKS SUMBER sebuah
  migration, tanpa pembaca. Kini sebuah fungsi yang dikutip dalam prosa dan tak
  pernah dipanggil. Ketiganya terbaca persis seperti kode yang bekerja bagi
  siapa pun yang tidak mencari CALL SITE-nya. **Grep CALL-nya, bukan
  definisinya.**

  **Sebenarnya URL-nya apa.** Tidak ada apa pun di pohon legacy yang
  menghasilkan tautan rubrik dari nilai kolom; semuanya literal ketik-tangan.
  Itu membuat himpunannya **terenumerasi dan LENGKAP, bukan sampel** — crawler
  hanya bisa menjangkau apa yang ditautkan. Jumlahnya 67, kini di-commit bersama
  provenance-nya di `data/seputarborneo-legacy/`.

  Dua sifat menentukan pekerjaannya, dan keduanya tak terlihat dari rencana:

  - **Kapitalisasi menanggung beban DI SINI dan tidak di situs legacy.**
    `utf8mb4_unicode_ci` MariaDB membuat `rubrik/Hukum.html` dan
    `rubrik/hukum.html` halaman yang SAMA (5.183 artikel masing-masing). Repo
    ini mencocokkan dengan KESAMAAN dan mempertahankan kapitalisasi, jadi kedua
    ejaan butuh aturannya sendiri. Lima rubrik ditautkan dalam keduanya.
  - **32 dari 67 resolve ke NOL artikel** — tautan nav/footer mati
    bertahun-tahun, menyajikan HTTP 200 dengan listing KOSONG alih-alih 404,
    jadi kemungkinan terindeks sebagai halaman tipis. Delapan di antaranya sisa
    template asal situs ini dan menyebut tempat di SUMATERA SELATAN.
    `rubrik/Olah Raga.html` mati karena nilai kolomnya `OLAHRAGA` tanpa spasi,
    dan kolasi case-insensitive tidak menutup perbedaan SPASI.

  62 aturan atas 10 kategori tujuan. Karena keputusannya membuang `kt`, setiap
  URL dari kedua bentuk mendarat di arsip rubrik INDUK-nya, sehingga petanya
  adalah fungsi dari segmen pertama saja.

  **Petanya di-commit karena ia TAK BISA diturunkan ulang.** Membangunnya butuh
  salinan kerja PHP legacy dan volume MariaDB terisi, keduanya ada di SATU
  workstation dan tidak dikirim ke mana pun. Ini pelajaran PUTARAN VOLUME
  berjalan MAJU alih-alih mundur: putaran itu menemukan artefak yang dikira
  hilang padahal tidak, dan jawaban atas "ia ada hari ini" adalah MENANGKAPNYA,
  bukan mencatat bahwa ia ada.

  Test-nya menegakkan apa yang AKAN DILAKUKAN jalur tulis terhadap tiap entri —
  setiap source path dan target lewat `normalizeRedirectPath`,
  `validateRedirectTarget` dan `isValidSlug` — bukan bahwa berkasnya ter-parse.
  Saudara peringatannya, `tests/legacy-redirect-map.test.ts`, menegakkan bahwa
  TEKS SUMBER sebuah migration memuat `ALTER TABLE awcms_blog_pages`, yang
  membuktikan sebuah kolom ADA dan tak bisa memperhatikan tak ada yang
  membacanya; kolom itu dibuang di `sql/147`. `findMapProblems` sendiri diuji
  terhadap tiga entri yang sengaja dirusak, karena validator yang tak pernah
  dilihat GAGAL adalah validator yang tak pernah diuji.

- **PUTARAN CAPTURE — 25 Agustus 2026: tulisan telemetri 404 publik TIDAK punya
  rate limit, dan dokumen yang menyebut kardinalitasnya terbatas justru sedang
  memakai klaim itu untuk membenarkan keputusan partisi.**

  Auditnya berangkat dari kedua issue terbuka, bukan dari sapuan. #599 DIKIRA
  akan membawa `awcms_seo_redirects` dari nyaris kosong ke **25.029** aturan per
  tenant (entri ini menulis 23.906 — lihat ADR-0114 untuk koreksi hitungannya)
  dengan ADR-0113 menambah ~60 lagi, di jalur yang berjalan untuk setiap pembaca
  dan setiap crawler — jadi jalur itulah yang layak diukur. **ADR-0114 sejak itu
  MENGHAPUS beban itu seluruhnya**: 301 SeputarBorneo dieksekusi di tepi,
  sehingga tabel ini tidak bertambah 25.029 baris. Pengukuran di bawah tetap
  berdiri sendiri bagi tenant mana pun yang memang menulis aturan sebanyak itu.

  **Paruh RESOLVE-nya sehat**, dan layak dicatat supaya tak diaudit ulang:
  `MAX_REDIRECT_HOPS = 5` membatasi penelusur rantai, dan
  `awcms_seo_redirects_resolve_idx` adalah index parsial atas persis
  `(tenant_id, normalized_source_path) WHERE deleted_at IS NULL AND state =
'active'`. 25.029 aturan adalah point lookup B-tree, bukan scan.

  **Paruh CAPTURE-nya tidak.** `recordPublicNotFound` menyala setelah SETIAP
  request publik yang resolve ke sebuah tenant lalu 404 — tanpa autentikasi,
  transaksinya sendiri, satu `INSERT … ON CONFLICT` per request. Kunci
  agregasinya `(tenant_id, normalized_path, referrer_domain, locale,
domain_host)`, dan pemanggil menguasai dua dari lima: path-nya apa pun yang ia
  minta, dan `referrer_domain` adalah hostname dari `Referer` apa pun yang ia
  kirim, tanpa allow-list. `/a1 … /aN` adalah N baris, masing-masing bisa
  dikalikan lagi dengan memvariasikan `Referer`.

  **Yang membuatnya TAMPAK tertangani itulah bagian menariknya.** Dua dokumen
  menyebutnya terbatas:

  - `not-found-directory.ts` — "bounded cardinality + bounded retention";
  - `module.ts` — "cardinality is bounded by distinct 404 paths, not by
    traffic", yang merupakan alasan tertulis bagi `partition.eligible: false`.

  Upsert-nya meruntuhkan PENGULANGAN satu kunci dan tidak melakukan apa pun
  terhadap kunci-kunci berbeda, dan tidak ada himpunan tetap "path 404" —
  himpunannya adalah apa pun yang diminta siapa pun, jadi kunci berbeda
  DIHASILKAN oleh trafik, persis yang disangkal rasionalnya. **Klaim salah di
  sebuah RASIONAL lebih buruk daripada klaim salah di komentar, karena rasional
  itu menanggung beban sebuah keputusan** — di sini, tidak mem-partisi.
  Keputusannya bertahan; alasan ia bertahan kini yang benar, dan alasan itu
  menyatakan terang-terangan bahwa menaikkan rate limit secara substansial
  berarti memeriksa ulang keputusan itu.

  Layak dicatat komentar DDL `sql/060` BENAR sebagaimana tertulis: ia berkata
  "bot yang menyelidik 404 yang **SAMA** sejuta kali adalah satu baris". Klaimnya
  baru menjadi salah ketika diparafrasakan ke lapisan aplikasi dan ke registry.

  **Saudaranya sudah punya jawabannya.** `POST /api/v1/analytics/collect` adalah
  endpoint sejenis — publik, anonim, satu baris per request — dan sudah membawa
  backstop `checkSharedRateLimit` per-IP sejak ia dirilis, untuk ancaman yang
  komentarnya sendiri nyatakan dalam kalimat yang berpindah kata demi kata.
  Jalur ini tidak punya. Kini ia memakai limiter yang sama pada default 120/60 d
  yang sama, berkunci **IP SAJA, tidak pernah tenant**, sehingga kontrak
  tanpa-orakel milik beacon terjaga dan sebuah penolakan tak mengungkap apakah
  suatu tenant ada. Tidak ada yang ditolak kepada pengunjung — 404-nya sudah
  diproduksi — dan pelewatannya SENYAP, karena mencatat log per tulisan yang
  ditolak memberi banjir yang sama sebuah penguat kedua.

  **Cap baris-berbeda per tenant DIPERTIMBANGKAN dan TIDAK diambil.** Ia
  membatasi penyimpanan lebih keras, dan ia memperkenalkan mode gagal yang hari
  ini tidak ada: penyerang yang memenuhinya membuat 404 yang NYATA tak terlihat.
  Rate limit plus purge berbasis usia yang sudah dideklarasikan (default 30h,
  lantai 7h) membatasi keadaan tunaknya tanpa membeli itu.

  Buktinya berupa DIFERENSIAL alih-alih asersi, karena fungsinya fail-open
  menurut kontrak dan "ia tidak melempar" benar baik ketika ia menolak lebih awal
  maupun ketika ia mencoba lalu gagal: dengan `DATABASE_URL` tak diset, langkah
  DB mencatat `seo_distribution.not_found.capture_failed`, jadi dalam anggaran ia
  mencatatnya sekali dan di luar anggaran ia tidak mencatat apa pun.

- **PUTARAN BATAS-DAN-BATCH — 25 Agustus 2026: satu-satunya batch tanpa cap di
  API ini duduk persis di sebelah satu-satunya N+1 yang tak terlihat oleh
  sapuan sebelumnya.**

  **Pemindainya mencari BACKTICK.** PUTARAN BOUND di bawah memindai
  `src/**/*.ts` untuk `await` tagged-template di dalam badan loop dan menemukan
  34 loop. `GET /api/v1/blog/menus` memuat
  `for (const menu of menus) { … await fetchMenuItems(tx, …) }` — sebuah
  panggilan fungsi biasa, jadi ia tak pernah jadi kandidat. Dijalankan ulang
  terhadap himpunan fungsi yang secara _transitif_ menerbitkan SQL alih-alih
  terhadap sintaks SQL, sapuan yang sama memunculkan 45 lokasi. **Mencocokkan
  SINTAKS alih-alih KUERI menyembunyikan setiap N+1 yang lewat helper**, yang di
  repo ber-application-layer berarti sebagian besarnya.

  Endpoint itu berbiaya 1 + N kueri, N sampai 100 yang dikembalikan `listMenus`,
  seluruhnya serial karena keharusan — satu koneksi Postgres melayani satu kueri
  pada satu waktu, jadi `Promise.all` yang justru diperingatkan kodenya akan
  HANG alih-alih memparalelkan. Kini satu `menu_id = ANY(…)` yang dikelompokkan
  di memori.

  **Dan tulisan yang dibacanya TIDAK punya batas jumlah sama sekali.** Diperiksa
  terhadap seluruh 18 rute yang menerima array di body: setiap rute lain
  mendeklarasikan cap (`MAX_IMPORT_ITEMS = 200`, `MAX_IDS`,
  `MAX_NODE_ACTIVATIONS = 128`, dan milik `/sync/push` yang baru), dan `items`
  menu satu-satunya pengecualian. Tier body 128 KB mengizinkan sekitar 1.250
  item per menu, jadi 100 menu × 1.250 adalah respons 125.000 baris.
  `MAX_MENU_ITEMS = 200` kini duduk di SATU validator yang sudah dilalui kedua
  rute menuju database.

  **Batasnya TIDAK BISA berupa `LIMIT` telanjang, dan inilah bagian yang bisa
  dipindahkan.** `syncMenuItems` adalah GANTI-SELURUHNYA. Klien yang membaca
  sebuah menu, menyuntingnya lalu menyimpannya kembali mengirim apa yang
  ditunjukkan kepadanya — sehingga baca yang diam-diam berhenti di cap akan
  membuat perjalanan itu MENGHAPUS segala sesuatu di baliknya. Menambahkan
  `LIMIT` yang tampak jelas akan mengubah baca tak-terbatas menjadi kehilangan
  data yang senyap. Bacanya mengembalikan `{ items, truncated }`, membaca
  cap + 1 baris agar tahu yang mana, dan kedua endpoint memunculkan
  `itemsTruncated`.

  Dua hal kecil ikut terjatuh. `sort_order` TIDAK unik dan bacanya mengurutkan
  hanya dengannya, yang selamat selama bacanya tak terbatas dan tidak lagi
  begitu setelah sebuah batas bisa memotong daftar — urutan tak terdefinisi
  membuat 200-dari-250 yang sembarang. Dan jumlahnya diperiksa SEBELUM lintasan
  per-item, karena sesudahnya array kelebihan berisi entri tak-valid tetap akan
  dijelajahi penuh dan memancarkan beberapa galat per entri; menegakkan JUMLAH
  galat, bukan sekadar `valid: false`, itulah yang memisahkan kedua urutan itu
  di tesnya.

  `GET /api/v1/blog/menus` dikonsumsi `ahliweb/awcms-astro`, dan kontrak
  konsumen beku tetap LULUS TANPA regenerasi — perubahannya aditif bagi pembaca,
  dan repo itu membaca menu saat build dan tak pernah menulisnya. Tipe `Menu`-nya
  tidak membawa `itemsTruncated`, jadi tenant yang menunya melampaui 200 item
  akan merender 200 di sana tanpa peringatan. Itu pertanyaan lintas-repo, bukan
  regresi yang diperkenalkan di sini.

- **PUTARAN KEPUTUSAN — 25 Agustus 2026: pemblokir tersisa #711 adalah sebuah
  KEPUTUSAN, dan keputusan itu sudah diambil (ADR-0113).**
  Bentuk 2 dan 3 keduanya 301 ke `/kategori/{jenis_rubrik}` dengan `kt` dibuang.
  Penalarannya ada di ADR itu; tiga hal yang diselesaikannya layak diulang di
  sini. **Dua klaim di entri ini sebagaimana pertama ditulis kini DICABUT** —
  normalisasi `seo_title()` (PUTARAN CALL-SITE di atas) dan keputusan bentuk-4,
  yang memutuskan keluarga URL yang tak pernah ada (PUTARAN ORIGIN di atas).

  - **Meratakan dipilih karena jawaban yang LUAS mengalahkan jawaban yang
    SALAH.** Alternatif yang juga tak butuh rute baru — `jenis_rubrik` sebagai
    kategori, `kategori` sebagai tag — membuang AND-nya, sehingga
    `/hukum/pidana.html` akan mendarat di artikel `pidana` dari SEMUA rubrik.
    Itu halaman yang salah. Meratakan mendaratkan pembaca di daftar yang lebih
    luas, dan itu jenis ketidaksempurnaan yang berbeda.
  - **Provenance term MELARUT alih-alih dibangun.** Butir DoD ketiga #711
    menawarkan pilihan antara menambah `legacy_source_id` pada
    `awcms_blog_terms` dan menulis tangan `--term-map`. Di bawah keputusan ini
    bentuk 2/3 adalah aturan path-eksak → path-eksak yang tak pernah mencari
    baris term, jadi keduanya tak dibutuhkan. Ini penting karena `sql/147` baru
    saja menghapus pasangan provenance `awcms_blog_pages` yang ditambahkan atas
    penalaran yang SAMA dan tak pernah dikawatkan ke pembaca: menjawab sebuah
    kebutuhan dengan membangun kolom mati KEDUA akan mengulanginya persis.
  - **Garis miring akhir TIDAK disimpan**: `/kategori/hukum/` dinormalisasi
    menjadi `/kategori/hukum`, diperiksa terhadap KODE alih-alih diasumsikan.
    (Kendala kedua yang tercatat di sini, percent-encoding target ber-query, ada
    semata untuk melayani aturan bentuk-4 yang dicabut dan kini tanpa pemanggil.)

  Yang tersisa di #711 adalah pekerjaan DATA. **KESEPULUH** kategori tujuan
  WAJIB sudah ada di tenant SEBELUM petanya dipakai, atau setiap aturan 301 ke
  404 — kegagalan ADR-0111 satu langkah bergeser. Entri ini berbunyi
  "47-atau-kurang"; 47 adalah batas ATAS `jenis_rubrik` di bawah kolasi
  case-insensitive MariaDB (map JS berkunci nama eksak melihat 48/45), tidak
  pernah jumlah tujuan.

- **PUTARAN VOLUME — 25 Agustus 2026: pemblokir PERTAMA #711 tidak ada, dan
  berkas 0-byte yang dibaca semua orang sebagai buktinya justru INERT.**

  Dua entri di bawah menyatakan bentuk rubrik terhalang karena "daftar rubrik
  butuh data yang tak dimiliki salinan kerja (`seputa58_sbb.sql` 0 byte)".
  Berkas itu MEMANG 0 byte. Ia juga **bukan tempat datanya berada**, dan sudah
  begitu sejak container itu pertama kali jalan.

  `docker-compose.yml` memasangnya HANYA sebagai seed initdb
  (`/docker-entrypoint-initdb.d/`), sedangkan datadir-nya volume bernama. Di
  mesin ini `seputarborneocom_db_data` memuat **411 MB** dengan `seputa58_sbb`
  yang TERISI. Skrip initdb hanya jalan pada datadir KOSONG, jadi berkas kosong
  itu inert sejak saat itu — dan justru itulah sebabnya tak ada yang sadar ia
  kosong: tak pernah ada yang bergantung padanya.

  **Dan tak ada tabel rubrik karena memang tak pernah dimaksudkan ada.**
  `include/rubrik.php` menjawab `/rubriks/?news=X&kt=Y` dengan
  `SELECT ... FROM berita_red_tayang WHERE jenis_rubrik = ? AND kategori = ?` —
  `jenis_rubrik` dan `kategori` adalah KOLOM di `berita_red`. Terukur terhadap
  salinan sekali-pakai volume itu: **25.029 artikel, 47 `jenis_rubrik` distinct,
  46 `kategori` distinct, 102 pasangan distinct.** Daftarnya cuma sejauh satu
  `SELECT DISTINCT` selama ini, sepanjang issue-nya menyatakan ia hilang.

  **Satu hal yang diperlihatkan DATANYA dan tak mungkin diperlihatkan
  perencanaan.** Ada `MITRA BORNEO` (11.767 artikel) DAN `MITRA-BORNEO` (133).
  Segmen URL bentuk-3 adalah keluaran `seo_title()` — tanda baca dibuang, spasi
  jadi `-` — jadi keduanya runtuh ke slug yang SAMA sementara `DISTINCT` polos
  melaporkan dua rubrik. Peta yang dibangun dari daftar distinct tanpa
  menormalkan lewat `seo_title()` yang sama akan SALAH-KUNCI rubrik TERBESAR di
  arsip. Itu peringatan bentuk-3 satu tingkat lebih dalam: mengenumerasi
  bentuknya tidak cukup bila NILAI di dalamnya tak dinormalkan sebagaimana kode
  legacy menormalkannya.

  **Pemblokir kedua TETAP berlaku dan itulah yang sebenarnya.** Ke mana
  `/rubrik/x.html` harus 301 adalah pertanyaan kontrak lintas-repo
  (ADR-0045/0070: arsip berita dirender `ahliweb/awcms-astro`). Memiliki
  daftarnya tidak menjawabnya, dan menebak kosakata tujuannya menghasilkan
  persis akibat 301-salah-massal yang issue itu ada untuk mencegahnya. Jadi
  tidak ada peta yang dibangun — #711 kini terhalang SATU hal, dan itu
  keputusan, bukan artefak yang hilang.

  Bagian yang bisa dipindahkan: **"artefaknya hilang" adalah klaim tentang
  SISTEM BERKAS, dan sistem berkas bukan satu-satunya tempat sebuah artefak bisa
  berada.** Dump 0-byte itu diperiksa, dengan benar, dan kesimpulan yang ditarik
  darinya keliru karena pemeriksaannya berhenti di berkas yang disebut pertama
  oleh entri compose.

- **PUTARAN KOSONG — 25 Agustus 2026: suite integrasi punya NOL tes gagal, dan
  sembilan yang dua kali saya laporkan sebagai pre-existing itu LINGKUNGAN SAYA
  SENDIRI.**

  Dinyatakan terang-terangan karena dua kali dinyatakan keliru, sekali di badan
  PR yang sudah ter-merge (#716: _"the integration suite shows 9 failures both
  with and without this branch"_). Benar sebagaimana ditulis — memang gagal di
  kedua sisi, jadi perbandingan tanpa-regresi tetap sahih — tetapi terbaca
  sebagai kerusakan repo, dan tidak ada. Dengan lingkungan yang benar suite-nya
  **567 lolos, 0 gagal**.

  Tujuh dari sembilan berasal dari `export A=... B=$A` di shell saya sendiri:
  **`$A` diekspansi SEBELUM `A` di-assign**, jadi `SETUP_DATABASE_URL`/
  `WORKER_DATABASE_URL` ter-set ke STRING KOSONG, bukan ke URL-nya. Dua sisanya
  dari `APP_URL=http://localhost:4321` lokal — `site-origin` mengambil skema
  dari `APP_URL`, dan dua tes menegakkan URL host-absolut `https://`. Tak satu
  pun cacat, kecuali pada cara saya memanggilnya.

  **Paruh string-kosongnya MEMANG cacat nyata, di kodenya.**
  `getNamedDatabaseClient` menyelesaikan
  `process.env[name] ?? process.env.DATABASE_URL`, dan `??` hanya jatuh-balik
  pada null/undefined — jadi nilai kosong itu "terkonfigurasi", menutupi
  fallback-nya, dan menghasilkan

  > `WORKER_DATABASE_URL (or DATABASE_URL as a fallback) is required to connect
to the database.`

  dengan `DATABASE_URL` ter-set dan benar. **Pesan galat yang menyebut fallback
  yang baru saja ia tolak pakai** — nyaris pesan terburuk yang mungkin, karena
  ia mengirim pembacanya memeriksa variabel yang sudah benar. URL per-kind
  didokumentasikan OPT-IN (tak-diset berarti jatuh-balik), dan KOSONG persis
  yang dihasilkan operator saat mencoba menyatakan itu: kunci compose tanpa isi,
  baris PaaS tersimpan kosong (deployment ini memakai Coolify), atau bentuk
  shell di atas. `readConfiguredUrl` kini memperlakukan kosong dan
  hanya-spasi sebagai tak-diset.

  Bagian yang bisa dipindahkan bukan soal `??`-nya. Melainkan bahwa **kegagalan
  yang SUDAH saya tulis ke memori sendiri sebagai jebatan diketahui tetap
  memakan dua putaran pelaporan yang salah**, karena pesan galatnya tegas dan
  menunjuk ke tempat yang masuk akal. Galat yang dengan percaya diri menyebut
  sebab yang KELIRU lebih buruk daripada yang kabur; ia merekrut pembacanya
  untuk mengonfirmasinya.

- **PUTARAN NAMA — 25 Agustus 2026: jalur tulis N+1 ketiga ditutup, dan alasan
  ia tampak sulit adalah cacat di TRIASE SAYA SENDIRI, bukan di kodenya.**

  PUTARAN BATAS di bawah menunda satu situs dengan alasan tertulis. Kedua paruh
  alasan itu salah, dan CARA salahnya justru intinya.

  **Ia disebut `replaceMenuItems`. Fungsi itu tidak ada.** Yang asli
  `syncMenuItems`. Namanya ditulis dari INGATAN, bukan dibaca dari signature-nya,
  dan menyebar ke sebuah issue GitHub, badan PR yang sudah ter-merge, changeset
  yang sudah ter-merge, dan KEDUA salinan dokumen ini sebelum ada yang
  menangkapnya — karena tak ada yang memeriksa nama fungsi yang hanya muncul di
  prosa. Ini persis aturan yang sudah tercatat, "kutip BERKAS, bukan catatan
  tentang berkas", dan kali ini catatannya milik saya sendiri sepuluh menit
  sebelumnya.

  **Dan "pemanggilnya bergantung pada urutan `RETURNING`" itu KELIRU.** Ia punya
  dua pemanggil, dan `blog/menus/[id].ts` mengisi field respons yang SAMA dari
  `syncMenuItems` (root-lalu-anak) ATAU dari `fetchMenuItems`
  (`ORDER BY sort_order`) hanya bergantung apakah request mengirim `items`.
  Endpoint-nya SUDAH menjawab dalam dua urutan berbeda, jadi tak ada klien yang
  bisa bergantung pada salah satunya. Klaim itu tak pernah diverifikasi; ia
  DISIMPULKAN dari adanya klausa `RETURNING`.

  Yang tersisa setelah keduanya diperiksa: **tak ada yang butuh keputusan.**

  - FK-diri itu `NOT DEFERRABLE`, dan foreign key `NOT DEFERRABLE` diperiksa
    trigger AFTER ROW yang menyala di akhir STATEMENT, bukan sesudah tiap baris.
    Diverifikasi terhadap Postgres nyata dengan anak diletakkan PERTAMA — susunan
    yang WAJIB gagal bila pemeriksaannya per-baris. Jadi satu INSERT multi-baris
    aman apa pun urutan di dalamnya.
  - `RETURNING` sama sekali tak diperlukan. `MenuItemInput` membawa ketujuh
    kolomnya, `tenantId`/`menuId` adalah parameter, tabelnya tak punya trigger
    pengguna, dan tak ada `DEFAULT` yang berlaku pada kolom yang selalu diberi
    nilai — jadi klausa itu membaca balik persis apa yang baru saja dikirim.

  Kini dua statement. Urutan root-sebelum-anak dipertahankan, tetapi
  docstring-nya tak lagi mengklaim menanggung beban: ia dipertahankan karena
  itulah yang DIKEMBALIKAN fungsi ini, dan mengubahnya berarti perubahan API
  senyap yang menumpang pada perbaikan performa.

  **Satu tes di draf pertama menegakkan hal yang SALAH, dan ia LOLOS.** Kasus
  bernama "anak diletakkan SEBELUM induknya tetap mendarat" mengklaim kode lama
  "tak mungkin bisa melakukan ini". Bisa: `syncMenuItems` menyaring root dan anak
  sendiri, jadi urutan pemanggil tak pernah sampai ke INSERT dan kasus itu lolos
  di loop per-item juga. Hijau, dan tak membuktikan apa pun yang diakuinya.
  Ditulis ulang agar menegakkan yang benar-benar dicakupnya — bahwa urutan input
  tak mengubah apa yang mendarat maupun apa yang dikembalikan — dan header-nya
  kini menyatakan terang-terangan bahwa properti FK itu TIDAK bisa direproduksi
  lewat fungsi ini, supaya pembaca berikutnya tak menyalahartikan kasus itu
  sebagai buktinya.

  Kedua properti nyata terbukti-mutasi: membuang satu field dari batch sehingga
  baris tersimpan menyimpang dari input memerahkan "apa yang DIKEMBALIKAN adalah
  isi tabel" (pemeriksaan yang membuat membangun jawaban dari input aman sama
  sekali), dan mengembalikan loop per-item memerahkan anggarannya.

- **PUTARAN BATAS — 25 Agustus 2026: satu endpoint API menerima batch TANPA
  batas, dan fungsi yang menyebut dirinya kembaran fungsi yang sudah diperbaiki
  justru menyimpan cacatnya.**

  Pemindaian `src/**/*.ts` atas `await` bertag-template di dalam badan loop
  menemukan **34 loop**. Mayoritas terbatas — oleh registry kode, oleh cap yang
  dideklarasikan (`MAX_NODE_ACTIVATIONS = 128`, `MAX_SIDEBAR_ROWS`), atau oleh
  ukuran batch sebuah job — dan beberapa sudah ter-batch atau memang false
  positive pemindai. Dua tidak, dan keduanya jenis temuan yang berbeda.

  **`POST /api/v1/sync/push` sama sekali tak punya batas jumlah.** Validator
  memeriksa setiap event dalam array `events` dan TIDAK PERNAH panjang
  array-nya; satu-satunya batas adalah `readTextBody(request, "large")` di 5 MB.
  Event minimal terserialisasi beberapa ratus byte, jadi satu request
  terautentikasi bisa membawa sekitar **30.000 event** — tiap yang diterima
  berbiaya compare-and-set pada versi agregat plus INSERT inbox, tiap yang
  konflik satu INSERT konflik, semuanya berurutan, semuanya di dalam SATU
  transaksi yang memegang koneksi dan mengunci setiap baris agregat yang sudah
  dimajukan sampai commit. Biayanya bukan perjalanan pulang-perginya; melainkan
  berapa lama semua hal lain menunggu di belakangnya.

  Sementara itu `/sync/pull` sudah menjepit baca di 500 sejak dikirim. **Dua
  paruh dari SATU protokol punya batas asimetris, dan paruh yang tak terbatas
  adalah yang MENULIS.** `MAX_SYNC_PUSH_EVENTS` kini didefinisikan SEBAGAI
  `MAX_SYNC_PULL_EVENTS`, bukan sebagai `500` kedua, dan `pull.ts` mengimpor
  konstanta yang sama — alasan angkanya adalah RELASINYA, dan dua literal
  independen yang kebetulan sama hari ini adalah cara asimetri itu kembali saat
  salah satunya disetel. Tesnya menegakkan relasinya, bukan nilainya.

  DITOLAK, tak pernah dipotong (postur #180): sebuah node memperlakukan batch
  yang diterima sebagai diterima UTUH dan akan memajukan cursor-nya melewati
  event yang tak pernah mendarat. Dilaporkan sebagai SATU error, bukan satu per
  event — badan error yang memuat error field untuk tiap dari 30.000 event
  adalah denial of service-nya sendiri.

  **Gerbang yang membuat ini jujur.** Menambahkan `maxItems: 500` ke skema
  OpenAPI memerahkan `openapi-bundle.test.ts`, yang membekukan setiap path
  pra-migrasi. Daftar izin yang menuntut entri itu bernama
  `INTENTIONALLY_EVOLVED_PATHS` dan dua entri lamanya sama-sama berbunyi
  "backward-compatible". Yang ini TIDAK: ia aditif secara dokumen tetapi
  PENYEMPITAN nyata bagi pemanggil, dan entrinya menyatakan begitu. Test kontrak
  beku membuktikan nilainya persis di sini — bukan dengan memblokir
  perubahannya, melainkan dengan menolak membiarkannya diarsipkan dengan
  deskripsi yang salah.

  **Dan temuan kedua, yang soal BAGAIMANA cacat kembaran bertahan hidup.**
  `syncPostInstitutionAssignments` mengeluarkan satu INSERT per institusi.
  Docstring-nya sendiri menyatakan ia "exactly like `syncPostTermAssignments`" —
  dan memang begitu, dalam KONTRAK dan bukan dalam BIAYA. Jalur term diratakan
  jadi dua statement di PUTARAN PERFORMA saat `blog:legacy:import` menjadikan
  arsip 23.906 artikel sebagai pemanggilnya; jalur INI, yang digerakkan importer
  yang SAMA lewat payload post yang SAMA, menyimpan loop-nya. Kini memakai
  `DELETE` + `INSERT ... unnest` yang sama.

  Layak disimpan: **saudara kembar yang MENGIKLANKAN dirinya sebagai kembaran
  adalah jenis cacat yang paling mudah terlewat**, karena orang yang memperbaiki
  yang pertama sudah membaca yang kedua dan ingat menyetujuinya. Docstring yang
  seharusnya menuntun pembaca ke sana justru yang membuatnya terasa sudah
  ditangani.

  Anggarannya berkas TERPISAH dari anggaran term, sengaja: dua anggaran dalam
  satu berkas menjadi hijau begitu salah satunya regresi dan yang lain
  menyerapnya. Dan bukti-mutasinya memperlihatkan kenapa fixture WAJIB melebihi
  anggaran — mengembalikan loop memerahkan kasus sepuluh-institusi dan
  meninggalkan kasus satu-institusi tetap lolos, karena `1 + 1 = 2` di kedua
  bentuk.

  Instans ketiga, `syncMenuItems`, ditunda di sini dan ditutup oleh PUTARAN NAMA
  di atas. **Dua hal yang semula dinyatakan entri ini tentangnya SALAH**, dan
  keduanya dikoreksi di sana: ia dinamai `replaceMenuItems`, fungsi yang tidak
  ada, dan pemanggilnya disebut bergantung pada urutan `RETURNING`-nya. Triase
  lengkap situs yang belum dibaca ada di **#715**.

  **Sapuan itu kini ditutup di #715, dan DUA klaimnya lagi ternyata salah.**
  "Job backfill mengiterasi TENANT di lapis terluar sehingga biayanya PERKALIAN"
  — benar, dan BUKAN cacat: `withTenantOrThrow` membuka transaksi dengan GUC
  tenant ter-set, jadi mem-batch lintas tenant berarti MELEWATI RLS, dan KEDUA
  job menyatakannya di komentarnya sendiri (`entitlement-backfill-job.ts:94`:
  _"a single cross-tenant SELECT would return nothing at all rather than
  everything"_). Temuan kedua yang saya ajukan di sana — bahwa backfill
  entitlement melebih-lapor jumlah grant dan membuat grant satu tenant
  tak-atomik — juga BERLEBIHAN dan dikoreksi di issue-nya: plan-nya sudah
  melewati `already_held`, dan job-nya idempoten serta bisa dijalankan ulang,
  jadi hitungannya akurat di luar race dan keadaan separuh menyatu pada
  jalannya berikutnya.

  Dari 34 situs, **empat layak ditindaklanjuti**. Tiga ada di atas; keempat
  adalah `business-scope-expiry-job`, yang kedua pass-nya masing-masing
  mengeluarkan satu INSERT per item kedaluwarsa di bawah cap **500** — dua kali
  lebih besar dari batas sapuan blog. Pass exception-nya kini memakai
  `recordAuditEvents`, bentuk batch dari writer yang loop-nya sendiri panggil,
  dengan BARISNYA tak berubah. Sisanya terbatas oleh registry, disengaja dengan
  alasan tertulis, atau butuh penulisan ulang alih-alih batch
  (`module-usage-report` adalah 21 query BERBEDA lewat `switch`, jadi
  `UNION ALL`, bukan batch).

  Satu hal yang disingkap pass itu dan BUKAN soal performa: **tes kedaluwarsa
  SoD menegakkan perpindahan status dan tidak lebih.** Memindahkan tulisan itu
  ke batch writer akan membiarkan setiap asersi di berkas itu hijau bahkan bila
  batch-nya membuang seluruh baris auditnya. Bentuk yang berulang — tes yang
  mencakup PERPINDAHAN keadaan dan bukan CATATAN atas perpindahan itu persis tes
  yang tak bisa menyadari writer-nya ditukar di bawahnya.

- **PUTARAN ARAH — 25 Agustus 2026: gerbang enforcement menanyakan
  pertanyaannya SATU arah saja, dan arah yang hilang justru yang berakibat
  endpoint MATI.** Dicatat sebagai terbuka oleh PUTARAN REGISTER di bawah;
  ditutup di sini.

  Sejak ADR-0057 §F, `access:permissions:enforcement:check` menanyakan apakah
  setiap permission yang DIDEKLARASIKAN deskriptor punya guard
  `authorizeInTransaction`. Ia membangun himpunan setiap guard yang dibentuk
  teks sumber lalu TIDAK PERNAH membaca himpunan itu kembali. Pertanyaan
  sebaliknya — apakah setiap guard MENYEBUT permission yang dideklarasikan
  suatu deskriptor? — berbiaya satu loop tambahan dan menangkap kegagalan yang
  jelas lebih buruk.

  **Kenapa lebih buruk.** `authorizeInTransaction` menjawab dari
  `grantedPermissionKeys`, hasil join role grant aktif ke `awcms_permissions`.
  Kunci yang tak dideklarasikan deskriptor mana pun tak punya baris katalog
  untuk di-join, sehingga TIDAK ADA role yang bisa memegangnya, sehingga
  `evaluateAccess` mengembalikan `default_deny` — untuk owner tenant, untuk
  tenant platform, untuk setiap aktor di setiap deployment, selamanya. Endpoint
  itu bukan berpenjagaan lemah; ia MATI, dan menjawab 403 dalam bentuk yang tak
  bisa dibedakan dari penolakan yang sah. Repo ini sudah mengirimkan cacat itu
  DUA KALI: `POST /api/v1/identity/business-scope/assignments` menolak setiap
  input di setiap deployment (#180 F2), dan `blog_content.pages.publish` berarti
  tak ada halaman yang bisa dipublikasikan oleh jalur kode mana pun sementara
  pencarian publik memfilter `status = 'published'` sehingga selalu
  mengembalikan kosong (ADR-0057). Keduanya ditemukan dengan tangan, berbulan
  kemudian, oleh orang yang hendak membangun layar.

  **Celahnya NYATA, dan pemindai gerbang itu sendiri yang membuktikannya.**
  Ditanya terbalik, repo menghasilkan tepat satu pelanggaran:
  `seo_distribution.redirect.purge`. Route itu menjaga dengan
  `action: (lifecycleAction === "purge" ? "delete" : "update")`, dan
  `readActionValues` mengumpulkan SETIAP literal string dalam ekspresi —
  termasuk yang justru DIBANDINGKAN oleh ternary. Pemindai mengarang permission
  yang tak pernah dituntut route itu, dan ia duduk di himpunan enforced tanpa
  disorot selama tak ada yang membaca himpunan itu kembali.

  Layak disimpan, karena inilah alasan gerbang satu-arah bukan sekadar setengah
  gerbang: **false positive yang tak berbahaya di satu arah adalah KEGAGALAN di
  arah lain.** Kunci ENFORCED karangan tak cocok dengan apa pun dan diabaikan
  loop maju. Kunci yang sama, dibaca sebagai "permission yang dituntut repo
  ini", adalah cacat yang dilaporkan. Gerbang mana pun yang mengakumulasi
  himpunan untuk satu tujuan WAJIB diaudit ulang sebelum himpunan itu dibaca
  untuk tujuan kedua.

  Kedua sisi diperbaiki. Operand pembanding dibuang sebelum literal
  dikumpulkan — hanya OPERAND-nya, tak pernah seluruh kondisi, karena route
  comments menulis `decision === "approve" ? "approve" : "reject"` di mana
  `approve` sekaligus dibandingkan DAN dihasilkan. Dibuang UTUH, berikut tanda
  kutipnya: mengosongkannya jadi `""` memasangkan ulang kutip di sekitarnya
  sehingga CELAH antar-literal asli (`" ? "`, `" : "`) mulai cocok sebagai
  literal. Draf pertama perbaikan ini sendiri melakukan itu dan mengarang empat
  permission per route — itulah sebabnya ia dipatok tes, bukan diserahkan pada
  bentuk sebuah regex.

  Aturan basi ikut berubah. "Basi bila permission tak dideklarasikan" membuat
  exception yang memaafkan guard TAK-TERDEKLARASI mustahil ditulis — mencatat
  satu akan langsung melaporkannya basi. Exception kini basi hanya bila ia tak
  memaafkan apa pun.

  Dikirim dengan daftar exception tetap KOSONG di kedua arah: 244/244 permission
  terdeklarasi punya guard, dan setiap guard menyebut permission terdeklarasi.
  Terbukti-mutasi dua kali di gerbang (kembalikan perbaikan pemindai → phantom
  dilaporkan; salah-ketik satu activity code → kedua action-nya dilaporkan) dan
  sekali per tes baru.

  Ditutup di sini juga, item lain yang ditinggalkan terbuka PUTARAN REGISTER:
  **fan-out push berbiaya `R + (R x S)` query.** `enqueuePushToRecipients`
  melakukan satu lookup subscription per penerima lalu satu `INSERT` per
  perangkat, di dalam SATU transaksi pada satu koneksi — 1.500 perjalanan
  pulang-pergi untuk 500 pengguna dengan dua perangkat. Tak ada di produksi yang
  pernah membayarnya: satu-satunya pemanggil, `POST /api/v1/push/test`, mengirim
  satu penerima. Justru itu alasan memperbaikinya — biayanya bukan properti
  fungsi SEBAGAIMANA DIPAKAI melainkan properti KONTRAK-nya ("setiap penerima"),
  menunggu pemanggil pertama yang menyiarkan, dan akan tiba sebagai insiden
  bukan komentar review. Kini satu lookup ter-batch dan satu
  `INSERT ... jsonb_to_recordset`. Kasus murah TIDAK jadi lebih mahal: nol
  penerima tetap nol query, dan semua-penerima-dilewati — kasus UMUM, karena
  kebanyakan pengguna tak pernah mengaktifkan push — berbiaya satu. Perilaku tak
  berubah, sengaja termasuk bagian ganjilnya (id duplikat tetap menghasilkan
  notifikasi duplikat); mengubahnya berarti perubahan perilaku senyap yang
  menumpang pada perbaikan performa. Dipatok anggaran terhadap fixture 4
  penerima dan 9 perangkat — 13 query di bentuk lama — dan tesnya membaca
  barisnya kembali dari tabel karena penulisan ulang `jsonb_to_recordset`
  memuaskan penghitung sambil merusak apa yang mendarat.

  **Masih terbuka setelah putaran ini** (keduanya disebut PUTARAN REGISTER dan
  tak satu pun ditutup olehnya): route API yang menyebut permission yang tak
  dideklarasikan modul mana pun KINI tertangkap, tetapi route yang menyebut
  permission TERDEKLARASI sambil menegakkannya pada resource yang SALAH tidak,
  dan tak bisa ditangkap pemindaian sintaktik — tes kontrak per-layar adalah
  lapisan untuk itu, dan ia hanya ada untuk layar admin. #599 dan #711 tetap
  terblokir artefak eksternal, bukan kode.

- **PUTARAN REGISTER — 25 Agustus 2026: dua register menggambarkan permission
  yang sama, tak ada yang membandingkannya, dan gara-gara itu SATU permukaan
  otorisasi utuh tidak punya layar.**

  `awcms_permissions` adalah yang dibaca `authorizeInTransaction`. Deskriptor
  modul adalah register KEDUA atas fakta yang sama, dan register itulah yang
  dipercaya setiap gerbang statis: `access:permissions:enforcement:check`
  bertanya "apakah tiap permission TERDEKLARASI punya penegak?",
  `admin:screen-coverage:check` bertanya "apakah tiap permission TERDEKLARASI
  punya layar?". Keduanya mengiterasi apa yang DIDEKLARASIKAN modul. **Tidak ada
  yang membandingkan kedua register itu, ke arah mana pun.**

  **Tiga permission hanya hidup di salah satunya.**
  `identity_access.abac_policies.{read,configure,analyze}`, di-seed langsung ke
  `sql/032`, tidak dideklarasikan di mana pun — dengan alasan yang tertulis di
  migration itu, _"rather than via a module descriptor `permissions` array which
  this module does not use"_, benar saat ditulis dan salah sesudahnya.
  Endpoint-nya berfungsi, jadi tak ada yang tampak rusak. Yang rusak: ketiganya
  menjadi **TAK TERLIHAT oleh setiap gerbang yang seharusnya menginterogasinya**
  — dikecualikan dari pemeriksaan repo karena KELALAIAN, bukan karena keputusan,
  dan tak ada register yang menyatakannya.

  **Yang disembunyikannya.** Permukaan kebijakan DSL yang dijaga ketiganya —
  `/api/v1/access/policies/*`, SATU-SATUNYA permukaan yang menghasilkan
  kebijakan yang dikonsumsi evaluator (`policy-cache.ts` memfilter
  `is_dsl_managed`) — **sama sekali tidak punya layar admin**, sepanjang
  hidupnya. ADR-0033 sudah mengantisipasinya. Gerbang yang ada persis untuk
  mengatakan itu tidak bisa: ia tak pernah diberi pertanyaannya.

  Sementara itu satu-satunya layar kebijakan yang ADA, `/admin/abac-policies`,
  menulis baris flat yang tak pernah dievaluasi. Keinertan itu disengaja dan
  benar — baris flat tak bisa di-scope maupun dikondisikan, jadi sebuah `deny`
  flat akan menolak SETIAP request tenant tanpa pemulihan in-band — tetapi
  layarnya hanya pernah berkata tabelnya kosong secara bawaan, yang terbaca
  "belum ada apa-apa" alih-alih "tak ada yang berlaku". Kini ia menyatakannya.

  **Enam penyimpangan deskripsi ikut keluar, dan itu HIDUP.** Setiap migration
  seed permission berakhir `ON CONFLICT DO NOTHING`, jadi deskripsi ditulis
  SEKALI dan suntingan deskriptor sesudahnya tak pernah sampai ke katalog.
  `comparePermissions` menyebutnya `mismatched_description` dan sinyal health
  modul menghitungnya sebagai kegagalan — sehingga `blog_content`,
  `identity_access`, `tenant_admin`, dan `idn_admin_regions` SEMUANYA melaporkan
  `permission_catalog_synced = fail` di setiap deployment ter-migrasi. **Diukur
  terhadap basis data nyata, lalu diukur ulang hijau sesudah `sql/148`.** Lima
  dikoreksi di katalog; yang keenam di DESKRIPTOR, karena di sana katalog punya
  kalimat yang lebih baik. Aturannya "buat kedua register mengatakan kalimat
  yang lebih baik", bukan "buat katalog menuruti kode".

  **Gerbangnya sebuah TEST, bukan `scripts/*-check.ts`, dan itu keputusan
  desainnya.** Gerbang murni yang jelas akan mem-parse `sql/*.sql`: dua bentuk
  kolom INSERT, plus lima migration yang MENGHAPUS baris katalog dalam
  setidaknya dua bentuk predikat, diterapkan kumulatif menurut urutan migration.
  Regex yang salah-parse satu saja menghasilkan gerbang yang salah dengan
  yakin — kegagalan yang sudah dicatat repo ini lebih dari sekali. Basis data
  ter-migrasi sudah menerapkan semuanya dengan tepat, jadi
  `permission-catalogue-parity.integration.test.ts` MEMBACA jawabannya alih-alih
  menurunkannya ulang, dan memakai ulang `comparePermissions` supaya CI dan
  endpoint health tak bisa berselisih soal dua register yang sama.
  Dibuktikan-mutasi.

  **`/admin/access-policies`** memberi permukaan itu layarnya: daftar kebijakan
  yang dievaluasi dengan kolom **Berlaku**, dan simulator keputusan. Juga
  `isDslManaged` pada record dan pada respons API — daftar ini mengembalikan
  baris flat dan DSL sekaligus, jadi tanpanya baik klien maupun layar tak bisa
  membedakan kebijakan yang TERSIMPAN dari yang BERLAKU. Keduanya fakta berbeda
  tentang sebuah aturan akses, dan yang lebih berkonsekuensi justru yang tak
  bisa dilihat siapa pun.

  `abac_policies.configure` masuk `DELIBERATELY_UNSCREENED`, dengan preseden
  `workflow.definition.*`: menulis DSL kondisi butuh editor sungguhan, dan
  textarea JSON yang menerima kebijakan cacat sampai API menolaknya adalah
  afordansi yang LEBIH BURUK daripada tidak ada. Di sini lebih tajam daripada
  untuk workflow — graf workflow cacat itu diagram buruk, kebijakan akses cacat
  itu aturan otorisasi.

  **Satu salah-belok yang layak dicatat, karena ia bertahan melewati dua putaran
  penalaran.** Versi pertama temuan ini berbunyi "layar ABAC menggerbangi
  `access_control.*` padahal rute yang digerakkannya menggerbangi
  `abac_policies.*`" — sebuah afordansi palsu. Itu SALAH: layar tersebut
  mem-POST ke `/api/v1/abac/policies`, yang MEMANG dijaga `access_control.*`.
  Ada dua permukaan di atas satu tabel, namanya beda satu kata, dan yang keliru
  dibaca sebagai satu-satunya.
  `tests/admin-access-policies-page-contract.test.ts` kini memaku nyaris-miss itu
  dari sisi sebaliknya: layar baru TIDAK BOLEH menyebut `access_control.*`.

  **Masih terbuka:** sinyal health melaporkan orphan tanpa menggagalkannya —
  disengaja, karena orphan itu celah tata kelola, bukan kesalahan runtime — dan
  `access:permissions:enforcement:check` tetap hanya berarah
  deklarasi→penegakan. Test paritas membuat arah kedua tak diperlukan untuk
  KATALOG, tetapi rute yang menyebut permission yang tak dideklarasikan modul
  mana pun masih hanya tertangkap untuk `src/pages/admin/**`, bukan untuk rute
  API.

- **#599 SUDAH DIPECAH — 25 Agustus 2026. Rekomendasi PUTARAN BENTUK
  dijalankan, dan ini mencatat hasilnya supaya rekomendasi itu tidak dibaca
  lagi sebagai masih-tertunda.**

  PUTARAN BENTUK di bawah ditutup dengan: "pecah #599 alih-alih menahan satu
  issue pada artefaknya yang paling lambat. Bentuk 1 plus tiga aturan statis
  adalah peta yang siap cutover hari ini." **Kalimat terakhir itu kini diketahui
  SALAH** — template bentuk-1 mencocoki 0 dari 25.029 URL dan pemikul petanya
  adalah lapis yang keliru; lihat PUTARAN ORIGIN di atas dan ADR-0114.
  Pemecahannya sendiri tetap benar. Sudah dikerjakan:

  - **#599, diganti judulnya** — "Cutover 301 SeputarBorneo: jalankan peta
    artikel + tiga aturan halaman statis (kodenya sudah ada; sisanya artefak)".
    Ketiga keluhan ASLINYA — tak ada kolom id legacy, tak ada impor redirect
    massal, badan CKEditor tak bisa disimpan — semuanya SUDAH DIBANGUN
    (`sql/138`, `blog:legacy:redirects:import`, `legacy-html-conversion.ts`),
    dan itulah sebabnya judul lamanya menyesatkan. Yang tersisa adalah
    menjalankannya: peta artikel, tiga aturan path-eksak yang diketikkan ke
    `awcms_seo_redirects`, dan crawl pra-cutover terhadap URL sitemap yang
    hidup.
  - **#711, baru** — bentuk rubrik (2 dan 3) dan bentuk pencarian (4). Diajukan
    dengan dua pemblokir; PUTARAN VOLUME di atas menemukan yang PERTAMA tidak
    ada (daftar rubriknya 102 pasangan di volume Docker yang terisi, bukan data
    yang hilang), menyisakan satu: rute TUJUAN dirender
    oleh `ahliweb/awcms-astro` (ADR-0045/ADR-0070) — pertanyaan kontrak
    lintas-repo lebih dulu, baru pertanyaan impor. Term juga tidak punya kolom
    provenance, jadi tidak ada yang bisa diungkapkan `--path-template`.
    **Di bawah ADR-0114 `--path-template` BUKAN mekanisme untuk semua ini** — ia
    menulis ke tabel yang tak pernah dicapai permintaan-permintaan itu.

  **Yang sebenarnya dilindungi oleh pemecahan ini.** Bentuk 3 adalah catch-all
  dua segmen telanjang, jadi ia keluarga yang akan dijatuhkan dalam jumlah
  TERBESAR oleh peta yang dibangun dari bentuk-bentuk yang DISEBUT — secara
  senyap. Menahannya di issue yang sama dengan paruh yang DIKIRA siap cutover
  justru yang akan membuat cutover-nya berangkat sambil mengira dirinya lengkap.
  Terpisah dari itu, `cari_berita/*.html` sama sekali TIDAK boleh 301 ke konten
  — query sembarang tidak punya satu tujuan yang benar. **Instruksi itu tetap
  berlaku dan subjeknya tidak ada:** bentuk 4 tak pernah menyala, karena
  catch-all dua-segmen di baris atasnya sudah mengklaim setiap path yang bisa
  dicocokinya, sehingga `/cari_berita/X.html` disajikan sebagai URL BENTUK-3 dan
  sudah tercakup aturan 1 ADR-0113.

- **PUTARAN SAPUAN — 25 Agustus 2026: sapuan terjadwal berbiaya konstan PER
  POST, dan indeks yang putaran sebelumnya tinggalkan sebagai tugas pengukuran
  ternyata TIDAK perlu diubah. Kedua paruh itu sama-sama hasil.**

  PUTARAN PERFORMA di bawah meninggalkan tiga hal yang disebut tetapi tidak
  diperbaiki. Dua di antaranya kini ditutup.

  **Sapuannya lebih buruk daripada yang dicatat.** Catatan itu menyebut
  "`blog-scheduled-publish` memanggil `fetchPostTermIds` per-post di dalam loop
  sapuannya". Per post jatuh tempo, sapuan itu JUGA membaca flag penegakan
  managed-media SEKALI PER EVALUASI checklist — dan ia mengevaluasi dua kali —
  me-resolve media post itu per evaluasi, menulis `UPDATE`-nya sendiri,
  meng-enqueue purge edge-cache-nya sendiri, dan menulis baris auditnya sendiri.
  Diukur terhadap implementasi sebelumnya:

  | Sapuan (12 post jatuh tempo) | Sebelum | Sesudah |
  | ---------------------------- | ------- | ------- |
  | publish, penegakan mati      | 40      | 6       |
  | publish, penegakan hidup     | 52      | 7       |
  | unpublish                    | 27      | 4       |

  Kemiringannya yang jadi temuan: `4 + 3N`, `4 + 4N`, dan `3 + 2N` melawan 6, 7,
  dan 4 yang datar. Pada batas batch 200 itu berarti 604, 804, dan 403 pulang
  pergi — per tenant, pada SATU koneksi `maintenance` yang job itu pegang, di
  dalam job yang mendatangi setiap tenant aktif berurutan.

  **Tidak ada yang per-post di sana kecuali putusannya.** Penegakan
  managed-media adalah properti TENANT; resolusi media berkunci pada id objek
  media, yang berlaku se-tenant. Me-resolve gabungan seluruh referensi satu
  batch dalam satu `id = ANY(...)` mengembalikan baris yang identik dengan
  me-resolve milik tiap post sendiri-sendiri. Evaluasinya sendiri tetap
  per-post.

  **Cek-ulang TOCTOU menjadi LEBIH KECIL, bukan lebih lemah** — bagian yang
  paling berisiko hilang oleh "rapi-rapi" berikutnya. Sapuan mengevaluasi ulang
  tepat sebelum menulis karena objek media yang dirujuk TIDAK dikunci oleh
  `FOR UPDATE` batch. Membatch menjaga jendela itu tetap satu pulang-pergi dan
  menghentikannya tumbuh mengikuti seberapa jauh sebuah post berada di dalam
  batch. Memakai ulang putusan lintasan pertama akan MENGHAPUS mitigasinya
  sambil tampak seperti pembersihan, jadi lintasan kedua tetap lintasan kedua —
  dengan dua query untuk seluruh batch, bukan dua per post.

  **Mitigasi itu TIDAK dipegang apa pun, dan itulah sebabnya ia nyaris
  hilang.** Sebuah anggaran justru akan lebih SENANG bila lintasan kedua
  dihapus — angkanya turun — dan test kebenaran di atas fixture yang stabil
  tidak bisa membedakan kedua lintasan, karena keduanya melihat media yang
  sama. Ia hanya sebuah komentar. `scheduled-publish-toctou.integration.test.ts`
  kini menjalankan stub `MediaLibraryPort` yang me-resolve media unggulan pada
  panggilan PERTAMA lalu berhenti pada yang kedua — pelepasan itu, dibuat
  deterministik — dan menuntut post-nya tetap `scheduled`; kasus kontrolnya,
  media yang tak pernah hilang, WAJIB terbit, sehingga test yang lulus karena
  checklist-nya tak pernah lulus tidak bisa bersembunyi. **Port-lah yang membuat
  ini bisa diuji sama sekali**: keadaan media berada di balik satu jahitan,
  jadi balapannya tak perlu dibalapkan.

  **`recordAuditEvents` adalah paruh yang bisa dipakai ulang**, dan bentuknya
  yang layak dibawa ke depan. N baris dalam satu statement dari SATU parameter
  `jsonb`, BUKAN idiom `INSERT ... SELECT unnest(...)` yang dipakai di tempat
  lain: `unnest` menuntut satu array per kolom, tabel ini punya delapan kolom
  nullable plus satu `jsonb`, dan binding array Bun TIDAK BISA membawa NULL — ia
  menulis string harfiah `null` tanpa melempar. Itu delapan peluang salah secara
  senyap, melawan satu parameter di mana JSON `null` memetakan ke SQL NULL dan
  `attributes` tetap objek bersarang sungguhan. `jsonb_to_recordset` adalah
  idiom untuk batch insert baris dengan kolom nullable atau `jsonb`.

  **Sebuah test asersi-source memerah padahal perilakunya utuh, dan itu
  pelajarannya sendiri.** `tests/two-sided-attribution.test.ts` menjaga dua kolom
  atribusi ADR-0091 dengan mencari `${input.actorTenantId ?? null}` di
  `audit-log.ts`. Penulis batch merakit nilai yang sama ke dalam objek baris
  jsonb, jadi asersinya patah pada EJAAN. Ia tetap dipertahankan — murah, tanpa
  basis data, paling cepat menangkap field yang hilang — tetapi bukan lagi
  satu-satunya saksi: `tests/integration/audit-log-writer.integration.test.ts`
  membaca kedua kolom itu KEMBALI DARI TABEL, dengan seluruh rantai FK
  (partner → engagement → grant) di-seed, karena sebuah baris tidak bisa
  mengklaim grant yang tidak ada.

  **Pertanyaan indeks, diukur terhadap 24.000 post — dan hipotesisnya tidak
  bertahan.** Catatannya berbunyi: "`awcms_blog_post_terms_tenant_idx` adalah
  satu kolom berkardinalitas rendah. Arsip kategori memfilter `term_id` di bawah
  predikat `tenant_id` milik RLS; `(term_id)` melayaninya dan komposit
  `(tenant_id, term_id)` akan melayani keduanya."

  - Untuk kategori LEBAR arsip tidak memakai satu pun: ia berjalan dari
    `awcms_blog_posts_tenant_status_published_idx` terbaru-dulu lalu memeriksa
    indeks UNIQUE `(post_id, term_id)`. 0,09 ms, 67 buffer.
  - Untuk kategori SEMPIT planner berbalik ke rencana yang digerakkan term dan
    memakai `(term_id)` — jadi `(term_id)` TIDAK redundan. 27 buffer.
  - Komposit `(tenant_id, term_id)` melayani rencana sempit itu secara identik
    (25 buffer) dan lebih lebar per entri. Mengganti KEDUA indeks satu-kolom
    dengannya akan membuat penghapusan induk di `awcms_blog_terms` memindai
    tabel join — persis residu yang didokumentasikan `db:fk-index:check` soal
    komposit `(tenant_id, X)`. Dan `tenant_id` tidak bisa sekadar dibuang: tidak
    ada query di repo yang memfilter tabel ini dengan `tenant_id` saja, tetapi
    gerbang FK-index menuntutnya terjangkau indeks.
  - Bulk insert 5.000 assignment: 110 ms dengan tiga indeks, 115 ms dengan dua.
    Masih di dalam derau — tidak ada kemenangan tulis terukur untuk diklaim.

    **Kesimpulan: tidak ada perubahan.** Nilainya ada pada penyangkalan dan
    angkanya, bukan pada sebuah migration.

  **Jebakan pengukuran yang layak dicatat, karena ia menghasilkan jawaban yang
  salah dengan yakin selama dua puluh menit.** Ditulis dengan term id sebagai
  subquery — `pt.term_id = (SELECT id FROM awcms_blog_terms WHERE slug = …)` —
  kategori sempit berbiaya **24,7 ms dan 48.832 buffer**, memindai seluruh
  24.000 post untuk mengembalikan 8 baris, karena InitPlan tidak di-konstanta-
  lipat dan planner jatuh ke selektivitas generik (ia menduga 12.003 baris untuk
  keduanya). Kode nyata mengikat `termId` sebagai PARAMETER, Postgres membangun
  custom plan, dan query yang sama berbiaya 27 buffer. **Benchmark yang tidak
  mengikat parameternya seperti pemanggilnya mengukur rencana yang tak pernah
  didapat pemanggil itu.**

  **Masih terbuka dari putaran di bawah, tidak berubah:** sembilan jalur tulis
  ber-amplifikasi lebih rendah, masing-masing dibatasi oleh apa yang dikirim
  SATU request. `enqueuePushToRecipients` yang layak disebut — satu query per
  penerima plus satu `INSERT` per langganan — tetapi satu-satunya pemanggilnya
  hari ini adalah `POST /api/v1/push/test` yang self-service, dengan satu
  penerima. Ia menjadi fan-out sungguhan begitu ada pemanggil broadcast.

- **PUTARAN PERFORMA — 24 Agustus 2026: seluruh anggaran query mengukur
  PEMBACAAN. Setiap N+1 di repo ada di jalur TULIS atau di job — paruh yang
  tak dihitung siapa pun.**

  Metode: pemindaian setiap berkas `src/` untuk query yang diterbitkan DI DALAM
  loop, lalu disilangkan dengan apa yang benar-benar dicakup keempat suite
  anggaran (`query-budget`, `query-budget-admin`, `middleware-query-budget`, dan
  pembangun sitemap). Keempatnya mengukur pembacaan. Itu bukan kelalaian
  melainkan ke mana perhatian tertuju: jalur baca dipukul terus-menerus sehingga
  biayanya terasa; jalur tulis dipukul sekali per penyimpanan, jadi query
  per-item di dalamnya tampak bukan apa-apa.

  Ia berhenti tampak bukan apa-apa begitu importer massal menjadi pemanggilnya.

  **DIPERBAIKI — `syncPostTermAssignments` menerbitkan satu `INSERT` per term.**
  Segelintir statement saat editor menyimpan artikel; sekitar 24rb `DELETE` dan
  48rb `INSERT` saat `blog:legacy:import` mengarsipkan 23.906 artikel — pemanggil
  nyata yang baru dibuat #708. Kini satu `DELETE` + satu `INSERT ... unnest`,
  bentuk yang sudah dipakai `comment-retention.ts` dan
  `announcement-directory.ts`. TIDAK dideduplikasi di jalan masuk:
  `awcms_blog_post_terms_unique` menolak pasangan berulang dulu dan sekarang,
  dan menelannya di sini akan mengubah error constraint yang NYARING menjadi
  selisih SENYAP antara yang diminta dan yang tersimpan.

  Dipatok `tests/integration/post-term-assignment-budget.integration.test.ts` —
  **anggaran query PERTAMA pada jalur tulis**. Anggarannya PERSIS (2), bukan
  plafon: propertinya adalah angkanya TIDAK bergerak mengikuti jumlah term, dan
  `toBeLessThanOrEqual` akan meloloskan regresi per-term selama fixture-nya tetap
  kecil. Fixture memasang 12, jadi bentuk lama tak bisa lolos kebetulan.
  Kebenaran di-assert BERSEBELAHAN dengan tiap hitungan, karena anggaran sendirian
  dipuaskan oleh fungsi yang tidak menulis apa pun.

  **TIDAK diperbaiki, dicatat agar tak diturunkan ulang:**

  - **Sembilan jalur tulis lain menyisipkan satu baris per item di dalam loop** —
    item menu, penempatan iklan, institusi, template email, penulis kebijakan
    ABAC, undangan, konfigurasi sidebar, push enqueue, `sync/push`. Masing-masing
    dibatasi oleh apa yang dikirim SATU permintaan, jadi konstanta kecil, bukan
    risiko penskalaan. Layak di-batch bila himpunannya dikendalikan pengguna;
    tidak mendesak.
  - **`blog-scheduled-publish` memanggil `fetchPostTermIds` per-post di dalam loop
    sapuannya.** Dibatasi berapa post jatuh tempo dalam satu sapuan — yang saat
    cutover tidak kecil. Kembaran ter-batch `fetchPostTermIdsForPosts` sudah ada.
  - **`awcms_blog_post_terms_tenant_idx` adalah satu kolom berkardinalitas rendah.**
    Arsip kategori — permukaan yang dinyatakan nyata oleh #708 — memfilter
    `term_id` di bawah predikat `tenant_id` milik RLS; `(term_id)` melayaninya dan
    komposit `(tenant_id, term_id)` akan melayani keduanya, membuat index
    satu-kolom itu mubazir. Butuh `EXPLAIN` terhadap data nyata untuk membenarkan
    biaya tulisnya, jadi ini tugas PENGUKURAN, bukan perubahan.

  **Yang TIDAK ditemukan pemindaian, dan itulah paruh berguna dari hasil bersih:**
  tak ada pembacaan publik tanpa batas, dan tak ada N+1 di jalur daftar publik.
  Sisi baca dari relasi yang sama ini SUDAH diperbaiki dengan sengaja —
  `fetchPostTermIdsForPosts` membawa komentar "tiga round trip per halaman, bukan
  lima puluh satu". Sisi tulisnya sekadar tak ada yang menghitung.

- **PUTARAN BENTUK — 24 Agustus 2026: `.htaccess` legacy yang ditunggu #599 ADA
  di mesin pengembangan, dan ia MEMBANTAH rencana yang disusun tanpanya. Lima
  bentuk URL, bukan dua; salah satunya tak pernah didaftar; dan separuh
  halaman-statis `sql/138` adalah sepasang kolom yang TAK ADA penulis maupun
  pembacanya.**

  PUTARAN CUTOVER di bawah ditutup dengan "yang tersisa pada #599 bukan kode —
  menjalankan job-nya butuh `.htaccess` legacy dan ekspor sitemap, yang tidak
  ada di kedua repo". Paruh pertamanya kini TIDAK berlaku lagi. Berkasnya ada di
  `/home/data/dev_php/seputarborneo.com/.htaccess`, salinan kerja situs legacy
  yang duduk BERSEBELAHAN dengan repo ini, dan membacanya menggerakkan #599
  tanpa menggerakkan satu baris kode aplikasi pun.

  **Lima bentuk rewrite.** Artikel `^news/([^/]*)\.html$`; rubrik
  `^rubrik/([^/]*)\.html$`; **`^([^/]*)/([^/]*)\.html$`**, catch-all dua-segmen
  telanjang yang memetakan ke `/rubriks/?news=$1&kt=$2`; pencarian
  `^cari_berita/([^/]*)\.html$`; dan halaman statis `^([^/]*)\.html$`. Hanya
  yang pertama tercakup. Yang ketiga TIDAK muncul di versi rencana mana pun pada
  issue itu — dan karena ia catch-all, justru keluarga itulah yang akan dijatuhkan
  DIAM-DIAM dalam jumlah terbesar oleh peta yang dibangun dari bentuk-bentuk yang
  terdaftar: persis keluaran yang hendak dicegah catatan "enumerasi setiap bentuk".
  **Putaran ini MENGHITUNG bentuknya dan tidak membaca URUTANNYA**, dan itulah
  sebabnya ia luput melihat bahwa catch-all yang baru saja ditemukannya duduk DI
  ATAS `cari_berita` dan selalu membayanginya — bentuk hidupnya EMPAT, bukan
  lima. Lihat PUTARAN ORIGIN di atas.

  **"Menutupinya cukup satu run lagi, bukan perubahan kode" SALAH untuk tiga dari
  lima.** `blog:legacy:redirects:import` MENOLAK `--path-template` yang tidak
  memuat `{legacyId}` dan menurunkan petanya dari
  `awcms_blog_posts.legacy_source_id`. Daftar rubrik dan halaman statis BUKAN
  artikel, jadi tak ada template yang bisa menyatakannya; tak ada yang bisa
  dijalankan. Term bahkan tak punya kolom provenance sama sekali.

  **`awcms_blog_pages.legacy_source_system`/`legacy_source_id` TANPA penulis dan
  TANPA pembaca.** `blog:legacy:import` hanya mengimpor post, dan
  `listLegacyRedirectMappings` mengambil `FROM awcms_blog_posts`. Pasangan itu
  mati sejak `sql/138` mendarat. Yang membuatnya TERBACA tercakup adalah bentuk
  yang wajib dibawa ke depan: `tests/legacy-redirect-map.test.ts:54-61`, "pages
  get the same treatment as posts", meng-assert bahwa TEKS BERKAS MIGRATION
  memuat `ALTER TABLE awcms_blog_pages` dan nama index dedup-nya. Tes atas sumber
  sebuah migration membuktikan kolomnya ADA; ia tak bisa melihat kolom itu tak
  pernah dipakai. Komentarnya sendiri menyebut taruhannya — _"memberi provenance
  hanya pada post akan membuat separuh peta 301 tak dapat diturunkan"_ — dan
  separuh itu lalu tak pernah dirangkai. Sekeluarga dengan gerbang registry yang
  memeriksa BENTUK, bukan MAKNA.

  **Kolom mati itu pun bukan obatnya.** `data/index.php:195-212` melakukan switch
  atas himpunan TERTUTUP berisi tiga: `/tentang_kami.html`,
  `/pedoman_media_cyber.html`, `/disclimer.html` (salah ketik legacy itu BAGIAN
  dari URL). Tiga aturan exact-path, yang didukung `awcms_seo_redirects` sejak
  `sql/060` — entri data admin, bukan importer dan bukan backfill. Pasangan kolom
  itu harus dirangkai atau dihapus; membiarkannya adalah yang melahirkan RUPA
  cakupan tadi. **DIHAPUS di `sql/147`** — tak pernah ada yang menulisnya, jadi
  nilai setiap baris NULL dan tak ada data yang hilang; tes yang meng-assert TEKS
  migration diganti tes yang mencari PEMBACA.

  Satu bentuk yang tercakup terkonfirmasi benar: `berita/index.php:9` membaca
  `(int) $_GET['news']`, jadi id-nya adalah digit terdepan dan slug-nya dekoratif
  — `/news/{legacyId}_{slug}.html` memang template yang tepat.
  **Benar tentang router LEGACY, dan terbawa seolah juga benar DI SINI, padahal
  tidak.** Kunci aturan repo ini adalah string EKSAK, dan template itu mencocoki
  0 dari 25.029 URL; ADR-0114 membuat resolusi artikel berkunci-ID justru karena
  ini. Lihat PUTARAN ORIGIN di atas.

  **Yang MASIH terhalang lebih sempit daripada "artefaknya", dan lebih sempit
  lagi sejak PUTARAN VOLUME.** Paragraf ini semula menyatakan bentuk rubrik
  butuh daftar rubrik "yang butuh data yang tak dimiliki salinan kerja itu
  (dump-nya, `seputa58_sbb.sql`, berukuran 0 byte)". Dump-nya 0 byte dan ia
  INERT — datanya ada di volume `seputarborneocom_db_data`, dan daftarnya 102
  pasangan `(jenis_rubrik, kategori)`. Yang tersisa adalah rute target yang
  dirender
  `ahliweb/awcms-astro`, bukan di sini (ADR-0045/ADR-0070) — pertanyaan kontrak
  lintas-repo sebelum menjadi pertanyaan impor. Crawl pra-cutover tak berubah:
  `blog:legacy:cutover:verify` sudah ada dan butuh URL sitemap hidup, pada level
  halaman karena ia menolak index. **Tidak ADA sitemap legacy dan tak pernah
  ada** — tidak di pohon, tidak di riwayat git; situs hidupnya 404 pada
  `/robots.txt` dan setiap path sitemap konvensional sambil menyajikan 200 untuk
  dirinya sendiri. `--sitemap` menerima BERKAS LOKAL, jadi korpus sintetis
  membukanya TANPA perubahan kode. URL hasil pencarian TIDAK boleh di-301 ke
  konten; query sembarang tak punya satu tujuan yang benar — dan bentuk 4 pun tak
  pernah menyala.

  Direkomendasikan: PECAH #599 alih-alih menahan satu issue pada artefak
  terlambatnya. Bentuk 1 plus tiga aturan statis sudah menjadi peta siap-cutover
  hari ini. **Dikerjakan 25 Agustus 2026 — lihat entri di puncak bagian ini.**
  Paruh "siap-cutover" dari kalimat itu tidak bertahan: template bentuk 1
  mencocoki NIHIL (PUTARAN ORIGIN).

- **PUTARAN LEDGER — 24 Agustus 2026: 121 endpoint MENOLAK pengguna tenant
  TANPA MENCATAT bahwa mereka melakukannya.**

  PUTARAN BATAS di bawah menutup pemanggil yang BUKAN SIAPA-SIAPA. Ini mengukur
  pemanggil yang SESEORANG TANPA GRANT — bentuk yang dimiliki SETIAP tenant, dan
  yang paling tak bisa dinalar gerbang statis. Sesi ber-NOL permission, ditembakkan
  ke setiap endpoint ber-body yang ber-gate:

  | Jawaban                                       | Jumlah |
  | --------------------------------------------- | ------ |
  | `403 ACCESS_DENIED` — otorisasi duluan, BENAR | 84     |
  | `400 VALIDATION_ERROR` — skema endpoint-nya   | 61     |
  | `400 IDEMPOTENCY_REQUIRED`                    | 54     |
  | `404` — pencarian eksistensi jalan duluan     | 3      |
  | `422` / `401`                                 | 3      |

  **Temuannya adalah BARIS YANG HILANG, bukan kode statusnya.** ADR-0063
  menjadikan `authorizeInTransaction` satu-satunya tempat keputusan diambil DAN
  satu-satunya tempat ia dicatat. Rute yang menolak sebelum sampai ke sana
  menolak secara tak terlihat — tanpa baris `awcms_access_decision_log`.
  "Endpoint mana yang menjawab selain 403" adalah pertanyaan yang SAMA dengan
  "penolakan mana yang tak meninggalkan jejak", dan jawabannya **121**.

  **Ledger yang HANYA BOLEH MENGECIL, ditegakkan DUA ARAH**
  (`tests/e2e/api-authorization-first.e2e.ts` +
  `support/authorization-first-ledger.ts`): endpoint tak terdaftar yang menjawab
  selain `403` → MERAH (utangnya tak bisa tumbuh), dan endpoint TERDAFTAR yang
  menjawab `403` juga MERAH (ia sudah diperbaiki; barisnya harus dihapus). Tanpa
  arah kedua, ledger penuh baris basi dan jadi hiasan dinding. Keduanya terbukti
  lewat mutasi — 121 entri itu DIHASILKAN oleh arah pertama yang gagal, dan satu
  baris basi memerahkan arah kedua. Bentuk yang sama dengan
  `api:tenant-route:check`.

  **Satu rute diperbaiki sebagai contoh kerja:**
  `POST /api/v1/media/news-images/upload-sessions` dulu memberi tahu pemanggil
  tanpa grant apakah R2 terkonfigurasi (`502`) beserta daftar MIME dan batas
  ukurannya (`400`), tanpa mencatat apa pun. Kini ia MENAHAN kedua penolakan itu
  sampai otorisasi menjawab. Body tetap dibaca DI LUAR transaksi —
  `await request.json()` menunggu KLIEN — dan nilai yang ditahan berupa union
  ber-diskriminan, bukan dua nullable berkorelasi, sehingga kodenya membaca
  `held.value` alih-alih mengasersi `input!`.

  **Tiga entri bersifat STRUKTURAL dan tetap didaftarkan.** `blog/posts/:id` dan
  `blog/pages/:id` membaca barisnya duluan karena BASIS GRANT kepemilikan
  dihitung darinya; `partners/:id/status` dan `access/machine-credentials`
  menghitung permission yang lebih ketat DARI body. "Ada alasannya" dan "ini
  baik-baik saja" adalah dua klaim berbeda, dan hanya yang pertama benar.

  **Dua jebakan, keduanya dicatat.** Sapuan itu MENGELUARKAN DIRINYA SENDIRI dari
  sesi dengan menembak `POST /api/v1/auth/logout`, setelah itu setiap request
  menjawab `401` — false negative buatan sendiri yang terbaca persis seperti
  gerbang yang lulus; kini ia melewati endpoint perusak-sesi dan meng-assert
  sesinya hidup SEBELUM memercayai penolakan apa pun. Dan beberapa "temuan" larut
  saat diperiksa: `push/subscriptions` itu self-service dengan `404` anti-oracle
  yang TERDOKUMENTASI, dan `502`-nya pemeriksaan env lokal, bukan panggilan
  keluar. Kode status saja menyesatkan di kedua arah.

- **PUTARAN BATAS — 24 Agustus 2026: 77 endpoint API menyerahkan skema
  validasinya kepada TOKEN BEARER APA PUN, tanpa meninggalkan baris
  decision-log sama sekali.**

  Ditemukan dengan MENJALANKAN API, bukan membacanya:

  ```
  POST /api/v1/blog/institutions   Authorization: Bearer nonsense
  → 400 VALIDATION_ERROR + setiap nama field, nilai enum, dan batas panjang
  ```

  Tanpa akun, tanpa sesi — string apa pun. **77 endpoint ber-gate sesi menjawab
  seperti itu**, terukur terhadap server yang hidup.

  **Pengungkapan itu bagian TERKECILNYA.** `authorizeInTransaction` yang menulis
  decision log, jadi request yang berhenti sebelum itu tak pernah tercatat:
  enumerasi API TIDAK MENINGGALKAN JEJAK. Sebabnya urutan — `defineTenantRoute`
  memeriksa token ADA, lalu menjalankan `prepare`, yang mem-parse dan
  memvalidasi body.

  **Seluruh gerbang statis HIJAU hari itu**, dan memang tak mungkin lain:
  urutan antara hook `prepare` dan panggilan chokepoint BUKAN properti teks.
  Pemindaian tekstual "validasi sebelum otorisasi" melaporkan 297 dari 305 blok
  rute — salahnya cukup untuk jadi tak berguna, dan nyaris dilaporkan sebelum
  diperiksa terhadap server.

  **Ditutup dengan SATU batas di `src/middleware.ts`**, bukan 77 suntingan
  rute: tidak ada body API yang di-parse sampai kredensial pemanggil resolve.
  63 dari 77 adalah handler tulis-tangan tanpa bentuk bersama, jadi perbaikan
  per-rute takkan punya mekanisme di belakangnya. Ia juga mengubah "endpoint
  mana yang bisa dijangkau tanpa sesi" — sampai kini implisit, hanya bisa
  diketahui dengan membaca 246 handler — menjadi `SESSION_FREE_BODY_ENDPOINTS`,
  26 entri masing-masing dengan alasannya.

  **Autentikasi SAJA.** Otorisasi tetap di chokepoint ADR-0063 dan TIDAK
  diduplikasi. Sesi dicari DUA KALI pada request tulis, dan itu disengaja:
  menyerahkan principal yang di-resolve di transaksi LAIN akan memisahkan
  keputusan dari pembacaan yang dijaganya. Request baca tak berbadan dan tak
  pernah sampai ke batas ini.

  **Paruh otorisasinya:** `defineTenantRoute` kini MENAHAN penolakan `prepare`
  sampai otorisasi menjawab, jadi pemanggil tanpa permission mendapat `403`
  beserta baris decision-log, bukan `400` beserta skema. Mengotorisasi sebelum
  mem-parse justru SALAH di sini — `await request.json()` menunggu KLIEN, dan
  mem-parse di dalam `withTenant` menahan koneksi terpesan selama apa pun yang
  dipilih pemanggil. Dua rute menghitung guard-nya DARI body dan tak bisa
  menunda; keduanya disebut namanya di kode.

  Terbukti lewat mutasi: batas dimatikan lalu di-build ulang → **185 kegagalan
  asersi** di 92 endpoint. Tercatat sebagai **C18** di dokumen standar.

  **Masih terbuka, tak berubah dari PUTARAN GELOMBANG:** kontrol TULIS mana yang
  boleh dilihat pengguna ber-permission separuh.

- **PUTARAN GELOMBANG — 24 Agustus 2026: dua sapuan admin itu KEBETULAN KEBAL,
  dan harness-nya harus dibereskan DULU sebelum keduanya boleh berkata jujur.**

  Ini menutup masalah harness yang ditinggalkan terbuka oleh PUTARAN SESI di
  bawah, lalu membereskan apa yang selama ini DISEMBUNYIKAN oleh masalah itu.

  **Pengurutannya.** `playwright.config.ts` kini menjalankan
  `setup` → `read` → `write` (`tests/e2e/support/e2e-waves.ts`). Spec gelombang
  baca melihat tenant sebagaimana ditinggalkan bootstrap; penulis berjalan
  sesudahnya. Di DALAM tiap gelombang semuanya tetap paralel — biayanya satu
  barrier, dan suite tetap selesai ~19 detik. Baca berjalan DULUAN, bukan
  terakhir, dan itu disengaja: menjalankannya terakhir akan bergantung pada
  setiap mutator yang membereskan dirinya dengan rapi, sedangkan mutator yang
  gagal separuh jalan meninggalkan residu menurut definisinya.

  **Klasifikasinya DIPERIKSA, bukan dipercaya.** Daftar nama berkas biasanya
  jawaban yang SALAH di repo ini — gerbang yang memeriksa matriksnya sendiri
  alih-alih apa yang ADA adalah kegagalan yang berulang di sini. Jadi ia
  dipegang dari dua arah: `tests/e2e-wave-classification.test.ts` menuntut
  setiap `*.e2e.ts` di disk ada di TEPAT SATU gelombang (spec tak terklasifikasi
  malah tidak berjalan sama sekali), dan keanggotaan gelombang baca ditegakkan
  SAAT RUNTIME — spec gelombang baca mengimpor `test` dari
  `tests/e2e/support/e2e-read-wave.ts`, yang menggagalkan tes mana pun yang
  mengirim request `/api/` yang memutasi. Terbukti lewat mutasi: satu
  `fetch(…, {method:"POST"})` membuat spec itu merah dan menyebut request-nya.

  **Apa yang dibuka oleh pengurutan itu — bagian yang paling layak dibaca.**
  `admin-screens-render.e2e.ts` meng-assert `200` — dan **layar yang MENOLAK
  juga menjawab `200`**, karena penolakan di sini DIRENDER, tidak pernah
  redirect. Sapuan itu akan tetap hijau seandainya sebuah layar mulai menolak
  owner: modul dimatikan, sebuah grant hilang dari bootstrap, kebijakan `deny`
  se-tenant ditulis. Kini ia meng-assert layar merender ISINYA — tanpa hook
  penolakan di mana pun di halaman. Terbukti lewat mutasi: mematikan modul
  `reporting` membuatnya gagal di `/admin` DAN `/admin/reporting` sekaligus. Di
  bawah asersi lama skenario itu HIJAU — persis alasan kenapa ia tak bisa
  diperketat selagi mutator mungkin berjalan bersamaan.

  **Sapuan read-only mendarat TANPA perubahan.** `admin-read-only-access.e2e.ts`
  menjalankan pengguna yang diberi SETIAP permission `read` ber-scope tenant dan
  tidak lebih — grantnya dari KATALOG permission, ekspektasinya dari blok
  `authorize` milik tiap halaman, jadi kedua paruhnya berasal dari sumber
  BERBEDA. `/admin/tenants` dan `/admin/partner-registry` WAJIB menolaknya.
  **Ini satu-satunya pemeriksaan ADR-0053 saat runtime di seluruh repo.**
  Terbukti lewat mutasi: memberi peran itu dua platform read membuat kedua layar
  menyajikan isinya dan spec melaporkan pengungkapan lintas-tenant.

  **Percobaan pertama yang SALAH, dicatat karena ia temuan nyata.** Asersi
  ADR-0053 mula-mula ditulis di sapuan OWNER — "kedua layar ini menolak owner" —
  dan GAGAL di lingkungan yang tenant ter-seed-nya ADALAH platform tenant, yang
  owner-nya memang sah memegang permission itu. Apa yang menjadi hak owner di
  sana bergantung pada tenant mana yang di-seed, yang tak bisa diketahui sapuan
  itu secara mandiri — jadi kedua layar itu kini dikecualikan dari pertanyaan
  isi-vs-penolakan di sana dan hanya dipegang pada `200` + shell. Untuk pengguna
  read-only sifatnya TANPA SYARAT: grant `scope = 'tenant'` tak pernah bisa
  memuat permission platform, di tenant mana pun ia berada.

  **Ditemukan sambil bekerja: skill browser-test menggambarkan REPO LAIN.**
  `.claude/skills/awcms-browser-test/SKILL.md` mengklaim ada spec untuk
  `/admin/analytics` dan `/admin/security`, `admin-responsive-nav.e2e.ts`,
  `admin-a11y-smoke.e2e.ts`, serta devDependency `@axe-core/playwright`. Tak
  satu pun ada di sini — semuanya warisan `awcms-mini` saat skill itu di-port.
  Ia juga menggambarkan job CI berjalan DUA FASE dengan
  `--grep-invert "@full-online-gate"`; `ci.yml` hanya satu fase dan kedua spec
  security itu tidak ada. Bagian Status kini mendaftar 16 spec yang
  benar-benar ada, dan satu konvensi wajib baru mencakup klasifikasi gelombang.

  **Masih terbuka, dan DISEBUT alih-alih dianggap tertutup:** kontrol TULIS mana
  yang boleh dilihat pengguna ber-permission separuh. Ekspektasinya berbeda
  per-layar — tak ada selector yang dipakai bersama oleh 76 kontrol terdelegasi
  — jadi itu pekerjaan per-layar, bukan satu aturan mekanis.

- **PUTARAN SESI — 23 Agustus 2026: DUA kegagalan e2e intermiten yang berbeda,
  dan yang di CI ternyata KEADAAN TENANT BERSAMA. Dua diagnosis sebelumnya salah.**

  **Flake di CI:** `admin-users.e2e.ts` meng-assert bahwa menugaskan ulang peran
  yang SUDAH dipegang owner ditolak `409`. Ia sesekali mendapat `200` — penugasan
  BERHASIL. Dropdown-nya mendaftar SETIAP peran di tenant, dan
  `admin-roles.e2e.ts` membuat satu secara bersamaan, jadi pilihan bawaannya
  kadang peran yang TIDAK dipegang owner. Diperbaiki dengan memilih `owner`
  secara eksplisit. Keadaan bersama, bukan balapan, dan tidak ada yang salah
  pada halamannya.

  **Salah arah 1 — balapan hidrasi.** Listener terdelegasi mengikat pada
  `document` di dalam modul tertangguh, jadi klik sebelum itu ditelan diam-diam.
  Jendela itu NYATA dan kini teramati lewat `ADMIN_DELEGATION_READY_ATTRIBUTE`,
  tetapi tidak menyebabkan apa pun di sini.

  **Salah arah 2 — kontensi argon2.** Juga nyata, juga kegagalan BERBEDA:

  Setiap spec terautentikasi menjalankan sendiri formulir `/login` sungguhan.
  Dengan `fullyParallel: true`, itu berarti sampai lima `Bun.password.verify`
  bersamaan — argon2id pada bawaan Bun, berat memori dan CPU SECARA SENGAJA —
  sementara server yang sama merender halaman admin. Suite-nya bimodal:
  biasanya ~15 detik hijau, sesekali EMPAT MENIT dengan enam atau tujuh
  kegagalan, semuanya timeout `waitForURL` 30 detik DI LANGKAH LOGIN, pada spec
  yang tak berhubungan satu sama lain.

  **CI berjalan dengan 2 worker, bukan 5, dan tidak pernah menunjukkan timeout
  login itu.** Itu fenomena LOKAL, dan menyebutnya sebagai penyebab flake di CI
  adalah kekeliruan kedua. Perbaikan sesi di bawah dipertahankan karena ia
  peningkatan yang nyata, bukan karena ia memperbaiki flake-nya — ia tidak.

  CI menyembunyikan flake yang sebenarnya di balik `retries: 1`, sehingga ia
  muncul sebagai satu baris "flaky" alih-alih sebuah masalah. **Suite yang hijau
  pada percobaan kedua mengajari orang untuk mengulang, bukan menyelidiki** — dan
  di sini itu berharga tiga diagnosis.

  **Pola di balik semuanya: spec memutasi keadaan tenant BERSAMA yang dibaca spec
  lain.** Peran yang dibuat satu spec mengubah dropdown spec lain; toggle modul
  mematikan `reporting`, yang justru menjadi otorisasi `/admin`. Itulah masalah
  harness yang sebenarnya. **DITUTUP oleh PUTARAN GELOMBANG di atas (24
  Agustus 2026).**

  `tests/e2e/auth.setup.ts` me-login owner SEKALI lalu menyimpan `storageState`;
  tiga belas login menjadi empat. Enam kali jalan berturut-turut ~18 detik,
  tanpa variansi.

  Tidak ada yang salah dengan biaya argon2 — biaya itu JUSTRU kontrolnya.
  Membayarnya sebelas kali untuk menguji hal yang bukan autentikasi itulah
  kekeliruannya.

  DITAHAN dari putaran ini: sapuan READ-ONLY. Ia bekerja, tetapi
  `admin-modules-toggle.e2e.ts` sengaja MEMATIKAN modul `reporting` dan `/admin`
  mengotorisasi pada `reporting.dashboard.read` — jadi sapuan baca yang tumpang
  tindih dengan toggle itu melihat dasbor menolak, dan itu BENAR. Sendirian ia
  lulus 4/4; di dalam suite ia gagal sekitar satu dari tiga kali, selalu pada
  `/admin`. **Sapuan baca TIDAK BOLEH berjalan bersamaan dengan spec yang
  memutasi keadaan se-tenant**, dan itu perubahan harness yang layak dilakukan
  dengan sengaja. Dua sapuan yang sudah ada di `main` KEBETULAN kebal, bukan
  benar: sapuan render hanya meng-assert `200` dan layar yang menolak tetap
  mengembalikan `200`; sapuan deny justru mengharapkan penolakan, yang juga
  dihasilkan modul yang dimatikan. **Keduanya SELESAI di PUTARAN GELOMBANG di
  atas — sapuan kini meng-assert isi, dan spec read-only mendarat tanpa
  perubahan.**

- **PUTARAN DENY — 23 Agustus 2026: tidak pernah ada yang menyaksikan layar
  admin MENOLAK pengguna tanpa permission, dan empat layar sama sekali tak bisa
  diperiksa.**

  Tes kontrak per-layar adalah grep sumber: ia membuktikan halaman MENYEBUT
  sebuah permission key, bukan bahwa kontrolnya disembunyikan dari yang tidak
  memilikinya. Uji asap render memuat setiap layar sebagai OWNER ter-seed, yang
  memegang segalanya. Jadi jalur deny — separuh otorisasi yang justru penting —
  tidak pernah dieksekusi.

  `loadAdminScreen` tidak pernah redirect, jadi layar yang ditolak MERENDER,
  secara konvensi lewat elemen ber-`id="<layar>-denied"`. Empat puluh tiga
  mengikutinya. **`site-profile`, `blog-settings`, `sidebar-menu`, dan
  `comments` merender pesan penolakan yang BENAR tanpa id padanya.** Tidak ada
  yang rusak bagi pengguna; yang rusak adalah KETERVERIFIKASIAN — tak ada
  pemeriksa yang bisa membedakan keempatnya dari layar yang menampilkan isinya
  kepada orang tanpa permission. **Penolakan yang tak bisa di-assert siapa pun
  adalah penolakan yang hilangnya tak akan disadari siapa pun.**

  `tests/e2e/admin-deny-path.e2e.ts` kini login sebagai pengguna yang perannya
  memegang NOL permission dan menuntut, untuk 46 layar ber-gerbang statis,
  status `200` (penolakan adalah halaman terender; 404 berarti layarnya
  MELEMPAR) serta hook penolakan milik layar itu. Id-nya dibaca DARI TIAP
  HALAMAN, bukan diturunkan dari URL — beberapa layar memakai nama yang bukan
  rutenya.

  **Build basi nyaris menghasilkan laporan PALSU.** Jalan pertama menyebut
  keempatnya bocor; servernya menyajikan bundel yang dibangun SEBELUM hook
  ditambahkan. Menjalankan ulang di atas build segar adalah satu-satunya alasan
  itu tidak dilaporkan sebagai cacat. Bangun ulang sebelum memercayai temuan
  e2e.

  **Masih belum tercakup, dengan sengaja:** pengguna ber-permission SEBAGIAN
  yang melihat subset kontrol yang benar. Hasil yang diharapkan berbeda per
  layar, jadi itu pengetahuan per-layar, bukan satu aturan mekanis — putarannya
  sendiri.

- **PUTARAN RENDER — 23 Agustus 2026: 41 dari 48 layar admin tidak pernah
  dimuat apa pun, dan gejala layar rusak adalah 404 — BUKAN 500.**

  `/admin/seo` tidak pernah merender, dan alasan tak ada yang menyadarinya
  sesederhana: **tidak ada yang memintanya**. Tujuh layar diuji spec CRUD e2e;
  41 sisanya tidak pernah dimuat di CI, oleh gerbang mana pun, dalam bentuk apa
  pun. `admin:screen-coverage:check` tampak berdekatan tapi menjawab pertanyaan
  lain — apakah sebuah layar MENGKLAIM permission.

  `tests/e2e/admin-screens-render.e2e.ts` menyusuri `src/pages/admin/**.astro`
  saat DIJALANKAN lalu memuat setiap layar sebagai owner ter-seed. Daftarnya
  DITEMUKAN, tidak pernah ditulis: daftar hardcoded adalah kegagalan yang terus
  ditemukan repo ini — gerbang yang memeriksa matriksnya sendiri alih-alih apa
  yang ADA. Menambah layar tanpa mencakupnya kini mustahil.

  **Koreksi yang muncul dari memverifikasinya:** memunculkan kembali cacat
  `/admin/seo` lalu menyaksikan server sungguhan menjawab menunjukkan ia
  mengembalikan **404**, bukan 500. `ReferenceError`-nya masuk log server;
  peramban diberi tahu halamannya tidak ada. ADR-0112 dan semua yang
  mengulanginya menyebut 500; semuanya dikoreksi, dan ADR itu membawa
  amandemen.

  Itu mengubah cara kelas ini diburu, dan karena itu dicatat di sini bukan
  hanya di ADR-nya: **bertanya "layar admin mana yang 5xx?" tidak menemukan apa
  pun lalu menyimpulkan armadanya sehat.** Layar yang melempar di setiap render
  tak bisa dibedakan, dari statusnya saja, dari rute yang memang tak pernah
  dibangun. Karena itu tesnya meng-assert `200` PERSIS, bukan "bukan 5xx" —
  asersi yang lebih lemah akan lolos begitu saja melewati cacat yang menjadi
  alasan keberadaannya.

- **PUTARAN FRONTMATTER — 23 Agustus 2026: `/admin/seo` selama ini menjawab 500
  di setiap permintaan dan tidak pernah sekali pun merender. Temuan standar C4
  DITUTUP (ADR-0112), dan itu baris terakhir yang terbuka di dokumen itu.**

  Halaman itu menghitung `showRedirectActions` sebagai pernyataan KETIGA
  frontmatter-nya, dari tiga `const` yang dideklarasikan 130 baris di bawahnya
  dalam scope yang sama — temporal dead zone, sehingga komponen terkompilasinya
  melempar `ReferenceError: Cannot access 'canUpdateRedirect' before
initialization` sebelum merender apa pun. Ia lolos review, `bun run check`,
  build dan CI, dan chunk produksinya mempertahankan urutan itu.

  **Layar operator yang selalu 404 adalah kegagalan yang paling sulit disadari
  repo ini**: tidak ada yang mem-poll `/admin/seo`, dan deskriptor modulnya
  mendaftarkannya di sidebar, jadi ia terbaca sebagai sudah terkirim.

  `astro check` memang TIDAK BISA jalan di sini — `@astrojs/check@0.9.10`
  menolak di TypeScript 7, diverifikasi dengan MEMASANG dan MENJALANKANNYA —
  jadi 61 berkas dan ~34.760 baris tidak diperiksa apa pun, dengan ADR-0068 §C
  mencatat mitigasinya sebagai "reviewer membaca diff `.astro` dengan mata".
  **Itulah mitigasi yang dilewati cacat ini.** Instruksi untuk membaca dengan
  teliti bukanlah kontrol; ia gagal diam-diam dan tidak meninggalkan bukti
  bahwa ia gagal.

  ADR-0112 MEMUTARI blokirnya alih-alih menunggunya:
  `check:astro-frontmatter:check` mengekstrak tiap frontmatter ke `.ts`
  bersebelahan lalu menjalankan `tsc` milik repo ini — teknik yang sudah
  dipakai `check:astro-scripts:check` untuk blok `<script>`. Empat shim membuat
  blok terekstrak kompilasi dan masing-masing melepaskan sesuatu; bersama-sama
  menurunkan keluaran mentah dari 920 diagnostik menjadi 6 yang nyata.

  Selisih `astro-files-not-type-checked` DIPERSEMPIT, bukan dihapus: kini ia
  mencakup `Props` komponen di call site-nya dan tidak lebih.

- **PUTARAN CUTOVER — 23 Agustus 2026: peta redirect #599 sudah lengkap, benar,
  dan TIDAK PERNAH bisa menyala. Presedensinya diperbaiki (ADR-0111) dan
  verifier yang seharusnya menangkapnya kini ada.**

  Butir lingkup 1–3 #599 sudah terbangun — `sql/138` menyimpan provenance,
  `blog:legacy:import` mengisinya dan mengonversi HTML CKEditor ke Portable Text
  dengan penolakan per baris, `blog:legacy:redirects:import` menurunkan satu
  aturan eksak per artikel terbit lengkap dengan pemeriksaan rantai dan prefix
  locale. Yang tersisa adalah butir 4, validasi crawl pra-cutover, dan
  membangunnya justru memunculkan alasan mengapa ketiga yang pertama tidak cukup.

  **`resolvePublicRedirect` mengonsultasikan rewrite keluarga `/news` yang
  dipensiunkan SEBELUM aturan tenant.** Rewrite itu mengklaim setiap jalur
  `/news/**`, dan URL arsipnya adalah `/news/{id_ber}_{slug}.html`, jadi tak
  satu pun dari 23.906 aturan yang ditulis importer pernah terbaca — dan
  jawaban yang tak sempat mereka berikan digantikan 301 ke
  `/blog/{tenantCode}/{id_ber}_{slug}.html`, yang tidak dimiliki post mana pun.
  Setiap URL legacy akan mengarah ke 404: persis keadaan yang dilarang
  Definition of Done issue itu, dihasilkan kode yang ditulis untuk memenuhinya,
  dengan tabel redirect yang terbaca benar.

  Tidak ada yang menangkapnya karena presedensinya hanya ada sebagai urutan dua
  `await` di dalam blok `try` — tak terjangkau tanpa basis data, jadi tak
  seorang pun menulis tes murahnya — dan kedua strategi milik concern berbeda,
  sehingga tes masing-masing modul tak punya alasan melihat yang lain. Keduanya
  tetap hijau sementara masing-masing benar tentang separuhnya sendiri.
  **Pelajarannya melampaui redirect: aturan yang hanya hidup sebagai urutan
  pernyataan adalah aturan tanpa tes, dan modul di kedua sisinya akan
  sama-sama terus lulus.**

  ADR-0111 menetapkannya sebagai YANG PALING SPESIFIK MENANG, dan memindahkan
  keputusannya ke `domain/redirect-precedence.ts` sebagai fungsi murni supaya
  bisa diuji sama sekali. `tests/redirect-precedence.test.ts` meng-assert
  terhadap SUMBER service bahwa fungsi itu dipanggil dan bahwa tidak ada
  `return retired` dini yang merayap kembali ke atasnya; ketiganya merah ketika
  urutan lama dikembalikan.

  `blog:legacy:cutover:verify` (butir 4) berangkat dari sitemap milik situs
  legacy sendiri alih-alih dari apa yang terimpor, dan itulah satu-satunya cara
  melihat URL yang tidak menghasilkan aturan sama sekali. Ia tidak menulis apa
  pun, menjalankan jalur resolusi yang SEBENARNYA alih-alih mengimplementasikan
  ulang, dan **MENOLAK sitemap INDEX** alih-alih meratakannya — memeriksa anak
  sebuah index sebagai halaman akan melaporkan sukses tanpa membaca satu pun URL
  halaman.

  **Yang tersisa pada #599 bukan kode.** Ketiga job dan verifier-nya sudah
  terbangun dan digerbangi; menjalankannya butuh `.htaccess` legacy dan ekspor
  sitemap, yang tidak ada di repo mana pun. Langkah berikutnya bersifat
  operasional: dapatkan keduanya, jalankan `blog:legacy:import --images=` untuk
  memperoleh himpunan unggahan, lalu `--media-map=`, lalu impor redirect, lalu
  verifier — dan verifier itu WAJIB bersih SEBELUM cutover, bukan sesudahnya.

- **PUTARAN BEACON — 23 Agustus 2026: #597 butir 9 sudah DIBANGUN, dan keputusan
  yang menghalanginya ternyata lebih kecil daripada "analitik: ya atau tidak".**

  Penghalang butir itu adalah ADR privasi di `ahliweb/awcms-astro` — keputusan
  pemilik repo, bukan sebuah tugas. Keputusannya dibuat, dan fakta yang
  membukanya dibaca dari collector repo INI alih-alih ditebak: **`fetch`
  lintas-origin tanpa `credentials` tidak mengirim maupun menyimpan cookie.**
  Jadi konsumennya sudah memegang sakelarnya, tanpa perubahan apa pun di sini.

  ADR-0044 di sana mengambil **Opsi B**: sebuah situs boleh memanggil beacon,
  hanya bila ia menyatakannya, dan selalu tanpa kredensial. Cookie
  `awcms_visitor_key` yang dipasang endpoint ini karena itu dibuang peramban, dan
  **setiap kunjungan halaman tiba sebagai kunjungan pertama** — hitungan
  kunjungan nyata bagi konsumen itu, hitungan pengunjung unik tidak. Tidak ada
  apa pun di sini yang boleh diubah dengan premis bahwa pengunjung berulang bisa
  dikenali, dan pekerjaan `SameSite=None` di #637 tidak terbuang: ia melayani
  konsumen yang mengambil pilihan sebaliknya.

  **Di sisi ini perubahannya sekali lagi satu pemindahan kontrak**, dan ia
  menjadikan kelas peramban-pembaca selebar tiga jalur.

  **Konsekuensi yang pantas dibawa maju: ketiganya TIDAK berbagi satu aturan.**
  Kedua jalur `site-search` tidak boleh membawa header tambahan, karena tidak ada
  yang menjawab preflight untuk keduanya — dan itu disengaja. Beacon HARUS
  membawa `content-type: application/json`, karena `security.checkOrigin` menolak
  POST lintas-origin yang tipe isinya mirip form, dan handler `OPTIONS` yang
  ditambahkan #637 ada justru untuk preflight yang menyusul.
  `navigator.sendBeacon` tidak bisa dipakai di sana sama sekali: ia mengirim
  `text/plain`, salah satu tipe yang ditolak.

  Menyeragamkan ketiganya — ke arah mana pun, dan itu adalah kerapian yang cepat
  atau lambat akan diusulkan seseorang — mematikan salah satunya di peramban
  pembaca dan tidak di log mana pun di sini. Karena itu ia ditulis di docblock
  `CONSUMED_PATHS` dan di komentar gerbangnya sendiri.

  **Dengan ini #597 selesai di kesembilan butirnya dan #607 di ketiganya.** Yang
  masih terbuka di keluarga ini adalah #599, dan ia terhalang dua artefak yang
  tidak ada di kedua repo — `.htaccess` legacy dan URL sitemap yang hidup —
  alih-alih terhalang kode.

- **PUTARAN KONSUMEN — 23 Agustus 2026: dua butir menghadap-pembaca yang tersisa
  sudah DIBANGUN, di `ahliweb/awcms-astro`. Tidak ada pekerjaan `awcms` yang
  tersisa pada #597 maupun #607, dan satu-satunya perubahan `awcms` di putaran
  ini adalah pemindahan kontrak.**

  Dengan ADR-0107/0109/0110 ditulis di hari yang sama, kedua butir sisanya
  menjadi pekerjaan biasa di repo sebelah. Yang mendarat di sana:

  - **Kotak pencarian pembaca** (#607, #597 butir 3) — `/cari/` dan `/en/cari/`,
    dengan hasil berperingkat, snippet tersorot, chip facet untuk jenis konten /
    kanal / topik / instansi / wilayah, "muat lebih banyak" ber-cursor, dan
    autocomplete. ADR-0043 di sana.
  - **Byline** (#597 butir 4) — dirender di halaman artikel, di `author` JSON-LD
    (sebuah `Person` bila ada), dan di entry Atom artikel itu. ADR-0042 di sana.

  **Di sisi ini satu-satunya perubahan adalah `scripts/api-consumer-contract.ts`:**
  `/api/v1/site-search/query` dan `/suggest` berpindah dari COMMITTED ke
  CONSUMED, yaitu arah yang dituntut Definition of Done lintas-repo — bekukan di
  sini dulu, panggil di sana kemudian. Byline tidak butuh pemindahan sama sekali:
  `authorByline` menumpang `/api/v1/blog/posts`, yang sudah dikonsumsi.

  **Tiga hal yang pantas dibawa maju, karena masing-masing sebuah KELAS dan bukan
  satu insiden.**

  **1. "CONSUMED" tidak lagi berarti "sebuah build memanggilnya".** Tujuh dari
  sembilan jalur dipanggil `astro build` dari mesin yang memegang kredensial
  baca-saja; dua jalur pencarian dipanggil PERAMBAN PEMBACA. Perbedaan itu tidak
  terlihat dari sini — keduanya `GET`, dan gerbang di sana mengekstrak string
  literal dari `src/` tanpa tahu siapa yang mengeksekusinya — dan ia menentukan
  berapa mahal biaya merusaknya. Perubahan bentuk pada jalur yang dipanggil build
  memerahkan build yang sedang dilihat seseorang. Perubahan bentuk pada dua yang
  ini gagal **diam-diam di peramban seorang asing**, pada situs yang terbit
  berminggu-minggu lalu dan tidak akan di-rebuild karenanya. Ditulis di docblock
  berkas itu sendiri alih-alih dibiarkan ditemukan.

  **2. Ketiadaan handler `OPTIONS` kini sebuah KONTRAK, bukan kelalaian.** Kotak
  itu memanggil kedua jalur tanpa header tambahan, yang menjaga keduanya tetap
  permintaan sederhana. Sebuah header yang ditambahkan di SALAH SATU sisi —
  `accept`, id korelasi, petunjuk tenant — mengubahnya menjadi permintaan
  ber-preflight dengan tidak ada yang menjawab preflight-nya. Kegagalan itu
  terjadi di peramban pembaca dan tidak muncul di log mana pun di sini. Hal yang
  sama berlaku bagi `Access-Control-Allow-Credentials`, yang ketiadaannya membuat
  `credentials: "include"` tidak terbaca menurut konstruksi.

  **3. Gerbang di sana tidak bisa melihat cacat yang penting, dan
  MENJALANKANNYA menemukannya dalam satu menit.** Facet jenis konten
  mengembalikan `resource_type` apa adanya — `blog_post`, `blog_page` — karena ia
  pengenal registry modul repo ini dan tidak membawa label tulisan redaksi,
  berbeda dari facet term. Jalannya yang pertama di peramban merender keduanya
  sebagai chip, dalam kedua bahasa: kunci mesin di layar. Tidak ada yang bisa
  merah — nilainya ada, tipenya benar, halamannya terbit. Ini kelas
  `jalankan-jangan-dibaca` lagi, dan perbaikannya di sana adalah nilai facet
  tanpa label yang bisa dibaca tidak merender chip sama sekali.

  **Yang tersisa terbuka di #597, dan itu bukan pekerjaan:** butir 9, beacon
  analytics, yang backend-nya sudah diverifikasi di #637/#638 dan yang terhalang
  ADR privasi di `awcms-astro` — keputusan pemilik repo. #599 juga terhalang dua
  artefak yang tidak ada di kedua repo (`.htaccess` legacy dan URL sitemap yang
  hidup), bukan terhalang kode.

- **PUTARAN KEPUTUSAN — 23 Agustus 2026: tiga butir #597 yang terhalang KEPUTUSAN
  TERTULIS, bukan pekerjaan.** **SELESAI — ADR-0107, ADR-0109, ADR-0110.**
  Setelah butir 1/2/5/6/7 issue itu mendarat, tabel statusnya sendiri membelah
  sisanya menjadi "butuh permukaan `awcms` baru" dan "butuh keputusan lebih
  dulu". Kelompok kedua kini kosong, dan di setiap kasus bagian yang menarik
  bukanlah fiturnya.

  - **Butir 3, kotak pencarian pembaca ([ADR-0107](adr/0107-a-readers-browser-may-search-and-the-origin-names-the-tenant.id.md)).**
    Separuh CORS-nya masalah yang lebih kecil. `withSiteSearchTenant` meresolusi
    tenant dari HOST, jadi pembaca di situs yang dibangun statis yang memanggil
    CMS ini jatuh melalui rantai terdokumentasi (`PUBLIC_DEFAULT_TENANT_ID` ->
    `PUBLIC_DEFAULT_TENANT_CODE` -> `awcms_setup_state`) dan mendarat di tenant
    BAWAAN deployment — situs satu tenant menampilkan artikel tenant lain sebagai
    hasilnya sendiri, dengan 200 dan tanpa apa pun yang melaporkan masalah.
    Permintaan lintas-origin kini meresolusi tenant-nya dari `Origin` dan tidak
    dari apa pun yang lain, yang menutupnya secara KONSTRUKSI: perbaikan
    hanya-header akan meninggalkan konten itu di badan respons bagi `curl`,
    perayap, atau proxy.
  - **Butir 4, byline ([ADR-0109](adr/0109-a-byline-is-opted-into-and-it-is-not-your-account-name.id.md)).**
    Menerbitkan `awcms_profiles.display_name` cukup satu baris tanpa migrasi, dan
    ditolak: ia menjadikan setiap nama akun internal publik begitu sebuah artikel
    terbit. `sql/146` menambahkan `public_byline_name` opt-in di mana NULL —
    setiap baris yang sudah ada — mempertahankan atribusi organisasi, jadi tidak
    ada artikel yang berubah.
  - **Butir 8, embed video ([ADR-0110](adr/0110-a-video-embed-origin-is-an-operators-decision.id.md)).**
    Renderer-nya sudah benar sejak #639 dan setiap iframe yang dipancarkannya
    DIBLOKIR, karena CSP tidak memasukkan origin pihak ketiga mana pun.
    `BLOG_VIDEO_EMBED_ENABLED` menambahkan tepat satu origin ke `frame-src`.
    Menurunkannya dari data tenant ditolak: header CSP berlaku se-deployment,
    jadi satu tenant akan membuka origin itu untuk setiap tenant yang berbagi
    deployment.

  **Sisa #597 dan #607 adalah pekerjaan `ahliweb/awcms-astro`**, ditambah butir 9
  yang terhalang ADR privasi di repo itu — keputusan pemilik repo, bukan tugas.
  TIDAK ADA pekerjaan sisi-`awcms` yang tersisa di kedua issue itu.

- **DITEMUKAN SAAT BEKERJA, 23 Agustus 2026 (sambil merancang byline #597 butir
  4): PENGHAPUSAN yang dieksekusi meninggalkan nama, nama legal, dan alamat login
  orangnya di database.** **SELESAI (23 Agustus 2026) —
  [ADR-0108](adr/0108-what-an-export-withholds-and-what-an-erasure-destroys-are-different-questions.id.md).**

  `SubjectDataDescriptor` punya SATU daftar kolom — `redactedColumns`, yang
  didokumentasikan sebagai apa yang tak boleh dibawa ekspor portabilitas — dan
  eksekutor penghapusan memakai daftar yang SAMA sebagai himpunan kolom yang
  ditimpa. Untuk sembilan tabel yang kedua jawabannya berimpit (`password_hash`,
  `token_hash`) itu bekerja sempurna, dan itulah sebabnya tak ada yang tampak
  salah.

  Untuk tabel yang memuat identitas orangnya sendiri, kedua jawaban itu
  BERLAWANAN. `awcms_profiles.display_name`/`legal_name` harus DIEKSPOR —
  permintaan akses subjek justru sebagian besar tentang itu — DAN DIHANCURKAN,
  jadi mendeklarasikannya berarti menahan nama subjek dari ekspornya sendiri.
  Pemiliknya dengan tepat tidak mendeklarasikan apa pun, dan penghapusannya
  dengan tepat tidak menulis apa pun. Sama untuk
  `awcms_identities.login_identifier`, `awcms_registration_requests` (yang tak
  menamai satu kolom pun), `awcms_invitations`, `awcms_comments_comments` dan
  `awcms_visitor_sessions.login_identifier_snapshot` — yang rasionalnya harfiah
  berbunyi "penghapusan harus menjangkau dan membersihkannya".

  **Di setiap kasus, prosa deskriptornya menggambarkan perilaku yang benar dan
  mekanismenya tidak bisa menyatakannya.** Diverifikasi terhadap Postgres nyata,
  bukan dibaca: setelah penghapusan selesai, `SELECT login_identifier` masih
  mengembalikan `subject@example.test`.

  Tiga konsekuensi membuatnya lebih buruk dari sekadar daftar kolom tertinggal.
  **~90 deskriptor menjawab `severed_with_subject_row`** dengan premis bahwa
  menganonimkan `awcms_identities` membuat stempel mereka tidak menunjuk siapa
  pun — stempel yang menunjuk baris yang masih membawa alamat login menunjuk
  seseorang. Kolom yang tak muat sentinel dilewati diam-diam ke daftar
  `skippedColumns` yang tak diasersikan apa pun (`ip_address`, `geo`). Dan
  penghapusan bisa GAGAL TOTAL: subjek dengan dua baris di bawah index unique
  menulis ulang keduanya menjadi `[erased]` yang sama dan menabrak 23505 di
  tengah transaksi, dengan permintaannya telanjur diklaim.

  Perbaikannya adalah dua deklarasi untuk dua pertanyaan, dan GERBANGNYA alih-alih
  dua belas suntingannya: `subject-data:registry:check` kini menolak `anonymize`
  yang tak menamai apa pun, nama kolom yang tak dimiliki tabelnya, dan
  `severed_with_subject_row` yang jangkarnya tak menganonimkan apa pun. Keunikan
  diturunkan dari `pg_index`, tak pernah dideklarasikan. Penghapusan yang sudah
  SELESAI TIDAK diperbaiki surut — menjalankannya ulang adalah keputusan operator
  dengan jejak auditnya sendiri.

- **DITEMUKAN SAAT BEKERJA, 22 Agustus 2026 (sambil menutup D7): `POST
/api/v1/tenant/domains/{id}/verify` TIDAK MEMVERIFIKASI APA PUN.** **SELESAI (22 Agustus 2026) — [ADR-0106](adr/0106-domain-verification-proves-control-of-the-zone.id.md).** Ia
  membaca baris, memeriksa `verification_method IS NOT NULL`, lalu menyetel
  `status = 'active'`. Tanpa lookup DNS, tanpa pengambilan berkas HTTP, tanpa perbandingan
  token di mana pun pada jalur rute itu. Domain `active` memberi makan
  `resolvePublicTenantByHost`, daftar-izin redirect dan host kanonik, jadi admin tenant
  yang memegang `domains.create` + `.update` + `.verify` bisa menambahkan hostname,
  mem-PATCH `verificationMethod: "manual"`, memanggil verify, dan membuat deployment ini
  menjawab untuk hostname itu sebagai tenant tersebut.

  **Membuat perbandingannya nyata baru setengah perbaikan.** API juga menerima NAMA dan
  NILAI record dari pemanggil, dan pemeriksaan terhadap nama pilihan pemanggil dan nilai
  pilihan pemanggil tidak membuktikan apa pun — keduanya bisa menunjuk record yang sudah
  ada di zona yang tak dikuasai siapa pun. Kedua bagiannya kini dicetak server
  (`_awcms-verify.<host>`, 32 bita acak per baris) dan mengirim salah satunya DITOLAK
  dengan 400 yang menyebut nama field-nya, bukan diabaikan.

  **`manual` dihapus, bukan diturunkan menjadi atestasi operator**, ke mana tebakan butir
  ini sendiri mengarah. Permission ber-scope platform hanya boleh dijalankan tenant
  platform (ADR-0053) dan RLS berarti ia tak bisa melihat baris tenant lain, jadi
  mempertahankan jalur itu berarti membangun permukaan lintas-tenant — jenis paling
  berbahaya yang dimiliki basis kode ini, dan reset MFA admin sengaja sendirian di sana.
  `file` keluar karena berarti mengambil URL pilihan pemanggil; `dns_cname` karena butuh
  target platform yang tidak ada. CHECK `sql/046` tidak disentuh.

  Lookup-nya berjalan DI LUAR setiap transaksi (ADR-0006) di antara dua transaksi tenant;
  yang kedua mengotorisasi ulang (ADR-0063) dan membawa nilai terbukti ke klausa
  `WHERE`-nya. **Tidak ada bukan berarti tidak terjangkau** — NXDOMAIN fakta tentang
  domain yang diklaim, SERVFAIL tentang resolver kita, dan hanya yang kedua memberi makan
  breaker atau membiarkan statusnya utuh. Kegagalan mencatat `failed`, yang menjaga
  keadaan itu tetap terjangkau. Baris pra-ADR dicetak tantangan secara malas pada verify
  pertama alih-alih lewat migrasi ber-DML pada tabel FORCE RLS. Dibatasi laju per
  PRINSIPAL, bukan per tenant — percobaan pertama mengunci pada header tenant dan
  `tests/auth-source-rate-limit.test.ts` menolaknya, dengan benar (Issue #447).

- **DITEMUKAN SAAT BEKERJA, 22 Agustus 2026: `docs:i18n:stamp` bisa MEMBUNGKAM
  `check:docs:translation` pada mirror yang kini SALAH.** **SELESAI (22 Agustus 2026).**
  Skrip stamp me-rehash setiap sumber Inggris ke penanda `i18n-source-hash` mirror-nya,
  dan ia melakukannya tanpa syarat — sehingga "sunting bahasa Inggrisnya, jalankan stamp"
  membuat gerbang terjemahan hijau sementara mirror Indonesia masih mengatakan hal yang
  lama. Kena sungguhan: `project-state:inventory:generate` menggeser hitungan migrasi §2
  dari 141 ke 142 dan stamp lalu menyatakan mirror-nya mutakhir sementara ia masih membaca
  **141**. Ia tertangkap `tests/doc-inventory-counts.test.ts`, yang kebetulan memeriksa
  rentang `sql/NNN` lintas dokumen — jaring pengaman yang ada untuk alasan lain dan
  mencakup satu field.

  Menulis ulang penanda itu adalah KLAIM tentang terjemahannya, jadi kini klaim itu hanya
  dibuat bila ada yang menyatakan terjemahannya memang dilihat: mirror-nya termodifikasi
  (atau untracked) di working tree ini, atau sumbernya hanya berubah SPASI sejak `HEAD` —
  kasus reflow yang menjadi alasan tool ini dibuat, di mana tak ada penerjemah yang perlu
  melakukan apa pun. Selain itu ia menolak, menyebut berkasnya, dan keluar 1;
  `--force-restamp` adalah override yang disengaja untuk penulisan ulang yang tetap
  dilewati terjemahannya. Versi `HEAD` yang tidak ada tidak diam-diam mengizinkannya.
  Diverifikasi terhadap ketiga kasus.

- **PUTARAN REKOMENDASI — 17 Agustus 2026, audit seluruh repo atas sepuluh dimensi.**
  **38 rekomendasi dari 48 temuan terverifikasi.** Metode: sepuluh pencari independen
  (celah fungsional, ongkos algoritma, bentuk query DB, performa jalur request,
  otorisasi, penanganan input, auth/sesi/kripto, keandalan job, disiplin fungsi
  reusable, operabilitas), masing-masing diikuti verifikator adversarial yang
  diperintahkan MEMBANTAH dan membuka ulang tiap berkas yang dikutip. 51 temuan masuk;
  **3 dibantah, 1 sudah terlacak, 24 lolos CONFIRMED dan 25 lolos PARTIAL** (nyata tapi
  dipersempit — dicatat di sini dalam bentuk sempitnya).

  **Baca batasan ini lebih dulu: TIDAK ada database hidup yang dipakai.** Tidak ada
  `EXPLAIN`, tidak ada job dijalankan, tidak ada request lintas-tenant. Tiap klaim indeks
  di bawah diturunkan dari DDL plus aturan prefix btree, bukan dari rencana yang diukur.
  Item diurutkan menurut (severity × keterjangkauan) / usaha di dalam tiap kelompok.

  ### Kerjakan dulu — imbalan terbaik per usaha lintas keempat kelompok
  1. **A1** — satu baris pada masing-masing dari dua predikat; mengubah grant
     lintas-organisasi yang hidup permanen menjadi fail-closed.
  2. **A2** — satu baca + satu penolakan di satu tempat yang dipakai bersama dua belas
     handler; menutup loop pencetakan sesi ke tenant yang ditangguhkan.
  3. **A3** — sebuah regex; menghapus primitif baca-sembarang-env **sebelum** SSO
     dinyalakan.
  4. **D1** — dua baris di `ops/run-job.sh`; menghentikan arsip dan ekspor ditulis ke
     dalam container yang dihapus beberapa detik kemudian sementara DB mencatatnya ada.
  5. **C1** — satu migrasi; menghapus scan se-tenant + sort dari `/admin/blog`,
     `/admin/pages`, dan `GET /api/v1/blog/posts`.

  Sesudahnya: **A4** (`readJsonBody` pada `dry-run.ts` saja — satu-satunya rute
  pra-autentikasi) dan **D2** (pemotong komentar bersama, karena itulah yang membuat
  cacat kelas berikutnya bisa lolos hijau).

  ### A. Keamanan
  1. **A1 — grant delegated-access yang sudah ditebus TIDAK PERNAH kedaluwarsa.**
     **SELESAI (22 Agustus 2026)** — gerbangnya, grant peran bertanggal, dan sapuannya.
     _(ditemukan independen oleh dua dimensi, dari sisi job dan dari sisi chokepoint)_
     `identity-access/application/auth-context.ts:63-70` dan `:101-108`;
     `delegated-access-store.ts:283`; `access-policy-writer.ts:65`; `grant-source.ts:113`;
     `sql/117:105,165`. `expireDelegatedAccessGrants` punya **NOL pemanggil** — tanpa
     deskriptor job, tanpa skrip, tanpa target `package.json` — kedua resolver waktu-request
     hanya menyaring `revoked_at IS NULL`, dan grant peran yang ditulis saat penebusan
     menghilangkan `effective_to`, yang dibaca `activeRoleGrants` sebagai berlaku selamanya.
     Keterlibatan mitra ber-scope "sampai 30 September" memberi perannya tanpa batas, dan
     `CHECK` 31 hari di `sql/117` menjadi inert. ADR-0090 menjanjikan "pencabutan **dan
     kedaluwarsa** menonaktifkan keanggotaan dalam transaksi yang sama"; paruh kedaluwarsa
     tidak punya eksekutor. `sql/117:165` bahkan mengirim indeks `(tenant_id, expires_at)`
     yang dibangun untuk sapuan itu. **Ubah:** tambahkan `AND g.expires_at > now()` pada
     kedua predikat (kedaluwarsa lalu jatuh ke cabang null-is-refuse
     `isDelegatedPartnerRefused` yang sudah ada — tanpa jalur kode baru); teruskan
     `expiresAt` grant sebagai `effective_to`; lalu tambahkan job-nya supaya sesi
     benar-benar dicabut.

     **Yang mendarat, dan dua tempat rencananya TIDAK diikuti.** Predikatnya kini ada di
     `resolveDelegatedGrantState` (resolver yang diganti nama, menjawab kedaluwarsa dan
     status partner dari SATU baris), dan penebusan menstempel `effective_to` **berpasangan
     dengan `effective_from` eksplisit** — `sql/102` membandingkan kedua kolom itu dan
     `effective_from` ber-DEFAULT `now()`, jadi mengirim hanya tanggal akhir berarti
     membandingkan jam proses ini dengan jam PostgreSQL dan bisa menolak penebusan yang
     sah. Kedaluwarsa TIDAK jatuh ke cabang `partner_suspended` seperti rencana: itu akan
     menulis baris decision-log yang menyatakan penangguhan yang tidak pernah terjadi, jadi
     ia mendapat cabangnya sendiri di atasnya (`403 DELEGATED_GRANT_EXPIRED`,
     `matchedPolicy: "delegated_grant_expired"`). Resolver ATRIBUSI
     (`resolveDelegatedGrantId`) sengaja dibiarkan tanpa saringan — pembacanya hanya
     `awcms_abac_decision_logs` dan `awcms_audit_events` (terverifikasi), jadi id basi tak
     bisa melebarkan keputusan apa pun dan justru itulah yang membuat penolakannya menyebut
     keterlibatan mana.

     **Sapuannya ikut mendarat, dan pertanyaan hak akses yang menahannya sudah terjawab.**
     `bun run identity-access:delegated-access:expiry` (per jam, berbatas, `maintenance`)
     mencabut grant dengan alasan `expired` dan TANPA aktor, menonaktifkan tenant user
     terdelegasinya, lalu mencabut sesinya. Opsi (a) yang diambil: `sql/142` adalah fungsi
     `SECURITY DEFINER` sempit mengikuti preseden `sql/048`/`sql/119`/`sql/124` — pemilik
     NOLOGIN tanpa anggota, policy khusus role itu saja, dan batas yang berupa
     STATEMENT-nya alih-alih daftar kolom (ia menerima id tenant dan ukuran batch dan tidak
     lebih, jadi tidak ada nilai dari pemanggil yang pernah ditulis). `awcms_worker`
     memegang `EXECUTE` dan tetap TIDAK memegang `UPDATE` pada
     `awcms_tenant_users`/`awcms_sessions`; `awcms_app` sengaja tidak memegang `EXECUTE`
     sama sekali, karena jalur request punya pencabutannya sendiri dan hak untuk pemanggil
     yang tidak ada adalah hak untuk apa-apa. Diverifikasi terhadap basis data nyata,
     termasuk kedua penolakannya.

     **Satu hal yang layak dibawa ke depan.** Bukti-mutasi pertama yang ditulis untuk tes
     sapuan ini SALAH: membuang `AND principal_kind = 'delegated'` dari UPDATE keanggotaan
     tidak mengubah hasil tes mana pun, karena predikat `id` sudah melindungi anggota
     biasa — keduanya penjaga independen atas baris yang sama, dan hanya kehilangan
     KEDUANYA yang membuka siapa pun. Klaimnya dikoreksi di header tesnya sendiri alih-alih
     dibuang diam-diam, karena bukti-mutasi yang salah terbaca sebagai cakupan.

  2. **A2 — penangguhan ADR-0073 tidak menjangkau factory rute self-service maupun
     client-credential.** **SELESAI (22 Agustus 2026).** Kedua factory kini menolak
     sebelum handler-nya jalan, dan klausa ketiga rencananya ikut mendarat:
     `api:tenant-route:check` menggagalkan berkas mana pun di
     `src/pages/api`/`src/pages/admin` yang memanggil `isTenantServiceStopped` sendiri.
     Diverifikasi terhadap basis data nyata: `PATCH /api/v1/auth/profile` menjawab **200**
     untuk tenant yang ditangguhkan sebelum perbaikan, dan `403 TENANT_SUSPENDED` sesudah.

     Satu penyimpangan dari "resolve statusnya sekali di dalam kedua factory": MENGHILANGKAN
     deklarasinya berarti MENOLAK, dan rute yang harus tetap terjangkau menyatakan
     `allowedWhileTenantSuspended: "<alasan>"`. Empat rute melakukannya, dengan satu aturan
     — tenant yang ditangguhkan masih boleh MELIHAT keadaan keamanannya sendiri dan masih
     boleh melakukan hal yang hanya MENGHAPUS aksesnya sendiri (melihat daftar sesi,
     mengakhiri satu, mengakhiri semua, mencabut pendaftaran perangkat push). Penangguhan
     yang menghalangi pelanggan mengakhiri sesi curian justru melindungi penyerangnya.
     `_shared/tenant-route.ts:247-301` dan `:342-379`;
     `auth/profile.ts:125`; `session-handoff/{issue,redeem}.ts`; `auth/password/change.ts:118`.
     Pemeriksaannya hanya ada di `authorizeInTransaction` dan `ssr-session.ts`, dan tidak
     satu pun factory memanggilnya, jadi sesi hidup milik tenant yang ditangguhkan masih
     bisa menulis profil, menulis ulang kredensialnya, dan mencetak sesi **baru** tanpa
     batas — pijakan itu hidup lebih lama daripada TTL yang seharusnya dikuras penangguhan.
     `push/subscriptions/index.ts:154` memeriksa dengan tangan; saudara `DELETE`-nya tidak,
     dan asimetri itulah yang membuktikan kelalaian ini tidak disengaja.

  3. **A3 — admin SSO tenant bisa menyebut env var APA PUN sebagai client secret OIDC dan
     mengirimkannya ke host pilihannya.** **SELESAI (22 Agustus 2026).** `tenant-sso.ts:180-184`;
     `tenant-sso-policy.ts:229-239,333-348`. `client_secret_env_var` hanya divalidasi
     sebagai string tak-kosong, lalu dibaca `env[...]` dan dikirim ke endpoint discovery
     yang diturunkan dari `issuer_url` pilihan admin, sebelum validasi ID-token apa pun.
     `DATABASE_URL` dan `AUTH_MFA_SECRET_ENCRYPTION_KEY` terjangkau. Belum hidup
     (`AUTH_SSO_ENABLED` mati), tetapi ini primitif tenant-admin → kompromi-deployment pada
     hari SSO dinyalakan.

     **Mendarat dengan satu perbedaan yang disengaja: prefiksnya `AUTH_SSO_CLIENT_SECRET_`,
     bukan `AWCMS_SSO_CLIENT_SECRET_`.** Setiap variabel SSO di repo ini ber-`AUTH_SSO_*`
     (`.env.example`, `18_configuration_env_reference.md`), dan namespace yang tidak bisa
     ditebak dari nama-nama tetangganya adalah namespace yang sekali dipasang keliru lalu
     diakali. Perhatikan apa yang TIDAK cocok dengan prefiks itu:
     `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY` — kunci yang mendekripsi client secret tersimpan
     milik SETIAP provider lain — hanya berjarak satu kata dan tetap tertolak.

     NAMESPACE, bukan deny-list, dan alasannya berlaku umum: deny-list nama variabel
     berbahaya harus dijaga tetap seiring dengan setiap secret yang dipegang deployment ini
     atau deployment mana pun kelak, dan ia gagal-terbuka untuk yang ditambahkan minggu
     lalu.

     Diperiksa di tiga tempat; yang ketiga yang menanggung beban. Kedua validator admin
     menolak saat tulis (create DAN update — pemeriksaan hanya-create adalah kontrol yang
     diakali admin dengan mem-patch setelahnya), dan `resolveProviderClientSecret`
     menegaskannya ulang persis sebelum menyentuh `env`. Validator hanya melihat nilai yang
     datang sekarang; pembacanya membaca baris yang ditulis di masa lalu oleh penulis yang
     mendahului aturan ini.

  4. **A4 — buffering body tak terbatas pra-autentikasi; 23 rute melewati `readJsonBody`.**
     `data-lifecycle/dry-run.ts:32-44`; `security/request-body-limit.ts:127-132`.
     `resolveAuthInputs` hanya memeriksa _keberadaan_ header tenant dan token, lalu
     `await request.json()` berjalan. `checkContentLengthCeiling` mengembalikan true saat
     header tidak ada, jadi body chunked tanpa `Content-Length` di-buffer tanpa batas
     sebelum kerja DB atau sesi apa pun. Hanya ketersediaan — tetapi tanpa autentikasi.
  5. **A5 — reset kata sandi mengganti kredensial di SETIAP tenant tetapi mencabut sesi
     hanya di satu.** `password-reset.ts:259,267`; `session-revocation.ts:26-31`.
     `setPrincipalCredentialForIdentity` global by design (ADR-0086);
     `revokeAllSessionsForIdentity` membawa `WHERE tenant_id = …`. Pengguna yang cookie
     tenant-B-nya dicuri lalu memulihkan dari tenant A mengubah kata sandi di mana-mana dan
     tidak mencabut apa pun di B. "Keluarkan saya dari semua perangkat" punya batas yang
     sama, dan dua komentar dokumen menegaskan jaminan yang tidak lagi diberikan kodenya. **Perubahan:** tambahkan
     `credential_epoch` pada `awcms_principals`, naikkan di statement yang mengganti hash,
     stempelkan pada sesi, tolak sesi ber-epoch basi. Sebelum itu, perbaiki komentar palsunya.

     SELESAI (22 Agustus 2026), `sql/145`. Rekomendasi diterapkan apa adanya, ditambah dua
     hal yang tidak disebutkannya.

     Pertama, MENGAPA epoch dan bukan pencabutan yang diperlebar — ditulis ke dalam migration
     supaya tidak diperdebatkan ulang: pencabutan TIDAK BISA diperlebar dari dalam request
     (satu GUC tenant per transaksi — UPDATE-nya akan diam-diam mengenai nol baris di tempat
     lain, bug yang sama dengan kode lebih banyak), dan keluar dari RLS berarti fungsi
     SECURITY DEFINER yang boleh mencabut sesi APA PUN di tenant MANA PUN, terjangkau dari
     jalur request. Epoch membalikkannya: perubahan kredensial menulis SATU baris yang sudah
     miliknya sendiri, dan tak ada penulis yang pernah melewati batas tenant. Suite integrasi
     menegaskan persis itu — setelah reset di A, baris tenant B tetap `revoked_at IS NULL`
     dan tetap ditolak; itulah yang membedakan perbaikan ini dari perbaikan yang diam-diam
     memperoleh hak tulis lintas-tenant.

     Kedua, kenaikannya ada DI DALAM `setPrincipalCredential`, bukan di dua titik panggil,
     dan ada gerbang baru. Delapan berkas memutuskan apakah sebuah sesi hidup, dan baris sesi
     tidak memberi petunjuk apa pun bahwa ada kredensial global untuk ditinggali — jadi
     penulis berikutnya menulis tiga predikat yang bisa dilihatnya dan yang keempat tak
     terlihat. Itu persis bentuk ADR-0079. `sessionCredentialCurrent` adalah satu-satunya
     definisi dan `identity:session-readers:check` (gerbang 57) menggagalkan build untuk
     pembaca sesi-hidup terdaftar yang tak memuatnya, untuk `INSERT` yang tak menstempel
     epoch, dan untuk berkas baru yang menyebut `awcms_sessions` tapi tidak ada di kedua
     daftar. Dibuktikan lewat mutasi di ketiga arah sebelum dipercaya.

     `promotePrincipalCredential` sengaja TIDAK menaikkan: ia menulis hash yang sudah dimiliki
     identity itu, jadi tidak ada yang berubah pada kredensialnya, dan menaikkan di sana akan
     mengeluarkan orang dari tenant-tenant lainnya saat login biasa.

  6. **A6 — feed/sitemap blog meng-escape dengan `escapeHtml`, bukan `escapeXmlText`.**
     **SELESAI (22 Agustus 2026).**
     `blog/[tenantCode]/feed.xml.ts:6,88,92,102`; `sitemap-blog.xml.ts:6,104,116`. Satu
     karakter kontrol C0 pada judul pos (`validateTitleField` hanya memeriksa panjang)
     membuat seluruh channel menjadi XML tidak well-formed dan setiap pembaca menolaknya.
     ADR-0038 menyebut `escapeXmlText`; itu diterapkan pada serializer `seo_distribution`
     yang 404 di produksi, dan tidak pada rute ini yang 200.
     Kedua rute kini memakai `escapeXmlText` (16 titik panggil). Docblock rutenya sendiri
     yang membuat fungsi salah itu terlihat benar — "escaped through the same `escapeHtml`
     used for HTML (XML and HTML share the same five entity escapes)" — benar, dan bukan
     seluruh perbedaannya. Ia DIKOREKSI alih-alih dihapus: komentar salah di samping kode
     benar adalah instruksi bagi penulis berikutnya.

  7. **A7 — sync-storage memakai string dari node apa adanya sebagai jalur filesystem
     server dan sebagai kunci object-store.** `sync-storage/domain/object-queue.ts:40-58,91`;
     `object-storage-uploader.ts:110-129`. `localPath` tidak dikurung akar dan dispatcher
     cron melakukan `Bun.file(input.localPath)` di **server**, mengembalikan teks galat yang
     membedakan ke node lewat `last_error` — sebuah orakel jalur sembarang. `objectKey`
     tidak diberi prefix tenant, jadi satu node bisa menimpa objek tenant lain. Butuh node
     sah yang dikompromikan, itulah sebabnya tidak lebih tinggi.

     SELESAI (22 Agustus 2026). `localPath` dikurung ke `OBJECT_SYNC_LOCAL_ROOT_PATH`
     (default `./var/object-sync`) di batas enqueue DAN sekali lagi tepat di sebelah
     syscall-nya — yang pertama supaya penolakan tak pernah jadi baris antrian permanen,
     yang kedua karena baris yang di-enqueue SEBELUM perubahan ini masih ada di tabel.
     Kunci tujuannya kini `<tenantId>/<objectKey>`, diterapkan saat PUT bukan disimpan,
     jadi tak perlu migration dan kunci yang dibaca balik oleh node tetap kunci yang ia
     kirim.

     Tiga hal yang tidak disebut rekomendasinya. (a) ORAKEL-nya justru bagian yang lebih
     besar: `Local file not found: ${path}` versus galat baca membedakan keberadaan jalur
     APA PUN di host; kini setiap penolakan melaporkan satu kalimat yang sama dan alasannya
     pergi ke log server. (b) `objectKey` juga butuh bentuk — S3 tak punya semantik jalur
     di sisi server, jadi `../` bukan traversal DI provider, tapi `/` adalah delimiter untuk
     listing, aturan lifecycle, dan setiap konsol yang menampilkan bucket sebagai pohon.
     (c) Pengurungannya menolak `..` secara TEKSTUAL, sebelum resolve: pemeriksaan
     resolve-lalu-`startsWith` menerima jalur yang keluar lalu kembali (`../object-sync/x`)
     — bukan eksploit hari ini, dan satu refactor dari menjadi eksploit.

     Env var wajib sempat dipertimbangkan lalu ditolak: ini mendarat di deployment yang
     sudah punya baris terantri dan protokol node yang jalan, dan gerbang konfigurasi yang
     menghentikan aplikasi saat upgrade adalah peristiwa yang lebih besar daripada temuan
     yang butuh node terkompromi berbekal secret HMAC deployment untuk dijangkau.

  8. **A8 — konfigurasi rate-limit site-search publik tidak divalidasi dan tidak dijaga
     NaN.** `site-search/query.ts:34-37`; `suggest.ts:27-32`. Satu salah ketik menghasilkan
     `NaN`, dan baik `count > NaN` maupun `now - windowStart >= NaN` bernilai false —
     **limiter-nya mati** pada endpoint full-text anonim sementara metrik `rate_limited`
     tetap nol dan meneguhkannya sebagai "tidak ada penyalahgunaan". Nilai kosong
     menghasilkan `0` dan mem-429 setiap pengunjung.

     **SUDAH DIPERBAIKI saat diperiksa, 22 Agustus 2026 — entri ini sudah basi pada hari ia
     ditulis.** Kedua setelan sudah melewati `parsePositiveIntSetting`
     (`src/lib/security/env-thresholds.ts`), yang mengembalikan fallback untuk nilai
     kosong/undefined DAN untuk apa pun yang non-finite, non-integer, atau ≤ 0, sambil
     memperingatkan sekali. `suggest.ts` bahkan membawa komentar "See `query.ts` — same
     defect, same fix". Ditutup oleh #601 bersama #593.

     **Dibiarkan terlihat alih-alih dihapus.** Entri audit yang menggambarkan cacat yang
     TIDAK ADA mengirim pembaca berikutnya mencarinya — bentuk kegagalan yang sama dengan
     banner skill basi, yang repo ini punya memorinya. Diverifikasi dengan membaca kedua
     titik panggil dan helper-nya, bukan dengan mempercayai komentarnya.

  ### B. Performa (jalur request + pengiriman)
  9. **B1 — tiap probe afordans `can()` menjalankan ULANG SELURUH pipeline otorisasi.**
     **SELESAI (22 Agustus 2026).**
     `lib/auth/admin-screen.ts:241-252`. Satu render `/admin/blog` menerbitkan 11 panggilan
     `authorizeInTransaction` ≈ 66 round trip berurutan pada satu koneksi `interactive`
     terpesan (maksimum 8 se-proses), ~50 di antaranya membaca ulang baris yang identik
     byte-per-byte, plus 11 insert decision-log per tampilan halaman. 112 panggilan `can()`
     di 38 layar; tidak ada budget yang mengukur chokepoint.

     **Diukur, dan estimasinya terlalu rendah: 89 query, bukan ~66.** 11 panggilan, 89
     query, 47 ms di satu koneksi `interactive` terpesan. Sesudahnya: **29 query, 23 ms**.
     Sebelas baris decision-log tetap sebelas — INPUT yang di-memo, bukan keputusan.

     Bukan persis salah satu dari dua bentuk yang disarankan. `canInTransaction` bergaya
     `evaluateFieldAccessInTransaction` akan melewati gerbang STRUKTURAL (penangguhan
     tenant, entitlement, larangan tulis terdelegasi, keadaan partner/grant, SoD), sehingga
     muncul affordance yang justru ditolak chokepoint sungguhan — cacat affordance-palsu
     yang repo ini kecam di tempat lain. `WeakMap` berkunci `tx` DI DALAM guard akan
     mengubah apa yang dilihat pemanggil setelah IA menulis: rute yang memberi role lalu
     mengotorisasi ulang akan membaca himpunan grant dari sebelum tulisannya sendiri, diam-
     diam dan hanya kadang-kadang.

     Maka memonya adalah OPT-IN yang disediakan pemanggil. `loadAdminScreen` membuat satu
     per render — jalur baca menurut konstruksinya, tempat kesebelas keputusan menggambarkan
     satu momen — dan setiap pemanggil lain tidak tersentuh. Tesnya MENJALANKAN argumen itu
     alih-alih menegaskannya: beri satu permission di tengah transaksi, otorisasi ulang
     TANPA cache, dan jawabannya berubah.

  10. **B2 — `isLegacyTenantRouteEnabled` membaca `awcms_blog_settings` lalu membuangnya.**
      **SELESAI (22 Agustus 2026).**
      `public-route-settings.ts:68-87`; dipanggil ketujuh rute `/blog/[tenantCode]/*`. Satu
      round trip terbuang penuh pada setiap tampilan halaman anonim — 100% dari semuanya
      pada deployment default, tempat edge cache mati.
  11. **B3 — rute `/blog/*` tidak pernah menerbitkan `locals.edgeCacheTenantId`.** Rute
      **SELESAI (22 Agustus 2026).**
      sudah meresolusi tenant lalu membuang id-nya, jadi middleware mengulang lookup
      `awcms_tenants` pada tiap MISS cache. Presedennya sudah bekerja di
      `seo-distribution/presentation/discovery-route.ts:145`.
  12. **B4 — `AdminLayout` membuka transaksi ketiga yang baca pertamanya adalah kolom yang
      **SELESAI (22 Agustus 2026).**
      tak diambil siapa pun.** `AdminLayout.astro:184-206`. `tenant_name` diambil terpisah
      dari baris yang sama yang sudah dipilih `readTenantDisplayDefaults`.

      **B2 lebih buruk dari yang tertulis: dua dari tujuh membayar DUA KALI.**
      `feed.xml.ts` dan `sitemap-blog.xml.ts` memanggil `isLegacyTenantRouteEnabled` lalu
      memanggil `fetchBlogSettings` sendiri, sehingga `awcms_blog_settings` dibaca, dibuang,
      lalu dibaca lagi. Gerbangnya kini SATU query dan pembaca gabungannya tetap membaca
      keduanya, karena ia memakai keduanya — dipatok terpisah supaya penghematannya tidak
      berasal dari membuang field yang dipakai orang lain.

      **Penempatan B3 adalah keseluruhannya.** `publish-tenant.ts` menyatakan aturannya —
      resolve, gate, produksi, publish TERAKHIR — karena 404 adalah status yang bisa
      di-cache: mem-publish sebelum cabang sumber-daya-tidak-ada membuat 404 "post tidak
      ada" beranotasi beda dari 404 "tenant tidak dikenal" dan menjawab, dari satu
      permintaan, pertanyaan yang justru ditahan bentuk 404 generiknya. Tesnya menuntut
      URUTAN terhadap `notFound` terakhir dan satu-satunya respons penyaji, dan mutasi yang
      memindahkan panggilannya ke atas gerbang memerahkannya.

      **B4 memindahkan satu shape-check bersamanya, dan itu nyaris luput.** Penjaga
      circuit-open berkunci pada `tenantName` — yang tidak lagi ada di return blok itu —
      sehingga membiarkannya berarti menguji field yang tidak pernah ada dan diam-diam
      melewati SETIAP penugasan di bawahnya: indikator sync, himpunan modul nonaktif, dan
      susunan sidebar.

  13. **B5 — ~6 round trip middleware per request publik sebelum query pertama halaman.**
      **SELESAI (22 Agustus 2026)** — diukur dulu, baru dikurangi.
      `middleware.ts:305`; `redirect-resolution-service.ts:170-212`. Dibayar bahkan oleh
      tenant tanpa satu pun aturan redirect. `standar-performa-dan-keamanan.md:195` mengaku
      plafon ≤3 query hot-read "terukur", tetapi **kedua suite budget memanggil fungsi
      directory langsung dan tidak pernah menggerakkan middleware**, jadi kelebihannya
      secara struktural tak terlihat oleh gerbang yang mengaku menegakkannya.

      **Pengukurannya adalah paruh yang lebih sulit, dan itulah inti temuan ini.**
      `countQueries` hanya bisa diberi `tx`, jadi ia hanya bisa melihat kode yang sudah
      ditaruh uji di dalam transaksi — sebuah fungsi directory. Semua yang dibayar
      request lebih dulu bukan sekadar tak terukur, melainkan tak TERUKURKAN oleh alat
      itu. `countPoolQueries` membungkus POOL dan transaksi yang dibuka di atasnya, dan
      `tests/integration/middleware-query-budget.integration.test.ts` kini memaku angka
      sebenarnya di atas PostgreSQL nyata: **5 statement** untuk passthrough, **7**
      untuk request yang redirect, **0** untuk path di luar kosakata redirect. Persis,
      bukan plafon — plafon berkelonggaran tak bisa membedakan perbaikan dari regresi
      ke dalam kelonggaran itu. Dan secara eksplisit BATAS BAWAH: `BEGIN` dan `COMMIT`
      adalah dua round trip lagi yang dikirim `sql.begin` sendiri dan tak terlihat
      Proxy mana pun. Anggaran yang diam-diam kurang menghitung adalah persis
      bagaimana "terukur" bisa berarti sesuatu selain terukur.

      **Pengurangannya satu pembacaan, bukan short-circuit.** `resolveTenantAllowedHosts`
      dan `resolveTenantPrimaryHost` membaca tabel yang SAMA dengan filter
      aktif/tak-terhapus yang sama, hanya beda `is_primary`, dan jalur redirect
      memanggil keduanya berurutan — maka `resolveTenantDomainSet` menjawab keduanya
      dari satu round trip (6 → 5, dan 8 → 7). Dibuktikan dengan menjalankan anggaran
      baru itu terhadap kode SEBELUM perbaikan dan melihatnya melaporkan 6 dan 8.
      Short-circuit yang dipertimbangkan catatan perf berkas itu sendiri ("apakah
      tenant ini punya aturan hidup?") TETAP tidak diterapkan, dengan alasan yang
      catatan itu berikan: cabang passthrough butuh host turunan-server untuk
      mengatribusikan 404, dan auto-redirect legacy-blog menyala dari settings, bukan
      dari baris aturan.

      **Standar kini menyatakan cakupannya.** Plafon ≤ 3 selalu anggaran ROUTE; tabelnya
      tidak mengatakan itu, dan "terukur" adalah kata yang ditangkap pembaca sebagai
      batas atas sebuah REQUEST. Anggaran middleware menjadi baris terpisah alih-alih
      dilebur ke angka yang sama, karena keduanya dibayar kode berbeda dan satu jumlah
      akan menyembunyikan paruh mana yang bergerak.

      **Ditemukan sambil bekerja: dua komentar menyatakan jalur kode HIDUP sebagai
      mati.** Baik `redirect-resolution-service.ts` maupun `redirect-middleware.ts`
      menyatakan middleware meneruskan `locale = null` "sepanjang jalan", sehingga
      aturan redirect ber-scope locale tak pernah bisa cocok. Benar di bawah ADR-0039;
      **salah sejak locale routing ADR-0098 mendarat** dan middleware mulai meneruskan
      locale yang disajikan untuk URL berprefiks. Dikoreksi di kedua tempat. Bentuk
      yang sama dengan hazard skill basi yang punya memori tersendiri di repo ini:
      klaim yang menua menjadi kebalikan kebenaran, di berkas yang tak punya alasan
      untuk dibaca ulang.

  14. **B6 — Map `buckets` rate-limit in-process tanpa eviction.** **SELESAI (22 Agustus
      2026).**
      `security/rate-limit.ts:57`. Satu entri permanen per IP klien berbeda; Redis mati
      secara default sehingga inilah jalur hidupnya. Kebocoran lambat, bukan risiko akut —
      tetapi mode gagalnya adalah OOM proses yang memegang setiap cache lain.

      **Dua mekanisme, karena sapuan saja bukan batas.** Sapuan ter-amortisasi (paling
      sering sekali per menit, dan saat melewati cap) membuang setiap entri yang
      jendelanya sudah lewat — `checkRateLimit` memang sudah memperlakukan jendela lewat
      sebagai awal baru, jadi entri seperti itu tidak menyimpan informasi apa pun. Itu
      membatasi map ke "klien berbeda yang terlihat dalam satu jendela", yaitu working
      set yang benar dan, saat banjir terdistribusi, dikendalikan penyerang. Maka ada
      juga cap keras 50.000, dan ketika tercapai korbannya dipilih yang paling tidak
      merugikan: entri yang PALING DEKAT KEDALUWARSA, dibuang satu batch sampai 45.000
      supaya sort yang memilihnya jalan sekali per 10% pertumbuhan, bukan tiap request.

      **Rekomendasi tidak menyebut dari mana `windowMs` datang, dan justru itulah inti
      desainnya.** Bucket kini menyimpannya. Eviction terjadi DI LUAR panggilan untuk
      kunci itu, jadi sapuan harus tahu kapan entri yang tidak ditanyakan berhenti
      menghitung, dan map itu dipakai bersama oleh pemanggil dengan jendela berbeda
      (login menit, site-search detik) — mengambil jendela dari pemanggil yang kebetulan
      memicu sapuan akan mengedaluwarsakan penghitung keluarga lain lebih awal.
      Kedaluwarsa dini adalah satu-satunya kegagalan yang tidak boleh diperkenalkan
      perbaikan memori: melupakan penghitung HIDUP memberi pemiliknya jatah baru —
      itulah yang diasersi `tests/rate-limit-bucket-eviction.test.ts` bersama ukurannya.

  ### C. Ongkos algoritma / query
  15. **C1 — tidak ada indeks yang mendukung pengurutan daftar blog.** **SELESAI (22 Agustus 2026).**
      `blog-post-directory.ts:398,436`; `sql/035:95-119,174-193`. Empat query daftar
      mengurut `updated_at DESC` (satu keyset `created_at DESC, id DESC`); tidak satu pun
      dari tujuh indeks dipimpin kolom itu, jadi tiap `/admin/blog`, `/admin/pages`, dan
      `GET /api/v1/blog/posts` adalah scan se-tenant + sort top-N, plus scan penuh kedua
      untuk `count(*)`. `db:fk-index:check` tidak bisa melihatnya — `updated_at` bukan
      foreign key. Ongkosnya O(pos tenant), bukan O(ukuran halaman).

      **DIUKUR, yang putaran ini tidak bisa lakukan.** `sql/145` menambah tiga indeks;
      terhadap 24.000 post ter-seed di PostgreSQL 18, daftar `/admin/blog` berubah dari Seq
      Scan 24.000 baris plus top-N heapsort (7,4 ms) menjadi Index Scan yang membaca **50**
      baris (0,057 ms), halaman keyset pertama dari 5,1 ms menjadi 0,110 ms, dan halaman
      keyset yang dilanjutkan di baris 10.000 membaca 50 baris dalam 0,060 ms. Milidetiknya
      milik mesin ini; `24.000 → 50` itulah temuannya.

      **Satu klaim di entri ini SALAH dan dibiarkan terlihat alih-alih disunting hilang:**
      "plus scan penuh KEDUA untuk `count(*)`". Hitungan di samping daftar itu sudah
      terencana sebagai Index Only Scan pada `awcms_blog_posts_tenant_deleted_idx` (1,8 ms,
      tidak berubah oleh `sql/145`). Ia membaca setiap entri indeks — itu sebabnya ia tidak
      menjadi lebih cepat — tetapi ia bukan heap scan, dan tidak ada indeks yang ditambahkan
      di sini yang menolongnya. Hitungan yang murah adalah keputusan lain (estimasi, atau
      penghitung terpelihara) dengan kompromnya sendiri.

      Post mendapat indeks PARSIAL pada `deleted_at IS NULL`, yang ditulis literal oleh
      query-nya. Page TIDAK: `listBlogPages` memutuskan terhapus-vs-hidup lewat `CASE` atas
      parameter terikat, jadi indeks parsial dapat dibuktikan di custom plan dan tidak di
      generic plan — indeks yang hanya kadang bisa dibuktikan planner adalah indeks yang
      kadang tidak ada.

      Dijaga oleh asersi RENCANA, bukan ambang waktu
      (`tests/integration/blog-list-ordering-plan.integration.test.ts`): nama indeksnya,
      tanpa `Seq Scan`, tanpa node sort, ≤50 baris dibaca. Kasus terakhirnya menjatuhkan
      indeksnya di dalam transaksi yang di-rollback dan menuntut scan-nya kembali — tanpa
      itu, setiap asersi lain juga lolos pada tabel yang terlalu kecil untuk membedakan
      rencananya.

  16. **C2 — `purgeVisitorAnalyticsData` satu-satunya purge retensi tanpa batas di repo.**
      `retention-purge.ts:91-117`. Empat statement tanpa batas batch, tiap-tiap memakai
      `RETURNING id` hanya untuk mengambil `.length` di sisi JS. Setiap saudaranya membatasi
      di 5000 dan mengulang.

      SELESAI (22 Agustus 2026). Keempat statement kini
      `WHERE <pk> IN (SELECT … ORDER BY … LIMIT n)` dan fungsinya mengembalikan `hasMore`.
      Job terjadwal mengulang dengan transaksi BARU tiap pass — mengulang di dalam satu
      transaksi akan menahan setiap lock dan tuple mati selama durasinya, persis hal yang
      hendak dihindari batching itu — dan menyebut nama tenant yang mentok di batas pass.
      Endpoint on-demand melakukan SATU pass terbatas lalu mengembalikan `hasMore`, karena
      besarnya pekerjaan tidak diketahui saat pemanggil menekan tombolnya.

      Satu KOREKSI yang ditemukan lewat mutasi, bukan lewat membaca: komentar kodenya
      mengklaim ORDER BY memberi kemajuan monotonik. Tidak — DELETE menghapus apa yang
      diambilnya, jadi terminasi tetap berlaku tanpa itu. Yang dibelinya adalah
      TERTUA-DULU, yang cocok dengan indeks yang sudah dipakai predikatnya dan berarti purge
      yang terputus telah menghapus data yang paling jauh melewati retensinya, bukan
      potongan sembarang. Menghapus ORDER BY membuat semua test tetap hijau sampai ditulis
      test untuk properti yang memang benar.

      `awcms_visitor_daily_rollups` dibatasi lewat `ctid`, bukan id surrogate: ia berkunci
      `(tenant_id, date, area)` dan tak punya kolom id. `ctid` tidak stabil melintasi UPDATE
      — justru itulah sebabnya ia hanya dipakai di dalam satu statement yang memilihnya.

  17. **C3 — sync push melakukan read-modify-write pada `current_version` tanpa row lock.**
      `sync/push.ts:132-137`. Dua batch bersamaan sama-sama membaca 5, sama-sama lolos
      pemeriksaan konflik, sama-sama menulis literal `6`: dua event berkonflik diterima, nol
      baris konflik, satu increment hilang. Tidak berbahaya di hilir hari ini hanya karena
      `awcms_sync_inbox` belum punya konsumen — cacatnya ada pada fondasi konfliknya
      sendiri.

      SELESAI (22 Agustus 2026). Tulisannya kini compare-and-set
      (`… DO UPDATE … WHERE current_version = ${expected}`), diekstrak ke
      `advanceAggregateVersion` supaya punya SATU nama dan SATU test. CAS yang tidak
      mengenai apa pun ADALAH `version_mismatch` — vonis yang akan dicapai evaluator murni
      dengan pembacaan segar, jadi node melihat hasil yang sudah dipahaminya.

      Dua hal di luar rekomendasi. Baris inbox kini ditulis SETELAH versinya maju; dulu ia
      ditulis lebih dulu, jadi batch yang kalah meninggalkan event "diterima" untuk increment
      yang tak pernah dilakukannya. Dan `SELECT … FOR UPDATE` — perbaikan yang jelas — DITOLAK
      karena LEBIH LEMAH: ia mengunci baris yang ADA, jadi dua batch yang MEMBUAT agregat
      sama tetap sama-sama lanjut, dan ia menahan setiap agregat dalam batch selama seluruh
      transaksi alih-alih satu baris selama satu statement.

      Balapannya diuji sungguhan dan DETERMINISTIK: dua transaksi dengan jabat tangan DUA
      arah. Menunggu pemenangnya saja tidak cukup — `withTenantOrThrow` kembali sebelum
      statement pertamanya jalan, jadi yang kalah bisa membaca nilai pasca-tulis lalu gagal
      karena alasan yang salah; itu terjadi satu dari lima run sebelum jabat tangan kedua
      ditambahkan.

  18. **C4 — cursor proyeksi reporting melewati baris yang disisipkan lebih dulu tetapi
      di-commit belakangan.** `projection-incremental-worker.ts:195-223`. Tanpa batas atas,
      tanpa jendela lag. Karena `now()` adalah waktu mulai transaksi, baris dari transaksi
      panjang bisa commit setelah cursor melewati timestamp-nya — tidak pernah terpilih
      lagi. **ADR-0077 menolak persis bentuk ini untuk sync-pull**; mesin ini
      mempertahankannya. ADR-0072 menyatakan nilai inkremental itu otoritatif,
      jadi tak ada yang merekonsiliasinya.

      SELESAI (22 Agustus 2026). Pemindaiannya berhenti di
      `now() - REPORTING_PROJECTION_LAG_SECONDS` (default 60), dan jaminannya DINYATAKAN
      bukan disiratkan: sebuah baris terhitung bila transaksi yang menulisnya commit dalam
      rentang lag sejak ia mulai. Penulis yang menahan transaksi lebih lama tetap terlewat —
      dibatasi dan disebut namanya, bukan dihilangkan. `0` mengembalikan perilaku lama.

      `min(xact_start)` dari `pg_stat_activity` akan tepat persis dan TIDAK BISA dipakai:
      non-superuser tanpa `pg_read_all_stats` membaca NULL untuk pengguna lain, jadi batasnya
      diam-diam menjadi `now()` — sama sekali bukan batas, tapi berbentuk seperti batas.
      Jawaban salah yang tampak seperti mekanisme yang benar lebih buruk daripada pendekatan
      yang terang-terangan aproksimatif.

      `now()`-nya milik SQL, bukan aplikasi. Membandingkan timestamp database dengan jam JS
      akan membuat batas itu bergantung pada skew jam app/DB, dan skew ke arah yang salah
      diam-diam berarti tanpa batas sama sekali.

  19. **C5 — ekspor data subjek: 49 baca tak terbatas dalam satu transaksi interactive, dua
      di antaranya atas kolom aktor tanpa indeks.** `subject-data-executor.ts:200-217`.
      Tanpa LIMIT, tanpa cursor, semua baris di-buffer; `awcms_audit_events.actor_tenant_user_id`
      dan kembarannya di `awcms_domain_events` tidak berindeks dan **bukan kolom FK sehingga
      `db:fk-index:check` secara struktural tidak bisa melihatnya**.

      SELESAI (22 Agustus 2026), `sql/145`. Tiga indeks parsial, dan DIUKUR pada 60.000
      baris: baca aktor beralih dari Seq Scan menyentuh 858 buffer (2,5 ms) menjadi Index
      Scan menyentuh 33 (0,039 ms). Nyaris-lolosnya layak dicatat — `awcms_audit_events`
      MEMANG punya `awcms_audit_events_actor_tenant_idx`, pada `actor_tenant_id`: TENANT si
      aktor terdelegasi, kolom berbeda yang hanya berjarak satu huruf saat dibaca.

      Bacanya juga dibatasi 10.000 baris dengan batas itu DILAPORKAN (`truncated` per tabel,
      `truncatedTables` di respons bersebelahan dengan pernyataan cakupan `unanswered` yang
      sudah ada, dan kata INCOMPLETE di pesan audit event `critical`-nya). Batas pada ekspor
      hak subjek hanya bisa diterima KARENA ditandai: ekspor yang diam-diam mengembalikan N
      baris pertama akan menjawab kewajiban hukum dengan angka yang berpakaian jawaban —
      lebih buruk daripada baca tak terbatas yang digantikannya. Tanpa cursor, dengan
      sengaja — "jawaban lengkap" yang dirakit lintas halaman punya batas di setiap request,
      tempat jawaban parsial bisa disalahartikan sebagai keseluruhannya.

      Satu mutasi mengajarkan hal yang layak disimpan: menghapus LIMIT sepenuhnya TIDAK
      memerahkan apa pun, karena dengan 12 baris dan batas 10 flag serta potongannya keluar
      identik dan hanya BIAYA-nya yang berbeda. Itu persis bentuk temuannya sendiri, jadi
      suite-nya kini membawa asersi eksplisit bahwa statement-nya benar-benar memuat LIMIT.

  20. **C6 — `/admin/roles` adalah N+1 plus payload O(peran × katalog).** **SELESAI (22
      Agustus 2026).**
      `roles.astro:88-94`. `listRolePermissions` di-await sekali per peran (sampai 100,
      berurutan); katalog ~230 baris dirender sebagai `<option>` sekali per peran.

      **Paruh N+1:** `listRolePermissionsForRoles` menjawab seluruh himpunan dalam satu
      round trip `role_id = ANY(...)` dan mengembalikan entri untuk SETIAP id yang
      diminta, termasuk array kosong — pemanggil yang harus membedakan "tanpa grant" dari
      "tidak ada di hasil" akan kembali bertanya per peran. Pembaca satu-peran DIHAPUS,
      bukan dibiarkan tak terpakai: ekspor tanpa pemanggil adalah cara layar berikutnya
      diam-diam menghidupkan lagi N+1 (lihat D12/D15/D16 untuk bentuk yang sama sebagai
      temuan hidup).

      **Paruh payload memindahkan satu keputusan ke klien, jadi perlu tegas soal apa yang
      TIDAK ikut pindah.** Katalog kini dikirim sekali di dalam `<template>` — konten
      inert, tidak dirender dan tidak ikut submit — dan klien mengklonnya ke picker satu
      peran saat panel itu pertama dibuka, dikurangi apa yang sudah didaftar panel itu
      sebagai granted. Id yang granted diambil dari tombol revoke panel itu sendiri,
      karena salinan kedua hanya bisa berbeda dari daftar yang sudah di layar. SERVER
      tetap memutuskan apakah picker ada sama sekali (`availableCount > 0`, dihitung
      terhadap katalog dan bukan lewat pengurangan — sebuah peran bisa memegang izin yang
      tidak ada di katalog), dan guard `configure` endpoint tetap satu-satunya otoritas
      atas grant-nya. Picker kosong tanpa JavaScript; itu bukan regresi, formulirnya
      memang selalu submit lewat `sendJson`.

      **Satu hal untuk dibawa ke depan: ini menghabiskan hampir seluruh anggaran aset
      klien.** `build:asset-budget:check` mengizinkan 192.000 B untuk bundel app; pengisi
      picker memakan ~540 B dan menyisakan **161 B**. Tukar-tambahnya bagus (beberapa
      ratus byte JS ter-cache melawan ~23.000 `<option>` di tiap render halaman) tetapi
      layar BERIKUTNYA yang menambah skrip klien akan memerahkan gerbang itu, dan
      memerahkannya karena sebab yang tak ada hubungannya dengan layar tersebut.
      Menaikkan plafon adalah keputusan, bukan formalitas — tidak diambil di sini.

  21. **C7 — `prepareCandidates` meng-escape ulang tiap nama tag di dalam komparator sort.**
      **SELESAI (22 Agustus 2026).**
      `internal-tag-linking.ts:155-158`. Terukur 1090 panggilan/sort vs 100 untuk
      decorate-sort-undecorate. Hemat absolutnya kecil (~0,14 ms), itulah sebabnya terakhir.

      Decorate-sort-undecorate, dengan nama ter-escape dibawa di baris yang memang sudah
      dibutuhkan loop dedupe dan pemanggilnya — sehingga versi yang lebih murah juga
      lebih pendek. Tidak ada uji perilaku yang bisa memisahkan kedua implementasi:
      escaping monoton atas prefiks, jadi "lebih panjang mentah" dan "lebih panjang
      ter-escape" hanya bisa berbeda untuk kandidat yang tak pernah bersaing di posisi
      teks yang sama. Yang diasersi sebagai gantinya: komparator tidak memuat panggilan
      `escapeHtml(`, plus dua properti yang menjadi alasan sort itu ada (terpanjang-
      ter-escape lebih dulu untuk istilah yang tumpang tindih; `minTermLength` tetap
      diukur pada nama MENTAH, sehingga escaping tak bisa menyelundupkan kembali tag yang
      sudah tersaring).

  ### D. Perbaikan fungsional & kemudahan pemeliharaan
  22. **D1 — job terjadwal berjalan di container tanpa volume dan dengan allow-list env yang
      bocor.** **SELESAI (22 Agustus 2026).** `ops/run-job.sh:88,92`. `docker run --rm` **tanpa `-v`**: arsip lifecycle dan
      ekspor laporan ditulis ke dalam container yang dihapus beberapa detik kemudian
      sementara `awcms_data_lifecycle_archive_manifests` dan `awcms_report_export_runs`
      mencatatnya ada — prosedur restore di README tidak bisa dijalankan dan ekspor
      terjadwal 404 saat diunduh. Terpisah dari itu, `printenv | grep -E` yang dirawat
      tangan membuang ~10 variabel yang benar-benar dibaca job terjadwal (alternatif
      `^CLOUDFLARE_` ter-anchor sehingga melewatkan `TENANT_DOMAIN_CLOUDFLARE_*`), dan
      job-nya tetap keluar 0.

      **Paruh env-nya LEBIH BURUK dari yang tertulis di entri ini: 81 dari 171, bukan ~10.**
      Diukur dengan `collectEnvReads()` — sumber yang sama dipakai
      `config:env:coverage:check`. Kedua path akar artefak
      (`DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`, `REPORTING_EXPORT_ROOT_PATH`) termasuk di
      dalamnya, yang membuat kedua paruh temuan ini SATU cacat, bukan dua: volumenya tidak
      ada DAN variabel yang bisa mengarahkan tulisannya ke tempat lain tidak pernah sampai.

      Sebuah direktori host kini di-mount di atas `var/` container — satu mount menutupi
      kedua akar karena keduanya berdefault `./var/...` relatif terhadap `WORKDIR`, dan
      sebuah tes mengikat path container itu ke `WORKDIR` SUNGGUHAN milik image supaya
      pemindahan di Dockerfile tidak bisa mendarat diam-diam. Env dipilih berdasarkan NAMA
      persis dari `ops/awcms-jobs.env-allowlist`, DIGENERASI oleh
      `bun run jobs:env-allowlist:generate` dan dijaga gerbang baru di `bun run check`.
      Pencocokan nama-persis bukan kebetulan: pola prefiks juga menyalin
      `DATABASE_URL_LOOKALIKE`, dan tidak ada asersi source yang bisa membedakannya —
      karena itu ekspresi `awk` milik runner DIJALANKAN atas environment fixture di tesnya.

      Dua penolakan alih-alih fallback, karena kedua alternatif senyapnya menghasilkan job
      yang jalan dan melaporkan sukses: allow-list yang tak terbaca, dan menyalin nol
      variabel. `*_ROOT_PATH` yang menunjuk ke luar mount DISEBUT di log — cacat yang sama
      berbalut konfigurasi, dengan gejala yang identik dengan sukses.

  23. **D2 — empat salinan `stripComments` naif menelan kode nyata; lima gerbang memindai
      lebih sedikit dari yang diakuinya.** **SELESAI (22 Agustus 2026)** — delapan salinan,
      bukan empat. `table-write-ownership-check.ts:68`;
      `access-chokepoint-check.ts:111`; `env-contract-coverage-check.ts:145`;
      `identity-principal-access-check.ts:177`; `work-class-registry-generate.ts:101`. Regex
      komentar blok berjalan atas seluruh berkas lebih dulu, jadi docblock apa pun yang
      memuat glob rute seperti `` `/api/v1/partner/**` `` menghapus semuanya sampai `*/`
      berikutnya. **Terbukti lewat mutasi:** `INSERT INTO` yang ditanam di
      `identity-access/module.ts:41` tak terlihat oleh `modules:table-writes:check`; 59
      berkas kehilangan kode nyata dibanding orakel. Tidak ada sinyal gerbang yang berbeda
      _hari ini_ — ini fail-open laten yang tumbuh tiap ada docblock baru. Versi
      sadar-string yang benar sudah ada di `i18n-catalog-check.ts:263`.

      **Mendarat, dan jangkauannya lebih besar dari yang tertulis di entri ini.** Delapan
      berkas membawa salinan, bukan empat. Fakta paling tajamnya bukan jumlah berkas:
      `src/modules/blog-content/module.ts` kehilangan **7.260 karakter dan 57 baris** akibat
      stripper naif itu, TERMASUK seluruh deklarasi `jobs:` dan `capabilities:`-nya —
      sehingga gerbang yang membaca deskriptor itu lewat stripper tersebut sedang melihat
      modul tanpa job dan melaporkan OK. Di seluruh `src/`, 29 berkas kehilangan lebih dari
      200 karakter.

      Kedelapan gerbang terdampak dijalankan sebelum dan sesudah: jawabannya sama, dan
      `work-class-registry.generated.json` diregenerasi identik byte-per-byte — klaim "tidak
      ada sinyal yang berbeda hari ini" DIVERIFIKASI, bukan diulang.

      `codeOnly` milik `work-class-registry-generate.ts` ikut dilebur. Ia BUKAN jenis
      penelan (tanpa regex sewhole-file) tetapi buta ke arah sebaliknya: komentar blok yang
      baris tengahnya tidak diawali `*`, atau `/* … */` di belakang kode, lolos darinya dan
      bisa terbaca sebagai pemanggilan.

      `stripComments` tetap DI-RE-EXPORT dari tiga skrip yang sudah menjadi tempat impor 21
      berkas tes — menyunting 21 baris impor di dalam perubahan tentang hal lain adalah cara
      sebuah diff berhenti bisa direview. Tesnya menyimpan versi naifnya sebagai ORACLE: tes
      yang hanya menjalankan stripper yang benar hanya menegaskan bahwa ia bekerja, yang
      mudah dan tidak informatif.

  24. **D3 — `LOG_LEVEL=warn` lolos `config:validate` dan diabaikan diam-diam; `warning`,
      nilai yang diimplementasikan logger, ditolak.** **SELESAI (22 Agustus 2026).** `validate-env.ts:51-56`;
      `logger.ts:12,21-26`. Tidak ada nilai yang sekaligus lolos kontrak tervalidasi dan
      bekerja, jadi firehose terus mengirim sementara operator percaya sudah diredam.

      Diperbaiki di KEDUA sisi dan bersifat aditif: validator menerima `warning` (dan tetap
      menerima `warn`), dan logger mengkanonikalkan `warn` → `warning` sambil mencatat
      pemberitahuan sekali yang menyebut ejaan kanoniknya. Menolak `warn` mentah-mentah akan
      lebih rapi dan akan mengubah no-op senyap menjadi `config:validate` yang GAGAL di
      deployment yang sedang berjalan, demi menghukum sebuah ejaan. Nilai yang tidak dikenali
      tetap jatuh ke `info` — arah yang aman, karena alternatifnya adalah deployment yang
      tidak mencatat apa pun karena seseorang mengetik `infoo`.

  25. **D4 — dua job analitik bercabang pada `result instanceof Response` setelah
      `withTenantOrThrow` — kode mati yang menyembunyikan abort nyata.**
      `visitor-analytics-rollup.ts:97-106`. `tenantsSkipped` permanen 0, peringatan
      `partial` tak pernah bisa menyala, dan backpressure meninggalkan setiap tenant sisa
      alih-alih melewati satu. Rollup hanya menyasar SATU hari, jadi
      run yang ditinggalkan meninggalkan lubang permanen: pass besok me-rollup besok.

      SELESAI (PR D4/D5/D6). Cabang mati diganti `catch` yang MELEMPAR ULANG apa pun yang
      bukan `DatabaseBusyError` — sengaja sempit, karena mencuci query rusak menjadi
      `tenantsSkipped` akan mengembalikan persis kelas bug yang jadi pokok temuan ini.
      Tenant yang dilewati DISEBUT NAMANYA, bukan sekadar dihitung: `--date=` adalah
      obatnya dan operator butuh id-nya.

      Audit menyebut "dua job analitik" dan benar untuk keduanya:
      `visitor-analytics-purge.ts:92` membawa cabang mati yang identik dan diperbaiki dengan
      cara yang sama. Purge justru yang lebih serius. Job itulah yang MENEGAKKAN retensi,
      jadi run yang ditinggalkan berarti setiap tenant sesudah yang pertama tetap menyimpan
      data pengunjung melewati jendela retensinya — diam-diam, sementara ringkasannya
      melaporkan sukses dan klausa `(WARNING: … database busy)` miliknya sendiri, yang
      digerbangi penghitung yang permanen nol, tak pernah bisa tercetak.

  26. **D5 — `site-search:reconcile` keluar 0 dan mencetak `failures=0` saat satu sumber
      penuh gagal.** `site-search-reconcile.ts:57-83`. `break` di mesinnya terjadi sebelum
      `results.push`, jadi sumber yang gagal menyumbang nol ke `failureCount`. Pencarian
      publik berhenti diperbarui sementara setiap sinyal operator mengatakan sukses.

      SELESAI (PR yang sama). Mesin kini melaporkan `failedSources` dan
      `unattemptedSources`, dijaga TERPISAH dari `failureCount` — meleburkan sumber yang
      mati ke dalam penghitung per-DOKUMEN justru itulah cara "0" berarti "satu sumber
      penuh berhenti". Skripnya memeriksa `status`, mencetak kedua daftar, dan keluar 1.

      Dua koreksi atas rekomendasinya. (a) `break` itu BENAR dan tetap: sumber yang gagal
      karena error database meninggalkan transaksi dalam keadaan abort, jadi melanjutkan
      hanya melahirkan rentetan `25P02` dan `finalizeRun` sendiri akan gagal. (b)
      Sukses-palsu itu hanya terjangkau bila sumbernya melempar error **JS** (asersi
      identifier di `buildExtractionQuery`, yang jalan sebelum SQL apa pun) — error DATABASE
      meracuni transaksi, menyeret `finalizeRun`, lalu menolak keluar dari panggilan, dan
      itu selalu berisik. Sampai PR ini ia berisik ke arah yang salah: ia meninggalkan
      setiap tenant sisa. Skripnya kini menangkap PER TENANT lalu lanjut, bentuk yang sama
      dengan D4.

  27. **D6 — circuit breaker email disuapi penolakan per-pesan, dan breaker terbuka dicatat
      sebagai percobaan nyata.** `mailketing-provider.ts:91-107`. Penolakan penerima tak
      sah — fakta tentang barisnya — mencatat kegagalan breaker, bertentangan dengan header
      berkas itu sendiri. Sekali terbuka, dispatcher menulis baris `failure` dan membakar
      `retry_count` untuk pesan yang tak pernah sampai ke provider: **buku besar pengiriman
      mencatat kontak yang tidak terjadi.**

      SELESAI (PR yang sama). `EmailDeliveryResult` mendapat `skipped`, yang bukan percobaan
      untuk dicatat maupun retry untuk dibelanjakan: pesan seperti itu kembali ke `queued`
      tanpa disentuh, dihitung sebagai `deferred` dan dicetak di baris ringkasan. Angka yang
      tidak dicetak ringkasan adalah angka yang tak dibaca siapa pun, jadi memisahkan
      `deferred` tanpa mencetaknya justru akan membuat pass itu lebih senyap, bukan lebih
      jelas.

      Akuntansi breaker kini memakai pembagian yang sudah didokumentasikan
      `push-delivery/domain/fcm-error-mapping.ts`: 429 dan 5xx adalah pernyataan tentang
      LAYANAN, setiap 4xx lain tentang PESAN. Itu menutup kasus ketiga yang tak disebut
      audit — cabang `!response.ok` juga menjatuhkan breaker pada 4xx biasa. Konkretnya:
      ambangnya 5 kegagalan beruntun, jadi ENAM alamat tak sah dalam satu batch dulu cukup
      untuk menghentikan email seluruh deployment, termasuk pesan reset kata sandi. Token
      API yang benar-benar salah adalah urusan `email:provider:health`, dan tak seperti
      breaker ia bisa memberi tahu operator masalahnya yang MANA.

  28. **D7 — `defaultVerificationMethod: "manual"` yang dideklarasikan `tenant_domain` tidak
      punya pembaca runtime.** **SELESAI (22 Agustus 2026) — diselesaikan dengan MENGHAPUSNYA,
      bukan dengan menyambungnya.**
      `tenant-domain/module.ts:163`. Validatornya default `null` dan
      verifikasi menjawab `missing_verification_method` — keadaan `pending_verification` yang
      sudah diamati item 6 §4 di produksi, tanpa menyebut sebab ini.

      **Perbaikan yang tampak jelas justru akan MENGHAPUS sebuah kontrol, jadi tidak
      dilakukan.** Menerapkan default itu saat pembuatan adalah yang disiratkan bingkai
      temuan, dan itu salah di sini: `verifyTenantDomain` TIDAK melakukan verifikasi apa
      pun. Ia memeriksa `verification_method` tidak NULL lalu menyetel `status = 'active'`
      — tidak ada lookup DNS di mana pun pada jalur rutenya (adapter Cloudflare dipilih
      lewat `TENANT_DOMAIN_DNS_PROVIDER` dan tidak dipanggil siapa pun). Jadi
      `verification_method` yang NULL saat ini adalah satu-satunya langkah antara "sebuah
      tenant membuat baris hostname" dan "hostname itu aktif", dan domain aktif memberi
      makan resolusi host→tenant, allow-list redirect, dan canonical host.

      Seluruh blok `settings` hilang, dengan penalarannya di tempatnya, dan uji yang dulu
      mengasersi default itu kini mengasersi ketiadaannya DITAMBAH perilaku yang tidak
      boleh berubah (pembuatan tetap meninggalkan kolomnya NULL).

      **DITEMUKAN SAAT BEKERJA, dan inilah item yang sebenarnya: `verify` tidak
      memverifikasi apa pun.** Friksi di atas hanya berjarak satu `PATCH` dari dihapus oleh
      tenant mana pun yang memegang `domains.update` — setel `verificationMethod:
"manual"`, panggil verify, dan hostname itu aktif. Apakah itu penting bergantung pada
      DNS yang tidak dikendalikan siapa pun di sini, dan justru karena itu ia butuh
      keputusan beralasan, bukan perbaikan diam-diam di dalam pembersihan settings. Dicatat
      sebagai item BARU di §4, bukan ditutup di sini.

  29. **D8 — `media_library.enforcement.*` diarsipkan sebagai KEPUTUSAN penyaringan yang
      menyebut layar yang tidak mengimplementasikannya.** **SELESAI (22 Agustus 2026).**
      `admin-screen-coverage-check.ts:91,93`.
      Relokasi yang tak pernah terjadi tercatat sebagai penilaian, sehingga ledger yang hanya
      boleh menyusut tidak menghitungnya.

      Diverifikasi sebelum dipindahkan: `/admin/security` membawa level enforcement MFA dan
      sama sekali tidak membawa apa pun soal media. Kedua kunci berpindah dari
      `DELIBERATELY_UNSCREENED` ke `NOT_YET_SCREENED`, sehingga hitungannya berubah dari "15
      deliberate, 34 menunggu layar" menjadi "13 deliberate, 36 menunggu layar" — ledger itu
      seharusnya adalah angka jujur tentang seberapa banyak yang belum dibangun, dan dua
      permukaan dijauhkan darinya oleh sebuah kalimat. Penalaran tentang DI MANA switch itu
      seharusnya berada bertahan sebagai catatan pada baris ledger; ia tak pernah salah, ia
      hanya belum benar.

      `DELIBERATELY_UNSCREENED` kini diekspor, sehingga sebuah uji bisa mengasersi kedua
      daftar itu tak pernah berbagi kunci. Versi uji yang mentoleransi ekspor yang hilang
      akan lulus tanpa melakukan apa pun — bentuk yang sama dengan temuan yang dijaganya.

  30. **D9 — `ship-logs.sh` menamai berkas keluarannya saat attach dan tidak pernah
      merotasi.** **SELESAI (22 Agustus 2026).**
      `ops/ship-logs.sh:53-57`. `$(date)` diekspansi sekali saat tailer
      dijalankan dan fd-nya hidup sampai deploy berikutnya, jadi baris hari ini mendarat di
      berkas bertanggal deploy terakhir dan sapuan `-mtime` 30 hari tak pernah bisa
      menyentuh berkas yang terbuka itu.

      Redirect itu kini menjadi loop `while read` yang menurunkan ulang tanggalnya dan
      membuka ulang dengan `>>` per baris — `printf -v day "%(...)T"`, sebuah builtin
      bash, sehingga tidak ada fork `date` per baris pada log yang justru menjadi alasan
      skrip ini ada. `TZ=UTC` di dalam payload karena `%(...)T` memformat waktu LOKAL
      sementara nama berkasnya selalu UTC.

      **Sifatnya bisa diuji tanpa menunggu tengah malam, dan ujinya menjalankannya.**
      Hapus berkasnya di bawah penulis yang sedang jalan: satu descriptor berumur panjang
      terus menulis ke inode tak bertaut dan path-nya tak pernah kembali; `>>` per baris
      membuatnya lagi pada baris berikutnya. `tests/ops-log-shipping-and-readiness.test.ts`
      menjalankan itu terhadap payload yang DIEKSTRAK DARI SKRIPNYA (bukan salinan), dan
      membawa kasus KONTROL yang menjalankan bentuk redirect lama lewat prosedur yang sama
      untuk memperlihatkan berkasnya tetap hilang — tanpa itu suite tersebut hanya
      membuktikan penulis baru bekerja, bukan bahwa ia berbeda.

  31. **D10 — tidak ada apa pun di jalur deploy atau load balancer yang membaca endpoint
      readiness yang sudah ada.** **SELESAI (22 Agustus 2026)** — dengan pemisahan yang
      disengaja, bukan penukaran.
      `health.ts:8-14`; `infra/varnish/default.vcl:26-34`.
      Coolify, HEALTHCHECK Docker, dan probe Varnish semuanya memakai endpoint liveness yang
      sengaja bebas dependensi, jadi rilis dengan database tak terjangkau ditandai sukses
      lalu dialihkan.

      **Perbaikan yang tampak jelas justru salah dan tidak diambil.** Mengarahkan ketiga
      probe itu ke readiness akan merestart atau mengeluarkan container dari rotasi saat
      gangguan database, dan merestart aplikasi tidak memperbaiki database — ia mengubah
      satu insiden menjadi dua. Ketiganya MERESTART atau MENGALIHKAN, jadi liveness adalah
      pertanyaan yang benar bagi mereka, dan alasan itu kini tertulis di masing-masing
      tempat agar pembaca berikutnya tidak "memperbaikinya".

      **Yang kurang dari readiness adalah pembaca di jalur yang memanggil manusia.**
      `ops/synthetic-check.sh` kini memeriksanya tiap 10 menit dari LUAR — berkas yang
      kepalanya sendiri menyatakan tugasnya adalah pertanyaan yang dijawab healthcheck
      container dari dalam, tempat "setiap cacat yang benar-benar dikirim proyek ini tak
      terlihat". Ia mengasersi `databaseReachable` dan bahwa breaker tidak `open`, karena
      endpoint itu menjawab 200 sambil melaporkan databasenya hilang: probe yang hanya
      memeriksa kode status akan menjadi liveness lagi dengan URL lebih panjang.

      **Yang BELUM tertutup, dan tak bisa ditutup dari sini.** Health Check Path Coolify
      adalah konfigurasi di Coolify, bukan di repo ini. Runbook kini menyatakan
      pemisahannya, memberikan asersi readiness sebagai langkah deploy bernomor, dan
      menyatakan eksplisit untuk tidak mengarahkan Coolify ke sana — tetapi tak ada apa pun
      di repositori ini yang bisa menegakkannya, dan menyebutnya ditegakkan akan menjadi
      klaim sekelas "terukur" ≤3 query di B5.

  32. **D11 — enam skrip job memanggil `withTenantOrThrow` tanpa `workClass`, jadi berjalan
      sebagai `interactive`.** **SELESAI (22 Agustus 2026) — dan jumlahnya TUJUH, bukan
      enam.**
      Purge malam menisbatkan tekanan pool-nya ke ember yang
      melayani pengguna hidup. Baik `work-class-registry.ts:11-17` maupun
      `database-capacity-runbook.md:268-282` menegaskan job tak pernah mencapai
      `acquireWorkClassSlot` — itu kini salah.

      Himpunan lengkapnya, diperiksa alih-alih dihitung dari temuan:
      `visitor-analytics-purge`, `visitor-analytics-rollup`, `blog-ads-drop-readiness`,
      `blog-ads-ingest`, `comments-retention` (3 panggilan), `edge-cache-purge` (3
      panggilan), dan `tenant-domain-dns-sync` — plus `site-search-reconcile` yang
      bertentangan dengan peta. Masing-masing kini meneruskan kelas yang dinyatakan
      registry untuknya. Driftnya diselesaikan KE ARAH REGISTRY (`background_sync` untuk
      site-search): entri registry membawa rationale beralasan sementara literal skripnya
      tidak membawa apa pun, dan bila `maintenance` yang benar, tempat mengubahnya adalah
      rationale itu.

      **Perbaikan yang penting adalah gerbangnya, karena tanpa itu ia menyimpang lagi.**
      `db:work-class:generate` kini MENOLAK jalan bila sebuah skrip job tidak membuka
      transaksinya sebagai kelas yang dinyatakannya — di kedua arah, opsi yang hilang
      maupun yang bertentangan. Ia MENGHITUNG alih-alih memeriksa keberadaan: skrip dengan
      tiga panggilan dan satu literal terbaca "sudah dinyatakan" oleh pemeriksaan
      keberadaan mana pun sementara dua transaksinya tetap berjalan sebagai `interactive`,
      dan dua skrip di sini persis berbentuk demikian. Dibuktikan dengan mengembalikan satu
      opsi dan melihat gerbang menyebut nama berkas dan hitungannya.

      **Gerbang itu membaca SATU berkas, yaitu skripnya, dan menyatakannya.** Beberapa
      rationale registry mengklaim "setiap panggilan di dalam <modul> sudah meneruskannya
      eksplisit"; panggilan itu ada di bawah `src/`, skripnya tidak punya `withTenant*(`
      sendiri, dan tak ada yang memverifikasinya. Diam di sana berarti "tidak tercakup",
      bukan "benar".

      **Kedua klaim palsu dikoreksi.** `work-class-registry.ts` menyatakan job "tidak
      memanggil `withTenant`/`acquireWorkClassSlot` sama sekali hari ini" dan bagian
      "Keterbatasan yang diketahui" runbook kapasitas menyatakan hal yang sama. Keduanya
      benar saat ditulis dan bertahan setelah berhenti benar — job melewati
      `withTenantOrThrow`, yang MEMANG `acquireWorkClassSlot`. Bagian runbook itu diganti
      namanya dari keterbatasan menjadi penjelasan bagaimana kedua mekanisme membagi tugas:
      work class menentukan antrean terbatas mana yang ditunggu transaksi sebuah job,
      advisory lock job-runner menentukan ada berapa job itu.

  33. **D12 — tiga inti fetch JSON nyaris identik di `src/lib/ui/`, plus `postJson` mati yang
      membawa komentar palsu.** **SELESAI (22 Agustus 2026).** `admin-form-client.ts:77-173`.
      Keduanya **sudah menyimpang**: `sendJson` mendukung `extraHeaders` (Idempotency-Key),
      request tanpa body, dan `DELETE`; `sendJsonWithFieldErrors` tidak satu pun sampai Issue
      #596 menambahkan yang pertama secara manual — itulah sebabnya `/admin/seo` melaporkan
      "invalid" tanpa menyebut field mana. `postJson` nol pemanggil sambil mengaku melayani
      "call site form create yang sudah ada".

      Ketiganya kini proyeksi dari satu `sendJsonRequest`, dan tetap tiga fungsi publik
      dengan sengaja: bentuk sempit `{ ok, errorCode }` milik `sendJson` adalah yang
      mencegah tiga puluhan layar melukiskan detail internal ke halaman (Issue #540), jadi
      melebarkannya untuk semua demi dua pemanggil akan mencabut properti itu dari semuanya.
      `postJson` dihapus. Perselisihan ketiga yang tidak disebut temuan: salinan
      field-errors menggabungkan `extraHeaders` DI ATAS `Content-Type`, sehingga pemanggil
      bisa menggantinya — urutan yang dipertahankan adalah yang diklaim kedua docblock.

      Empat berkas `src/lib/ui` lain melakukan fetch dengan kredensial same-origin dan
      sengaja TIDAK digabungkan: dua adalah baca GET, `language-switcher-client.ts` mem-POST
      secara ANONIM ke endpoint publik dan memutuskan lewat `response.ok` plus cookie, dan
      `push-subscription-client.ts` menampilkan `error.message` milik server — persis hal
      yang ditahan bentuk sempit itu.

      **Ia TIDAK memulihkan bita klien satu pun, dan klaim bahwa ia akan memulihkannya
      salah.** Kedua berkas sudah menjadi chunk bersama yang masing-masing dikirim sekali,
      jadi "tiga salinan bita" tak pernah benar — tiga salinan SUMBER yang dikirim sekali.
      "Penghematan" 425 B yang terukur saat bekerja berasal dari `dist/` yang belum
      dibersihkan build, dan ia membawa seluruh batch ini ke jalan yang salah:
      D12/D13/D14 diurutkan SEBELUM ADR-0106 demi membeli kelonggaran anggaran yang tidak
      ada, dan cabang ADR-0106 ternyata sejak awal berada di dalam pagu (191.733 B pada
      build bersih). `bun run build` kini menjalankan `rm -rf dist` lebih dulu, karena
      docblock `client-asset-budget.ts` sendiri sudah mencatat tertipu dengan cara ini dua
      kali dan memperingatkannya untuk ketiga kali pun tak akan berhasil.

  34. **D13 — `KEYSET_CURSOR_CREATED_AT_SQL` punya 3 pemakai dan 20 salinan inline tangan.**
      **SELESAI (22 Agustus 2026).** `_shared/keyset-pagination.ts:56-59`. Konstantanya
      mengeraskan `created_at` telanjang sementara docblock-nya sendiri menyuruh pemanggil
      "membungkusnya dalam alias tabel" — mustahil untuk sebuah string, jadi setiap kueri
      ber-join menulis salinannya sendiri.

      Kini `keysetCursorCreatedAtSql(alias?)` di atas `utcMicrosecondTextSql(column,
offsetSuffix)` bersama. **Salinannya dua puluh SATU, bukan dua puluh**: tiga lagi
      merender ekspresi yang sama untuk `occurred_at` dan `last_seen_at`, yang tak terlihat
      oleh pencarian `created_at` si audit, dan `idn_admin_regions` merendernya dengan
      akhiran `Z` untuk DTO alih-alih cursor. Semuanya hilang.

      Temuan menyebutnya prospektif dan memang begitu: setiap salinan benar byte. Itu tidak
      sama dengan aman — `AT TIME ZONE 'UTC'` dan `US` sama-sama senyap ketika salah, dan
      `US`→`MS` menghidupkan lagi #158 hanya setelah halaman satu. Sebuah tes kini menolak
      `to_char(… AT TIME ZONE 'UTC'` apa pun di luar modul pemiliknya, mencocokkan
      PERENDERANNYA alih-alih format string yang benar, karena suntingan yang salah satu
      karakter justru kasus yang ingin ditangkapnya. Ia dibuktikan GAGAL pada cacat asli.
      Rujukan kolomnya diasersi sebagai identifier, karena pemanggil menyerahkan hasilnya ke
      `tx.unsafe`.

  35. **D14 — selesaikan ekstraksi `scripts/lib/` yang sudah dimulai.**
      **SELESAI (22 Agustus 2026).** Tiga modul bersama, dan masing-masing menggantikan
      duplikasi yang sudah menghasilkan perbedaan yang tak seorang pun memilihnya.

      `lib/markdown-table.ts` — `extractBlock`/`replaceBlock` salinan identik byte;
      `parseInventoryRows` tidak. Satu sudah belajar soal escape `\|` karena tabelnya
      sendiri memuat shell pipeline; yang lain memecah pada `|` telanjang dan akan merobek
      sel itu. Versi sadar-escape adalah superset ketat, jadi tak berbiaya bagi pemanggil
      satunya.

      `lib/migrations.ts` — **enam** salinan pemuatnya (audit menemukan lima; `sql-grants.ts`
      punya yang keenam), dan asersi tidak-kosong hanya ada di satu. Setiap pemanggil
      bertanya "tabel mana yang ada, dan mana yang RLS-nya di-FORCE" — pertanyaan yang
      dijawab daftar kosong dengan "tidak ada" yang percaya diri dan salah. Kini ia
      meresolusi `sql/` dari akar repositori, yang hanya dilakukan salinan `sql-grants.ts`,
      sehingga tak ada gerbang yang bergantung pada dari mana ia dijalankan.

      `lib/table-rls-states.ts` — `deriveTableRlsStates` diekspor dari sebuah GENERATOR
      dokumentasi dan diimpor dua gerbang. Gerbang yang gagal karena sebuah generator
      dirapikan mengajari pembacanya bahwa gerbang itu rapuh, bukan bahwa kodenya salah.

      Kedua walker `catch { return; }` di `edge-cache-surfaces-check.ts` kini memakai walk
      bersama yang melempar pada root yang tak terbaca — untuk gerbang itu, call site purge
      yang terlewat berarti halaman lintas-tenant yang basi.

  36. **D15 — node `notify` workflow diam-diam tidak melakukan apa pun, dan kedua composition
      root membenarkannya dengan klaim palsu.** **SELESAI (22 Agustus 2026) — komentarnya,
      yang memang disebut temuan itu sebagai cacat hidupnya.**
      `workflow-notification-port-adapter.ts:18`
      nol pengimpor; dua rute menyebut modul `email` "belum di-port" — ia hidup dan memiliki
      adapternya.

      Adapter dan komentar itu saling menjadi alibi: rutenya menjelaskan wiring yang hilang
      dengan modul yang ada, dan kepala adapternya menyatakan "hanya composition root yang
      boleh mengimpor berkas ini", yang terbaca seolah ada yang mengimpornya. Keduanya
      dikoreksi, dan adapternya kini menyatakan tak ada yang mengimpornya.

      **Port-nya sengaja MASIH tidak disuntikkan.** Dipastikan sambil bekerja bahwa jalurnya
      tak terjangkau — `startWorkflowInstance` tak punya pemanggil dan tak ada rute yang
      membuat instance (`instances/[id].ts` hanya GET, plus cancel) — jadi menyuntikkannya
      akan menambah satu lagi hal yang dideklarasikan-dan-tak-pernah-jalan, dan akan
      menaruh enqueue announcement di dalam transaksi keputusan tanpa cara menguji
      kegagalannya. Pemicunya dinamai sebagai gantinya: suntikkan pada perubahan yang
      memberi pembuatan instance seorang pemanggil, tempat node `notify` benar-benar bisa
      diuji ujung ke ujung. Sebuah uji memaku ketiadaannya supaya perubahan itu harus
      melepas pakunya dengan sengaja.

  37. **D16 — keadaan siklus hidup orphan media tak terjangkau.** **SELESAI (22 Agustus 2026) — kode dihapus, skema dipertahankan.** `media-object-directory.ts:592`.
      `markNewsMediaObjectOrphaned` satu-satunya penulis `status='orphaned'` di repo dan
      punya nol pemanggil, sehingga sapuan stale-orphan, indeks parsialnya, dan
      `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` menjaga himpunan yang permanen kosong — dan setiap
      putaran mencetak `staleOrphaned(total=0,deleted=0,deferred=0)`, yang terbaca persis
      seperti bucket bersih. Ia peninggalan model pra-ADR-0036: `sql/087` menghapus relasi
      attach/detach, jadi tak ada hitungan rujukan untuk menurunkan "orphaned" DARINYA.

      Yang hilang: penulisnya, `markStaleOrphanedNewsMediaObjectDeleted`, jalur
      `cleanupStaleOrphaned` (yang docblock-nya menalar hati-hati tentang balapan yang tak
      mungkin terjadi), kategori `staleOrphaned`, dan tiga penghitung job itu.

      **Satu koreksi atas temuannya, dan ini penting:
      `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` TIDAK mati** dan tidak dihapus. `orphanInR2` —
      objek R2 yang sama sekali tak punya baris DB — benar-benar memakainya untuk
      memutuskan kapan penghapusan fisik aman. Menghapusnya bersama sisanya akan mencabut
      sebuah kontrol hidup.

      Dipertahankan sesuai keputusan: nilai CHECK `'orphaned'`, `orphaned_at`, indeks
      parsialnya, dan KEDUA filter status (layar admin dan API). Keduanya adalah baca atas
      kolom yang masih bisa menampung nilai itu, dan membuang salah satunya akan membuat
      dua permukaan berselisih tentang kolom yang sama.
      `isNewsMediaObjectSafeForPublicReference` tetap menolak status itu, jadi baris yang
      mencapainya secara manual tetap dijauhkan dari rujukan publik.

  38. **D17 — homepage section dan ad placement tidak punya permukaan baca yang sadar
      kelayakan.** **SELESAI (22 Agustus 2026) — bagian sempitnya, yang memang seluruh
      isi kekurangannya.** Ketiga helper rendering bernol pemanggil adalah **penangguhan
      bertanda tangan** (ADR-0071 memindahkan rendering berita publik ke `awcms-astro`)
      dan tetap ditangguhkan.

      Celah yang sebenarnya ditutup: `AdPlacementItem` kini membawa `mediaPublicUrl`,
      `mediaAltText`, dan `mediaPubliclyReferenceable`, ketiganya wajib. Yang terakhir
      itulah intinya — ia VONIS server, bukan status untuk ditafsirkan, karena
      `isNewsMediaObjectSafeForPublicReference` bergantung pada keadaan siklus hidup mana
      yang dihitung terverifikasi dan konsumen yang mengimplementasikannya ulang salah ke
      arah PERMISIF, yang berarti menerbitkan gambar tak terverifikasi. `false` juga
      mencakup objek yang di-soft-delete, jadi konsumen yang hanya memeriksa field ini pun
      tak bisa merendernya.

      Diresolusi dalam kueri yang sama di setiap jalur: `LEFT JOIN` dengan predikat media
      di klausa `ON`, sehingga placement yang objeknya di-soft-delete tetap muncul di
      daftar admin alih-alih lenyap dari satu-satunya layar yang bisa memperbaikinya, dan
      CTE ber-DML pada create/update sehingga iklan yang baru dibuat tidak dilaporkan tak
      dapat dirujuk. Tanpa N+1 dan tanpa endpoint kedua. `/admin/blog-ads` kini menyatakan
      apakah gambar terlampirnya benar-benar akan ditampilkan.

  ### Sengaja TIDAK direkomendasikan (dicatat agar pertanyaannya tak dibuka ulang buta)
  - **Membuat `/api/v1/health` sadar dependensi.** Ia sengaja tidak memanggil DB dan tiga
    dokumen menyatakannya. Probe liveness yang bergantung DB mengubah kedipan Postgres
    menjadi loop restart dan membuat Varnish menandai satu-satunya backend-nya sakit.
    Perubahan yang benar adalah D10.
  - **Membangun renderer homepage-section / iklan publik di sini.** ADR-0071 memindahkan
    rendering berita publik ke `awcms-astro`, dan `ad-placement-directory.ts:309-312`
    mencatat penangguhannya di dalam sumber. Menulisnya di sini akan menciptakan ulang
    permukaan yang dihapus ADR itu.
  - **Konsolidasi penuh 17 penelusur direktori.** `scripts/lib/repo-files.ts` sudah ada dan
    enam skrip sudah dipindah; pemicu yang dituduhkan tidak terjangkau lewat `bun run`
    (terverifikasi). Ganti kedua penelusur `catch { return; }` (dilipat ke D14) lalu
    berhenti.

  ### Yang TIDAK diperiksa putaran ini

  Tidak ada database hidup (tanpa `EXPLAIN`, tanpa job dijalankan, tanpa request
  lintas-tenant). Pohon `tests/` tidak diaudit untuk cakupan atau duplikasinya sendiri —
  beberapa temuan bersandar pada "tak ada tes yang akan melihat ini" tanpa itu
  diverifikasi. Isi `sql/` hanya dibaca yang ditarget (007, 009, 011, 035, 041, 050, 087,
  090, 117); perilaku kunci migrasi 001–128 tidak ditinjau. Internal `theming`,
  `site-search`, `comments`, `push-delivery`, dan `visitor-analytics` diperiksa hanya pada
  tingkat deskriptor + nol-pemanggil. Tidak dibaca baris-per-baris:
  `security/turnstile.ts`, blocklist IP di `ssrf-guard.ts`, self-registration dan
  penerimaan undangan, serta internal JWT/JWKS OIDC. Ke-42 layar admin `.astro` tidak
  diukur untuk jumlah query kumulatif per render — B1/B4 hanya berjangkar pada
  `/admin/blog` dan layout-nya. Dikecualikan karena sudah terlacak:
  `SYNC_HMAC_ALLOW_LEGACY` (GHSA-c972-3q5p-g3h4), MFA/SSO/Turnstile mati di produksi,
  ketiadaan crontab `edge-cache:purge`, dan item Varnish/s-maxage/asset-budget di bawah.

- **DIPUTUSKAN 22 Agustus 2026 — enam tag git pra-model TETAP ADA, dikecualikan.**
  Pemelihara memilih opsi 1 di bawah. Tidak ada yang berubah di repositori: keenam nama
  tetap di `LEGACY_UNPREFIXED_TAGS`, `bun run version:check` tetap menahan setiap tag yang
  dipotong sejak `v5.1.0` pada modelnya, dan halaman Releases tetap menampilkan `3.0.0` di
  samping `v3.0.0`. Alasan yang memutuskannya adalah alasan `release-process.md`
  §Rollback: konsumen yang sudah menarik tag terbit kehilangan kemampuan mendiagnosis apa
  yang ia pegang saat tag itu hilang, dan ongkos itu dibayar orang yang tidak ada di
  percakapan ini. Dicatat di sini supaya pertanyaannya tidak dibuka ulang tanpa konteks.

  Entri aslinya, disimpan karena argumennya:

- **KEPUTUSAN TERBUKA (DIGANTIKAN) — 17 Agustus 2026: enam tag git pra-model.** `bun run version:check`
  (gerbang 52) kini memegang model `vX.Y.Z` di setiap commit, dan ia mengecualikan enam tag
  bernama persis: `2.9.9`, `2.12.0`, `3.0.0`, `3.1.0`, `4.3.1`, `4.5.0`. Keenamnya mendahului
  rebuild (ADR-0024); `3.0.0` duduk di commit `b23d3308` berdampingan dengan `v3.0.0`, satu
  rilis dengan dua nama. Setiap tag yang dipotong sejak `v5.1.0` (16 Juli 2026) sudah patuh
  — 15 dari 15.

  **Sengaja DIBIARKAN, menunggu keputusan yang merupakan hak maintainer.** Menghapus tag
  yang sudah terbit itu menghadap keluar dan tak bisa dibatalkan: `release-process.md`
  §Rollback sudah berargumen menolak penghapusan tag terbit dengan alasan konsumen yang
  sudah menariknya kehilangan kemampuan mendiagnosis apa yang mereka punya, dan keenamnya
  terlihat di halaman GitHub Releases sebagai entri Pre-release basis kode lama.

  Dua opsi, keduanya bisa dipertahankan:
  1. **Pertahankan, dengan pengecualian** (keadaan saat ini). Biayanya: halaman Releases
     tetap menampilkan dua ejaan, dan pembaca yang membandingkan `3.0.0` dengan `v3.0.0`
     tidak bisa tahu keduanya satu rilis tanpa membaca ADR-0024.
  2. **Hapus keenamnya** (`git push origin :refs/tags/<nama>`), mempertahankan `v3.0.0`
     berprefiks yang sudah menutupi duplikatnya. `2.9.9`, `2.12.0`, `3.1.0`, `4.3.1`, dan
     `4.5.0` TIDAK punya kembaran ber-`v`, sehingga menghapusnya mengeluarkan rilis itu
     dari namespace tag sepenuhnya — itulah sebabnya ini bukan bersih-bersih yang boleh
     dilakukan diam-diam. Sesudahnya `LEGACY_UNPREFIXED_TAGS` menyusut ke sisanya, dan
     gerbangnya tetap bekerja.

  **Tidak direkomendasikan: menulis ulang mereka menjadi tag berprefiks `v`.** Men-tag ulang
  commit yang sama dengan nama baru akan menyajikan lima rilis seolah-olah mereka selalu
  mengikuti model yang baru diperkenalkan setahun kemudian, dan digest image serta
  attestation yang terbit atas nama lama akan tetap menunjuk byte yang tidak lagi ditunjuk
  nama-nama itu.

- **PUTARAN REKOMENDASI — 15 Agustus 2026, diturunkan dari repo + produksi v9.1.2
  yang SEDANG BERJALAN.** Tiap temuan di bawah punya bukti yang dijalankan, bukan
  dibaca. Yang tidak terverifikasi ditandai TERDUGA.

  ### P0 — sedang menyebabkan kehilangan senyap SEKARANG
  1. **31 dari 32 target job TIDAK PERNAH berjalan di produksi.** `crontab -l` di
     `dinkes-prod` hanya memuat satu: `email:dispatch` tiap 5 menit. Ini BUKAN
     pengulangan catatan "image produksi tak bisa menjalankan job" — mitigasi
     `run-job.sh` sudah ada dan bekerja; yang tidak ada adalah **jadwalnya**.

     Akibat yang bisa dinamai, bukan abstrak: `blog:publish:scheduled` (post
     terjadwal tak pernah terbit), `domain-events:dispatch` (outbox tak pernah
     terkuras → integrasi mati diam), `push:dispatch` (seluruh modul
     push_delivery inert), `reporting:projections:refresh` (laporan basi),
     `site-search:reconcile` (indeks melenceng), `workflow:escalations:dispatch`
     (eskalasi approval tak pernah jalan), `tenant-domain:dns:sync`, dan
     **seluruh keluarga retensi** (`logs:audit:purge`, `analytics:purge`,
     `comments:retention`, `data-lifecycle:archive-purge`, `*:queue:purge`) —
     yang berarti klaim retensi ADR-0094 tidak ditegakkan oleh apa pun.

     Perbaikan benar sudah dinamai dokumen ini: stage `jobs` di
     `Dockerfile.production` yang diterbitkan `release.yml`, lalu satu timer per
     job sesuai `recommendedSchedule` di deskriptornya. Sampai itu ada, minimal
     daftarkan cron untuk enam job berdampak-tertinggi di atas.

  2. **`identity-access:business-scope:expiry` dan
     `identity-access:subscription-lifecycle` termasuk yang tidak berjalan —
     jadi AKSES HIDUP LEBIH LAMA DARI MASA BERLAKUNYA.** Ini bagian keamanan dari
     temuan 1 dan layak dinaikkan sendiri: kedaluwarsa yang tidak dieksekusi
     tidak terlihat seperti kegagalan, ia terlihat seperti akses yang sah.

  3. **NOL backup terjadwal.** `scheduled_database_backups` Coolify kosong; tiap
     backup yang ada diambil tangan (yang terbaru: `awcms-pre-128-20260814`,
     diverifikasi `pg_restore -l`, 1.549 objek). Host ini SUDAH punya polanya
     untuk `hermes`: backup harian + push ke maxio + verifikasi mingguan. Salin
     pola itu untuk `awcms`, termasuk **uji restore**, karena backup yang tak
     pernah dipulihkan adalah dugaan, bukan cadangan.

  ### P1 — cacat yang KELUARANNYA sudah salah di produksi
  4. **`url.origin` aplikasi memakai skema `http` di situs `https`, dan itu
     BOCOR ke keluaran.** Terverifikasi: `curl https://…/blog/ahliweb/feed.xml`
     mengembalikan `<link>http://awcms.ahlikoding.com/…</link>` untuk tiap entri.

     > **KOREKSI (15 Agu 2026) — buktinya salah, dan angkanya juga.** Putaran ini
     > semula menyimpulkan bahwa canonical HTML "kebetulan benar (`https`) karena
     > dibangun dari jalur lain — jadi ini juga bukti bahwa asal URL absolut di
     > repo ini ADA DUA". **Bukti itu tidak sah.** `canonical` dan `og:url` pada
     > halaman yang sama keduanya dibangun dari SATU variabel
     > (`options.canonicalUrl`, `blog-content/domain/public-page-rendering.ts`
     > baris 118 dan 177), dan keduanya `http` saat meninggalkan origin. Yang
     > membuat canonical tampak benar adalah **Cloudflare Automatic HTTPS
     > Rewrites**, yang menambal atribut `href`/`src` pada HTML yang lewat —
     > sedangkan `og:url` memakai atribut `content`, yang tidak ia sentuh. Jadi
     > pasangan itu bukan bukti dua sumber; ia satu sumber yang salah di
     > kedua tempat, tertutupi pada satu tag oleh perantara yang tidak kita
     > kendalikan.
     >
     > Kesimpulannya sendiri ternyata **terlalu kecil, bukan terlalu besar**.
     > Inventarisasi lengkap menemukan **TIGA** sumber asal, bukan dua:
     >
     > - **A — `url.origin`**: 6 berkas `src/pages/blog/[tenantCode]/**`
     >   (canonical, `og:url`, JSON-LD `@id`, tautan berbagi sosial, feed, dan
     >   sitemap blog). Skemanya `http` di produksi dan host-nya adalah host
     >   PERMINTAAN, bukan host tenant.
     > - **B — literal `https://${primaryHost}`**: seluruh `seo_distribution`
     >   (robots, sitemap akar, feed akar, redirect legacy). Skemanya benar dan
     >   host-nya dari basis data.
     > - **C — `process.env.APP_URL`** (fallback `http://localhost:4321`):
     >   `redirect_uri` OIDC, tautan reset kata sandi, tautan undangan, dan
     >   tautan persetujuan pendaftaran — yakni permukaan yang paling mahal bila
     >   salah, karena ia dikirim lewat email dan diklik nanti.
     >
     > Ditambah dua deklarasi asal yang MATI tetapi menyesatkan pembaca
     > berikutnya: `astro.config.mjs` `site: "http://localhost:4321"` dan
     > `openapi/awcms-public-api.src.yaml` `servers[0].url` yang sama. Dan
     > `renderResourceSeoHead` — perender canonical/`og:url` yang dimaksudkan
     > sebagai PUSAT — **nol pemanggil**: jalur yang benar sudah ditulis, tidak
     > pernah disambungkan, dan jalur yang salah yang melayani produksi.

     Sebabnya: adapter Node menurunkan protokol dari listener-nya sendiri, dan
     TIDAK ADA satu pun tempat di repo ini yang membaca `X-Forwarded-Proto`.
     Ia juga akar dari kelas cacat yang memakan v9.1.1 (`checkOrigin` menolak
     tiap form POST asli). Perbaikan: SATU sumber asal-situs (turunkan dari
     `APP_URL`, atau hormati `X-Forwarded-Proto` saat `TRUSTED_PROXY_ENABLED`),
     lalu arahkan semua pembangun URL absolut ke sana.

  5. **`/admin/account` menawarkan pendaftaran MFA sementara `AUTH_MFA_ENABLED`
     tidak `true` di produksi.** Halaman itu bercabang pada `account.mfa.enabled`
     (status ENROLMEN pengguna), bukan pada `isMfaFeatureEnabled` (saklar
     DEPLOYMENT). Jadi tombolnya tampil dan endpoint-nya menolak — persis "fake
     affordance" yang dikutuk komentar `LanguageSwitcher` sendiri. TERDUGA pada
     penolakan endpoint-nya (butuh sesi untuk dijalankan); percabangan UI-nya
     terbaca langsung di sumber. Berlaku sama untuk seksi SSO
     (`AUTH_SSO_ENABLED` juga tidak `true`).

  6. **Permukaan publik yang hilang:** `/news/`, `/sitemap.xml`, dan `/rss.xml`
     semuanya **404** di produksi, sementara `/blog/{tenantCode}` dan
     `/blog/{tenantCode}/feed.xml` **200**. Untuk sebuah CMS, ketiadaan
     `sitemap.xml` adalah lubang distribusi, bukan kosmetik. Putuskan bentuk URL
     publik yang kanonik lebih dulu — ini bertetangga dengan pekerjaan locale
     publik yang sudah terblokir di butir kunci-cache.

  ### P2 — arsitektur
  7. **Dua kelas kegagalan HANYA-PRODUKSI kini terbukti, dan tak satu pun punya
     gerbang sebelum 14 Agustus:** (a) `checkOrigin` Astro vs proxy pengakhir
     TLS, (b) Astro me-inline script tanpa import lintas-chunk sehingga CSP
     menolaknya. Keduanya lolos 47 gerbang dan 4.375 test. `tests/form-post-origin-check.test.ts`
     menutup keduanya untuk komponen ITU; yang belum ada adalah gerbang
     ARTEFAK-BUILD yang umum: "tak boleh ada script inline selain hash
     theme-init". Itu satu pemeriksaan atas `dist/`, dan ia akan menangkap
     seluruh kelasnya, bukan satu contohnya.

  8. **Uji asap yang berbicara HTTPS.** Playwright, dev, dan `bun run build`
     semuanya bicara HTTP polos ke app, dan itulah sebabnya kedua cacat di atas
     tak terlihat. Satu skenario di belakang reverse-proxy pengakhir TLS
     (sekadar Traefik/Caddy di depan `dist/`) akan menemukan keduanya dalam
     hitungan detik.

  ### P3 — performa
  9. **Varnish SEHAT — dan cara mengukurnya penting.** Diukur DI container
     Varnish: `MISS` → `HIT` → `HIT` dengan `Age` menaik. Diukur lewat
     Cloudflare ia tampak `DYNAMIC` selamanya, karena origin hanya mengirim
     `Surrogate-Control` (yang dimengerti Varnish) dan `max-age=0,
must-revalidate` untuk browser. **Jangan** menyimpulkan cache mati dari
     header Cloudflare — `environments.md` §celah C14 sudah mengatakannya, dan
     pengukuran pertama saya hari ini melanggarnya.

  10. **Cloudflare karena itu tidak meng-cache APA PUN** (hanya TLS + kompresi).
      Menambah `s-maxage` akan mengubahnya, tetapi HANYA aman bila antrean purge
      juga menjangkau API zona CF — hari ini tidak. Satu paket, atau jangan
      sama sekali; separuhnya menyajikan konten basi.

  11. **Plafon aset klien terpakai 94%** (168.759 B dari 180.000 B). Bukan
      masalah hari ini, tetapi headroom-nya tipis untuk satu layar baru. Naikkan
      dengan alasan tertulis, atau pangkas.

  ### P4 — keamanan
  12. **`COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` tidak diset** (satu-satunya
      kegagalan `security:readiness`, tingkat warning, 0 critical). Ia gagal
      TERTUTUP — tak ada alamat plaintext yang tertulis — tetapi berarti
      notifikasi balasan tak bisa dikirim. Set, atau matikan fiturnya secara
      eksplisit supaya keadaannya dinyatakan.

  13. **MFA, SSO, dan Turnstile semuanya mati di produksi** meski ketiganya
      sudah dibangun dan diuji. Untuk permukaan admin yang memegang hak owner,
      MFA yang mati adalah paparan yang layak diputuskan secara sadar dan
      dicatat, bukan diwariskan dari default.

  ### P5 — kemampuan men-debug
  14. **Fondasinya ada, hilirnya tidak.** `correlationId` dipropagasi, log
      terstruktur JSON, `setLogSink` tersedia sebagai titik ekstensi — tetapi
      tidak ada sink yang dikonfigurasi, jadi log berhenti di stdout container
      dan LENYAP saat tiap deploy mengganti container. Kirim keluar host (host
      ini sudah melakukannya untuk `hermes`).

  15. **Tidak ada alarm laju-error, dan itu terbukti mahal.** Pengalih bahasa
      menjawab 403 untuk SETIAP pengguna selama berjam-jam dan tidak ada yang
      memberi tahu siapa pun; ia ditemukan hanya karena saya meng-`curl` satu
      permukaan yang baru saja saya kirim. Satu pemeriksaan sintetik pada dua
      atau tiga alur inti akan menangkapnya.

  ### HASIL PUTARAN — 15 Agustus 2026

  Sebelas dari lima belas TERTUTUP. Metodenya satu: **jalankan, jangan dibaca.**
  Menjalankan ke-23 job dengan `--dry-run` terhadap produksi menemukan dua cacat
  yang TIDAK dilihat gerbang mana pun, dan membaca `dist/` menemukan yang ketiga.

  | #         | Keadaan                                                                                                 | Bukti                                                                          |
  | --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
  | 1, 2      | TUTUP — jadwal jadi DATA (`ModuleJobSchedule`), `ops/awcms-jobs.crontab` ter-generate, 23 job terpasang | `crontab -l` = 23 baris; gerbang `jobs:crontab:check` menolak job tanpa jadwal |
  | 3         | TUTUP — backup harian ber-verifikasi + gladi restore mingguan                                           | backup 1.556 objek; gladi memulihkan 148 tabel / 128 migrasi / 1 tenant        |
  | 4         | TUTUP — satu sumber asal-situs + gerbang `site-origin:check`                                            | dan KOREKSI di atas: sumbernya TIGA, bukan dua                                 |
  | 5         | TUTUP — `/admin/account` bercabang pada saklar DEPLOYMENT, bukan hanya enrolmen                         |                                                                                |
  | 6         | **TERDIAGNOSIS, bukan diperbaiki — dan ia BUKAN fitur yang hilang**                                     | lihat di bawah                                                                 |
  | 7         | TUTUP — `build:inline-scripts:check` membaca manifes terbangun                                          | menemukan INSTANS KETIGA: `ThemeToggle` inert di produksi berminggu-minggu     |
  | 8         | DITUTUP — `tests/tls-terminating-proxy.test.ts` mendirikan proxy TLS nyata di depan origin HTTP polos   | mengembalikan resolver ke `url.protocol` telanjang memerahkan 3 skenarionya    |
  | 9, 10, 11 | KEPUTUSAN, bukan cacat                                                                                  | Varnish sehat; `s-maxage` tetap terblokir antrean purge CF; plafon aset 94%    |
  | 12, 13    | KEPUTUSAN — lihat di bawah                                                                              |                                                                                |
  | 14        | TUTUP — log SELAMAT dari deploy (`ops/ship-logs.sh`, per menit, re-attach saat container berganti)      |                                                                                |
  | 15        | TUTUP — `ops/synthetic-check.sh` tiap 10 menit, alarm sekali saat gagal dan sekali saat pulih           | **ia menangkap cacat asal-situs yang MASIH HIDUP pada jalannya yang pertama**  |

  **Dua cacat baru, keduanya ditemukan dengan menjalankan job:**

  - `data-lifecycle:archive-purge` **tidak bisa jalan sama sekali** —
    `permission denied` pada `awcms_delegated_access_grants` dan
    `awcms_subject_requests`. Bukan "tidak terjadwal" melainkan "tidak akan
    bekerja". Retensi ADR-0094 ditegakkan oleh NOL untuk dua tabel itu.
    `sql/129` + gerbang `data-lifecycle:worker-grants:check` menutup KELASNYA.
  - `domain-events:deliveries:purge` sama, pada `awcms_domain_event_replays` —
    dan gerbang baru itu **tidak** menangkapnya, karena tabel itu hanya DIBACA
    oleh job `delegated` dan tak punya deskriptor. Celah itu DICATAT, bukan
    ditutup-tutupi: yang menemukannya adalah menjalankan ke-23 job.

  **Butir 6 — permukaan publik 404 adalah KONFIGURASI, bukan kode.** Tiga fakta,
  semuanya terverifikasi:

  1. `awcms_tenant_domains` hanya punya SATU baris, dan itu host LAIN
     (`coba.ahlikoding.com`), `is_primary = false`, `status =
pending_verification`.
  2. Maka `resolveTenantPrimaryHost` mengembalikan `null`, dan
     `sitemap.xml`/`feed.xml`/`rss.xml` **404 sesuai desain** (fail-closed, tak
     pernah mengarang host). `robots.txt` 200 tanpa baris `Sitemap:` — persis
     yang dijanjikan degradasinya.
  3. `PUBLIC_TENANT_RESOLUTION_MODE` TIDAK diset, jadi rute host-resolved
     (`/news/**`) tidak pernah menyelesaikan tenant.

  Memperbaikinya berarti mendaftarkan domain primer dan menyalakan resolusi
  host — yang MENGUBAH bentuk URL publik. Rekomendasi ini sendiri mensyaratkan
  keputusan itu diambil lebih dulu, jadi ia tetap keputusan.

  **Yang MENUNGGU keputusan pemilik repo, bukan pekerjaan yang tertinggal:**

  - **MFA, SSO, Turnstile mati** (#13). Menyalakan MFA mengubah login untuk
    semua orang; itu postur keamanan yang layak diputuskan sadar dan dicatat.
  - **`COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` tak diset** (#12). Ia gagal TERTUTUP
    (tak ada alamat plaintext); menyalakannya MENGAKTIFKAN notifikasi balasan,
    yaitu email keluar. Set kunci, atau nyatakan fiturnya mati.
  - **`s-maxage` Cloudflare** (#10). Tetap terblokir: antrean purge tidak
    menjangkau API zona CF. Satu paket atau tidak sama sekali.
  - **Plafon aset 94%** (#11). Naikkan dengan alasan tertulis, atau pangkas.

- **i18n (ADR-0095) dan permukaan akun (ADR-0096) — apa yang SUDAH mendarat,
  dan apa yang persis tersisa. 14 Agustus 2026.**

  **Mendarat:** fondasi i18n (katalog gettext `locales/en.po` + `id.po` yang
  DIKOMPILASI ke `src/lib/i18n/catalogs/*.generated.ts` sehingga ikut ke
  `dist/`), resolusi locale di middleware, `LanguageSwitcher` yang benar-benar
  bekerja (menggantikan `LocaleBadge` yang mati), preferensi bahasa + tema
  per-PRINCIPAL (`sql/128`), dan `/admin/account` yang akhirnya memberi
  permukaan pada 17 endpoint self-service yang sebelumnya hanya bisa `curl`.

  **Angka yang tersisa, semuanya ber-ledger yang hanya boleh MENYUSUT:**

  | Ledger                                               | Sekarang         | Artinya                                                |
  | ---------------------------------------------------- | ---------------- | ------------------------------------------------------ |
  | `i18n:screens:check`                                 | **0** (dulu 18)  | layar yang masih merender literal template Inggris     |
  | `MAX_UNTRANSLATED_ID_ENTRIES` (`i18n:catalog:check`) | **0** (dulu 718) | msgid dideklarasikan tetapi `msgstr` `id` masih kosong |

  **Langkah 1 DITUTUP — 718 → 0, dan angkanya menyembunyikan satu cacat. 15 Agustus 2026.**

  Seluruh 1.258 msgid kini punya terjemahan Indonesia. Yang ditemukan pass ini
  lebih berharga daripada angkanya: **delapan belas msgid ternyata SUDAH
  berbahasa Indonesia** — msgid-nya SENDIRI, di `en.po`, berkas yang oleh
  ADR-0097 disebut sumber bahasa Inggris. `/admin/blog-settings` adalah semuanya:
  migrasi `t()` massal di layar itu membungkus literal Indonesia yang sudah ada
  alih-alih menerjemahkannya lebih dulu.

  Karena `en.po` memakai fallback identitas gettext (`msgstr ""` → msgid ITULAH
  keluarannya), **pembaca Inggris mendapat layar berbahasa Indonesia**, sementara
  pembaca Indonesia mendapat halaman yang sama secara KEBETULAN — jatuh kembali
  ke msgid yang kebetulan bahasanya. Dua string lain (`Tersimpan.` dan sebuah
  pesan gagal simpan) di-hardcode di script klien, berbahasa Indonesia di _setiap_
  locale tanpa ada yang mendeklarasikannya.

  Kedua locale merender sesuatu yang masuk akal, jadi tidak ada gerbang maupun
  tinjauan tangkapan layar yang bisa menangkapnya. Satu-satunya artefak yang
  tidak sepakat adalah penghitung entri belum-diterjemahkan — dan itu pun baru
  setelah ada yang MEMBACA string yang dihitungnya. Itulah alasan sebuah ledger
  dipertahankan di 0, bukan dihapus.

  Sebuah cek kelima kini menjaga kelas yang tak bisa dilihat ledger:
  `i18n:catalog:check` menegakkan **paritas placeholder** — setiap `{name}` di
  msgid bertahan sampai ke terjemahannya, dan tidak ada yang diada-adakan.
  `{days}` yang hilang terbaca sempurna sambil kehilangan angkanya; yang
  diada-adakan dicetak apa adanya oleh `interpolate()`. Dibuktikan pada kedua
  bentuknya, bukan sekadar hijau.

  **Langkah 2 DITUTUP — 18 layar → 0, dan gerbangnya tidak bisa melihat
  sepertiga pekerjaannya. 15 Agustus 2026.**

  Ke-23 literal ber-ledger itu adalah kelas kalimat-terbelah, digabungkan jadi
  msgid utuh ber-placeholder. Dua ongkos layak dicatat karena penggabungan
  berikutnya akan membayarnya lagi: `t()` mengembalikan STRING, jadi
  `<code>`/`<strong>` di sekeliling placeholder hilang (pertahankan `<a>`
  sungguhan sebagai label tersendiri alih-alih melipat tautan ke dalam kalimat);
  dan bila nilai yang disisipkan OPSIONAL, satu msgid `{code}` akan merender
  "tenant platform ()" — bentuk itu butuh DUA msgid utuh, satu per cabang.

  **Yang tidak dihitung ledger, dan tak ada yang akan menghitungnya:** pemindai
  hanya membaca teks template yang mengikuti sebuah TAG. Teks setelah EKSPRESI —
  `<caption>{roles.length} role(s)</caption>` — tidak terlihat. Sembilan belas
  string seperti itu ditemukan dengan tangan di 15 layar yang sudah disebut
  selesai oleh gerbangnya, semuanya merender bahasa Inggris kepada pembaca
  Indonesia. Semuanya diperbaiki (caption `{n} thing(s)` menjadi plural `tn()`
  sungguhan — sekaligus pemakaian pertama jalur plural lewat perjalanan
  bolak-balik `.po`). PEMINDAINYA tetap tidak bisa melihat kelas ini:
  melebarkannya akan mulai menangkap template literal dan ternary berantai
  sebagai prosa, yaitu kegagalan false-positive yang ditahan `CODE_SHAPED`, jadi
  pelebaran itu jadi perubahan tersendiri dengan mutation test-nya sendiri.
  Sampai saat itu, ledger kosong berarti "tidak ada teks tak-diterjemahkan
  setelah sebuah tag", yang lebih sempit daripada "tidak ada yang
  tak-diterjemahkan" — batasannya ditulis di header gerbangnya, bukan
  ditinggalkan untuk ditemukan pembaca berikutnya.

  **Dan gerbang katalog buta terhadap 86 msgid.** Pemanen literalnya
  mengecualikan string apa pun yang memuat backslash, sedangkan prettier menulis
  ulang em dash di dalam `t()` menjadi `\u2014` — sehingga msgid terpanjang dan
  paling mirip prosa tidak pernah DIWAJIBKAN ada. Akibatnya: `users.astro`
  memanggil `t()` pada kalimat yang tidak dideklarasikan di katalog mana pun,
  merender bahasa Inggris di setiap locale, sementara kedua ledger membaca 0.
  Pemanennya kini mendekode escape; dibuktikan dengan menghapus satu msgid
  ber-escape lalu melihat pola lama meloloskannya diam-diam.

  **Langkah 3 dan 5 sudah DIPUTUSKAN — [ADR-0098](adr/0098-the-cache-key-carries-the-locale-in-the-path.id.md)
  dan [ADR-0099](adr/0099-changing-the-login-address-is-account-recovery.id.md),
  15 Agustus 2026. Keduanya `Accepted (belum diimplementasikan)`, terikat pada
  artefak yang dijanjikannya oleh `tests/adr-implementation-status.test.ts`.**

  **Langkah 3 — locale masuk ke PATH, dan kunci cache tidak disentuh.**
  `Vary: Cookie` melipatgandakan objek cache menurut banyaknya string cookie
  berbeda dan memasukkan header pembawa kredensial ke kuncinya; `Vary:
Accept-Language` membatasi fan-out pada dua tetapi tak bisa melihat klik
  eksplisit, yang akan menjadikan pengalih bahasa dekoratif tepat di permukaan
  yang dilihat paling banyak pembaca. `/en/…` dan `/id/…` sudah menjadi objek
  berbeda di bawah kunci yang ada, jadi hit rate tidak berubah dan tidak ada
  header request yang masuk ke kunci sama sekali. Pemilihannya lewat 307
  ber-`private, no-store`, jadi cookie dihormati tanpa pernah mencapai cache.

  **Langkah 5 — alamat login ADALAH akun itu, jadi alurnya dibangun seperti
  pemulihan.** Kedua alamat dibuktikan secara berbeda: yang baru lewat token
  sekali pakai, berumur pendek, di-hash, dan TERIKAT; yang lama diberi tahu
  dengan tautan batal yang berlaku LEBIH LAMA daripada jendela konfirmasi,
  karena pemberitahuan itulah satu-satunya bagian desain yang menolong orang
  yang sudah dikompromikan. Otentikasi ulang yang segar diwajibkan (sesi saja
  bukan wewenang untuk memindahkan kanal pemulihan), konfirmasi mencabut setiap
  sesi lain dan setiap token reset yang beredar, dan keunikan diperiksa saat
  konfirmasi agar formulirnya bukan orakel keberadaan akun.

  3. **Langkah 3 DITUTUP — locale ada di PATH, ADR-0098 kini `Accepted`.
     15 Agustus 2026.**

  `src/lib/i18n/public-locale-path.ts` adalah keputusan itu dijadikan eksekutabel:
  sebuah path masuk, sebuah keputusan routing keluar, dan ia tidak bisa membaca
  header apa pun. `/blog/…` menjawab `307 private, no-store` ke `/en/…` atau
  `/id/…`; URL ber-prefiks di-rewrite kembali ke rute yang sudah ada, jadi tidak
  ada pohon halaman `[locale]` yang diduplikasi. Pada URL ber-prefiks, PATH-lah
  yang menetapkan `locals.locale` dan ia MENGALAHKAN cookie — inversi itulah
  seluruh properti keamanannya, karena URL adalah kunci cache dan kuncilah yang
  harus menentukan badannya.

  Tiga hal layak dibawa ke depan. **Prefiks hanya untuk HTML yang CACHEABLE**,
  bukan untuk setiap URL publik: `/admin`, `/login`, dan `/blog/{t}/search`
  bersifat `private, no-store` dan melokalkan dari cookie persis seperti yang
  diizinkan ADR-0098 keputusan 6 untuk `/admin`, jadi memberi mereka prefiks
  hanya menambah satu redirect tanpa membeli apa pun; `robots.txt` terpaku pada
  lokasi protokolnya dan feed sudah membawa `?locale=`, yang merupakan kunci yang
  sama dengan ejaan berbeda. **`matchPublicCacheSurface` butuh percobaan
  pencocokan KEDUA** atau setiap URL ber-prefiks akan meleset dari registry dan
  distempel tidak-cacheable — ADR-nya akan memindahkan locale ke dalam kunci
  sambil mematikan cacheability seluruh permukaan publik, regresi yang terbaca
  sebagai bug caching alih-alih bug routing. Dan **sitemap harus ikut pindah
  bersama canonical**: `<loc>` yang menyebut path telanjang sementara
  `<link rel="canonical">` halamannya menyebut yang ber-prefiks adalah
  ketidaksepakatan yang diselesaikan mesin pencari dengan tidak mempercayai
  keduanya.

  Keputusan 2 ditegakkan dua kali, bukan didokumentasikan sekali.
  `decideCacheability` MENOLAK respons yang `Vary` pada `Cookie` atau
  `Accept-Language` (menolak, bukan membuang — membuangnya berarti meng-cache
  badan yang penulisnya sendiri bilang bervariasi), dan
  `edge-cache:surfaces:check` menggagalkan build atas dua nama yang sama di mana
  pun di bawah `src/`. Keduanya dibuktikan dengan MENANAM cacatnya: tiga ejaan
  `Vary` terlarang, satu machine surface yang diberi alias ber-prefiks, dan satu
  flag `localePrefixed` yang dibalik sehingga tidak lagi sepakat dengan pola
  path-nya.

  Yang masih terbuka di belakangnya: field konten multi-bahasa untuk
  `blog_content` (bahasa antarmuka pembaca dan bahasa POST-nya adalah dua sumbu
  berbeda — `<html lang>` masih berasal dari `post.locale`), dan chrome publiknya
  sendiri belum diterjemahkan, jadi `/en/…` dan `/id/…` hari ini hanya berbeda
  pada `hreflang` dan canonical-nya.

  **Langkah 4 DITUTUP — `awcms_principal_preferences.time_zone`, sql/130.
  15 Agustus 2026.**

  `/admin/account` merender setiap stempel waktu dalam zona pilihan pembacanya,
  dan fallback-nya tetap UTC alih-alih zona host — alasan aslinya ("menebak zona
  server akan membuat 'terakhir dilihat' salah tanpa ada yang bisa
  mendeteksinya") justru itulah sebabnya. Yang berubah: kini ada preferensi
  tersurat untuk dibaca, bukan tebakan untuk dibuat.

  Dua hal layak dibawa ke depan. CHECK-nya adalah cek BENTUK dan migrasinya
  menyatakannya: 445 zona, daftar milik tzdata yang berubah beberapa kali
  setahun, berarti constraint yang mengenumerasi akan mulai MENOLAK nilai sah
  dalam hitungan bulan — dan CHECK tidak boleh membaca `pg_timezone_names`.
  Otoritas soal bisa-dirender adalah `Intl.DateTimeFormat`, yang melempar untuk
  zona tak dikenal. Dan karena ia melempar, `readPreferences` melakukan koersi
  saat KELUAR: zona yang dibuang tzdata baru harus terbaca "tidak dipilih", atau
  layar akun 500 tepat pada hari seseorang membukanya untuk memeriksa dugaan
  pembobolan. 5. **Penggantian alamat login.** Sengaja DI LUAR ADR-0096: ia pemulihan akun,
  bukan penyuntingan profil, dan menuntut pembuktian kepemilikan alamat baru.

- **PEMBLOKIR OPERASIONAL — image produksi TIDAK BISA menjalankan satu pun dari
  29 job terdaftar. Ditemukan 14 Agustus 2026 saat men-deploy v9.0.0.**

  `Dockerfile.production`'s stage `runtime` hanya menyalin `dist/`,
  `node_modules/`, dan `package.json`. Tidak ada `scripts/`, tidak ada `src/`.
  Setiap job yang didaftarkan modul lewat `ModuleDescriptor.jobs` berbentuk
  `bun run <target>`, dan **tiap satu dari 29 target itu keluar dengan
  `error: Script not found` di dalam container produksi** — `email:dispatch`,
  `logs:audit:purge`, `blog:publish:scheduled`, `domain-events:dispatch`,
  `push:dispatch`, `data-lifecycle:archive-purge`, semuanya.

  Aplikasi juga TIDAK punya penjadwal in-process (nol `setInterval`/cron di
  `standalone-entry.ts` maupun `middleware.ts`), jadi tidak ada jalur kedua.

  **Kenapa ini tidak pernah terlihat:** registry job hanya memverifikasi bahwa
  `command` menunjuk target yang ada di `package.json` — sebuah fakta tentang
  REPO, bukan tentang image yang berjalan. Gerbangnya benar dan hijau; yang
  tidak ada adalah pertanyaan "apakah target itu bisa dieksekusi di tempat ia
  seharusnya berjalan". Registry yang lengkap membuat 29 job terlihat
  terpasang, sementara nol di antaranya bisa jalan.

  **Konsekuensi yang sudah terjadi:** retensi audit tidak pernah dieksekusi,
  outbox domain-event tidak pernah dikirim, post terjadwal tidak pernah terbit
  — semuanya diam, tanpa error, karena tidak ada yang memanggilnya.

  **Mitigasi yang dipasang hari ini (host, BUKAN di repo):** image kedua
  `awcms-jobs:<versi>` dibangun dari sumber yang sama (`scripts/` + `src/` +
  `sql/`), plus `/home/admin1/awcms-jobs/run-job.sh` yang membaca env dari
  container app yang SEDANG berjalan (nama container berubah tiap deploy, jadi
  ia di-resolve bukan di-hardcode) dan menjalankan target apa pun di jaringan
  `coolify`. Cron pertama yang memakainya: `*/5` `email:dispatch`.

  **KOREKSI beberapa jam kemudian — mode gagalnya lebih buruk dari dugaan
  awal, dan lebih mudah dilihat.** Catatan ini semula memperingatkan image job
  akan "basi diam-diam". Yang sebenarnya terjadi: **Coolify mem-prune image
  yang tidak dipakai container mana pun setiap kali aplikasi di-deploy, dan
  `awcms-jobs` persis seperti itu — jadi ia DIHAPUS pada tiap deploy.**
  Terbukti pada redeploy pertama sesudahnya: `pull access denied for
awcms-jobs, repository does not exist`. Jadi bukan hasil basi yang
  menyesatkan, melainkan cron yang mati keras — lebih berisik, dan itu
  keberuntungan.

  Konteks build-nya (direktori biasa di `/home/admin1/awcms-jobs/`) selamat
  dari prune, jadi `run-job.sh` kini **membangun ulang image sendiri saat
  hilang** alih-alih bergantung pada seseorang yang ingat. Rebuild ~55 detik,
  dan cron `*/5` menyerapnya tanpa terlihat.

  **Utang yang tersisa, dan ini milik REPO bukan host:** konteks build itu
  SNAPSHOT sumber — ia tidak mengikuti rilis. Auto-rebuild memperbaiki
  penghapusan, BUKAN keusangan: setelah rilis berikutnya, cron akan
  membangun ulang **kode versi lama** terhadap skema baru, dan kali ini
  benar-benar diam-diam. Perbaikan yang benar adalah stage `jobs` di
  `Dockerfile.production` yang diterbitkan `release.yml` bersama image
  runtime, sehingga versi job dan versi app tidak BISA menyimpang. Sampai itu
  ada, **segarkan konteks `/home/admin1/awcms-jobs/` setiap rilis** — langkah
  ini tertulis di skill `awcms-deploy`.

- **PUTARAN 14 Agustus 2026 (ketiga puluh) — rilis v9.0.0, dan empat dokumen
  yang menua ke arah yang SALAH.**

  Menyiapkan rilis 26 commit (ADR-0085…0094) berarti membaca ulang docs dan
  skill terhadap kode. Yang ditemukan bukan sekadar "kurang lengkap": empat
  artefak menyatakan hal yang **kebalikannya benar**, dan tiga di antaranya
  adalah instruksi yang akan DIIKUTI, bukan prosa yang dibaca sambil lalu.

  1. **Dua skill memerintahkan perintah yang tidak ada.** `awcms-deploy` dan
     `awcms-production-preflight` sama-sama mencantumkan target bun run
     production:preflight (sengaja ditulis TANPA backtick — lihat di bawah)
     sebagai perintah inti; ia keluar dengan `error: Script not found`. Doc 07
     sudah menyatakan orkestrator itu tak pernah diimplementasikan — jadi
     dokumennya benar sementara dua skill yang merujuknya salah, dan skill-lah
     yang dijalankan orang. Diganti dengan langkah nyata (`config:validate` →
     `check` → `db:pool:health` → `security:readiness`, satu-satunya yang
     memblokir dengan exit code).

     Menuliskan putaran ini pun memerahkan gerbangnya: `check:docs` menuntut
     tiap rujukan `bun run` **berbacktick** di berkas current-state menunjuk
     script nyata, jadi menyebut target yang tidak ada — bahkan untuk
     mengatakan ia tidak ada — ditolak. Itu perilaku yang BENAR: gerbang tidak
     punya cara membedakan "aku mengutip ini sebagai cacat" dari "aku menyuruhmu
     menjalankan ini". Yang perlu diperhatikan adalah cakupannya: `.claude/skills/`
     berada di LUAR `check:docs`, dan itulah sebabnya kedua skill bisa membawa
     perintah palsu ini berbulan-bulan sementara dokumen yang menyatakan
     kebenarannya lolos gerbang tanpa keluhan.

  2. **`privacy-analysis.md` menyatakan permukaan yang SUDAH dibangun sebagai
     celah.** Ia masih berbunyi "endpoint ekspornya belum ada" dan "alur hapus
     orang ini belum ada" setelah #557 mendaratkan keduanya. Ini bentuk
     pembusukan paling mahal: pembaca yang percaya akan **membangun ulang**
     sesuatu yang sudah ada, lengkap dengan otoritas keduanya digabung.
  3. **Ledger subjek data tidak dikenal SATU skill pun.** Nol skill menyebut
     `subjectData`, ADR-0094, atau kedua gerbangnya — termasuk skill modul yang
     MEMILIKINYA. Akibat praktisnya: siapa pun yang menambah tabel akan
     didaftarkan ke registry retensi (yang skill-nya jelaskan) lalu ditolak
     `bun run check` oleh registry yang tak disebut di mana pun. `awcms-data-lifecycle`
     kini punya §Hak subjek data; `awcms-new-migration` aturan 14;
     `awcms-new-module` aturan 5b.
  4. **`awcms-sensitive-data` bertentangan dengan permukaan baru.** Aturannya
     "jangan pernah kirim raw value ke response" kini berhadapan dengan ekspor
     hak subjek yang SAH. Dibiarkan begitu, ia mengajarkan bahwa fitur yang
     sudah ada itu terlarang. Diperbaiki sebagai pengecualian yang menjelaskan
     kontrolnya (`redactedColumns`), bukan pelonggaran.

  Dua koreksi angka menyusul: `MODULE_CONTRACT_VERSION` tertulis `2.5.0` di
  `awcms-module-management` (nyatanya `4.0.0`) dan `1.3.0` di
  `family-compatibility.md` (manifestnya sendiri `4.0.0` dan digerbangi —
  dokumennya yang menyimpang, bukan pinnya). Klaim "base ship 1 aturan SoD"
  muncul di DUA tempat dan keduanya kini 2.

  **Yang perlu diingat dari putaran ini:** generator `project-state:inventory`
  dan `repo:inventory` menghasilkan tabel markdown TANPA padding, lalu prettier
  memformatnya. Menjalankan generator lalu `git status` terlihat seperti drift
  besar (431 baris) padahal nol perubahan makna — jalankan
  `bunx prettier --write` pada berkas ter-generate sebelum menyimpulkan ada
  drift. Ini bukan bug; ia hanya terlihat persis seperti bug.

- **PUTARAN 13 Agustus 2026 (kedua puluh sembilan) — MENJALANKANNYA menemukan
  TIGA cacat yang 41 gerbang tidak lihat.**

  Seluruh test permukaan #557 murni: rencananya murni, gerbang registry-nya
  murni, kontrak layarnya teks. Tak satu pun mengeksekusi satu statement, dan
  eksekutornya tidak lain adalah statement. `bun run check` hijau tanpa
  menyentuhnya. Satu test integrasi terhadap PostgreSQL nyata menemukan tiga hal
  — dan **dua di antaranya adalah cacat produksi**, bukan cacat test.

  1. **`hard_delete` pada tabel yang privilege-nya DICABUT.** Dua deskriptor MFA
     per-tenant menjanjikan penghapusan; ADR-0087/`sql/114` sengaja
     memensiunkannya jadi read-only dan mencabut INSERT/UPDATE/DELETE dari
     `awcms_app`. Penghapusan akan gagal `42501` di tengah transaksi, SETELAH
     permintaannya diklaim. Yang menggoda — memberikan privilege-nya kembali —
     justru akan membatalkan kontrol yang ADR itu pasang; jadi **deskriptornya
     yang mengalah**, ke `severed_with_subject_row`, yang kebetulan juga jawaban
     paling jujur untuk tabel yang runtime-nya tak boleh menulis.

  2. **Komentar migrasi yang berbohong tentang kontrolnya sendiri.** `sql/125`
     menulis "tanpa DELETE, dan itu keputusan" lalu hanya
     `GRANT SELECT, INSERT, UPDATE`. Tetapi `sql/019` memberi `awcms_app`
     keempat privilege atas SELURUH schema (`ON ALL TABLES` + `ALTER DEFAULT
PRIVILEGES`), jadi GRANT yang "tidak menyebut" DELETE **tidak menahan apa
     pun** — ia memberikan lagi apa yang sudah ada. Ditutup dengan `REVOKE`
     eksplisit. Pelajaran yang bisa dipindah: di schema ber-blanket-grant, satu-
     satunya cara menahan privilege adalah MENCABUTNYA, dan GRANT yang selektif
     terbaca seperti kontrol sambil tidak menjadi kontrol.

  3. **Jebakan binding Bun.SQL untuk jsonb** (cacat TEST, bukan produksi):
     `${JSON.stringify(arr)}::jsonb` menyimpan jsonb **string**, bukan array —
     `jsonb_typeof` menjawab `string` dan setiap uji containment jadi false.
     `${arr}::jsonb` (yang dipakai produksi) menyimpan array. Fixture pertama
     memakai bentuk pertama dan membuat eksekutor yang BENAR tampak rusak.

  Temuan 1 dan 2 kini digerbangi: `subject-data:registry:check` memutar ulang
  setiap `GRANT`/`REVOKE` atas `awcms_app` dari `sql/`, mulai dari blanket grant,
  dan menolak mode penghapusan yang menuntut privilege yang dicabut. Pesannya
  memperingatkan agar tidak "memperbaikinya" dengan memberi privilege kembali.

  **Dan memperbaiki temuan 2 memerahkan gerbang KETIGA, yang juga benar.**
  `checkRuntimeRoleGrants` menuntut tiap tabel ber-privilege lebih sempit dari
  default DIDEKLARASIKAN, dua arah — "narrowed on purpose" harus bisa dibedakan
  dari "rusak", dan hanya manusia yang bisa memberi bedanya. Jadi
  `awcms_subject_requests` masuk `RETIRED_TENANT_TABLE_PRIVILEGES` sebagai
  entri jenis KEDUA: bukan tabel pensiun ber-`SELECT` saja, melainkan ledger
  hidup yang menahan tepat satu verb. Dokumentasi konstantanya dilebarkan
  supaya namanya berhenti menggambarkan hanya separuh isinya, alih-alih
  menyelundupkan entri yang tidak cocok dengan deskripsinya sendiri.

- **PUTARAN 13 Agustus 2026 (kedua puluh delapan) — PERMUKAAN HAK SUBJEK DATA
  (#557 SELESAI), dan empat lapis yang masing-masing menangkap kegagalan
  berbeda.**

  Menutup #557 seluruhnya: ekspor, penghapusan maker/checker, empat izin +
  migrasi seed, dan layar `/admin/subject-requests`.

  **Empat lapis untuk satu aturan, dan itu bukan berlebihan.** "Yang menyetujui
  bukan yang meminta" dijaga oleh: dua izin terpisah, aturan SoD `critical`,
  CHECK constraint `decided_by <> requested_by`, dan klaim bersyarat satu
  UPDATE. Tiap lapis menangkap kegagalan yang tidak ditangkap lapis lain — izin
  menangkap orang yang salah, SoD menangkap grant yang salah, constraint
  menangkap balapan, dan klaim bersyarat menangkap DUA approval bersamaan yang
  jika tidak akan menjalankan penghapusan tak-terbalikkan dua kali. Pola yang
  layak diulang untuk tiap aksi tak-terbalikkan berikutnya.

  **`exceptionPolicy` aturan SoD-nya `allowed: true`, dan itu keputusan yang
  berlawanan intuisi.** `false` terbaca lebih ketat tetapi lebih buruk: aturan
  yang melarang pengecualian tidak punya baris tertunda untuk dilihat checker,
  jadi satu-satunya jalan keluar saat insiden nyata adalah perubahan grant di
  luar sistem yang tak seorang pun review. Tujuh hari, bukan empat belas seperti
  legal hold, karena yang ini menyerahkan kemampuan menghapus secara sepihak.

  **Ketegangan gerbang KEDUA, diselesaikan dengan menuruti gerbangnya.**
  Empat rute pertama disalin dari pola `withTenant` `legal-holds.ts` — yang ada
  di allowlist `NOT_YET_MIGRATED`. `api:tenant-route:check` menolaknya dan
  pesannya menulis sendiri "Jangan tambahkan berkas ini ke NOT_YET_MIGRATED".
  Keempatnya ditulis ulang ke `defineTenantRoute`. Pelajarannya: menyalin berkas
  yang ADA di repo bukan bukti bahwa polanya masih benar — berkas itu bisa jadi
  justru utang yang sedang dibayar.

  **Eksekutornya menulis ~7 tabel, bukan ~100**, karena `erasureTargets`
  menjatuhkan tiap `severed_with_subject_row`. Ini pembayaran langsung dari
  kosakata yang putaran kedua puluh tujuh temukan: tanpa anggota union itu,
  eksekutor yang patuh akan menulis ulang sembilan puluh kolom stempel dan
  menghancurkan catatan tenant demi memutus tautan yang sudah putus.

- **PUTARAN 13 Agustus 2026 (kedua puluh tujuh) — LEDGER SUBJEK DATA MENCAPAI
  NOL (#557, ADR-0094 gelombang 2), dan empat jawaban yang belum punya kosakata.**

  **139 → 0.** #542 mendaratkan fondasi dan meninggalkan 139 tabel berutang;
  #557 menulis prasyaratnya sendiri dengan jujur — endpoint ekspor di atas
  ledger itu akan menjawab dengan 3 tabel dan diam untuk 139 sisanya. Kini 139
  deskriptor + 7 penolakan beralasan menutup 146 tabel, dan kelengkapan menjadi
  sifat yang dipaksa skema alih-alih yang diklaim sebuah PR.

  **Menuliskan 139 jawaban menemukan EMPAT hal yang modelnya belum bisa
  nyatakan, dan tak satu pun terlihat dari tiga deskriptor gelombang 1.** Ini
  pelajaran yang layak diulang: memaksa diri menjawab SELURUH populasi, bukan
  sampel yang meyakinkan, adalah yang memunculkan batas modelnya.
  `severed_with_subject_row` (jawaban ~90 tabel; tanpanya eksekutor yang patuh
  akan menulis ulang stempel `deleted_by` dan menghancurkan catatan tenant demi
  memutus tautan yang sudah putus), `references: "profile"` (tanpanya
  `awcms_profiles` — tabel PERTAMA yang issue-nya sebut — benar-benar tak
  terjangkau, karena tautannya berjalan ke arah sebaliknya),
  `unreachableBySubject` (untuk tabel yang pseudonim SENGAJA, di mana
  `NO_SUBJECT_DATA` dusta dan kolom subjek fiksi), dan `tenantColumn: null`
  eksplisit.

  **Gerbang yang menemukan tujuh cacat pada deskriptor PR-nya sendiri.**
  `subject-data:registry:check` bertanya apakah jawabannya BENAR, bukan apakah
  ia ADA — dan seluruh tujuh temuannya adalah satu string yang tampak masuk
  akal yang gagal diam-diam saat runtime: lima kolom redaksi salah nama, dua
  `references` yang tak cocok dengan foreign key nyata. Bandingkan dengan
  pelajaran gerbang yang sudah tercatat: gerbang CAKUPAN bisa hijau sambil
  semua jawabannya salah, dan ini pasangannya.

  **Ketegangan antar-gerbang diselesaikan SEMPIT.** `awcms_access_assignments`
  dipensiunkan ADR-0079 dan `access:grant-readers:check` melarang berkas mana
  pun menyebutnya; dengan ledger di nol ia tetap wajib menjawab. Menambahkan
  `module.ts` ke `GRANT_READERS` akan membuat gerbang berhenti mengawasi
  seluruh berkas — persis proteksi yang dimaksud. Izinnya karena itu dikunci
  pada BENTUK penyebutan (hanya sebagai nilai `tableName:`), dan diuji dengan
  menanam pembacaan SQL yang seharusnya tetap merah. Pola yang layak diulang
  saat dua gerbang berselisih: persempit izinnya sampai ia tidak bisa menutupi
  cacat yang gerbang itu cari, jangan lebarkan cakupannya.

- **PUTARAN 13 Agustus 2026 (kedua puluh enam) — EDITOR SETTINGS MODUL (#546),
  dan tautan yang selama ini menuju 404.**

  Menutup 2 kunci, **49 → 47**. Tiga dokumen menyatakan panel
  `/admin/modules/{key}` sudah ada; ia tidak pernah ada, dan
  `/admin/blog-settings` me-render tautan HIDUP ke 404. Satu dokumen memakai
  klaim itu untuk membenarkan tidak membangun editor.

  **Membangun yang diklaim dokumen adalah koreksinya.** Menghapus kalimatnya
  meninggalkan gap-nya dan kehilangan catatannya; membangun halamannya membuat
  ketiganya benar sekaligus. Ini pola yang layak diulang saat menemukan
  dokumentasi yang berbohong tentang keberadaan sebuah kontrol: tanyakan dulu
  apakah lebih murah membuatnya jadi benar.

  **Satu gerbang diperluas, dan bedanya dengan melonggarkan layak dicatat.**
  `admin-navigation-registry` menuntut tiap halaman admin punya entri sidebar —
  proxy yang benar untuk halaman statis dan salah untuk rute ber-PARAMETER,
  karena sidebar tidak bisa memuat `[moduleKey]`. Propertinya dipertahankan dan
  proxy-nya diganti: halaman dinamis wajib punya INDUK dan dilarang punya entri
  sidebar. Bandingkan dengan putaran kedua puluh, di mana gerbang enforcement
  TIDAK dilebarkan karena di sana yang salah adalah cara menulis guard-nya, bukan
  proxy gerbangnya.

  **Kotak PATCH, bukan editor dokumen — dan itu temuan, bukan pilihan gaya.**
  `updateModuleSettings` menggabungkan dangkal dan kontraknya tidak punya
  konvensi penghapusan sama sekali. Textarea yang menyajikan override sebagai
  dokumen akan membiarkan operator menghapus satu kunci, submit, lalu melihatnya
  kembali. Memberi API jalur penghapusan adalah keputusan tentang apa arti
  `null`, dan sengaja TIDAK diambil di sini.

- **PUTARAN 13 Agustus 2026 (kedua puluh lima) — LAYAR PARTNER REGISTRY (#540).**

  Menutup 2 kunci, **51 → 49**. Hal terpenting tentang layar ini adalah di mana
  ia TIDAK berada: `/admin/partners` adalah pandangan PELANGGAN, dan registri di
  sana menaruh daftar setiap kemitraan platform di depan setiap pelanggan.
  Test kontraknya menegakkan pemisahan itu dari KEDUA arah.

  **Keputusan nav yang issue-nya khawatirkan ternyata tidak ada.** Pengelompokan
  sidebar per-MODUL, bukan per-scope, dan platform-ness dinyatakan lewat
  `requiredPermission` ber-scope platform — persis cara `/admin/tenants`. Layar
  platform kedua karena itu tidak menuntut mekanisme baru.

  **Tidak ada picker tenant, dan itu bukan kekurangan:** daftar tenant yang bisa
  dipilih adalah direktori yang ADR-0089 tolak. `/admin/tenants` ada untuk
  operator platform yang perlu mencarinya, dan batas IZIN yang seharusnya
  memutuskan, bukan sebuah `<select>`.

- **PUTARAN 13 Agustus 2026 (kedua puluh empat) — LAYAR INVITATIONS (#541).**

  Menutup 4 kunci, **55 → 51**. Permukaannya mendarat lengkap di Gelombang 4 dan
  tanpa halaman, persis alasan yang ledger tulis untuk keempatnya.

  **Membuat satu undangan menjalankan sampai TIGA gerbang**, dan formnya
  mengatakan yang mana: `invitations.create`, lalu `access_control.assign`
  begitu peran disebut, lalu `invitations.configure` ber-scope platform untuk
  `skipEmailConfirmation`. Form yang menggerbangi semuanya pada `create`
  menawarkan dua kontrol yang 403 saat submit.

  **Temuan: undangan yang dibuat saat email mati adalah undangan mati.** Respons
  pembuatan menyebut `delivery`, dan tidak ada endpoint yang mengembalikan
  tautannya — jadi undangan itu ada, valid, dan tak bisa diserahkan kepada siapa
  pun; mengirim ulang gagal dengan cara yang sama. Halaman melaporkannya apa
  adanya. Membuat tautannya bisa diambil adalah keputusan tentang di mana token
  undangan boleh muncul, dan sengaja TIDAK diambil di sini.

  **`Idempotency-Key` dikirim tepat sekali**, dan asimetrinya disengaja di kedua
  sisi: pembuatan mewajibkannya, `resend` menolaknya karena memutar ulang harus
  mengembalikan token yang sudah dirotasi pergi. Ia dibatasi lewat
  `resend_count < 5` di UPDATE-nya, bukan lewat header.

- **PUTARAN 13 Agustus 2026 (kedua puluh tiga) — LAYAR EMAIL SUPPRESSION (#544).**

  Menutup 3 kunci, **58 → 55**. Kelompok kedua yang ledger cakupan layar namai
  sendiri sebagai bukan kosmetik: alamat yang di-suppress diam-diam berhenti
  menerima surat, TERMASUK reset password, dan tak ada yang bisa mendaftar atau
  membersihkannya dari halaman. Diagnosisnya sampai sekarang query SQL yang harus
  diketahui keberadaannya.

  **`alreadySuppressed` adalah JAWABAN, bukan error — dan itu yang membentuk
  halamannya.** Daftarnya hanya menyimpan alamat ter-mask dan dibatasi 100 baris,
  jadi "apakah alamat INI di-suppress?" tidak bisa dijawab dengan membacanya.
  Endpoint-nya menjawab 200 ber-`alreadySuppressed` alih-alih 409, sehingga satu
  request melayani "tambahkan" DAN "sudah ada belum"; me-reload di cabang itu
  membuang satu-satunya hal yang ditanyakan operator.

  **`SUPPRESSION_REASONS` diekspor, dan `KNOWN_REASONS` diturunkan darinya.**
  Perubahan kecil dengan aturan yang sama seperti checkbox kelas-tulis satu
  putaran lalu: sebuah daftar yang disalin ke UI tetap benar hari ini dan
  tertinggal diam-diam saat nilai berikutnya ditambahkan. Bentuk mutasi yang
  membuktikannya juga sama, dan yang paling berguna adalah **mengosongkan daftar
  sumbernya** — asersi "diturunkan" yang tidak memerah pada daftar kosong adalah
  asersi hampa.

- **PUTARAN 13 Agustus 2026 (kedua puluh dua) — EPIC #423 DITUTUP, BACKLOGNYA
  PINDAH KE ISSUE, dan layar `/admin/machine-credentials` mendarat.**

  **#423 ditutup.** Kriteria yang issue itu tulis sendiri ("TERBUKA sampai
  Gelombang 8") terpenuhi, dan ketiga tindak lanjut Gelombang 8 tertutup (#535,
  #537, #538). Epic yang tetap terbuka sesudah cakupannya habis berhenti berarti
  apa-apa.

  **Sisanya menjadi delapan issue** (#539–#546), bukan prosa di §4 ini. Alasannya
  mekanis: repo ini akan punya NOL issue terbuka sementara backlog nyatanya hidup
  sebagai paragraf yang harus dibaca seluruhnya untuk tahu apa yang tersisa. §4
  tetap tempat KEPUTUSAN dan penolakan ditulis; issue adalah yang bisa di-assign
  dan ditutup satu per satu.

  **Layar kredensial mesin (#539) menutup 4 kunci, 62 → 58.** Argumennya sama
  dengan `/admin/partners`: pencabutan adalah kontrol yang dicari saat token
  bocor, dan sampai halaman ini ada ia `POST` yang tak akan diingat siapa pun di
  bawah tekanan. #537 mempertajamnya — sampai sekarang tak ada tempat untuk
  melihat kredensial mana yang bisa MENULIS.

  **Dua izin, satu form, dan itu bukan kosmetik.** Kalau halaman menurunkan
  fieldset tulis dari `machine_credentials.create`, pemisahan yang ADR-0092 buat
  justru untuk mencegah pelebaran grant dibatalkan lagi — kali ini di UI, tempat
  tak ada gerbang yang melihatnya. Checkbox aksinya **diturunkan** dari
  `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`, karena sepasang checkbox tulis
  tangan tetap benar hari ini dan tertinggal diam-diam saat plafonnya dilebarkan.

  **Pelajaran test yang berlaku untuk setiap layar berikutnya:** asersi sumber
  yang terikat INDENTASI memerah pada kode yang benar begitu formatter memindah
  satu baris. Dua asersi di sini tentang ADJACENCY (verb di sebelah URL-nya,
  ternary yang menguji daftar tulis) dinormalisasi whitespace-nya lebih dulu.
  Kegagalan sekerabat sudah tercatat di putaran kedelapan belas — di sana
  penyebabnya mencampur action audit dengan action guard.

- **PUTARAN 13 Agustus 2026 (kedua puluh satu) — REGISTRI PARTNER PUNYA PENULIS.**

  Menutup sisa #423 nomor 3. `sql/123` + `GET`/`POST /api/v1/partners`; tanpa
  ADR baru — ADR-0089 sudah menamai permukaan ini, dan `sql/116` sengaja
  mengirim tabelnya tanpa penulis. Bukti bahwa itu terasa: suite E2E Gelombang 8
  menuliskan barisnya sendiri, dengan komentar "belum ada jalur request untuk
  ini". Komentar itu kini hilang, dan alurnya dimulai dari penulis yang sama.

  **Kedua izinnya ber-scope platform, dan `read` bukan kelalaian.** `create`
  menyatakan siapa yang BOLEH MENJADI partner — paruh platform dari pemisahan
  yang ADR-0089 jaga terhadap `partner_access.configure` milik pelanggan. `read`
  mendaftar SELURUH partner, dan versi tenant-scoped-nya adalah direktori
  lintas-tenant yang ADR yang sama tolak sebagai tabel, dibangun ulang sebagai
  permission.

  **Tidak ada `DELETE`, dan itu keputusan.** Barisnya target FK dari
  keterlibatan DAN dari grant terdelegasi yang `sql/120` buat sengaja hidup
  lebih lama darinya; DELETE gagal begitu satu kemitraan pernah ada, dan
  `ON DELETE CASCADE` memutus setiap kemitraan di instalasi. Pensiun adalah
  perubahan `status` — dan `status` tetap dipatok, jadi permukaan ini tidak
  menerimanya sama sekali.

  **Konflik diselesaikan tanpa membaca SQLSTATE.** Kedua kunci naturalnya punya
  index unik GLOBAL, jadi membedakan kedua 23505-nya lewat error driver berarti
  membaca SQLSTATE dari tempat yang di repo ini bukan `error.code`.
  `ON CONFLICT DO NOTHING` plus satu pembacaan penentu menghindari pertanyaannya
  — dan itu pula alasan rute ini tidak ber-`Idempotency-Key`.

  **Jebakan yang ditemukan saat menyambungkan E2E:** `set_config` bersifat
  SESSION-scoped, jadi pada klien ber-pool pernyataan kedua bisa mendarat di
  koneksi yang tak pernah melihatnya. Tulisan satu-pernyataan yang ada di suite
  itu selamat karena kebetulan; tiga pernyataan tidak akan. Pemanggilannya
  dibungkus `withTenantOrThrow`.

  `NOT_YET_SCREENED` 60 → 62. Layarnya BUKAN `/admin/partners` — halaman itu
  pandangan PELANGGAN atas siapa yang menjangkau tenant-nya sendiri, dan menaruh
  registri di sana menaruh daftar setiap kemitraan platform di depan setiap
  pelanggan.

- **PUTARAN 13 Agustus 2026 (kedua puluh) — KREDENSIAL MESIN KELAS-TULIS BISA
  DITERBITKAN, dan izinnya sendiri.**

  Menutup sisa #423 nomor 1. `sql/122` + dua field opsional pada
  `POST /api/v1/access/machine-credentials`; tanpa ADR baru, karena ADR-0092
  §Konsekuensi sudah menamai permukaan ini sebagai pekerjaan lanjutan, bukan
  keputusan yang belum diambil.

  **Izinnya BARU, dan itu seluruh keputusannya.** Bentuk yang jelas adalah
  menerima `allowedWriteActions` pada `machine_credentials.create` yang sudah
  ada. Salahnya hanya terlihat kalau ditanyakan dari sisi grant: setiap peran
  yang hari ini memegang `create` akan MENDAPAT hak mencetak kredensial yang
  mengubah data pada hari rilis — pelebaran tanpa satu grant pun disunting, tanpa
  satu baris di diff untuk di-review. Jadi kelas tulis mendapat aktivitas ketiga,
  `machine_credentials_write.create`. `revoke` sengaja TIDAK ikut dipecah: saat
  insiden, siapa pun yang bisa membunuh kredensial bocor harus bisa membunuh
  setiap kelasnya.

  **CIDR pada kredensial BACA ditolak, dan tidak ada apa pun selain validator itu
  yang menjaga arah tersebut.** `isMachineCredentialWriteRefused` menjawab "tidak
  ditolak" untuk `read` SEBELUM menyentuh daftar CIDR — basis data mengizinkan
  baris seperti itu dan gerbang runtime tidak peduli, sehingga operator akan
  mengira ia mengikat sesuatu yang tidak pernah dikonsultasi.

  **Jebakan gerbang yang layak diingat, dan biayanya nyata:**
  `access:permissions:enforcement:check` membaca guard sebagai **literal objek
  ber-tiga-kunci**. Percobaan pertama menulis guard-nya sebagai satu literal
  dengan ternary pada `activityCode`, dan gerbangnya melaporkan **kedua** izin
  "enforced by nothing" — termasuk yang sudah ditegakkan sebelum PR ini. Bentuk
  yang benar adalah dua literal UTUH di kedua cabang; melebarkan gerbangnya agar
  muat pada preferensi penulisan adalah pertukaran yang salah arah.

  **Satu cacat ditemukan oleh test-nya sendiri:** kelas tulis awalnya diturunkan
  dari aksi yang LOLOS parse, bukan yang DIMINTA, sehingga permintaan ber-`delete`
  dengan CIDR benar dikembalikan sebagai read-only lalu dimarahi soal CIDR-nya.
  Satu kesalahan, dua pesan, dan yang kedua membantah permintaannya.

  Kontrak konsumen ADR-0065 **diregenerasi dengan sengaja** — diff-nya prosa plus
  dua properti OPSIONAL, nol rename, nol penghapusan, nol field menjadi wajib.
  Teks "read-only" di kontrak sudah menjadi klaim palsu sejak ADR-0092 mendarat;
  itu ikut dibetulkan di sini. `NOT_YET_SCREENED` 59 → 60.

- **PUTARAN 13 Agustus 2026 (kesembilan belas) — TIGA CELAH ALUR DITUTUP.**

  [`awcms/privacy-analysis.md`](awcms/privacy-analysis.md) (langkah 3),
  [`awcms/templates/definition-of-ready.md`](awcms/templates/definition-of-ready.md)
  (langkah 9), dan [`awcms/post-release-reviews.md`](awcms/post-release-reviews.md)
  (langkah 18), plus dua template pendukung.

  **Analisis privasi menunjuk, tidak menyalin.** Angka retensi per tabel tetap
  di deskriptor yang digerbangi; menyalinnya ke dokumen privasi menghasilkan
  angka yang basi pada hari pertama seseorang mengubahnya, dan angka basi di
  sana lebih berbahaya daripada tidak ada angka. Ia juga menyatakan apa yang
  hanya bisa dijawab OPERATOR, dan satu celah nyata yang tersisa: **tidak ada
  alur ekspor/penghapusan per subjek data**.

  **Pertanyaan pertama Definition of Ready adalah yang repo ini bayar dua
  kali**: apakah policy mengizinkan pembacaan yang rencananya butuhkan. ADR-0087
  dan ADR-0088 sama-sama gagal di situ.

  **Register rilis mendarat KOSONG dan mengatakannya.** Mengisinya mundur dari
  ingatan adalah kebalikan dari gunanya. Satu baris templatnya —"yang pertama
  kali terlihat di produksi dan tidak di CI"— adalah tempat harga ADR-0083
  dibayar, dan satu-satunya cara mengetahui apakah harganya masih pantas.

- **PUTARAN 13 Agustus 2026 (kedelapan belas) — layar `/admin/partners`:
  pencabutan akses partner berhenti menjadi panggilan API.**

  Menutup tiga entri terakhir `partner_access` di `NOT_YET_SCREENED` (62 → 59).
  Yang mendorongnya bukan kelengkapan melainkan satu kalimat dari putaran
  sebelumnya: pencabutan adalah kontrol yang dicari pelanggan ketika ada yang
  salah, dan sampai halaman ini ada ia adalah `DELETE` yang tidak akan diingat
  siapa pun di bawah tekanan.

  **Tidak ada partner picker**, dan halamannya mengatakan kenapa — sebuah
  `<select>` berisi partner adalah direktori lintas-tenant yang ADR-0089 tolak
  sebagai tabel, dibangun ulang di UI. **Halaman ini juga tidak reload setelah
  menyetujui**: respons persetujuan adalah satu-satunya tempat kode terbaca, dan
  reload berarti kredensial hilang plus grant yang harus dicabut.

  **Jebakan yang ditemukan saat menulis test kontraknya, dan layak diingat:**
  asersi `not.toContain('action: "revoke"')` atas seluruh berkas rute GAGAL pada
  kode yang BENAR, karena rutenya juga menulis baris audit ber-`action:
"revoke"`. Action audit ≠ action guard; test yang mencampurnya memerah pada
  kode yang benar.

- **PUTARAN 13 Agustus 2026 (ketujuh belas) — ALUR PENGEMBANGAN PUNYA DOKUMEN
  KANONIK, dan satu langkahnya BERTENTANGAN dengan ADR yang berlaku.**

  [`awcms/alur-pengembangan.md`](awcms/alur-pengembangan.md): 18 langkah dari
  Master Blueprint sampai post-release review, tiap langkah dipetakan ke artefak
  NYATA dan gerbang yang menegakkannya. Ia menggantikan
  `alur-pengembangan-mini-first.md` (yang sudah dicabut ADR-0055) dan menjadi
  yang mengikat; `CONTRIBUTING.md` dan §"Alur kerja wajib" di `AGENTS.md`
  keduanya kini menyatakan diri sebagai **langkah 10–12 saja**.

  **KEPUTUSAN PEMILIK REPO, DIAMBIL 13 Agustus 2026: ADR-0083 TETAP.** Langkah 13
  (Deploy Staging) dan 14 (UAT internal) ditandai **TIDAK BERLAKU untuk repo
  ini** — keputusan, bukan celah. Penggantinya dinyatakan di dokumen alur
  (basis data ephemeral CI, E2E Playwright, `security:readiness`, preflight
  produksi), **dan begitu pula harganya**: pengujian manusia terhadap data mirip
  produksi, dan verifikasi perilaku Cloudflare/Varnish/Traefik di luar jalur
  produksi. Keduanya alasan sah untuk meninjau ulang ADR-0083 kelak; keduanya
  bukan sesuatu yang hilang tanpa disadari.

  Dokumen alur karena itu membedakan **celah** dari **keputusan** di tabel
  ringkasannya — mencampurnya adalah bagaimana pekerjaan yang belum dikerjakan
  memperoleh rupa penilaian.

  **Tiga celah yang tersisa — murni belum ada, dan sedang dikerjakan
  berikutnya:**
  privacy analysis/DPIA (langkah 3), Definition of Ready umum (langkah 9 — yang
  ada hanya admission checklist untuk modul baru), dan post-release review
  per-RILIS (langkah 18 — §4 ini adalah yang terdekat, tetapi ia terikat putaran
  kerja, bukan rilis).

  Langkah 9 punya bukti biayanya sendiri di repo ini: **dua gelombang berturut-turut**
  (ADR-0087, ADR-0088) menulis rencana yang mengasumsikan pembacaan lintas-tenant
  yang FORCE RLS larang, dan keduanya baru ketahuan saat implementasi.

  Sejarah repo dipindahkan keluar dari `README.md` ke
  [`awcms/sejarah-repo.md`](awcms/sejarah-repo.md) — README menjawab "ini apa,
  sekarang", dan sejarah di bagian depan mengubur jawabannya. Ketiga agen
  (`.claude/agents/`) kini menunjuk dokumen alur; reviewer diminta menentukan
  KELAS perubahan lebih dulu, dan auditor diingatkan bahwa kontrol belum
  terbukti sampai ia dibuktikan GAGAL.

- **PUTARAN 13 Agustus 2026 (keenam belas) — PR 8.5 MENDARAT. GELOMBANG 8
  SELESAI, DAN PROGRAM #423 HABIS.**

  [ADR-0092](adr/0092-machine-credentials-may-write.md) (`sql/121`): kredensial
  mesin boleh menulis, dan aksinya adalah plafon KODE ∩ kolom baris. Kalau
  daftar aksinya menjadi kolom murni, satu restore backup bisa mencetak
  kredensial tulis se-katalog dengan setiap gerbang hijau.

  Sifat "tidak ada aksi high-risk di plafon tulis" **dihitung dari konstanta
  hidup**, bukan ditulis sebagai daftar — daftar literal menyimpang diam-diam
  pada hari seseorang menambah aksi high-risk baru.

  **Ketiadaan IP adalah DENY.** Tanpa itu, rute yang belum meneruskan alamat
  pemanggil diam-diam mematikan kondisinya. `defineTenantRoute` mengisinya di
  kedua jalurnya, termasuk SSE. Parser CIDR-nya menyempit saat ragu, dan arah
  itu diuji.

  Diverifikasi 7/7 di Postgres nyata; tiga mutasi memerahkan test yang tepat.

  **GELOMBANG 8 TUTUP** — PR 8.1 (#529), 8.2 (#530), 8.3 (#531), 8.4 (#532),
  8.5. Sembilan gelombang program model keanggotaan #423 selesai.

  **Yang tersisa dan BELUM dikerjakan**, dicatat supaya tidak perlu diturunkan
  ulang:

  1. **Permukaan penerbitan kelas tulis** — kolomnya ada dan gerbangnya
     menegakkannya, tetapi belum ada rute yang bisa menerbitkan kredensial
     tulis. Sengaja: setiap PR gelombang ini mendarat inert sebelum
     permukaannya.
  2. **Layar admin untuk `partner_access`** (3 permission di
     `NOT_YET_SCREENED`). Pencabutan akses partner hari ini adalah panggilan
     API — yang bekerja, dan yang tidak akan diingat siapa pun di bawah tekanan.
  3. **Permukaan pendaftaran partner** (`platform` scope) — `awcms_partners`
     hari ini hanya bisa ditulis operator lewat SQL.

- **PUTARAN 13 Agustus 2026 (kelima belas) — PR 8.4 MENDARAT, dan E2E
  menemukan cacat yang lolos setiap pembacaan.**

  `sql/119` + `sql/120`, enam endpoint: pelanggan menyewa/memutus partner dan
  menyetujui/mencabut grant; partner melihat bukunya lewat fungsi
  `SECURITY DEFINER` sempit; penebusan menukar kode menjadi KEANGGOTAAN (bukan
  sesi — salinan kedua kebijakan masuk tenant adalah tempat gerbang MFA
  terlewat).

  **Cakupannya sengaja lebih lebar dari rencana.** Rencana hanya menyebut sisi
  partner; mengirimnya sendirian menghasilkan permukaan di atas data yang tidak
  ada jalur request bisa membuatnya.

  **Koreksi terhadap `sql/117`, ditemukan E2E:** FK grant→kemitraan membuat
  pemutusan kemitraan MUSTAHIL begitu satu grant pernah ada. Ia terbaca benar di
  setiap review dan salah begitu urutan lengkapnya dijalankan. `sql/120`
  memindahkan FK ke registri; invarian penulisannya pindah ke
  `INSERT … SELECT … WHERE EXISTS`, bukan ke TypeScript. **Pelajarannya bukan
  "FK-nya salah" melainkan bahwa invarian berbentuk "X tidak bisa ada tanpa Y"
  harus ditanyai: apakah X harus hidup lebih lama dari Y?**

  Fungsi definer-nya diukur sebagai `awcms_app`, bukan sebagai pemilik migrasi —
  `sql/048` sendiri memperingatkan bahwa definer TIDAK mem-bypass RLS di postur
  ini. Suite E2E baru 18 test terdaftar di kedua workflow.

  **Sisa Gelombang 8:** PR 8.5.

- **PUTARAN 13 Agustus 2026 (keempat belas) — PR 8.3 MENDARAT, dan sebuah
  "tidak bisa dilakukan" berumur dua ADR ternyata BISA.**

  [ADR-0091](adr/0091-two-sided-attribution.md) (`sql/118`): tiga kolom membuat
  tindakan orang luar bisa dibedakan dari tindakan karyawan —
  `awcms_audit_events.actor_tenant_id`, `delegated_grant_id` pada audit, dan
  `delegated_grant_id` pada decision log. `NULL` berarti "dari dalam", bukan
  "tidak diketahui"; tidak ada backfill, karena baris lama memang benar NULL.

  **Tindak lanjut terbuka ADR-0054 tertutup**: "tenant yang dibuat tidak melihat
  catatan kelahirannya sendiri". Ia terbuka karena tampak mustahil dengan alasan
  yang BENAR — `awcms_audit_events` FORCE RLS, dinding yang sama yang
  menjatuhkan rencana ADR-0087 dan ADR-0088. Yang membuatnya bisa:
  `createTenantWithOwner` **sudah berdiri di dalam konteks tenant baru**. Yang
  membedakan kasus ini bukan aturan baru melainkan **di mana kodenya kebetulan
  berdiri** — dan pelajaran itu layak dibaca siapa pun yang berikutnya
  menyimpulkan "tidak bisa menulis lintas tenant".

  Keputusan performa yang perlu dilihat: decision log **tidak** mendapat
  `actor_tenant_id` (dua kolom per request pada tabel terbesar, demi satu join
  yang hanya dijalankan investigasi), ketiga index-nya **parsial**, dan grant id
  diresolusi **query kedua** yang berhenti lebih awal untuk anggota biasa —
  bukan join ke query autentikasi yang dibayar setiap request.

  Diverifikasi 10/10 di Postgres nyata, termasuk satu asersi yang benar-benar
  mem-provision tenant lalu membaca lognya sendiri. Dua mutasi memerahkan test
  yang tepat.

  **Sisa Gelombang 8:** PR 8.4, 8.5.

- **PUTARAN 13 Agustus 2026 (ketiga belas) — PR 8.2 MENDARAT: akses terdelegasi
  mencetak tenant user SUNGGUHAN, dan dua PR rencana bertemu kenyataan.**

  [ADR-0090](adr/0090-delegated-access-prints-a-real-tenant-user.md)
  (`sql/117`): grant yang ditebus menghasilkan baris `awcms_tenant_users` biasa
  terikat role **pilihan pelanggan**, dengan tanggal mati — sehingga RLS,
  decision log, audit, SoD, dan business-scope facts bekerja tanpa perubahan.
  Yang menyeberangi batas antar-organisasi hanyalah kode penebusan berumur
  pendek (`awcmsd_…`, hash `dg-sha256:`), preseden ADR-0050.

  **Dua item PR sebelumnya ditutup di sini.** Role `support` yang PR 8.2
  asumsikan ada memang tidak ada, dan setelah diperiksa ia juga tidak
  seharusnya ada: menanamnya membuat platform memutuskan isi tenant orang lain,
  membatalkan ADR-0089 dari sisi lain. Nilai `origin_auth` kelima (`delegated`)
  mendarat, dan aturan non-switchable berhenti dieja inline di `switch.ts`
  menjadi `NON_SWITCHABLE_ORIGIN_AUTH` — dua nilai masih boleh dieja, tiga
  sudah menjadi tempat nilai keempat terlupakan.

  **Temuan yang mengubah desain:** gerbang "aktor terdelegasi tidak menulis
  otoritas" tidak boleh bersandar pada `awcms_sessions.origin_auth`, karena ada
  DUA jalur ke chokepoint dan jalur tenant-user langsung akan tidak
  tergerbangi — kelas ADR-0079. Jenisnya karena itu hidup sebagai
  `awcms_tenant_users.principal_kind`, kolom yang kedua resolver sudah SELECT,
  write-once sehingga tidak ada kewajiban penulis kedua.

  Penebusan memakai `materializeMembership` (penulis keanggotaan ADR-0082),
  bukan INSERT kelima — yang juga memberinya penolakan role sistem secara
  gratis, sehingga `owner` tidak bisa didelegasikan. `bun run check` hijau,
  `sql/117` diverifikasi 13/13 di Postgres nyata, dan **empat mutasi** memerahkan
  test yang tepat (memindahkan gerbang ke bawah fetch, menghapus
  `tu.principal_kind` dari satu resolver, menghapus `delegated` dari daftar
  non-switchable, dan mencabut penolakan namespace kode di gerbang).

  **Sisa Gelombang 8:** PR 8.3, 8.4, 8.5.

- **PUTARAN 13 Agustus 2026 (kedua belas) — GELOMBANG 8 DIBUKA. PR 8.1 mendarat,
  dan kali ini asumsi lintas-tenant DIPERIKSA SEBELUM rencananya ditulis.**

  [ADR-0089](adr/0089-a-partner-is-an-ordinary-tenant.md) (`sql/116`):
  `ModulePermissionScope` tetap `tenant | platform`, **tidak ada nilai
  `partner`**, dan jangkauan kemitraan dimodelkan sebagai DATA —
  `awcms_partners` + `awcms_partner_managed_tenants`, keduanya mendarat inert.
  Kalimat yang dijaga verbatim: _`scope` mengatur siapa yang boleh MEMEGANG
  sebuah permission; kemitraan mengatur OBJEK MANA yang disentuhnya._

  **Pemeriksaan yang dilakukan lebih dulu, dan enam hal yang ditemukannya.**
  Dua gelombang terakhir rencananya keliru dengan cara yang sama, jadi rencana
  Gelombang 8 (ditulis 9 Agustus, tiga hari dan dua ADR sebelum yang benar-benar
  mendarat) diperiksa terhadap kode nyata sebelum satu baris ditulis:

  1. **Sisi kepemilikan baris pemetaan tidak terjawab.** Rencana menetapkan
     baris grant ber-RLS pada tenant TARGET, tetapi tidak menetapkan apa pun
     untuk pemetaan partner→tenant, yang punya masalah persis sama. Dijawab di
     ADR-0089: TARGET, dengan pandangan partner lewat `SECURITY DEFINER` saat
     PR 8.4 memberinya pemanggil.
  2. **Registri partner TIDAK BISA berbentuk "satu baris di tenant partner".**
     Di bawah FORCE RLS tenant platform tak dapat menyisipkan baris ber-`tenant_id`
     tenant lain. Barisnya milik platform dan MENYEBUT tenant lain.
  3. **`sql/048` lebih besar dari kutipannya.** "Preseden fungsi `SECURITY
DEFINER` sempit" benar, tetapi `sql/048` sendiri mendokumentasikan bahwa di
     postur repo ini definer TIDAK mem-bypass RLS — perlu role pemilik NOLOGIN,
     policy baca eksplisit, daftar kolom tetap, dan `EXECUTE` terkunci. Siapa pun
     yang menulisnya di PR 8.4 harus membaca empat bagian itu, bukan satu.
  4. **Aturan non-switchable yang mendarat berbasis `origin_auth`, bukan kolom
     `switchable`** seperti yang rencana 8.2 tulis. Sesi turunan grant menuntut
     nilai `origin_auth` KELIMA (`delegated`) di CHECK `sql/115` — satu ALTER,
     tetapi ia harus ada di rencana 8.2 dan sekarang tercatat.
  5. **`actor_tenant_id` sudah ada** di `awcms_tenant_status_transitions`
     (`sql/092`, ADR-0054) — preseden bentuk dan FK untuk PR 8.3 yang rencananya
     tidak menyebut.
  6. **Role `support` yang diasumsikan PR 8.2 TIDAK ADA.** Role adalah baris
     per-tenant di `awcms_roles`; menyeragamkannya menuntut seed **plus
     backfill**, karena seed migration hanya menjangkau tenant yang dibuat
     SETELAHNYA dan tenant lama akan diam-diam 403.

  Urutan langkah chokepoint (aturan lintas-gelombang 1 & 2) diverifikasi masih
  utuh setelah PR 7.4 menyisipkan penolakan token seleksi di puncak: seleksi →
  machine → `tenant_suspended` → `module_disabled` → entitlement →
  `platform_scope_required` → `fetchGrantedPermissionKeys` →
  `narrowPermissionKeys` → `ownershipGrant`.

  **Satu kenaikan plafon yang perlu dilihat pemilik repo:**
  `BOUNDED_BY_DESIGN` naik **13 → 15**, dan kenaikan ini **tidak memenuhi bar
  yang ditulis PR 7.3** ("argumen keempat, bukan tabel keempat belas yang
  mengulang salah satu dari tiga"). Kedua tabel partner mengulang argumen
  KEPENGARANGAN, dan itu dinyatakan apa adanya alih-alih didandani sebagai
  kelas baru. Alasan menaikkannya tetap: bar itu ada untuk mencegah tabel yang
  tumbuh mengikuti TRAFIK diparkir di sana, dan tak satu pun dari keduanya
  begitu — sementara membacanya harfiah memaksa salah satu dari dua hasil yang
  lebih buruk (novelty palsu, atau deskriptor `generic` yang akan menghapus
  partner hidup). Bar-nya diganti yang lebih tajam: **kenaikan berikutnya wajib
  membawa argumen keempat ATAU memendekkan daftar di tempat lain.**

  Rantai tetap **41 gerbang**. Tidak ada gerbang ke-42 untuk union dua-nilai —
  penolakan `partner` hidup di `tests/platform-scoped-permissions.test.ts`,
  dibuktikan memerah oleh tiga mutasi (menambah `partner`, mengganti nama tipe,
  menghapus entri registry).

  **Sisa Gelombang 8:** PR 8.2 (ADR akses terdelegasi), 8.3 (atribusi dua sisi),
  8.4 (permukaan `/api/v1/partner/**`), 8.5 (kelas tulis machine credential).

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
  SoD base saat itu ship **1 rule** (`data_lifecycle.legal_hold_maker_checker`,
  ADR-0037) — rule ilustratif tambahan tetap di fixture. **Kini 2**: ADR-0094
  menambahkan `data_lifecycle.subject_erasure_maker_checker` (#557).

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
