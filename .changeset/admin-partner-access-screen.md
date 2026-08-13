---
"awcms": minor
---

feat(admin): layar Partner access — pencabutan berhenti menjadi panggilan API

`/admin/partners`, menutup tiga entri terakhir `partner_access` di
`NOT_YET_SCREENED`. Alasannya bukan kelengkapan: **pencabutan adalah kontrol
yang dicari pelanggan ketika ada yang salah**, dan sampai halaman ini ada ia
adalah `DELETE` ke API — yang bekerja, dan yang tidak akan diingat siapa pun di
bawah tekanan.

Empat aksi, tiga permission, dan pemasangannya sengaja: menyewa dan memutus
sama-sama `configure`; menyetujui dan mencabut sama-sama `assign`. Memisahkan
salah satunya menghasilkan kombinasi yang tidak boleh ada — seseorang yang bisa
memasukkan partner dan tidak bisa mengeluarkannya.

TIDAK ADA PARTNER PICKER, DAN HALAMANNYA MENGATAKAN KENAPA. Sebuah `<select>`
berisi partner akan menjadi direktori kemitraan lintas-tenant yang ADR-0089
tolak sebagai tabel, dibangun ulang di UI. Pelanggan mengetikkan tenant id yang
partnernya berikan di luar jalur — dan halaman menjelaskan itu alih-alih
meninggalkan kolom UUID tanpa keterangan.

KODE AKSES DITAMPILKAN SEKALI DAN HALAMANNYA TIDAK RELOAD. Ini satu-satunya
layar admin yang membaca body respons alih-alih memuat ulang, karena respons
persetujuan adalah satu-satunya tempat kode itu terbaca. Reload sesudah
menyetujui berarti kredensial hilang dan grant yang harus dicabut lalu
disetujui ulang. `sendJsonForData` ditambahkan untuk itu, dengan setengah
error-nya tetap sempit: gagal berarti `data: null` dan `errorCode` yang sama,
sehingga panggilan yang gagal tetap tidak bisa membocorkan apa pun.

Role sistem disaring dari picker karena penebusan menolaknya
(`materializeMembership`). Menawarkan `owner` akan gagal di ujung jauh
penyerahan kode di luar jalur — momen terburuk untuk mengetahuinya.

Test kontrak halamannya menemukan satu jebakan saat ditulis: asersi
`not.toContain('action: "revoke"')` atas seluruh berkas GAGAL pada kode yang
benar, karena rutenya juga menulis baris audit ber-`action: "revoke"`. **Action
audit dan action guard adalah dua hal berbeda di repo ini** — permukaan restore
office membuat pembedaan yang sama — dan test yang mencampurnya memerah pada
kode yang benar, yang lebih buruk daripada tidak menguji. Asersinya kini membaca
konstanta guard saja.

`NOT_YET_SCREENED` menyusut dari 62 ke 59, dan itulah gunanya ia satu arah.
