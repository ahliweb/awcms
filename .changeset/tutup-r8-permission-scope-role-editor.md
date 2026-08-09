---
"awcms": patch
---

fix(keamanan): permission ber-`scope: 'platform'` berhenti bisa dilekatkan ke role tenant biasa (R8)

`listPermissionCatalog` mengembalikan **seluruh** katalog global tanpa predikat
`scope`, jadi editor role menawarkan permission ber-`scope: "platform"`
(ADR-0053) kepada tenant mana pun, dan `grantPermissionToRole` menerimanya.

**Ini bukan privilege escalation, dan penting untuk mengatakannya.** Gerbang
platform di chokepoint selalu menolaknya saat runtime, dan ia memutuskan dari
deklarasi **sisi kode** — jadi tidak ada baris basis data yang bisa mengangkatnya.

Yang hilang adalah **redundansi**, dan **kejujuran**. Seorang administrator bisa
memberikan permission itu, melihatnya tercantum di role, lalu menyimpulkan bahwa
ia berlaku. Ia tidak. Grant yang **tampak diberikan** tetapi tidak akan pernah
berlaku adalah jawaban yang salah untuk "siapa bisa melakukan apa" — persis
jawaban yang harus dipercaya review akses berikutnya. ADR-0058 menghabiskan satu
dokumen penuh pada kelas ambiguitas itu.

**Nol migrasi.** Rancangan pertama memberi tiap role kolom `permission_scope`.
Itu pemisahan yang lebih halus — ia akan membedakan role di dalam tenant platform
yang boleh dan tidak boleh memegang permission platform — tetapi **bukan R8**, dan
ia menuntut migrasi, kolom baru, serta penegakannya sendiri.

Batasan yang R8 gambarkan lebih sederhana dan sudah diputuskan: permission
platform hanya boleh **dijalankan** oleh tenant platform. Jadi filter yang jujur
adalah *"apakah tenant yang bertindak adalah tenant platform"* — tanpa perubahan
skema sama sekali, dan persis predikat yang sudah dipakai gerbang runtime. Kolom
per-role tetap tersedia untuk hari ketika least privilege **di dalam** tenant
platform menjadi pertanyaannya.

Dua sisi, dan yang kedua yang jadi kontrolnya:

- `listPermissionCatalog(tx, { includePlatformScoped })` — **wajib** dinyatakan,
  bukan flag opsional ber-default permisif: pemanggil yang lupa mendapat compile
  error, bukan picker yang diam-diam melebar.
- `grantPermissionToRole` memeriksa ulang di server dan menolak dengan
  `409 PLATFORM_SCOPE_REQUIRED`. Menyaring dropdown menghentikan kecelakaan,
  bukan permintaan yang ditulis tangan.

Permission id yang tidak dikenal **tidak** ditolak di sini — ia jatuh ke foreign
key yang melempar `PermissionNotFoundError`. Satu tempat memutuskan "apakah ini
ada", dan bukan fungsi ini.

Menutup PROJECT_STATE §4 **R8**.
