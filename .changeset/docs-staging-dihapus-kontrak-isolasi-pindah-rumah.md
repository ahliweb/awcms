---
"awcms": minor
---

docs: `staging` dihapus dari kosakata profil, kontrak isolasinya pindah rumah

Pagi ini dokumen-dokumen ini masih menulis `staging` sebagai profil deployment
yang sah — sebuah kapabilitas yang ditawarkan template kepada pemakainya.
Pemilik repo membatalkan itu: `staging` hilang seluruhnya, bukan sekadar tidak
dijalankan di sini. Yang tersisa tiga — `development`, `production`,
`offline-lan` — dan `deployment-profiles.md` kini mendokumentasikan tiga baris,
bukan empat.

**Yang tidak boleh ikut terbuang adalah kontraknya.** Database sendiri,
role/password sendiri, secret sendiri, integrasi keluar mati, tanpa tulis ke
bucket media produksi, provider DNS `manual`, token purge per-environment — itu
mahal untuk diturunkan ulang, dan sebagiannya dibayar dengan kesalahan nyata di
`awcms-micro`. Jadi ia dipindah-rumahkan, bukan dihapus: dari sebuah tingkatan
bernama menjadi aturan untuk **environment kedua apa pun** yang seseorang
dirikan di samping produksinya, di `environments.md` §Kontrak isolasi
environment kedua. Kegagalannya tidak pernah peduli nama tingkatannya.

Satu konsekuensi ikut ditulis alih-alih ditutupi: `staging` dulu satu-satunya
nilai `APP_ENV` yang sekaligus production-like DAN boleh menjadi sasaran DR
drill (`APP_ENV=production` tidak punya flag override sama sekali). Tanpa dia,
rehearsal dan drill terpaksa berjalan di dua database — runbook preflight
sekarang mengatakannya, bukan menyisakan resep yang akan ditolak interlock-nya
sendiri.

Catatan bertanggal **tidak** ditulis ulang. Probe 4 Agustus dan verifikasi host
11 Agustus tetap menyebut `awcms_staging`/`awcms-staging-varnish`, karena itu
memang nama sumber daya yang ada saat itu; yang ditambahkan hanyalah penunjuk
bertanggal bahwa sumber daya itu sedang dibongkar dan namanya bukan nama sebuah
profil.
