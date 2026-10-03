---
name: awcms-browser-test
description: Tulis/jalankan browser E2E test AWCMS dengan Playwright di atas Bun. Gunakan saat butuh verifikasi lintas-layer nyata di browser (render halaman, form submit, navigasi, state SSR+client script bersamaan) — bukan pengganti unit/integration/API contract test dari skill `awcms-testing`, melainkan puncak piramida testing-nya (doc 07). Juga rujukan saat tidak ada tool browser interaktif tersedia dan verifikasi UI perlu dijalankan lewat CLI.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:4e5a03ff9c9d12131fa8a736a5af1f1c52b0c55c8c6746dcabaa780bb381be2f -->

# AWCMS — Browser E2E Test (Playwright + Bun)

Puncak piramida testing doc 07 (`docs/awcms/07_sprint_testing_production_readiness.md`
§Piramida: "sedikit end-to-end di puncak"). Skill `awcms-testing` mengatur
unit/integration/API-contract/security/performance test yang dijalankan
lewat `bun test`; skill ini mengatur lapisan E2E berbasis browser sungguhan
yang **tidak** dijalankan lewat `bun test` — beda test runner, beda tujuan.

## Kapan pakai skill ini

- Menambah/mengubah halaman Astro (SSR + inline `<script>` client) yang
  perilakunya baru benar-benar teruji lewat browser sungguhan — render
  awal, event handler, fetch ke API, state setelah reload.
- Sebelum PR untuk perubahan UI non-trivial, sebagai pelengkap
  `tests/integration/*.integration.test.ts` yang (per konvensi repo ini,
  lihat `tests/integration/menu-widget-response-shape.integration.test.ts`)
  **tidak** merender markup — integration test menguji fungsi data-layer
  yang dipanggil SSR, bukan HTML yang dihasilkan atau `<script>` client.
  Sisi markup-nya justru ditutup berkas datar
  `tests/admin-*-page-contract.test.ts`, yang berasersi terhadap sumber
  halaman tanpa browser.
- Situasi tanpa tool browser interaktif (mis. sesi CLI headless) yang perlu
  "coba di browser beneran" untuk memverifikasi sebuah fitur — jalankan
  spec Playwright alih-alih `curl` manual satu per satu.

## Kapan TIDAK perlu skill ini

- Logic murni (validator, calculator, state machine) → unit test biasa.
- Kontrak endpoint API (status code, shape response, auth/tenant header) →
  integration test yang memanggil `APIRoute` handler langsung, jauh lebih
  cepat dan tidak butuh browser sama sekali.
- Data-layer SSR admin page (fungsi yang dipanggil frontmatter) →
  integration test seperti `tests/integration/tenant-domain.integration.test.ts`,
  bukan spec Playwright — jangan duplikasi coverage yang sudah ada di sana
  dengan E2E yang lebih lambat.

## Setup (sekali per checkout)

```bash
bun add -d @playwright/test   # sudah ada di devDependencies repo ini
bun run test:e2e:install      # bun --bun playwright install --with-deps chromium — butuh root/apt-get
```

`--with-deps` menginstal shared library OS yang dibutuhkan Chromium
headless (`libnss3`, `libgtk`, dst) lewat `apt-get` — **butuh root**. Di
sandbox tanpa akses root (`sudo` gagal karena `no new privileges`), lewati
`playwright install` dan pakai browser sistem yang sudah terpasang lewat
env var `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (lihat `playwright.config.ts` —
sudah dibaca otomatis, contoh `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`).
Diverifikasi empiris berfungsi di lingkungan pengembangan ini (Bun 1.3.14,
Linux, `google-chrome` sistem) tanpa perlu `--no-sandbox` tambahan.

## Menjalankan test

E2E butuh app yang benar-benar jalan (bukan `webServer` auto-start
Playwright — app ini butuh koneksi Postgres hidup untuk boot sama sekali,
`webServer` tidak bisa menyediakan itu):

```bash
# Terminal 1 — DATABASE_URL wajib set, sama seperti integration test
bun run dev     # atau: bun run build && bun run preview

