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
