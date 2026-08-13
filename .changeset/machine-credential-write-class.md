---
"awcms": minor
---

feat(auth): kredensial mesin boleh MENULIS, dan plafonnya tetap di kode (ADR-0092, #423)

Gelombang 8 PR 8.5, `sql/121` — **PR terakhir program #423**.

ADR-0049 mengirim kredensial mesin yang hanya bisa membaca, ditahan satu
kalimat: `MACHINE_CREDENTIAL_ALLOWED_ACTIONS` memuat tepat satu nilai. PR ini
membuka kelas kedua dan menjaga kalimat itu tetap yang memutuskan.

AKSI EFEKTIFNYA ADALAH `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS` ∩
`allowed_write_actions`, DAN URUTAN ITU BUKAN GAYA PENULISAN. Kalau daftar
aksinya menjadi kolom MURNI, satu restore backup, satu INSERT tangan, atau satu
jalur provisioning yang kehilangan `WHERE` bisa mencetak kredensial tulis
se-katalog — dengan SETIAP GERBANG DI REPO INI HIJAU, karena tidak satu pun
gerbang membaca isi baris. Plafonnya karena itu tinggal di tempat yang hanya
berubah lewat commit yang di-review; kolomnya daftar penyempit, bukan sumber
kebenaran.

ISINYA `create` DAN `update`, DAN SIFATNYA DIHITUNG BUKAN DINYATAKAN:
`WRITE_ALLOWED ∩ HIGH_RISK_ACTIONS = ∅` diuji dari KONSTANTA HIDUP. Daftar
literal "yang high-risk" akan menyimpang pada hari seseorang menambah aksi
high-risk baru, dan menyimpang DIAM-DIAM. Menurunkannya tidak bisa. Menambah
anggota ke plafon adalah ADR, dengan alasan yang sama ADR-0049 nyatakan untuk
himpunan baca: setiap penambahan adalah kelas baru hal yang bisa dilakukan token
curian, dan ia tak terlihat di diff endpoint yang tiba-tiba menerimanya.

KETIADAAN IP ADALAH DENY, DAN ITU BAGIAN YANG PALING MUDAH DILUPAKAN. Kredensial
tulis wajib terikat CIDR (CHECK basis data), dan gerbangnya menolak ketika
`clientIp` tidak tersedia. Tanpa itu, setiap rute yang belum meneruskan alamat
pemanggil DIAM-DIAM MEMATIKAN KONDISINYA — kontrol yang terbaca sebagai
ditegakkan dan sebenarnya tidak, kelas yang sudah dua kali muncul di gelombang
ini. Gagal tertutup membuat rute seperti itu menjawab 403, yang adalah laporan
bug alih-alih pelanggaran. `defineTenantRoute` mengisinya di KEDUA jalurnya,
termasuk SSE — tempat ia diresolusi sekali saat stream dibuka, karena satu
koneksi panjang punya satu peer dan menurunkannya ulang tiap tick hanya
mengundang keduanya berbeda pendapat.

Parser CIDR-nya ditulis tanpa dependensi (IPv4 + IPv6, termasuk bentuk
terkompresi) dan MENYEMPIT SAAT RAGU: CIDR yang tidak bisa di-parse tidak cocok
dengan apa pun alih-alih cocok dengan segalanya, dan arah itu diuji.

30 HARI, BUKAN 365. Kredensial baca boleh hidup setahun; kredensial tulis bisa
mengubah data, dan waktu sampai seseorang menyadari ia bocor diukur dalam
minggu. CHECK basis datanya 31 hari karena `created_at` DEFAULT `now()` adalah
instant MULAI TRANSAKSI — jebakan yang sama yang `sql/117` dokumentasikan.

DUA SENTINEL, DAN YANG LAMA VERBATIM. `machine_credential_readonly` ada di
sejarah decision log dan di ADR-0049; mendaur ulangnya untuk penolakan tulis
akan menulis ulang masa lalu bagi setiap konsumen log. Kelas tulis mendapat
`machine_credential_write_forbidden`.

Setiap kredensial yang ada TETAP BACA-SAJA: kedua kolom kosong, dan cabang
pertama setiap CHECK benar untuk baris kosong — tidak ada backfill, tidak ada
validasi yang bisa gagal saat migrasi.

DIVERIFIKASI DENGAN MENJALANKAN. 121 migrasi dari nol pada Postgres 16 nyata; 7
asersi membuktikan setiap CHECK MENOLAK, termasuk promosi kredensial baca lama
menjadi tulis tanpa CIDR. Tiga mutasi memerahkan test yang tepat: memasukkan
aksi high-risk ke plafon, menghapus penolakan `clientIp` yang absen, dan membuat
parser CIDR melebar saat ragu.

Tidak ada permukaan penerbitan untuk kelas tulis di PR ini — kolomnya ada,
gerbangnya menegakkannya, dan yang bisa menuliskannya belum ada.
