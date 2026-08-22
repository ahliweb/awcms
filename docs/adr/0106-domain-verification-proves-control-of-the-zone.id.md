🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0106-domain-verification-proves-control-of-the-zone.md)

<!-- i18n-source-hash: sha256:450bd805246395575faf0f819e8fefa0b884ebe6ec09981529724dae1e8fc53c -->

# ADR-0106 — Verifikasi domain membuktikan penguasaan zona, dan tantangannya kita yang mencetak

- **Status:** Accepted
- **Tanggal:** 2026-08-22
- **Pengambil keputusan:** ahliweb
- **Terkait:** PROJECT_STATE §4 (ditemukan saat menutup temuan D7 putaran 17 Agustus 2026); ADR-0006 (tidak ada panggilan keluar di dalam transaksi database); ADR-0053 (scope platform); ADR-0063 (gerbang otorisasi); migrasi `sql/046`; Issue #555 (port `tenant_domain` yang asli)

## Konteks

`POST /api/v1/tenant/domains/{id}/verify` tidak memverifikasi apa pun.

Ia membaca baris, memeriksa `verification_method IS NOT NULL`, lalu menyetel `status = 'active'`. Tidak ada lookup DNS, tidak ada pengambilan berkas, tidak ada perbandingan token di mana pun pada jalur rute itu. Adapter Cloudflare memang ada dan bisa membuat serta memeriksa record verifikasi, tetapi ia hanya dipanggil oleh `tenant-domain:dns:sync`, ia menolak nama apa pun di luar zona terkelola platform, dan ia sama sekali tidak terjangkau dari rute ini. Kolom yang _menyebut_ metode adalah keseluruhan pemeriksaannya.

Domain `active` bukan penanda kosmetik. `resolvePublicTenantByHost` memetakan header `Host` masuk ke sebuah tenant dari `awcms_tenant_domains`; `resolveTenantDomainSet` memperlakukan hostname itu sebagai target redirect yang diizinkan; `resolveTenantPrimaryHost` menaruhnya di URL kanonik, feed dan sitemap. Jadi urutan yang tersedia bagi administrator tenant yang memegang `domains.create`, `.update` dan `.verify` adalah: tambahkan hostname, `PATCH` `verificationMethod: "manual"`, panggil verify — dan deployment ini kini menjawab untuk hostname tersebut sebagai tenant itu.

Dua hal membatasinya dan tak satu pun adalah kontrolnya. Pembuatan dan verifikasi dijaga ABAC, jadi ini jangkauan administrator tenant dan bukan jangkauan anonim; dan itu hanya berarti bagi hostname yang DNS-nya bisa benar-benar diarahkan ke sini oleh seseorang, yang merupakan properti zona milik orang lain, bukan properti kode ini.

Temuan D7 ditutup dengan **menghapus** setelan `defaultVerificationMethod: "manual"` yang tak pernah dibaca alih-alih menerapkannya, justru agar hal ini tidak menjadi lebih buruk: menerapkan default itu akan menyerahkan satu-satunya prasyarat yang dimiliki `verify` kepada setiap domain yang baru dibuat.

## Keputusan

**Sebuah domain menjadi `active` hanya ketika record TXT yang dicetak server dan tidak dapat ditebak muncul di zona yang sedang diklaim. Setiap bagian tantangan itu dicetak oleh aplikasi ini dan tidak satu pun diterima dari pemanggil.**

### Membuat perbandingannya nyata baru setengah perbaikan

API menerima `verificationRecordName` dan `verificationRecordValue` dari pemanggil. Sekadar membandingkan keduanya terhadap DNS tetap tidak membuktikan apa pun, karena pemanggil yang memilih **keduanya** — nama yang ditanyakan dan nilai yang diharapkan — bisa mengarahkannya ke record yang sudah ada di zona yang tidak ia kuasai. `example.com` menerbitkan banyak record TXT; `hostname = example.com`, `recordName = example.com`, `recordValue = "v=spf1 -all"` lolos lookup DNS yang sempurna tanpa si pengklaim menguasai satu bita pun zona itu.

Maka kedua bagiannya milik server:

- **Namanya** diturunkan dari hostname yang diklaim — `_awcms-verify.<normalized_hostname>` — sehingga record itu hanya bisa berada di zona yang memang sedang diklaim. Label berawalan garis bawah tidak mungkin bertabrakan dengan host nyata dan bukan sesuatu yang diterbitkan sebuah zona secara tidak sengaja.
- **Nilainya** adalah 32 bita acak, dicetak per baris domain. "Record ini ada" dan "kami yang menaruh record ini di sana" menjadi pernyataan yang sama.

