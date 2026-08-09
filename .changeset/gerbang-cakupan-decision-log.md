---
"awcms": patch
---

feat(gerbang): `access:decision-log:coverage:check` mengunci jejak keputusan otorisasi

`authorizeInTransaction` menulis satu baris `awcms_abac_decision_logs` di setiap
jalur terminal. Properti itulah yang membuat sistem ini bisa menjawab "kenapa
permintaan ini ditolak" dari sebuah tabel alih-alih dari tebakan — dan ia
ditopang **kebiasaan review saja**.

Program model keanggotaan menambahkan **tiga** cabang keluar baru ke fungsi yang
sama: `TENANT_SUSPENDED`, `ENTITLEMENT_REQUIRED`, dan penolakan
principal/delegasi. Regresi paling mungkin di seluruh program adalah salah satu
darinya kembali lebih awal tanpa menulis log. Tidak ada yang akan menangkapnya:
suite default berjalan **tanpa** PostgreSQL, jadi "sebuah baris ditulis" tidak
bisa di-assert di sana; permintaannya tetap ditolak dengan benar, jadi tidak ada
test yang gagal dan tidak ada pengguna yang mengeluh. Yang hilang hanya jejaknya
— pada penolakan yang paling perlu dijelaskan ke pelanggan.

Gerbang ini **hijau hari ini**. Nilainya bukan menemukan cacat sekarang,
melainkan mengunci properti sebelum tiga cabang baru mendarat di atasnya.

**Aturan naif salah, dan membaca guard-nya yang menunjukkan itu.** "Setiap
`return` didahului `recordDecisionLog(`" keliru di dua arah sekaligus:

- Return `401 AUTH_REQUIRED` **tidak bisa** menulis log — ia menyala ketika
  `context` bernilai null, jadi tidak ada `tenantUserId` untuk mengatribusikan
  barisnya. Menuntut log di sana berarti menuntut baris yang mustahil. Ia masuk
  daftar pengecualian ber-alasan.
- Return `403 SOD_CONFLICT` didahului `recordDecisionLog` yang mencatat sebuah
  **allow** — keputusan ABAC-nya memang allow, dan SoD adalah deny aditif yang
  dicatat di `awcms_sod_conflict_evaluations`. Aturan "log tepat sebelum return"
  meluluskannya karena alasan yang salah; aturan "log di blok yang sama"
  menggagalkannya karena alasan yang salah.

Jadi aturannya **dominansi**, diaproksimasi secara leksikal: untuk sebuah return,
telusuri rantai blok yang melingkupinya dan cari `recordDecisionLog(` pada
kedalaman blok itu sendiri, sebelum posisi return-nya. Log di dalam
`if (machine && …) { … }` karena itu mencakup return cabang itu dan **tidak**
mencakup return di luarnya.

Lima mutasi memerahkan gerbang, diverifikasi lokal. Yang paling menentukan:
memindahkan panggilan log ke **cabang saudara** — ia tetap ada di berkas dan
tetap tekstual lebih dulu dari return-nya, dan gerbangnya tetap **MERAH**. Itu
yang membedakan dominansi dari regex. Empat lainnya: cabang keluar baru tanpa
log; log dominan dihapus; fungsi target di-rename (gerbang tidak boleh diam-diam
OK); dan pengecualian basi untuk kode yang kini sudah menulis log.

Batas yang ditulis, bukan disembunyikan: pengecualian di-key oleh **kode error**
(bukan offset baris, yang membusuk tiap kali ada suntingan di atasnya), sehingga
return kedua yang memakai kode yang sudah dikecualikan akan mewarisi
pengecualiannya. Dan gerbang ini menalar **satu** fungsi —
`evaluateFieldAccessInTransaction` sengaja di luar cakupan dan sengaja tidak
menulis log.

Nol perubahan runtime. Rantai `check` 36 → 37 segmen.
