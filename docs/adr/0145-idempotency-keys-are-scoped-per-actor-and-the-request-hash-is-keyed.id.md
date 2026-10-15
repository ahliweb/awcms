🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0145-idempotency-keys-are-scoped-per-actor-and-the-request-hash-is-keyed.md)

<!-- i18n-source-hash: sha256:5c9ee045085ce94ed17f030b24e53e7608200e5e5d2b7ff27ac41baf7b1d8f98 -->

<!-- i18n-source-hash: sha256:0000 -->

# ADR-0145 — Idempotency key di-scope per aktor, dan request hash memakai kunci

- **Status:** Diterima
- **Tanggal:** 2026-10-15
- **Pengambil keputusan:** ahliweb
- **Mengubah:** [ADR-0129](0129-idempotency-key-is-a-shared-openapi-parameter-component.id.md) (yang menetapkan bentuk dan batas header `Idempotency-Key`; ADR ini menetapkan atas apa record tersimpan di-key) — amandemen, bukan pengganti
- **Terkait:** Issue #1000; temuan F4 audit #990 (#947); migrasi `sql/256_awcms_idempotency_actor_scope.sql`; `src/modules/_shared/idempotency.ts`; `src/lib/security/idempotency-hmac.ts`; skill `awcms-idempotency`

## Konteks

`awcms_idempotency_keys` unik pada `(tenant_id, request_scope, idempotency_key)`. Aktor hanya muncul di request hash, dan hanya pada pemanggil yang ingat memasukkannya (booking, procurement, hr-commission, hr-workforce ya; keputusan workflow, siklus blog, media, tax, dan sekitar delapan puluh rute lain tidak). Akibatnya dua cacat:

1. **Rekan kerja dapat menyerobot key yang mudah ditebak.** Pengguna pertama yang menyajikan `clock-in-2026-10-15` memilikinya untuk seluruh tenant. Request korban lalu dijawab `409 IDEMPOTENCY_CONFLICT`: denial of service pada, misalnya, clock-in, sekaligus oracle yang membenarkan key itu sedang dipakai. Bila hash tidak memuat aktor, rekan dengan body sama justru mendapat replay respons tersimpan milik korban.
2. **Hash tersimpan adalah SHA-256 polos dari body.** Body dapat memuat teks bebas sensitif (`reason` koreksi absensi, alasan penolakan, catatan komersial). Nilai pendek atau mudah ditebak dapat dipulihkan offline oleh siapa pun yang dapat membaca tabel (backup, replika, role pelaporan): hash para kandidat lalu bandingkan.

## Keputusan

