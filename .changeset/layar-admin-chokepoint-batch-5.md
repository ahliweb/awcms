---
"awcms": minor
---

feat(auth): tiga konsol besar berlayar-tunggal melewati chokepoint (#450, R3)

`blog`, `analytics`, `theming` berpindah ke `loadAdminScreen`. Ledger 12 → 9.

Ketiganya ber-aktivitas-jamak tetapi **state penolakannya selalu satu
permission** (`!canRead` / `!canView`), jadi menjadikan permission itu ENTRY
tidak mengubah siapa yang ditolak — ia hanya MENAMBAH gerbang yang tidak pernah
diterapkan pemeriksaan grant mentah. Itu yang membedakan ketiganya dari delapan
layar sisa, yang menolak hanya bila SEMUA permission bacanya absen; layar-layar
itu butuh rancangan tersendiri dan tidak dipaksakan ke sini.

`blog.astro` menggerbangi sebelas permission — terbanyak di repo ini.

## Satu gerbang sengaja TIDAK disentuh

`analytics.astro` sudah lebih dulu menyelesaikan `raw_detail.read` lewat
`evaluateFieldAccessInTransaction`, bukan `ssr.permissions.has(...)`. Ia
keputusan tingkat-FIELD tentang kolom mana yang dibentuk pada sebuah baris
(IP, user-agent, snapshot login), bukan tentang mencapai halaman — dan ia tidak
pernah menjadi bagian dari cacat R3. Jadi ia tetap apa adanya: migrasi ini tidak
punya alasan menulis ulang satu-satunya gerbang di layar itu yang sudah benar.

`analytics` juga kini meneruskan `now` yang sama ke `loadAdminScreen` yang
dipakainya menghitung rentang, jadi keputusan dan datanya dibaca pada satu jam.

## Dua contract test diperbaiki

`admin-blog-page-contract` dan `admin-theming-page-contract` mengekstrak klaim
layar hanya dari `permissionKey(...)`. `theming` tidak bisa sekadar memakai
ulang ekstraktor guard di berkasnya: yang itu mencocokkan ROUTE, yang menyusun
guard-nya dari konstanta `THEMING_*_ACTIVITY_CODE`, sementara layar menuliskan
kode aktivitasnya. Jadi ia mendapat matcher literal sendiri.