# Terminal 2
bun run test:e2e
```

`E2E_BASE_URL` override target selain `http://localhost:4321` default
(`playwright.config.ts`). **Sejak Issue #685** (epic #679,
platform-hardening) sudah jadi job CI tersendiri —
`.github/workflows/ci.yml`'s `e2e-smoke` — yang mengorkestrasi Postgres
service terisolasi, `db:migrate`, `bun run build`, `bun run start`, health
check, lalu `bun run test:e2e` sungguhan (bukan skip-jika-server-tidak-
jalan, karena CI memang menyediakan server+DB hidup). **Tetap belum**
bagian dari `bun run check` lokal (`check` tidak boot server/DB sendiri) —
lokal tetap manual seperti di atas.

Job-nya **satu fase**: start server, tunggu catch-all 404 menjawab, seed satu
tenant + owner + head office lewat `POST /api/v1/setup/initialize` sungguhan,
ekspor `E2E_TENANT_ID` yang dikembalikan, lalu `bun run test:e2e` sekali.
(Versi sebelumnya bagian ini menggambarkan job DUA fase dengan
`--grep-invert "@full-online-gate"` dan `admin-security-enabled.e2e.ts` /
`admin-security-disabled.e2e.ts`. **Itu `awcms-mini`, bukan repo ini** — spec
seperti itu tidak ada di sini dan `ci.yml` tidak punya fase kedua. Dikoreksi
24 Agu 2026.) Spec yang butuh env var boot-time non-default akan butuh fase
kedua ditambahkan — baca job `e2e-smoke` di `ci.yml` sebelum menulisnya, dan
catat bahwa project gelombang (`setup` → `read` → `write`) juga harus
dijalankan ulang di fase itu.

Urutan di dalam satu run BUKAN sekadar `fullyParallel` — lihat konvensi 7.

## Konvensi wajib

1. **Nama file `*.e2e.ts`, BUKAN `*.spec.ts`/`*.test.ts`**, di
   `tests/e2e/`. `bun test` secara default merekursif mencocokkan
   `*.test.*`/`*_test.*`/`*.spec.*`/`*_spec.*` — kalau spec Playwright
   memakai salah satu pola itu, `bun test` (dan `bun run check`) akan ikut
   mencoba menjalankannya sebagai file `bun:test` dan gagal (spec
   Playwright import `test`/`expect` dari `@playwright/test`, konteks
   runtime beda total dari `bun:test`). `.e2e.ts` sengaja tidak cocok
   pola manapun di atas — verifikasi: `bun test tests/e2e` selalu
   melaporkan "did not match any test files".
2. **Jalankan test runner lewat `bun run test:e2e` (→ `bun --bun playwright
test`), bukan `playwright test` polos.** AGENTS.md aturan #14
   ("Backend Bun-only") melarang menambah tooling Node.js kecuali Bun
   belum mendukung kebutuhan teknisnya, dengan pengecualian terdokumentasi
   — jadi ini bukan pilihan gaya, tapi kepatuhan wajib. `@playwright/test`'s
   binary punya shebang `#!/usr/bin/env node`; tanpa flag `--bun`, `bun run
test:e2e` (atau `bunx playwright test`) diam-diam menjalankan proses
   test-runner-nya di **Node.js sungguhan** (diverifikasi empiris:
   `process.versions` di dalam proses test menunjukkan `node`, bukan
   `bun`, tanpa `--bun`) — pelanggaran diam-diam terhadap aturan #14 yang
   mudah lolos review kalau tidak dicek langsung.
   `bun --bun playwright test` (dipakai `test:e2e`, pola sama seperti
   `"dev": "bun --bun astro dev"` yang sudah ada) memaksa Bun jadi runtime
   proses test-runner-nya sendiri — diverifikasi empiris `isBun: true` di
   dalam proses test, dan `chromium.launch()` + kedua test nyata di
   `login.e2e.ts` lulus konsisten di bawah mode ini (Bun 1.3.14, Linux).
   Ada laporan lama (oven-sh/bun#15679, terutama Windows, fix PR #31932
   belum merged per riset saat skill ini ditulis) soal `chromium.launch()`
   hang di bawah Bun native runtime lewat subprocess/IPC
   (`--remote-debugging-pipe` fd3) yang dipakai Playwright — **tidak
   tereproduksi** di Linux/Bun 1.3.14 saat skill ini diverifikasi. Kalau
   suatu saat `bun --bun playwright test` hang/gagal di platform/versi
   Bun tertentu (mis. Windows), itu kegagalan yang sudah diketahui
   kelasnya — jangan buru-buru ganti balik ke Node tanpa mengikuti proses
   pengecualian AGENTS.md #14 (izin maintainer + entry di
   `docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`); coba dulu
   versi Bun yang lebih baru.