1. **Aktor menjadi bagian key unik.** Tabel mendapat `actor_key text NOT NULL`, dan indeks unik menjadi `(tenant_id, request_scope, actor_key, idempotency_key)`. Dua aktor yang menyajikan satu key memegang dua record terpisah. Ditolak: membiarkan key seluas tenant dan hanya menambah aktor ke hash, karena penyerobotan tetap ada (korban masih menabrak baris rekan) dan setiap rute yang tidak memasukkan aktor ke hash tetap terbuka untuk replay lintas pengguna.
2. **Aktor eksplisit dan buram.** `findIdempotencyRecord` dan `saveIdempotencyRecord` menerima `IdempotencyActor` ber-brand, hanya dibuat oleh `userIdempotencyActor(tenantUserId)` (`user:<id>`), `machineIdempotencyActor(id)` (`machine:<id>`, untuk pemanggil non-pengguna tanpa tenant user) atau `ANONYMOUS_IDEMPOTENCY_ACTOR` (`anonymous`). String mentah adalah galat kompilasi (idempotency key, yang juga string, berdampingan di setiap panggilan), dan id kosong melempar error alih-alih diam-diam berbagi satu namespace. CHECK database membatasi bentuknya. Bearer machine-credential di-scope oleh tenant user service-account yang tertaut (`user:<id>`), jadi namespace-nya per service account, bukan per credential: dua credential dari satu service account berbagi namespace. Menyalurkan id credential lewat konteks terotorisasi dan helper modul akan menyentuh sebagian besar titik panggil tanpa menambah isolasi antar manusia, sehingga ditinggalkan. Pemanggil anonim (form komentar publik) tetap berbagi satu namespace per `(tenant, scope)` karena memang tak ada identitas; mereka bergantung pada key acak buatan klien dan tidak menyimpan respons yang privat bagi satu pemanggil.
3. **Advisory lock mengikuti key.** `lockIdempotencyKey` (booking) meng-hash `tenant:scope:actor:key`, sehingga hanya menserialkan request yang memang dapat bertabrakan pada key unik.
4. **Request hash adalah HMAC-SHA-256 dengan secret server.** `computeRequestHash` mempertahankan signature dan bentuk 64-hex (sekitar 100 titik panggil, satu kolom) dan kini mengembalikan `HMAC(IDEMPOTENCY_HMAC_SECRET, tag domain + JSON kanonik)`. Secret hanya ada di konfigurasi, tidak pernah disimpan.
5. **Fail closed di produksi.** Dengan `APP_ENV=production`, secret kosong, placeholder, atau kurang dari 32 karakter membuat `computeRequestHash` melempar `IdempotencyConfigurationError` (mutasi ditolak, bukan disimpan dengan hash lemah), dan `config:validate` menggagalkan kondisi yang sama lebih awal. Di lingkungan lain, secret kosong jatuh ke kunci acak per proses dengan satu peringatan: replay setelah restart atau di instance lain dijawab `409`, tak pernah eksekusi ganda dan tak pernah membocorkan respons.
6. **Rotasi.** Ganti secret. Hash tersimpan yang dibuat dengan secret lama tak lagi cocok, sehingga retry atas request yang tercatat sebelum perubahan dijawab `409 IDEMPOTENCY_CONFLICT`. Ini aman: baris unik masih ada, jadi mutasi tak bisa berjalan dua kali. Rotasi saat sepi (retry klien hitungan menit, bukan hari), atau terima `409` untuk yang kebetulan melintasinya. Ring dua secret dipertimbangkan dan ditolak: pemanggil membandingkan `existing.requestHash !== requestHash` di sekitar seratus tempat dan hanya memegang digest, bukan payload, sehingga verifikasi terhadap kunci sebelumnya memerlukan perubahan signature di mana-mana demi jendela beberapa menit.
7. **Migrasi `256` (expand dan contract sekaligus).** Tambah `actor_key` dengan default `legacy:unscoped`, hapus default, tambah CHECK bentuk, buat indeks unik baru, hapus yang lama. Baris lama menjadi `legacy:unscoped`, yang tak pernah di-replay ke siapa pun. Baris legacy untuk `(tenant, scope, key)` yang sama dan dibuat dalam 24 jam terakhir membuat lookup menjawab konflik, sehingga `409 IDEMPOTENCY_CONFLICT` dan tanpa eksekusi kedua bagi klien yang me-retry mutasi bertipe create melintasi deploy (audit M1); setelah 24 jam ia tidak memblokir apa pun. Baris legacy tak bisa di-replay karena tak bisa diikat ke aktor, yaitu cacat yang diperbaiki. **Waktu dan rollback.** Migrasi berjalan sebelum kode baru mulai, jadi jalankan migrate dan redeploy berurutan rapat (atau dalam jendela maintenance); instance lama yang masih melayani gagal-tertutup pada mutasi idempoten (target `ON CONFLICT`-nya tak ada lagi) sampai diganti. Indeks unik baru dibangun dengan SHARE lock (baca tetap jalan, tulis idempoten menunggu satu kali scan). **Rollback hanya forward-fix:** menambah lagi indeks lama `(tenant, scope, key)` akan membuka kembali penyerobotan lintas aktor dan gagal pada baris yang kini sah mengulang key, jadi rilis buruk diperbaiki ke depan. Retensi tabel dilacak terpisah di #1034 dan sudah mendarat (lihat Amendemen 1 di bawah); kalimat di header `sql/256` yang menyebut belum ada job retensi bersifat historis, karena migrasi yang sudah terapan immutable.

## Konsekuensi

