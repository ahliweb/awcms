---
"awcms": minor
---

feat(auth): empat layar admin ber-aktivitas-tunggal melewati chokepoint (#450, R3)

Gelombang 1 batch 4: `index`, `blog-pages`, `blog-taxonomy`, `media` berpindah
ke `loadAdminScreen`. Ledger 18 → 14.

`index.astro` adalah halaman pendaratan yang pertama dilihat setiap operator,
jadi ia juga tempat sebuah `deny` ABAC atas `reporting.dashboard.read` paling
kasat mata inert-nya.

`blog-pages` menggerbangi delapan permission — jumlah terbanyak dari layar mana
pun sejauh ini — dan ketujuh afordans tulisnya kini diputuskan lewat `can(...)`
pada transaksi yang sama.

## Satu keputusan yang sengaja tidak ditulis rapi

Ketujuh `can(...)` di `blog-pages.astro` ditulis satu per satu, bukan di-loop
atas array aksi. Versi loop-nya lebih enak dibaca dan **membuat ketujuhnya tidak
terlihat** oleh `admin:screen-coverage:check`, yang matcher-nya hanya membaca
triple literal: layar tetap menggerbangi dengan benar sementara gerbangnya
melaporkan tujuh permission sebagai tidak punya layar sama sekali. Alasannya
ditulis di layar itu supaya tidak "dirapikan" kembali nanti.

## Tiga contract test diperbaiki, sekelas dengan batch 1

`admin-blog-taxonomy`, `admin-blog-pages`, dan `admin-media` mengekstrak klaim
layar hanya dari `permissionKey(...)`. Sesudah migrasi sebuah layar menyatakan
guard-nya sebagai objek literal `AccessRequest` — bentuk yang SAMA dengan
rute — sehingga test-nya memerah. Membiarkannya berarti test itu menuntut layar
tetap memutuskan dari himpunan grant mentah, yaitu cacatnya sendiri.

Ekstraktor `pageKeys`/`pageTriplesFrom` kini menggabungkan ekstraktor guard yang
sudah ada di berkas yang sama. Yang dipatok tetap sifatnya — "layar ini
menggerbangi tepat kedelapan/keempat/kedua ini" — bukan sintaks yang kebetulan
mengungkapkannya.

Kebersihan: pemeriksaan bentuk `"tenantActivity" in result` di `index.astro`,
yang ada persis karena `withTenant` mengembalikan `Response` yang truthy saat
circuit terbuka, tidak lagi diperlukan — `AdminScreenOutcome` memisahkan
`allowed`/`denied`/`error` secara langsung. `DASHBOARD_PERMISSION` dipertahankan
sebagai konstanta TAMPILAN: ia dirender di state ditolak supaya operator bisa
membaca kunci persis yang harus dimintanya.
