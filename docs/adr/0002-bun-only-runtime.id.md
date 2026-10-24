🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0002-bun-only-runtime.md)

<!-- i18n-source-hash: sha256:ea616045c2ea18f94ee064b8f4394237ee29a25b6780dc81564f9bd48d544f58 -->

# ADR-0002 — Runtime & tooling Bun-only

- **Status:** Accepted
- **Tanggal:** 2026-07-05
- **Terkait:** `AGENTS.md` (aturan 14), `docs/awcms/10_template_kode_coding_standard.md` (§Standar platform backend), `docs/awcms/18_configuration_env_reference.md` (§Runtime & tooling)

## Konteks

Menjalankan dua runtime (Node.js + Bun) menambah percabangan perilaku, ukuran toolchain, dan permukaan bug. Bun menyediakan runtime, package manager, test runner, dan API bawaan (`Bun.serve`, `Bun.sql`) yang cepat dan cukup untuk kebutuhan base.

## Keputusan

Kami memutuskan **Bun-only**: seluruh backend, script, test, migration, build, dan tooling repository berjalan dengan `bun`. Dilarang menambah `node`/`npm`/`npx`/`pnpm`/`yarn` atau adapter yang **memaksa** runtime Node.js. Import `node:*` diizinkan (API bawaan Bun). Bin dengan shebang node (mis. `astro`, `vite`) dipanggil `bun --bun`. Pengecualian Node.js hanya boleh dengan izin maintainer dan pencatatan di audit standar.

## Konsekuensi

- **Positif:** satu toolchain, CI sederhana, performa lebih baik, ambiguitas runtime hilang.
- **Trade-off:** Astro belum punya adapter Bun first-party — SSR memakai seam `Bun.serve` atau `@astrojs/node` yang dijalankan di atas Bun (dicatat sebagai pengecualian tersanksi).
- **Netral:** dependency npm yang murni-JS dan kompatibel Bun tetap boleh dipakai.

## Alternatif yang dipertimbangkan

- **Node.js sebagai platform utama** — ditolak: menghilangkan keuntungan Bun dan menambah dua-runtime.
- **Bun + Node.js berdampingan** — ditolak: percabangan perilaku dan biaya pemeliharaan.

## Penegakan

Aturan ini dijaga oleh test, bukan oleh review. Job CI `Repo hygiene` meng-grep script `package.json`; `tests/bun-only-launch-manifests.test.ts` (Issue #1170) mencakup setiap tempat job atau worker **diluncurkan**:

- Menemukan otomatis `Dockerfile*`, `*.crontab`, `docker-compose*.yml` / `compose*.yml`, unit `*.service`, `*.sh`, dan `.github/workflows`, lalu menolak peluncur Node.js (`node`, `npm`, `npx`, `pnpm`, `yarn`, `tsx`, `ts-node`, ...) baik sebagai perintah, path, image container, maupun shebang. Daemon Socket.IO / `ws` yang hanya-Node ditolak oleh aturan yang sama.
- Setiap image `oven/bun` dan versi `setup-bun` harus sama dengan pin `packageManager` di `package.json` (kecuali sel floor `engines.bun` di CI).
- Setiap job terjadwal dan setiap job registry modul harus menunjuk ke script `package.json` yang Bun dari ujung ke ujung.
- Identitas proses: tiap entrypoint worker yang aman-diimpor di-import dalam proses anak dan harus melihat `process.versions.bun`, global `Bun`, dan `process.execPath` berupa binary Bun.
- Diizinkan, dan dicakup fixture negatif: built-in `node:*`, `node_modules`, `NODE_ENV`, `@astrojs/node` yang dijalankan di atas Bun, paket npm murni yang dijalankan Bun, serta komentar atau prosa yang sekadar menyebut Node.

**Memperluasnya.** Adapter pengiriman masa depan (StarSender/Meta, Mailketing v2, Telegram customer, publikasi sosial, gateway realtime Bun) otomatis tercakup tanpa mengubah test selama worker-nya adalah entri `jobs` modul atau baris crontab dan manifes peluncurannya berjenis yang ditemukan otomatis. Tambahkan target job-nya ke `CHANNEL_WORKER_TARGETS` di test agar penghapusannya dari registry gagal, bukan lolos diam-diam. Jenis manifes baru (misalnya manifes Kubernetes) memerlukan classifier di `discoverManifests` dan scanner di `tests/support/bun-only-launch-scan.ts`, beserta fixture positif dan negatif. Smoke test container yang ter-deploy (`docker run <image> bun -e ...`) memerlukan Docker daemon dan bukan bagian dari gerbang statis ini.
