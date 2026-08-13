---
"awcms": minor
---

feat(admin): layar Machine credentials — mencabut token bocor berhenti menjadi panggilan API (#539)

Permukaannya ada sejak `sql/082` dan tidak pernah punya halaman. Alasan membangunnya
adalah kalimat yang sama yang menutup `/admin/partners`: **pencabutan adalah kontrol
yang dicari orang ketika sebuah token bocor, dan sampai halaman ini ada ia adalah
`POST` yang tidak akan diingat siapa pun di bawah tekanan.** #537 mempertajamnya
dengan membuka kelas yang bisa MENGUBAH data — dan sampai sekarang tidak ada tempat
untuk melihat kredensial mana yang bisa.

DUA IZIN, SATU FORM, DAN ITU BUKAN KOSMETIK. `machine_credentials.create` mencetak
kelas baca; `machine_credentials_write.create` mencetak kelas tulis. Fieldset tulis
hanya dirender bagi pemegang kunci kedua. Kalau halaman ini menurunkan keduanya dari
satu izin, pemisahan yang ADR-0092 buat justru untuk mencegah pelebaran grant akan
dibatalkan lagi — kali ini di UI, di mana tak ada gerbang yang melihatnya.

CHECKBOX AKSI TULISNYA DITURUNKAN dari `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`,
bukan ditulis tangan. Sepasang checkbox `create`/`update` yang ditulis tangan akan
tetap benar hari ini dan diam-diam tertinggal pada hari sebuah ADR melebarkan plafon
itu — form yang tertinggal dari konstanta, tanpa apa pun memerah.

TOKENNYA TAMPIL SEKALI, dan halaman ini karena itu **tidak reload** sesudah
menerbitkan — respons penerbitan adalah satu-satunya tempat plaintext-nya ada, dan
reload mencetak kredensial yang tak bisa dipakai siapa pun lalu harus dicabut. Sama
persis bentuk `/admin/partners` untuk kode akses.

CIDR HANYA DIKIRIM BERSAMA KELAS TULIS. API menolak `allowedIpCidrs` pada kredensial
baca karena gerbangnya tak pernah mengkonsultasinya di sana; halaman yang selalu
mengirim field itu akan mengubah penolakan jujur tersebut menjadi 422 pada setiap
penerbitan baca. Plafon kadaluwarsa ikut menyempit ke 30 hari begitu satu aksi tulis
dicentang — ditegakkan server, ditampilkan di sini supaya batasnya terlihat saat
memilih, bukan sesudah form terisi.

DAFTAR IZINNYA ADALAH SELURUH KATALOG, dan halamannya mengatakan artinya.
`allowedPermissionKeys` MENYEMPITKAN: himpunan efektifnya adalah irisan dengan yang
dipegang akun layanan, jadi menyebut kunci yang tak dipegang akun tidak memberi
apa-apa. Menampilkan hanya kunci milik akun butuh endpoint per-akun yang tidak ada;
menyiratkan bahwa daftar itu sebuah pemberian jauh lebih buruk.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Lima mutasi memerahkan
test yang tepat: penerbitan me-reload (token hilang), fieldset tulis digerbangi izin
baca, checkbox ditulis tangan alih-alih diturunkan, CIDR selalu dikirim, dan satu
kunci ditinggal di ledger padahal layarnya ada. Dua asersi sumber sengaja dibuat
tahan-whitespace — asersi yang terikat indentasi memerah pada kode yang benar begitu
formatter memindahkan satu baris, kegagalan yang `/admin/partners` sudah catat sekali.

`NOT_YET_SCREENED` **menyusut 62 → 58**, dan itulah gunanya angka itu.
