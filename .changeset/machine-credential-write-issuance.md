---
"awcms": minor
---

feat(auth): kredensial mesin kelas-tulis bisa DITERBITKAN — dan izinnya sendiri (ADR-0092, #423)

`sql/121` membuka kelas tulis di skema dan di chokepoint, lalu sengaja berhenti:
kolomnya ada, gerbangnya menegakkannya, dan tidak ada rute yang bisa menerbitkan
satu pun. Ini menutup celah itu — tercatat sebagai sisa #423 nomor 1 di
`docs/PROJECT_STATE.md` §4.

IZINNYA BARU, DAN ITU SELURUH KEPUTUSANNYA. Bentuk yang jelas adalah menerima
`allowedWriteActions` pada `machine_credentials.create` yang sudah ada. Bentuk itu
salah, dan salahnya hanya terlihat kalau ditanyakan dari sisi grant: setiap peran
yang hari ini memegang `create` akan MENDAPAT hak mencetak kredensial yang mengubah
data pada hari rilis — pelebaran tanpa satu grant pun disunting, tanpa satu baris pun
di diff untuk di-review, dan tanpa apa pun di jejak audit yang menandainya. Program
#423 dibangun di atas aturan sebaliknya. Jadi kelas tulis mendapat aktivitas ketiga,
`machine_credentials_write.create` (`sql/122`), dan default-deny menahan sisanya:
sampai seseorang memberikannya dengan sengaja, rute itu menjawab 403 untuk setiap
permintaan tulis dan berperilaku persis seperti sebelum `sql/121`.

`revoke` TIDAK ikut dipecah, dan itu keputusan: saat insiden, siapa pun yang bisa
membunuh kredensial bocor harus bisa membunuh SETIAP kelasnya. Izin cabut yang
berhenti di kelas baca adalah alat penahanan yang gagal justru pada kredensial yang
paling perlu ditahan.

CIDR PADA KREDENSIAL BACA DITOLAK, dan arah ini tidak dijaga apa pun selain validator
ini. `isMachineCredentialWriteRefused` menjawab "tidak ditolak" untuk `read` SEBELUM
ia menyentuh daftar CIDR — jadi menyimpan jaringan pada kredensial baca menggambarkan
ikatan yang tidak pernah dikonsultasi. Basis data mengizinkannya, gerbang runtime
tidak peduli, dan operator akan mengira ia mengikatnya. Ditolak, bukan dibuang
diam-diam: membuangnya meninggalkan keyakinan yang sama.

CIDR YANG TIDAK BISA DI-PARSE DITOLAK DI PENERBITAN, meski penegakan sudah aman
terhadapnya. Keduanya sengaja menjawab pertanyaan berbeda: saat request, entri tak
terbaca MENYEMPIT ke nol; saat penerbitan, penyempitan diam itu justru cacatnya —
`10.0.0.0/33` menghasilkan kredensial yang terbaca terikat dan tidak pernah bisa
lolos. `10.0.0.0/` ikut ditolak karena `Number("")` adalah 0, dan prefix nol adalah
seluruh internet.

SATU CACAT DITEMUKAN OLEH TEST-NYA SENDIRI. Kelas tulis awalnya diturunkan dari aksi
yang LOLOS parse, bukan yang DIMINTA. Akibatnya permintaan ber-`delete` dengan CIDR
yang benar dikembalikan sebagai read-only, lalu dimarahi soal CIDR-nya — satu
kesalahan, dua pesan, dan yang kedua membantah apa yang jelas-jelas diminta.

DIVERIFIKASI DENGAN MENJALANKAN. Tiga mutasi memerahkan test yang tepat: menghapus
kolom dari satu dari TIGA daftar proyeksi (1 merah), menyamakan kedua cabang guard
menjadi `machine_credentials` (4 merah), dan menghapus penolakan CIDR-pada-kelas-baca
(6 merah). Kontrak konsumen ADR-0065 diregenerasi dengan sengaja — diff-nya hanya
prosa plus dua properti OPSIONAL, nol rename, nol penghapusan, nol field menjadi
wajib, sehingga build `awcms-astro` tidak bisa pecah karenanya.

`NOT_YET_SCREENED` tumbuh 59 → 60. Kredensial mesin belum punya layar sama sekali,
dan layar yang bisa mencetak kelas TULIS sementara kelas baca tetap panggilan API
adalah layar yang salah untuk dibangun lebih dulu.