Keduanya tidak lagi dapat disetel lewat API. Mengirim salah satunya **ditolak dengan 400 yang menyebut nama field-nya**, bukan diabaikan: pemanggil yang mengirim `verificationRecordValue` yakin ia telah memilih apa yang akan diperiksa, dan membuangnya diam-diam akan membiarkan keyakinan itu utuh sementara server memeriksa hal lain.

### Satu metode, dan itulah yang benar-benar diimplementasikan

`TENANT_DOMAIN_VERIFICATION_METHODS` dulu menawarkan `dns_txt`, `dns_cname`, `file` dan `manual`. Kini ia menawarkan `dns_txt`.

- **`manual` dihapus** karena ia tak pernah berarti apa pun. Ia _adalah_ pemeriksaan yang lama.
- **`file` dihapus** karena mengimplementasikannya berarti server ini mengirim permintaan HTTP ke hostname yang dipilih pemanggil — SSRF yang memakai lencana verifikasi. Ia akan butuh perlakuan `isBlockedAddress` penuh, penanganan redirect dan batas ukuran respons sebelum aman, dan tidak satu pun dari itu membeli sesuatu yang belum diberikan DNS.
- **`dns_cname` dihapus** karena ia butuh hostname target platform untuk ditunjuk, yang merupakan konfigurasi per-deployment yang tidak ada di sini. Metode kedua yang setengah jadi tidak akan membuat yang pertama lebih benar.

CHECK constraint `sql/046` masih menerima keempatnya dan dibiarkan apa adanya — migrasi terapan itu immutable, dan kolom itu tetap dokumentasi jujur tentang apa yang bersedia ditampung skema. Yang berubah adalah aplikasi ini hanya menulis, dan hanya menghormati, `dns_txt`.

### `manual` dihapus, bukan diturunkan menjadi aksi operator

Alternatif yang jelas adalah mempertahankan `manual` sebagai atestasi yang hanya boleh dilakukan operator platform. Ia ditolak karena biaya, bukan karena prinsip.

Permission ber-scope platform (ADR-0053) hanya boleh dijalankan **oleh tenant platform**, dan `withTenant` mengunci RLS ke tenant itu — jadi operator platform tidak bisa melihat, apalagi mengaktifkan, baris domain milik tenant lain. Membuat atestasi operator bekerja berarti membangun permukaan lintas-tenant baru, yaitu jenis permukaan paling berbahaya yang dimiliki basis kode ini (reset MFA admin adalah satu-satunya aksi yang menjangkau keluar tenantnya, dan ia sengaja sendirian). Membangun satu lagi demi mempertahankan sebuah bypass adalah pertukaran yang salah. Dengan `dns_txt` yang terimplementasi, tidak ada yang bisa diatestasi operator yang tak bisa dibuktikan sendiri oleh tenant.

Subdomain platform tetap punya jalur: platform memiliki zona itu, jadi record tantangan bisa diterbitkan di sana — secara manual, atau oleh adapter Cloudflare yang sudah dijalankan `tenant-domain:dns:sync`, yang justru merupakan kasus yang menjadi alasan penjaga `isWithinPlatformRootDomain` ditulis.

### DNS, dan di mana panggilannya terjadi

Kueri DNS menuju resolver terkonfigurasi, tidak pernah ke host yang diklaim, tidak membawa kredensial, dan tidak bisa diarahkan ke `169.254.169.254`. Itulah sebabnya ia aman di tempat pengambilan HTTP tidak aman.

Ia berjalan **di luar setiap transaksi database** (ADR-0006). Rutenya tiga fase: satu transaksi tenant membaca tantangan dan menolak apa yang tidak dapat diverifikasi; lookup terjadi tanpa transaksi terbuka; transaksi tenant kedua mengotorisasi ulang dan mencatat hasilnya. Menahan koneksi pool terbuka selama resolver orang lain ingin berlama-lama adalah cara satu dependensi lambat menjadi pemadaman database.

Transaksi kedua mengotorisasi ulang alih-alih mempercayai yang pertama. ADR-0063 menempatkan gerbang di transaksi yang melakukan pekerjaannya, dan sesi yang dicabut saat DNS sedang ditanya harus menghentikan penulisan, bukan sekadar telah menghentikan pembacaan. Ia juga membawa nilai yang terbukti kembali ke klausa `WHERE`: jika baris itu diberi tantangan baru, di-soft-delete atau di-suspend di antaranya, jawabannya `409 CONFLICT` alih-alih aktivasi yang diperoleh tantangan yang bukan lagi tantangannya.

### Tidak ada bukan berarti tidak terjangkau

`NXDOMAIN`/`NODATA` adalah fakta tentang **domain yang diklaim** — record-nya belum diterbitkan, yang merupakan jawaban paling biasa yang ada. `SERVFAIL`, penolakan, atau timeout adalah fakta tentang **resolver kita** dan tidak mengatakan apa pun tentang domainnya.