3. **Satu `page.goto` per skenario nyata, assert lewat `getByRole`/`#id`
   selector yang stabil** — hindari selector berbasis teks visible yang
   berubah kalau string i18n diedit; pakai `id`/`name`/`data-*` yang
   sudah ada di markup (lihat `tests/e2e/login.e2e.ts` untuk contoh nyata:
   `#login-form`, `#tenant-id`, `#login-identifier`, `#password`,
   `#login-submit`, `#login-error`).
4. **Pilih target yang tidak butuh data ter-seed** kalau memungkinkan
   (mis. `/login` selalu render form yang sama terlepas dari isi DB) —
   spec yang butuh tenant/user nyata harus menyiapkan sendiri lewat SQL
   langsung atau `POST /api/v1/auth/login` di awal test (lihat memory
   `manual-admin-ui-smoke-test` project untuk pola bootstrap tenant+admin
   manual kalau setup wizard sudah terkunci).
5. **Error message di UI tidak boleh bocorkan detail internal** — kalau
   spec menguji jalur error, assert isi pesan TIDAK mengandung kata kunci
   seperti "stack"/"postgres"/nama fungsi internal, bukan cuma assert
   "ada pesan error" (lihat contoh di `login.e2e.ts`'s kedua test).
6. **CSP halaman `.astro`: script HARUS eksternal, jangan pernah inline
   atau conditional** (Issue #166, memory `awcms-admin-ui-notes`). CSP
   `default-src 'self'` (middleware) memblokir semua inline script/style.
   Karena itu setiap `<script>` halaman **wajib meng-import** dari
   `src/lib/ui/admin-form-client.ts` — import itu yang memaksa Astro
   mem-bundle-nya jadi file eksternal; script tanpa import di-inline-kan
   Astro dan **diblokir CSP** (perilaku mati diam-diam, tetap lolos build).
   DAN: Astro meng-hoist `<script>` saat **build**, jadi JANGAN membungkusnya
   di conditional runtime `{cond && (<script>…)}` — itu percuma (bundle tetap
   ter-ship) DAN membuat `prettier`/parser Astro gagal (`SyntaxError`).
   Taruh `<script>` sebagai elemen top-level tanpa conditional; guard di JS
   (`const el = getElementById(...); el?.addEventListener(...)`). CSS: pakai
   stylesheet eksternal (`build.inlineStylesheets: "never"`), bukan `<style>`
   inline, dan **jangan pernah atribut `style=` inline** — `default-src 'self'`
   tanpa `'unsafe-inline'`, jadi browser membuangnya diam-diam dan tak ada
   satu pun bagian build yang memberitahu.

   Jalankan E2E dan setiap sesi screenshot terhadap build produksi
   (`bun run build`, lalu `dist/standalone-entry.mjs`), **bukan** `dev`. Di
   bawah Vite, stylesheet disajikan sebagai `<script type="module" src="…css">`
   yang diblokir CSP ini — jadi screenshot dev-server bukan "sedikit berbeda",
   melainkan **halaman tanpa gaya sama sekali**, dan itu tampak seperti
   redesign yang rusak, bukan harness yang rusak.

   Dua jebakan harness yang menghasilkan "lulus" yang percaya diri tapi salah:
   - **`newContext({viewport: …})`, bukan `viewportSize`.** Yang terakhir
     bukan opsi valid, diabaikan diam-diam, dan setiap screenshot "mobile"
     lalu sebenarnya 1280px desktop berlabel mobile. Asersikan lebar yang
     kamu minta.
   - **Asersikan halamannya, bukan status-nya.** 200 bisa berarti penolakan
     yang dirender, dan komponen Astro yang melempar muncul sebagai 404
     dengan `ReferenceError`-nya hanya di log server. Cek elemennya, dan cek
     `document.documentElement.scrollWidth <= innerWidth` untuk overflow.

   Sapuan overflow (`tests/e2e/responsive-360.e2e.ts`, Issue #884) melakukan
   persis itu untuk setiap layar admin statis pada empat viewport: **360px**
   (ponsel tersempit), **640×360** (desktop 1280×720 pada zoom browser 200% —
   WCAG 2.1 SC 1.4.10 mengukur reflow dalam piksel CSS dan Playwright tak
   punya API zoom sungguhan, jadi viewport CSS yang setara dipakai; tingginya
   juga penting), **768px** (tablet potret) dan **1024px**. Tambahkan lebar
   sebagai entri `{width, height, why}` di tabel `VIEWPORTS`-nya — satu
   `test()` masing-masing, asersi yang sama, tanpa pengecualian atau toleransi
   lebih besar.

7. **Setiap spec baru WAJIB diklasifikasikan ke sebuah GELOMBANG, dan
   gelombang baca ditegakkan saat RUNTIME.** Semua spec berbagi SATU tenant
   ter-seed, jadi spec yang menulis mengubah apa yang dilihat spec yang
   membaca. `playwright.config.ts` menjalankan `setup` → `read` → `write`, dan
   `tests/e2e/support/e2e-waves.ts` menentukan spec mana yang mana. Berkas baru
   yang tidak ada di kedua daftar **tidak berjalan sama sekali**, dan
   `tests/e2e-wave-classification.test.ts` merah sampai ia ditambahkan — jadi
   keputusannya tak bisa dilewati, hanya bisa diambil. Tanyakan: apakah spec ini
   mengubah keadaan se-tenant (peran, enablement modul, kebijakan ABAC,
   penugasan)? Kalau ya → `WRITE_WAVE`. Kalau tidak → `READ_WAVE`, dan ia WAJIB
   mengimpor `test` dari `./support/e2e-read-wave`, bukan dari
   `@playwright/test` — fixture itu menggagalkan tes yang mengirim request
   `/api/` yang memutasi, jadi label gelombangnya DIPERIKSA, bukan dipercaya.
   Ini bukan birokrasi: tumpang tindihnya berharga TIGA diagnosis (dua di
   antaranya salah) dan menahan satu spec yang sudah bekerja di luar `main`
   selama satu putaran penuh.

## File referensi

- `playwright.config.ts` — config utama (testDir, testMatch, baseURL,
  launchOptions dengan escape hatch `PLAYWRIGHT_CHROMIUM_EXECUTABLE`), dan
  rantai project `setup` → `read` → `write`.
- `tests/e2e/support/e2e-waves.ts` — klasifikasi gelombang dan alasannya,
  termasuk dua kasus tumpang tindih yang nyata.
- `tests/e2e/login.e2e.ts` — contoh kerja nyata (bukan placeholder),
  sudah dijalankan dan lulus terhadap dev server + Postgres sungguhan
  sebagai bagian dari penambahan skill ini.

## Smoke aksesibilitas (`@axe-core/playwright`, Issue #877)

`@axe-core/playwright` **kini devDependency repo ini**
(`bun add -d @axe-core/playwright`) — paragraf di bagian ini yang dulu
menyatakan sebaliknya sudah dikoreksi setelah harness-nya sungguhan dikirim.
`tests/e2e/a11y-axe.e2e.ts` menjalankan `AxeBuilder` (tag WCAG 2.0/2.1 A+AA)
terhadap delapan rute admin representatif — `/admin`, `/admin/comments`,
`/admin/users`, `/admin/approvals`, `/admin/media`, `/admin/omes`,
`/admin/omes/jobs`, `/admin/site-profile` — dalam tema terang MAUPUN gelap
(lewat mekanisme sungguhan `localStorage["awcms_theme"]` yang dibaca
`theme-init-script.ts`, bukan override CSS atau emulasi
`prefers-color-scheme`), pada 360px dan desktop, dan gagal pada pelanggaran
`critical`/`serious` apa pun. Ia juga membuka `ConfirmDialog` ADR-0125
(tombol hapus `/admin/offices` — baris head office ter-seed selalu ada) dan
`ReasonPanel` (tombol nonaktifkan `/admin/modules` — modul non-core aktif
secara default), memindai masing-masing saat terbuka, lalu MEMBATALKAN —
tidak pernah mengonfirmasi/mengirim — sehingga tidak ada yang termutasi lewat
aplikasi. Itulah yang membuatnya READ_WAVE bukan WRITE_WAVE (lihat
`support/e2e-waves.ts`).

**Ia berjalan di bawah `test.use({ reducedMotion: "reduce" })`, dan itu
load-bearing, bukan kebetulan.** Animasi masuk `.fade-in-up` milik
`src/styles/motion.css` (240ms, berlaku pada setiap `.admin-section`)
benar-benar menurunkan `opacity` leluhurnya saat berjalan, dan axe menyampel
warna PIKSEL TERENDER alih-alih mempercayai computed style — pemindaian di
tengah animasi melaporkan penurunan kontras sesaat yang nyata (terukur saat
mendiagnosis spec ini: leluhur pada `opacity: 0.617` di tengah fade mengubah
pasangan token 5,19:1 menjadi 3,11:1 sesaat). `reducedMotion: "reduce"`
memakai mode WCAG 2.3.3 yang SUDAH diimplementasikan aplikasi sendiri
alih-alih `waitForTimeout` ad hoc — setiap pemindaian berjalan terhadap
keadaan mapan yang sama yang selalu dilihat pengguna reduced-motion, dan
larinya tetap cepat serta deterministik terlepas dari kecepatan mesin.

**Dijalankan sungguhan saat spec ini ditulis**, ia menemukan lima cacat
`critical`/`serious` yang sudah terlanjur dikirim dan tidak terlihat oleh
`bun run design:token-contrast:check` (pemeriksaan registry CSS murni, perlu
tapi tak cukup — lihat header skrip itu sendiri), karena tak satu pun dari
kelimanya adalah NILAI token yang salah:

1. Wordmark `.admin-brand` kehilangan nama aksesibelnya di bawah 768px —
   `admin.css` menyembunyikan `.admin-brand-text` dengan `display: none`
   pada lebar ponsel, dan `display: none` menghapus elemen dari komputasi
   nama aksesibel persis sebagaimana dari tata letak (`link-name`, serious).
   Diperbaiki dengan `aria-label="AWCMS"` pada link itu sendiri, tak
   bergantung pada anak mana yang tampak.
2. Label alasan `ReasonPanel` yang berupa `<span>` polos tanpa asosiasi
   programatik ke `<textarea>`-nya (`label`, critical). Diperbaiki dengan
   menjadikannya `<label for>` sungguhan.
3. `.reason-panel { display: flex }` yang berlaku TANPA SYARAT alih-alih
   di-scope ke `.reason-panel[open]`. Perilaku "tersembunyi saat tertutup"
   milik `<dialog>` native hidup di cascade origin user-agent, yang kalah
   dari aturan APA PUN di author-origin dengan spesifisitas sama atau lebih
   rendah terlepas dari `!important` — sehingga panel tetap bertata letak
   dan tampil di layar (`isVisible()` Playwright melaporkan `true`) bahkan
   setelah `.close()` menghapus atribut `open`-nya. Kelas bug yang sama
   dengan `[hidden]` kalah dari aturan `display` — catatan memori
   `html-hidden-loses-to-display-rule` menggeneralisasi melampaui `[hidden]`
   secara spesifik.
4. `.admin-logout` memakai `--color-text-muted` yang theme-aware pada latar
   sidebar yang selalu gelap alih-alih `--color-sidebar-text`
   (`color-contrast`, serious, terukur 3,07:1 terhadap ambang 4,5:1 untuk
   teks berukuran normal — `--color-text-muted` disetel untuk permukaan kartu
   admin terang/gelap, bukan keluarga permukaan sidebar yang selalu gelap
   sendiri).
5. Dashboard `.dd-alert` (peringatan deny-count dan sync-health di `/admin`)
   menggunakan `--color-danger-strong` sebagai TEKS pada `--color-surface`
   (`color-contrast`, serious, tema gelap saja: 3,81:1 terhadap ambang 4,5:1).
   `-strong` adalah peran solid-fill-under-white-text; teks pada permukaan
   polos adalah pekerjaan plain `--color-danger` (5,81:1 gelap; terang tidak
   berubah di 4,83:1 karena kedua token adalah `#dc2626` di sana). Diperbaiki
   dengan tukar token, dan pasangan `color-danger`/`color-surface` yang ada
   di `design-token-contrast-check.ts` kini mencantumkan `.dd-alert` sebagai
   konsumen.

Lihat `docs/awcms/admin-ui-parity-matrix.md` §7 dan komentar ledger
`scripts/client-asset-budget.ts` sendiri (`APP_BUDGET_BYTES` dinaikkan
248.033 → 248.055) untuk pencatatan lengkapnya.

## Status

Yang benar-benar ada (18 berkas spec di `tests/e2e/`):

- **Gelombang baca** — `login.e2e.ts` (alur login itu sendiri),
  `not-found.e2e.ts`, `cwv-lab.e2e.ts` (ber-env-gate `E2E_CWV_LAB`),
  `admin-offices.e2e.ts`, `a11y-axe.e2e.ts` (lihat di atas), dan tiga sapuan
  se-armada yang menemukan sendiri targetnya dari `src/pages/admin/**.astro`:
  `admin-screens-render.e2e.ts` (setiap layar merender untuk owner),
  `admin-deny-path.e2e.ts` (setiap layar ber-gate MENOLAK pengguna tanpa
  permission), `admin-read-only-access.e2e.ts` (operator read-only tenant —
  pemeriksaan platform-scope ADR-0053 saat runtime).
- **Gelombang tulis** — `admin-roles.e2e.ts`, `admin-users.e2e.ts`,
  `admin-abac-policies.e2e.ts`, `admin-modules-toggle.e2e.ts`, spec CRUD
  `admin-*-create` / `admin-offices-edit`, `api-body-auth-boundary.e2e.ts`
  (setiap rute API ber-body wajib menolak token bearer palsu SEBELUM membaca
  apa pun), dan `api-authorization-first.e2e.ts` (sesi ber-NOL permission wajib
  mendapat `403`, bukan jawaban validator — utangnya di-ledger di
  `support/authorization-first-ledger.ts` dan hanya boleh mengecil). Keduanya
  diklasifikasikan menurut apa yang DICOBANYA, karena tak satu pun yang
  dikirimnya dimaksudkan berhasil).

Ketiga sapuan sudah mencakup SETIAP layar admin, jadi layar baru tidak butuh
spec baru untuk sekadar DIMUAT — hanya butuh spec sendiri bila ada perilaku
yang layak diasersi. Jangan retrofit spec per-halaman tanpa alasan konkret
(prinsip repo ini: jangan bangun cakupan di luar scope issue yang sedang
dikerjakan).
