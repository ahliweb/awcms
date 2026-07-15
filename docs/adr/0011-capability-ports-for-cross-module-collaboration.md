# ADR-0011 — Capability ports untuk kolaborasi lintas-modul

- **Status:** Accepted
- **Tanggal:** 2026-07-11
- **Pengambil keputusan:** Tim modul `blog_content`/`news_portal`
- **Terkait:** Issue #681 (epic #679, platform-hardening), Issue #636/#637 (asal mula import lintas-modul yang diperbaiki di sini), `src/modules/_shared/module-contract.ts` (`ModuleCapabilityContract`)

## Konteks

`blog_content` dan `news_portal` saling meng-import kode `application`/`domain` satu sama lain secara langsung sejak Issue #636 (`blog_content` butuh registry media R2 milik `news_portal`) dan Issue #637 (`news_portal`'s homepage composer butuh query post/kategori milik `blog_content`). Kedua arah ini terdokumentasi eksplisit sebagai keputusan sadar saat itu ("cross-module TypeScript import ≠ `dependencies` array, yang cuma mengatur urutan enable/disable") — tapi hasil akhirnya tetap sebuah cycle di level SOURCE CODE: `blog-content/application/news-media-reference-gate.ts` meng-import `news-portal/application/news-media-object-directory.ts`, sementara `news-portal/application/homepage-section-composer.ts` meng-import `blog-content/application/public-blog-directory.ts` DAN `blog-content/application/news-media-reference-gate.ts` (yang, seperti disebut di atas, balik meng-import `news-portal`) — rantai tiga-hop yang sama sekali tidak terlihat dari `module.ts`'s `dependencies` array manapun.

Audit statis epic #679 menandai ini sebagai risiko: dua modul tidak bisa dipahami, diuji, atau (secara hipotetis) dipisah tanpa yang lain, meski registry metadata terlihat bersih.

## Keputusan

Kami memutuskan untuk memisahkan **kapabilitas** (interface yang disepakati) dari **implementasi** (kode nyata satu modul), lewat pola ports-and-adapters minimal:

1. **Port** — interface TypeScript murni di `src/modules/_shared/ports/*.ts`, TIDAK meng-import apa pun dari modul mana pun. `NewsMediaPort` (kapabilitas milik `news_portal`, dipakai `blog_content`) dan `PublicContentPort` (kapabilitas milik `blog_content`, dipakai `news_portal`).
2. **Adapter** — implementasi konkret satu port, hidup di modul PEMILIK kapabilitas itu sendiri (`news-portal/application/news-media-port-adapter.ts`, `blog-content/application/public-content-port-adapter.ts`). Modul lain TIDAK PERNAH meng-import file adapter modul lain secara langsung.
3. **Composition root** — route handler (`src/pages/api/v1/**`, `src/pages/news/**`, `src/pages/blog/**`) yang meng-import adapter konkret dan menyuntikkannya (parameter fungsi biasa, bukan DI framework) ke fungsi `application` modul lain yang butuh kapabilitas itu. Route handler SUDAH menjadi lapisan terluar yang boleh meng-import lintas-modul (konvensi yang sudah ada, bukan baru) — inilah yang menjadikannya composition root yang natural, tanpa infrastruktur baru.
4. `renderContentJsonToHtml`'s bagian gallery-rendering (dipakai KEDUA modul, sebelumnya `news_portal` meng-import fungsi `blog_content` untuk ini) dipindah ke `_shared/rendering/gallery-block-renderer.ts` — kode yang genuinely dipakai bersama pindah ke tanah netral, bukan salah satu modul "meminjam" dari yang lain.
5. `ModuleDescriptor` (`_shared/module-contract.ts`) mendapat field opsional baru, `capabilities?: {provides, consumes}` — dokumentasi terstruktur tentang hubungan port ini, terpisah dari `dependencies` (yang tetap murni untuk urutan enable/disable lifecycle).
6. Test struktural baru (`tests/unit/module-boundary.test.ts`) men-scan `blog-content`/`news-portal`'s `application`/`domain` tree untuk import langsung ke tree modul lain, gagal loud bila ditemukan — mencegah regresi diam-diam ke pola lama.

## Konsekuensi

- **Positif:** `blog_content`/`news_portal`'s `application`/`domain` masing-masing sekarang genuinely tidak tahu-menahu soal implementasi satu sama lain — hanya soal bentuk data (DTO) dan interface (port) yang independen dari siapa yang mengimplementasikannya. Diverifikasi otomatis, bukan cuma didokumentasikan.
- **Positif:** DTO port (`PublicContentPostSummaryDTO`, dll) sengaja BUKAN re-export tipe asli modul pemilik — port tidak pernah menciptakan source dependency ke implementasi hari ini.
- **Negatif/trade-off:** setiap fungsi yang butuh kapabilitas lintas-modul sekarang menerima satu parameter tambahan (port), dan setiap route handler pemanggilnya harus meng-import adapter konkret + menyuntikkannya — sedikit lebih verbose dibanding import langsung yang lama, harga yang sepadan untuk menghapus cycle nyata.
- **Netral:** `dependencies` array KEDUA modul tetap sengaja TIDAK menyertakan satu sama lain (keputusan Issue #632 yang masih berlaku) — `capabilities` adalah lapisan dokumentasi/verifikasi TERPISAH untuk hubungan level-source, bukan pengganti atau tambahan pada graf lifecycle enable/disable.

## Alternatif yang dipertimbangkan

- **Biarkan cycle apa adanya, cukup dokumentasikan** — ditolak: audit epic #679 eksplisit menandainya sebagai risiko P0, dan tanpa test struktural, siapa pun bisa diam-diam menambah edge baru di masa depan tanpa sadar sedang memperdalam cycle yang sama.
- **Gabungkan `blog_content`+`news_portal` jadi satu modul** — eksplisit di luar cakupan issue #681 sendiri ("Merging the two modules" ada di §Out of scope) — kedua modul punya lifecycle/permission/scope produk yang genuinely berbeda (blog dasar vs. lapisan editorial R2-only), menggabungkannya menghapus fleksibilitas enable/disable independen yang sudah ada.
- **Service-locator/registry global untuk adapter** (bukan parameter injeksi manual) — ditolak: repo ini tidak punya DI framework/container di manapun, menambah satu HANYA untuk dua modul ini adalah kompleksitas baru yang tidak proporsional; parameter fungsi biasa cukup dan konsisten dengan gaya "fungsi murni + `tx: Bun.SQL` eksplisit" yang sudah dipakai di seluruh codebase.
