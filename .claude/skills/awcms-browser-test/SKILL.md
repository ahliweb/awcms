---
name: awcms-browser-test
description: Tulis/jalankan browser E2E test AWCMS dengan Playwright di atas Bun. Gunakan saat butuh verifikasi lintas-layer nyata di browser (render halaman, form submit, navigasi, state SSR+client script bersamaan) — bukan pengganti unit/integration/API contract test dari skill `awcms-testing`, melainkan puncak piramida testing-nya (doc 07). Juga rujukan saat tidak ada tool browser interaktif tersedia dan verifikasi UI perlu dijalankan lewat CLI.
---

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
  lihat `tests/integration/blog-content-admin-ui.integration.test.ts`)
  **tidak** merender markup — integration test menguji fungsi data-layer
  yang dipanggil SSR, bukan HTML yang dihasilkan atau `<script>` client.
- Situasi tanpa tool browser interaktif (mis. sesi CLI headless) yang perlu
  "coba di browser beneran" untuk memverifikasi sebuah fitur — jalankan
  spec Playwright alih-alih `curl` manual satu per satu.

## Kapan TIDAK perlu skill ini

- Logic murni (validator, calculator, state machine) → unit test biasa.
- Kontrak endpoint API (status code, shape response, auth/tenant header) →
  integration test yang memanggil `APIRoute` handler langsung, jauh lebih
  cepat dan tidak butuh browser sama sekali.
- Data-layer SSR admin page (fungsi yang dipanggil frontmatter) →
  integration test seperti `tests/integration/tenant-domain-admin.integration.test.ts`,
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
lokal tetap manual seperti di atas. Job CI-nya berjalan **dua fase**
(lifecycle server terpisah): fase 1 dengan config default menjalankan
semua spec KECUALI `admin-security-enabled.e2e.ts` (yang di-tag
`@full-online-gate` di `test.describe`-nya sendiri, bukan dicocokkan lewat
judul prosa — `--grep-invert "@full-online-gate"`, tahan terhadap rename
judul di masa depan), fase 2 me-restart server
dengan `AUTH_ONLINE_SECURITY_ENABLED=true`/`AUTH_ONLINE_SECURITY_PROFILE=full_online`
lalu menjalankan hanya spec itu — ditemukan empiris saat mewire job ini
bahwa `admin-security-disabled.e2e.ts` dan `admin-security-enabled.e2e.ts`
menguji render YANG BERTENTANGAN dari halaman yang sama digerbangi env var
boot-time, jadi tidak bisa jalan terhadap satu instance server yang sama.
Spec baru yang butuh config server non-default lain (var env baru, dsb.)
kemungkinan butuh fase ketiga serupa — lihat `ci.yml`'s `e2e-smoke` job
untuk pola lengkapnya sebelum menambah.

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
   inline. Jalankan E2E terhadap build produksi (`build && start`), bukan
   `dev` (dev server menyuntik HMR inline yang diblokir CSP ini).

## File referensi

- `playwright.config.ts` — config utama (testDir, testMatch, baseURL,
  launchOptions dengan escape hatch `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).
- `tests/e2e/login.e2e.ts` — contoh kerja nyata (bukan placeholder),
  sudah dijalankan dan lulus terhadap dev server + Postgres sungguhan
  sebagai bagian dari penambahan skill ini.

## Status

Selain `login.e2e.ts`, sudah ada spec untuk `/admin/analytics`,
`/admin/security` (kedua profil gate), dan — sejak Issue #693 (epic #679
platform-hardening) — `admin-responsive-nav.e2e.ts` (sidebar/drawer
responsif: toggle, scrim, Escape, focus management, skip link),
`admin-access-users-migrated.e2e.ts`/`admin-tenant-domains-migrated.e2e.ts`
(migrasi ke primitive `DataTable`/`StatusBadge`/`ConfirmDialog`), dan
`admin-a11y-smoke.e2e.ts` (smoke test aksesibilitas otomatis berbasis
`@axe-core/playwright`, ditambahkan sebagai devDependency khusus untuk
issue ini — lihat docblock file itu untuk kenapa ini bukan pelanggaran
"Bun-only", AGENTS.md #14: itu soal runtime/tooling build, bukan dependency
yang dipakai dari dalam proses `bun --bun playwright test` yang sudah
berjalan di Bun). Belum ada spec untuk admin page lain (`blog/*`, dst) —
tambahkan sesuai kebutuhan issue, jangan retrofit semua admin page
sekaligus tanpa alasan konkret (lihat prinsip repo ini: jangan bangun
cakupan di luar scope issue yang sedang dikerjakan).