Hanya jenis kedua yang memberi makan circuit breaker, dan hanya jenis kedua yang membiarkan status domain tidak tersentuh (`503`, tidak ada yang ditulis). Menggabungkan keduanya adalah cacat yang dicatat temuan D6 pada provider email, di mana penolakan per-pesan menjatuhkan breaker yang lalu menghentikan pengiriman untuk seluruh deployment. Di sini kesalahan yang sama gagal ke dua arah sekaligus: tenant dengan hostname salah ketik akan mendorong breaker terbuka dan mengunci verifikasi semua orang, dan pemadaman resolver akan menandai domain jujur yang sudah menerbitkan record sebagai `failed`. Kode error yang tak dikenali diperlakukan sebagai masalah _kita_, sehingga kode yang belum pernah ditemui daftar ini tak pernah bisa dibaca sebagai "record-nya pasti tidak ada".

### Kegagalan mencatat `failed`

Pemeriksaan yang gagal menyetel `status = 'failed'` dan `last_checked_at`, lalu menjawab `409 DOMAIN_NOT_VERIFIED`. "Belum ada yang memeriksa" dan "kami memeriksa, dan tidak ada" adalah dua fakta berbeda dan operator perlu membedakannya. Ini juga menjaga `failed` tetap terjangkau — status yang dideklarasikan tetapi tak bisa dihasilkan apa pun adalah bentuk cacat yang persis menjadi isi temuan D7, D8 dan D15, dan menciptakan satu lagi sambil menutup putaran itu akan menjadi lelucon yang buruk. `failed` bisa diverifikasi ulang: ia menggambarkan sebuah momen, bukan sebuah vonis.

### Baris yang lebih tua dari keputusan ini

Domain yang dibuat sebelum ADR ini punya `verification_method = NULL` dan tanpa tantangan, karena tidak ada yang pernah menulisnya. Pada percobaan verify pertamanya tantangan itu **dicetak dan pemanggil diberi tahu untuk menerbitkannya** (`409`), alih-alih dicari — record yang baru diciptakan satu milidetik lalu tidak mungkin ada di DNS, dan lookup yang pasti meleset hanya akan mengajari operator untuk tidak mempercayai jawabannya.

Tidak ada migrasi backfill. Mencetak secara malas menjangkau persis baris yang membutuhkannya, pada saat seseorang sedang melihatnya, tanpa migrasi ber-DML pada tabel `FORCE ROW LEVEL SECURITY` — yang di repo ini adalah cara yang sudah dikenal untuk hijau di CI dan jebol di produksi.

### Lookup-nya dibatasi laju per tenant

Keharusan `Idempotency-Key` bukan pembatas laju; pemanggil mencetak yang baru per percobaan secara desain. Tanpa batas, sebuah tombol terautentikasi menjadi generator kueri DNS yang diarahkan ke hostname mana pun yang bisa disebut pemanggil. Tiga puluh percobaan per menit per tenant — per tenant dan bukan per domain, karena sumber daya yang dilindungi adalah resolver deployment ini, dan pemanggil dengan seratus baris domain tidak berhak atas seratus kali jatahnya.

## Konsekuensi

**Tenant tidak lagi bisa mengaktifkan hostname yang tidak ia kuasai.** Itulah intinya, dan itu juga satu-satunya perubahan perilaku yang akan disadari siapa pun.

**`POST /api/v1/tenant/domains` tidak lagi menerima tiga field, dan `PATCH .../{id}` juga tidak.** Ketiganya ditolak dengan `400` alih-alih diabaikan. Ini perubahan yang memutus terhadap body permintaan yang terdokumentasi; modul OpenAPI membawanya, dan layar admin tidak lagi menawarkan pemilih metode verifikasi karena tidak ada lagi yang bisa dipilih.

**Hostname yang terlalu panjang untuk membawa `_awcms-verify.` ditolak saat pembuatan**, alih-alih diterima sebagai baris yang tak akan pernah bisa diverifikasi.

**Verifikasi kini bergantung pada resolusi DNS dari host aplikasi.** Deployment tanpa DNS keluar tidak bisa memverifikasi domain, dan akan mengatakannya dengan `503` alih-alih berpura-pura. `tenant-domain-dns-verify` bergabung dengan circuit breaker provider yang sudah dilaporkan `/api/v1/database/pool/health`.

**`verification_token_hash` tetap tidak ditulis oleh apa pun.** Tantangan itu bukan rahasia — ia diterbitkan di DNS, dan properti keamanannya adalah ketidakdapat-ditebakan sebelum publikasi, bukan kerahasiaan setelahnya — jadi ia tinggal di `verification_record_value`, kolom publik, persis seperti yang dimaksudkan skema.