- **Positif:** tak ada penyerobotan atau replay lintas pengguna di rute mana pun, termasuk yang tak pernah mengikat aktor ke hash; teks sensitif dalam body tak lagi dapat ditebak dari tabel; secret produksi yang hilang tertangkap saat konfigurasi dan saat runtime.
- **Netral:** pemanggil yang sudah mengikat aktor ke hash tetap melakukannya (defense in depth). Tak ada perubahan endpoint, event, atau bentuk respons; OpenAPI tidak berubah. Satu variabel produksi baru yang wajib, `IDEMPOTENCY_HMAC_SECRET`.
- **Negatif:** satu argumen tambahan di ~100 titik panggil. Jendela 24 jam setelah migrasi di mana retry key-sama atas request pra-migrasi dijawab `409`. Rotasi menyebabkan `409` pada retry yang melintasinya. Entri inventori subject-data untuk tabel ini diubah redaksinya: tabel kini memuat id aktor pseudonim.

## Alternatif yang dipertimbangkan

- **Aktor hanya di hash.** Ditolak di atas (penyerobotan tetap ada).
- **Aktor ambient lewat `AsyncLocalStorage` atau GUC sesi.** Ditolak: state implisit yang bisa terlupa suatu rute, dan rute publik diam-diam tak punya aktor. Argumen ber-brand yang eksplisit gagal saat kompilasi.
- **Meng-hash aktor juga (berkunci).** Ditolak: rotasi lalu mengubah actor key, sehingga retry pengguna yang sama melewatkan barisnya dan menjalankan mutasi lagi, kebalikan dari fail-safe.
- **Fallback tanpa kunci di produksi.** Ditolak: mengembalikan kelemahan sambil tampak sehat.

## Amendemen 1 — retensi dan klasifikasi data subjek (Issue #1034)

`awcms_idempotency_keys` tak punya retensi, padahal tabel ini kini memuat `actor_key` pseudonim dan `response_body` tersimpan yang dapat menggemakan data pribadi.

- **Retensi.** `domain_event_runtime` (pembuat tabel di `sql/009`) mendeklarasikan deskriptor lifecycle `domain_event_runtime.idempotency_keys`: hard delete menurut `created_at`, **default 30 hari**, minimum 7, maksimum 90, dijalankan engine generik di balik `bun run data-lifecycle:archive-purge` (sudah terjadwal harian; tanpa job baru). 30 hari adalah jendela retry terpanjang yang masih masuk akal, dan batas bawah 7 hari menjaga override tenant tetap jauh di atas guard deploy-straddle 24 jam, sehingga operator tak bisa memperpendek jendela sampai guard berhenti bekerja. Menghapus baris `legacy:unscoped` setelah jendela itu benar: ia tak memblokir apa pun setelah 24 jam.
- **Privilege.** `sql/276` memberi `awcms_worker` `SELECT, DELETE` (dua kata kerja yang dikeluarkan engine generik) dan tak ada yang lain; `WORKER_ROLE_GRANTS` di `scripts/security-readiness.ts` mencatat pasangan yang sama. INSERT dan UPDATE tetap milik `awcms_app`, sehingga worker tak bisa menanam replay.
- **Data subjek.** Tabel pindah dari `NO_SUBJECT_DATA` ke deskriptor `subjectData`, `unreachableBySubject` dengan `exportable: false` dan `retain_under_obligation`. Menjangkau `actor_key` untuk ekspor atau penghapusan ditolak: ia nilai teks berawalan (`user:<uuid>`) yang tak dibaca planner berbasis kesetaraan uuid, dan mengajari executor mode pencocokan baru untuk cache replay adalah perubahan yang lebih besar dari nilai datanya. Menghapus baris atas permintaan juga keliru, karena baris itu bukti bahwa mutasi sudah berjalan dan menghapusnya membiarkan retry menjalankan mutasi kedua kali. Jendela retensilah yang membatasi paparan. Data pribadi yang digemakan sebuah respons adalah catatan subjek di tabelnya sendiri, yang punya deskriptor sendiri dan diekspor serta dihapus di sana.
- **Tanpa legal hold.** Deskriptor menyatakan `legalHold.applicable: false`; catatan hold tenant-wide atau yang menarget deskriptor tetap dihormati engine apa pun nilainya.
- **Run pertama** menghapus tumpukan lama dalam batch terbatas (5000 per pass); pratinjau dengan `--dry-run`.
