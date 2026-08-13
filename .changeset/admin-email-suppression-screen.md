---
"awcms": minor
---

feat(admin): layar Email suppression — alamat yang diam-diam berhenti menerima surat kini bisa dilihat (#544)

Ledger cakupan layar menamai kelompok ini sendiri sebagai salah satu dari dua yang
**bukan kosmetik**: sebuah alamat yang di-suppress diam-diam berhenti menerima surat,
**termasuk reset password**, dan tidak ada yang bisa mendaftar atau membersihkannya
dari sebuah halaman.

Itu mode kegagalan dukungan yang lengkap: orang tidak bisa masuk, meminta reset,
tidak menerima apa-apa, dan tidak seorang pun di sisi operator punya cara melihat
kenapa. Diagnosisnya sampai sekarang adalah query SQL yang harus diketahui
keberadaannya.

`alreadySuppressed` ADALAH JAWABAN, BUKAN ERROR — dan itu yang membentuk halamannya.
Daftar suppression hanya menyimpan alamat ter-MASK (tak pernah yang mentah) dan
dibatasi 100 baris, jadi "apakah alamat INI di-suppress?" tidak bisa dijawab dengan
membaca tabelnya. Endpoint-nya menjawab 200 ber-`alreadySuppressed` alih-alih 409,
sehingga satu request melayani "tambahkan" DAN "sudah ada belum". Halaman ini
memunculkan jawaban itu sebagai pemeriksaan yang memang ia lakukan; me-reload di
cabang itu akan membuang satu-satunya hal yang ditanyakan operator. Bukan
pengungkapan baru — itu yang selalu dibalas `POST` — tetapi membiarkannya tanpa label
membuat pertanyaan dukungan paling umum tampak tak terjawab.

SELECT ALASANNYA DITURUNKAN, bukan disalin. `SUPPRESSION_REASONS` kini diekspor dari
domain dan `KNOWN_REASONS` diturunkan darinya, sehingga hanya ada SATU tempat untuk
disunting. Salinan empat nilai di halaman akan tetap benar hari ini dan tertinggal
diam-diam pada hari nilai kelima ditambahkan — form menawarkan empat dari lima, tanpa
apa pun memerah.

Layar tersendiri, bukan bagian dari `/admin/email-templates`: orang yang menjangkau
ini sedang menjawab "kenapa surat kami tidak sampai", bukan menyunting teks — dan
kontrol yang tidak bisa DITEMUKAN sama saja dengan yang tidak ada.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Empat mutasi
memerahkan test yang tepat: cabang `alreadySuppressed` diganti reload, satu `<option>`
ditulis tangan alih-alih diturunkan, daftar alasan domain dikosongkan (membuktikan
asersi "diturunkan" tidak hampa), dan satu kunci ditinggal di ledger.

`NOT_YET_SCREENED` **menyusut 58 → 55**.
