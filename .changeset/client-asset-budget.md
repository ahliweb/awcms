---
"awcms": patch
---

Anggaran ukuran aset klien, digerbangi pada `build` (menutup celah C6).

Diukur 2026-08-05, `dist/client` berbobot 139.048 byte dalam 45 berkas (35 JS = 77.449 B, 10 CSS = 61.599 B; berkas terbesar `css/public-content.css` 16.800 B) — momen termurah untuk memasang anggaran, karena setiap momen berikutnya berangkat dari baseline yang lebih besar. `scripts/client-asset-budget.ts` gagal bila total melewati 180.000 B (baseline + ~29%) atau satu berkas melewati 21.000 B (terbesar + 25%); dua aturan karena dua mode kegagalan berbeda — akresi pelan versus satu island yang mem-bundle dependensi 200 KB. `dist/client` yang tidak ada atau kosong juga GAGAL keras ("jalankan build dulu"), bukan lolos senyap. Target `build` kini merantai `bun run build:asset-budget:check` setelah `astro build`, sehingga gerbang ikut jalan di CI Quality dan release tanpa entri rantai `check` baru. Tidak ada kelas aset yang dikecualikan: seluruh isi `dist/client` hari ini adalah app shell JS+CSS (gambar konten hidup di R2 via `media_library`), jadi pengecualian dini hanya akan jadi titik buta.
