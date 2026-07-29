---
"awcms": patch
---

Segarkan graf graphify di atas dokumen dan skill yang sudah disinkronkan.

Jalur inkremental (`--update`): 105 berkas berubah (50 kode + 55 dokumen), 13
berkas terhapus. Hasilnya 8.247 node · 24.098 edge · 495 komunitas, ekstraksi 98%
EXTRACTED, biaya 791.182 token input.

Guard penyusutan graphify (#479) menyala pada −25 node dan **benar** menyala:
penurunan itu diverifikasi sah sebelum `force` dipakai — 13 berkas
`src/modules/news-portal/**` beserta dua test-nya nol di disk **dan** nol di
`git ls-tree HEAD`, sisa penghapusan modul ADR-0044 yang belum pernah masuk graf.
Diagnostik integritas pasca-build bersih: nol dangling, nol missing-endpoint, nol
self-loop, nol edge kolaps.

Berkas ber-titik di `graphify-out/` (labels, penanda path, sig) tidak ikut
ter-commit — aturan `graphify-out/.*` yang mendarat di PR sebelumnya bekerja
persis seperti maksudnya.
