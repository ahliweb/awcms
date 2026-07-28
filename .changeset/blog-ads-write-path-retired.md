---
"awcms": minor
---

ADR-0044 §4 Fase 2, langkah ketiga: jalur TULIS iklan free-URL ditutup, dan
gerbang kesiapan yang membuat penghapusan tabel bisa dibuktikan alih-alih
dipercaya.

`POST /api/v1/blog/ads` dan `PATCH /api/v1/blog/ads/{id}` sekarang menjawab
**410 ENDPOINT_RETIRED**, tanpa auth dan tanpa sentuhan basis data. Keduanya
menyimpan `imageUrl` teks bebas — URL apa pun yang diketik admin, dirender
langsung ke `<img src>` halaman publik. Itulah bypass managed-media yang ditutup
ADR-0036, dan ia terbuka selama masih ada rute yang bisa menulisnya.

**Urutannya yang menjadi isi perubahan ini.** Job ingest memindahkan apa yang
ada saat ia berjalan. Jalur tulis yang masih terbuka membiarkan editor membuat
iklan free-URL di jendela antara ingest dan penghapusan — iklan yang tidak
bermigrasi ke mana pun dan lenyap saat tabelnya hilang, tanpa satu pun laporan
menyebut ia pernah ada.

Menutup `POST` saja tidak cukup: `PATCH` bisa menulis ulang `imageUrl` pada
iklan yang sudah ada — bypass yang sama lewat rute yang lebih senyap, dan yang
tidak menghasilkan baris baru untuk diperhatikan siapa pun.

`GET` dan `DELETE` sengaja bertahan. Operator yang menyelesaikan laporan residu
harus bisa membaca baris yang disebut laporan itu, dan mempensiunkan yang tidak
ingin ia buat ulang — `blog:ads:drop-readiness` menghitung iklan yang
soft-delete sebagai sudah-diputuskan.

**`bun run blog:ads:drop-readiness`** menjawab "bolehkah kedua tabel lama
dihapus sekarang?" dari data, dan keluar non-nol selama jawabannya belum.
Migrasi penghapusan tak bisa dibatalkan dan membawa serta iklan situs hidup;
seluruh pengaman epik ini menjadi hiasan bila langkah terakhirnya diambil atas
dasar ingatan seseorang bahwa ia sudah menjalankan ingest. Kolom
`source_legacy_ad_id` (`sql/079`) membuatnya jadi sebuah join.

Iklan lama terhitung sudah-diputuskan bila ada baris penerus yang menyebutnya,
ATAU bila ia soft-delete. Selain itu memblokir. **Tidak ada flag override** —
gerbang yang bisa disuruh lulus adalah gerbang yang tak perlu dipenuhi siapa
pun.

Catatan proses: mutasi pertama saya terhadap query kesiapan (menghapus predikat
`p.tenant_id = a.tenant_id`) **lolos ketujuh test** — RLS diam-diam mengerjakan
apa yang diklaim predikat itu. Dua mekanisme diklaim, dan test yang tak bisa
membedakannya hanya membuktikan setidaknya satu ada. Test kedelapan menjalankan
penilaian yang sama sebagai peran admin yang melewati RLS sepenuhnya, sehingga
predikatnya menjadi satu-satunya penghalang — dan mutasi itu kini merah.
