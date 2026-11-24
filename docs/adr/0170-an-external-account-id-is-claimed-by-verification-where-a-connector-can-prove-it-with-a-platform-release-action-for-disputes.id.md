🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0170-an-external-account-id-is-claimed-by-verification-where-a-connector-can-prove-it-with-a-platform-release-action-for-disputes.md)

<!-- i18n-source-hash: sha256:58f1dd8c3071cebdd6ca2c1fb1587c3a29f08d9a83518349f39e9a395c9cbf1a -->

# ADR-0170 — Id akun eksternal diklaim lewat verifikasi bila konektor dapat membuktikannya, dengan aksi pelepasan oleh platform untuk sengketa

- **Status:** Diterima
- **Tanggal:** 2026-11-22
- **Pengambil keputusan:** ahliweb (pemilik). Keputusan K2 Issue [#1215](https://github.com/ahliweb/awcms/issues/1215), 22 November 2026: opsi **A + C**, opsi B ditolak; pemilik mendelegasikan pilihan kepada orchestrator dengan urutan prioritas skalabilitas, performa, keamanan. Tercatat di #1215 dan di `docs/PROJECT_STATE.md` bagian 4 (PR #1434).
- **Mengamandemen:** invarian **I1** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) (akun eksternal unik per `(tenant, provider, id eksternal)`; tenant kedua yang mengklaimnya ditolak), **hanya** sebagaimana dinyatakan di bawah: "unik per id live" menjadi "unik per id yang **diklaim**".
- **Memperluas:** [ADR-0053](0053-platform-scoped-permissions.id.md) (permission ber-scope platform), [ADR-0051](0051-admin-screens-consolidated-in-awcms.id.md) (aksi lintas tenant adalah gerbang platform, bukan permission tenant), [ADR-0091](0091-two-sided-attribution.id.md) (aksi oleh platform ditulis di jejak tenant yang terdampak tanpa individunya), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md).
- **Terkait:** Issue #1215 (M4 tinjauan pertama, "squatting id eksternal"; opsinya ditulis di sana), README modul [`src/modules/channel-accounts/README.id.md`](../../src/modules/channel-accounts/README.id.md), migrasi `sql/416`.

## Konteks

`channel_accounts` mencatat akun eksternal yang dihubungkan tenant (id halaman, id nomor telepon WhatsApp, id bot, alamat pengirim, id perangkat StarSender). I1 ADR-0148 membuat pasangan `(provider, id eksternal)` unik **lintas tenant** untuk setiap baris live, lewat `awcms_channel_accounts_live_external_key` (`sql/318`). Pendaftaran dimulai `pending`, **belum terverifikasi**, dan baris `pending` memegang klaim global itu.

Itu cacat squatting (M4 tinjauan pertama). Sebuah tenant dapat mendaftarkan id publik milik orang lain lebih dulu, dan pemilik aslinya mendapat `409 ACCOUNT_ALREADY_REGISTERED`, jawaban yang sama dengan duplikat milik tenant sendiri (jadi bukan oracle, tetapi juga tanpa jalan keluar). Mendaftar itu murah (`accounts.create`, tanpa bukti), dan id-nya publik.

Tiga opsi yang ditulis di #1215:

- **A: klaim hanya saat terverifikasi.** Unique index global menjadi parsial atas baris terverifikasi; unique per tenant tetap untuk sisanya.
- **B: kedaluwarsa klaim.** Job platform men-soft-delete baris `pending` yang lebih tua dari N hari.
- **C: aksi pelepasan oleh platform.** Aksi ber-scope platform, ber-step-up, diaudit, yang melepas klaim yang disengketakan setelah bukti di luar sistem.

Yang dapat dibuktikan repositori hari ini, ditemukan dengan membaca konektor (bukan diasumsikan):

- Konektor `telegram_engagement` memanggil `getMe` dengan token bot akun itu sendiri dan menolak endpoint kecuali id bot yang dikembalikan sama dengan id eksternal akun (`BOT_IDENTITY_MISMATCH`); baru setelah itu ia melaporkan akun sehat, yang memindahkannya ke `connected` lewat `recordAccountHealth`.
- Verifikasi pengirim `email` menanyakan ke Mailketing pengirim mana yang telah ia verifikasi untuk token akun itu dan menghubungkan pengirim hanya bila alamatnya ada di daftar tersebut.
- Tidak ada konektor lain yang melaporkan kesehatan `ok`. Jalur Graph API (`meta-cloud-provider`, `facebook-pages-adapter`) mengirim; mereka tidak mengikat id ke token sebuah koneksi. StarSender tidak mendokumentasikan panggilan status tanpa efek samping, sehingga `attest-device` adalah atestasi operator, bukan bukti. `esp_account` Mailketing membuktikan "token ini berfungsi", bukan "id ini adalah akun token itu". `channel` Telegram tidak diperiksa oleh `getMe`.
- Setiap perpindahan akun ke `connected` melewati SATU fungsi, `recordAccountHealth`.

## Keputusan

### 1. Klaim punya dasar, dan dasarnya adalah kolom

`awcms_channel_accounts.claim_basis` (`text NOT NULL DEFAULT 'registration'`, `CHECK` pada `('registration','verification')`) menyatakan bagaimana baris memegang klaim global:

- `registration` (default, dan fail-closed): baris memegang klaim sejak ia live, di setiap status, sampai di-soft-delete. Ini persis perilaku `sql/318`.
- `verification`: baris memegang klaim hanya selama statusnya `connected` atau `degraded`, yaitu setelah konektor membuktikan kendali atas id. Baris `pending` berdasar ini tidak memegang apa pun terhadap tenant lain.

Aplikasi memilih dasar saat INSERT dari satu tabel kode (`claimBasisFor`, `VERIFIED_CLAIM_KINDS` di `provider-matrix.ts`). Trigger menolak perubahan berikutnya, untuk semua role. Setiap baris yang ada saat migrasi berjalan tetap `registration`: **klaim tidak pernah dilepas oleh migrasi.**

### 2. Index

- `awcms_channel_accounts_live_external_key` dibangun ulang sebagai unique parsial pada `(provider, account_kind, external_id) WHERE deleted_at IS NULL AND (claim_basis = 'registration' OR status IN ('connected','degraded'))`. **Jenis akun adalah bagian dari kunci** (audit H1): tanpa itu sebuah `channel` `telegram` yang didaftarkan dengan id bot akan memegang klaim yang kemudian dikalahkan verifikasi `bot` pemilik asli, dan `esp_account` Mailketing yang dinamai alamat pengirim akan memblokir `sender_identity` itu; lubang yang sama juga menjadi oracle keberadaan id terverifikasi.
- `awcms_channel_accounts_tenant_external_key` baru, unik pada `(tenant_id, provider, account_kind, external_id) WHERE deleted_at IS NULL`. Cakupannya lebih lebar dari "baris `pending`" yang disebut keputusan (meliputi setiap baris live tenant) karena itulah perilaku hari ini untuk "milik sendiri" dan menghindari aturan kedua yang lebih sempit. Pendaftaran memakai `ON CONFLICT DO NOTHING` tanpa target, sehingga index mana pun yang bertabrakan dengan baris menjawab sama.

Yang pertama menjadi `connected` menang dan unique index yang memutuskan, tanpa kunci aplikasi: aman terhadap balapan. Duplikat `pending` lintas tenant diterima saat pendaftaran **tanpa oracle**: tenant tidak dapat mengetahui bahwa tenant lain memegang, atau bahkan mendaftarkan, id dari jenis berdasar `verification`.

### 3. `(provider, jenis)` mana yang diklaim lewat verifikasi

Hanya dua pasangan yang id-nya dibuktikan konektor di repositori ini:

| `(provider, jenis)`            | Dasar          | Buktinya                                                                                                            |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `telegram` `bot`               | `verification` | `getMe` dengan token akun itu sendiri; id bot sama dengan id eksternal; lalu kesehatan ok                           |
| `mailketing` `sender_identity` | `verification` | daftar pengirim terverifikasi milik penyedia memuat alamatnya; lalu kesehatan ok                                    |
| setiap pasangan lain           | `registration` | tak ada panggilan di repositori yang mengikat id ke kredensial; klaim dipegang sejak pendaftaran seperti sebelumnya |

"Setiap pasangan lain" adalah WhatsApp Cloud (`waba`, `waba_phone_number`), Facebook, Instagram, Threads, TikTok, YouTube, LinkedIn, `device` StarSender, `esp_account` Mailketing, dan `channel` Telegram. Penyedia masuk tabel `verification` **dalam perubahan yang sama dengan panggilan konektor yang membuktikannya**; `tests/channel-accounts-claim-basis.test.ts` mengunci tabel dan kedua buktinya, sehingga melebarkannya berdasarkan firasat menggagalkan build.

#### Bentuk id eksternal (audit H1)

Mengunci klaim per jenis menghapus squat lintas jenis; memvalidasi bentuk id per jenis mencegah ruang nama dibuat tumpang tindih dengan sengaja. Pendaftaran ditolak dengan `422 EXTERNAL_ID_INVALID` kecuali id berbentuk sesuai jenisnya, pemeriksaan yang hanya bergantung pada input sehingga menjawab sama untuk id yang dipegang maupun yang bebas (tanpa oracle):

- `telegram` `bot`: bilangan bulat positif; `telegram` `channel`: `-100<digit>` atau `@username`, tidak pernah bilangan bulat polos.
- `mailketing` `esp_account`: label yang tidak pernah berupa alamat (tanpa `@`); `sender_identity`: alamat huruf kecil.
- `whatsapp_cloud` `waba` dan `waba_phone_number`: digit (5 sampai 25), seperti yang sudah dituntut konektor; `facebook` `page` dan `instagram` `professional_account`: digit; `starsender` `device`: pola id perangkat yang sudah dituntut konektor.
- Penyedia dan jenis lain (TikTok, YouTube, LinkedIn, Threads) dibiarkan terbuka: repositori ini belum memverifikasi format id resmi untuk mereka, dan tebakan yang terlalu ketat akan menolak akun yang sah.

Satu ejaan per id (audit L-d): username Telegram tidak membedakan huruf besar-kecil, sehingga `@VictimChannel` disimpan (dan dicari oleh aksi pelepasan) sebagai `@victimchannel` dan dua ejaan adalah satu klaim; id numerik menolak nol di depan dalam bentuknya alih-alih ditulis ulang (`0123` dan `123` tidak dapat menjadi dua klaim); pengirim Mailketing ditolak kecuali sudah huruf kecil. Dibiarkan apa adanya karena semantik penyedia tidak didokumentasikan di sini: label `esp_account` Mailketing dan id perangkat StarSender (label deployment yang peka huruf, bukan identitas publik milik korban).

Revoke endpoint bot Telegram tidak menjadwalkan `deleteWebhook` untuk pihak yang kalah (audit L-b): penghapusan di sisi penyedia hanya dijadwalkan bila endpoint itu pernah diaktifkan DAN akunnya masih memegang klaim, karena Telegram punya satu webhook per bot dan endpoint yang tak pernah memasangnya tidak boleh dapat mematikan webhook pemenang. Referensi tiket adalah `^[A-Z]{2,10}-[0-9]{1,10}$` (audit L-a), sehingga tak dapat membawa nomor telepon atau token berbentuk email ke jejak pemegang; flag ciphertext-terhapus di baris audit bernama `ciphertextErased` karena redaksi berdasar nama key mencetak atribut `credential...` atau `secret...` sebagai `[REDACTED]`.

### 4. Yang dilihat pihak yang kalah

`recordAccountHealth` menjalankan perpindahan ke `connected` dalam savepoint. Ketika unique index menolaknya, fungsi mengembalikan `claim: "lost"`: akun tetap `pending`, baris kesehatannya menjadi `failing` dengan alasan `ACCOUNT_ALREADY_REGISTERED` (kode yang sama dengan jawaban pendaftaran yang ditolak, tanpa menyebut tenant), dan pemanggil memetakannya ke apa yang ia miliki: endpoint Telegram menjadi `failed` dengan kode itu, pengirim email dihitung belum terverifikasi (dan dicatat di log), dan `attest-device` akan menjawab `409 ACCOUNT_ALREADY_REGISTERED`. Baris akun sendiri tidak ditulis pada klaim yang kalah, karena role konektor yang melaporkan kesehatan dibatasi policy RESTRICTIVE pada tulis `connected`/`degraded`; sinyalnya adalah baris kesehatan. **Konektor Telegram mengklaim SEBELUM memanggil `setWebhook`** (audit L1): `getMe` membuktikan token, lalu `recordBotHealth` mengambil klaim dalam transaksinya sendiri, dan hanya pemenang yang lanjut ke `setWebhook`; pihak yang kalah tidak pernah memanggil Telegram lagi, sehingga tidak dapat menimpa webhook pemenang.

### 5. Aksi pelepasan oleh platform (opsi C)

`POST /api/v1/channel-accounts/claims/release` dengan `{ provider, accountKind, externalId, reasonCode, ticketRef?, reason }` mengakhiri akun tenant yang memegang klaim, agar pemilik asli dapat mendaftar dan memverifikasi. Operator memverifikasi penuntut di luar sistem; aksi ini tidak memutuskan siapa yang benar.

- **Otoritas.** Permission ber-scope PLATFORM baru, `channel_accounts.account_claims.revoke` (`scope: "platform"` di descriptor, `'platform'` di seed, hanya diberikan ke owner tenant setup, tidak ada di katalog mana pun yang di-seed ke role tenant; `tests/platform-scoped-permissions.test.ts` mendaftarkannya). Chokepoint menolaknya kecuali tenant yang bertindak adalah tenant platform, sehingga owner tenant menerima `403` seragam yang sama seperti siapa pun tanpa grant. Ia juga mendeklarasikan `requiresMfaEnrolment` (audit L3: aksi destruktif, lintas tenant, `critical` tidak pernah dijalankan hanya dengan kata sandi): operator tanpa faktor aktif ditolak dengan `MFA_ENROLMENT_REQUIRED`, dan rute lalu menuntut step-up segar tanpa syarat (`STEP_UP_REQUIRED`), yang aman karena gerbang pendaftaran sudah hanya meloloskan orang yang punya faktor. Kredensial mesin ditolak; `Idempotency-Key` wajib; `reason` teks bebas 10 sampai 500 karakter wajib dan tidak boleh memuat alamat email atau nomor telepon. Satu-satunya jalur pemberian adalah migrasi, ke owner tenant setup: `identity-access:permissions:backfill` menyaring `scope = 'tenant'` dan tidak pernah memberikan permission platform, sehingga deployment yang tenant platform-nya bukan tenant setup memberikannya dengan baris role-permission eksplisit di sana.
- **Bagaimana ia melintasi batas tenant tanpa mem-bypass RLS.** Satu **baca** SECURITY DEFINER yang sempit, `awcms_find_channel_account_claim_holder(provider, account_kind, external_id)`, berbentuk `sql/048`/`sql/119`: role pemilik NOLOGIN tanpa anggota (`awcms_channel_claim_locator`), policy SELECT khusus role itu, daftar kolom tetap (delapan kolom, tidak pernah nama tampilan atau referensi kredensial), EXECUTE hanya untuk `awcms_app`. Ia menuntut ketiga argumen (kesamaan), mengembalikan paling banyak satu baris yang diizinkan unique index, dan tidak pernah menulis. Pelepasannya sendiri lalu berjalan di **konteks RLS tenant pemegang** (bentuk yang diberikan ADR-0091 pada catatan lahir tenant) dengan langkah yang sama seperti hapus milik tenant sendiri, dikurangi penolakan "tidak saat connected": ciphertext kredensial dan secret webhook dihapus, soft delete dengan alasan tetap `CLAIM_RELEASED_BY_PLATFORM`. Tenant platform diikat ulang sebelum apa pun ditulis. **Anak (audit M1):** locator tidak pernah menemukan anak `pending` berdasar verifikasi, sehingga kontainer yang memilikinya tak dapat dilepas; pelepasan karena itu mengakhiri, dalam transaksi dan konteks yang sama, setiap anak live yang TIDAK memegang klaim (kredensialnya dihapus, satu baris jejak masing-masing), sedangkan anak yang MEMEGANG klaim tetap memblokir pelepasan (`409 HAS_CHILD_ACCOUNTS`) dan dilepas dengan id-nya sendiri.
- **Audit.** `channel_accounts.claim.release` `critical` di jejak tenant platform (dengan operator dan `reason` teks bebas) dan `channel_accounts.account.claim_released` `warning` di jejak pemegang, satu per akun yang diakhiri (menyebut tenant platform, bukan individunya, karena pelanggan tidak dapat meresolusi id operator). **Pemegang adalah pihak lawan (audit M2)**, sehingga jejaknya hanya memuat `reasonCode` tertutup (`ownership_dispute_resolved`, `registered_in_error`, `abuse_confirmed`) dan referensi tiket opsional berpola sempit, tidak pernah teks bebas operator, yang tetap di jejak platform. Tak satu pun baris memuat id eksternal atau kredensial.
- **Belum dibangun:** layar operator. Permission-nya ada di `NOT_YET_SCREENED`.

### 6. Yang sengaja tidak diputuskan di sini

- **Opsi B ditolak.** Lihat Alternatif.
- Akun Graph API tidak dibuat dapat diverifikasi di sini. Ketika konektornya melaporkan kesehatan `ok` lewat `recordAccountHealth`, perubahan itu menambahkan pasangannya ke tabel.

## Konsekuensi

- **Positif:** squat tertutup untuk dua penyedia yang punya bukti (kasus yang paling penting untuk bot dan pengirim), tanpa job baru, tanpa role baru yang menulis, tanpa timer dan tanpa konstanta kebijakan (N milik opsi B). Konflik diputuskan satu unique index, sehingga skalanya mengikuti jumlah akun, bukan sapuan. Setiap penyedia lain tetap fail-closed seperti hari ini, dan kini punya jalur sengketa yang sebelumnya tidak ada. Aksi pelepasan tidak dapat dijangkau dari tenant, dan baca lintas tenant yang dibutuhkannya adalah yang tersempit yang sudah dipakai repositori.
- **Negatif / trade-off:** dua kelas penyedia kini berperilaku berbeda, dan pembaca harus tahu mana (tabel di atas, dikunci tes). Untuk jenis `verification` sebuah tenant dapat memiliki baris `pending` untuk id yang tidak dikendalikannya; ia tidak pernah dapat menghubungkannya, tetapi menyimpan baris tak terpakai sampai ia menghapusnya. Squat berdasar `registration` masih mungkin sampai operator melepasnya. Aksi pelepasan butuh orang (operator) dan keputusan di luar sistem; ia tidak skala untuk banyak sengketa, dan itu dapat diterima hanya selama sengketa jarang. Pihak yang kalah dalam balapan `verification` mengetahui bahwa ia kalah (alasan kesehatan di akunnya sendiri), bukan siapa yang menang.
- **Netral:** `security:readiness` mengunci kolom, CHECK-nya, kedua index dan locator (role, kolom, pemilik, `search_path`, isi, EXECUTE) secara persis, dan menjalankan probe ter-rollback atas seluruh perilaku termasuk kasus lintas jenis; pin guard akses mengunci trigger immutabilitas. Id eksternal setiap jenis divalidasi BENTUKnya saat pendaftaran (di bawah), tak bergantung data tersimpan, sehingga penolakannya sama untuk id yang dipegang maupun yang bebas.

## Alternatif yang dipertimbangkan

- **B: kedaluwarsa klaim (job platform men-soft-delete baris `pending` yang lebih tua dari N hari).** Ditolak pemilik. Ia mempersempit jendela dan tidak menghilangkannya (daftar ulang tiap N hari); ia job lintas tenant, sehingga butuh role khusus, kelas job role khusus, dan baca lintas tenant atas klaim tenant lain yang oleh desain dilarang RLS; dan N adalah konstanta kebijakan yang harus dipilih dan dipertahankan seseorang. Ia juga menghapus pendaftaran lambat yang sah. Skalanya lebih buruk dari unique index (sapuan atas semua tenant) dan jaminannya lebih lemah.
- **Verifikasi untuk setiap penyedia, dengan yang tak dapat diverifikasi juga mengklaim saat `connected`.** Ditolak. Untuk StarSender dan penyedia Graph API, `connected` hari ini adalah atestasi operator atau tidak ada sama sekali, sehingga mengklaim pada saat itu membiarkan penyerang mengatestasi lebih dulu. Ia menukar squat dengan squat yang lebih buruk (pembohong pertama menang) sambil tampak seperti perbaikan.
- **Menjadikan dasar fungsi dari matriks penyedia, bukan kolom.** Ditolak: predikat index tidak dapat membaca kode aplikasi, sehingga index global butuh daftar penyedia yang ditulis keras di SQL yang harus diubah migrasi pada setiap konektor, dan dasar per baris yang tak berubah itulah yang membuat baris mempertahankan klaim saat ia dibuat.
- **Tabel registri klaim global yang dirawat trigger.** Ditolak: sumber kebenaran kedua untuk fakta yang sama, ditulis fungsi definer dengan hak tulis lintas tenant, demi menghindari satu index parsial.
- **Pelepasan dengan menghapus lewat satu fungsi definer yang mengerjakan semuanya.** Ditolak: ciphertext kredensial dan secret webhook ada di tabel lain dengan RLS-nya sendiri, sehingga definer yang menghapusnya butuh hak tulis pada tabel-tabel itu, melebarkan permukaan lintas tenant jauh melampaui satu baca. Menjalankan pelepasan di konteks RLS pemegang memakai ulang kode hapus milik tenant sendiri.

## Evaluasi terhadap 11 kriteria

| #   | Kriteria                 | Penilaian                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Kelebihan dan kekurangan | **+** Menghilangkan squat di tempat bukti ada, tanpa oracle, tanpa job baru, aman terhadap balapan lewat unique index, penyedia lain tak berubah dan kini punya jalur sengketa. **−** Dua perilaku yang harus diketahui, jalur sengketa manual dan jarang, baris `pending` yang dapat dipegang pihak yang bukan pemilik untuk jenis `verification`.                                                              |
| 2   | Keamanan                 | Dasar bawaan fail-closed (registration) dan kolom yang tak dapat diubah; baris tidak dapat memilih memegang lebih sedikit. Satu-satunya baca lintas tenant adalah satu pencarian kesamaan delapan kolom oleh pemilik NOLOGIN; aksinya ber-scope platform, ber-step-up, idempoten dan diaudit di kedua jejak. Dikunci pemeriksaan `security:readiness` persis dan probe.                                          |
| 3   | Performa                 | Satu pencarian unique index parsial per pendaftaran atau verifikasi; jalur yang ada tak berubah untuk baris `registration`. Index per tenant menambah satu index kecil. Tanpa sapuan, tanpa job. `recordAccountHealth` menambah satu savepoint pada jalur `ok`.                                                                                                                                                  |
| 4   | Pemeliharaan             | Satu tabel kode kecil (`VERIFIED_CLAIM_KINDS`) yang diubah bersama konektornya dan dikunci tes; satu migrasi; guard-nya tinggal bersama pin channel-account yang ada.                                                                                                                                                                                                                                            |
| 5   | Skalabilitas             | Konflik diputuskan di index saat tulis, tak bergantung jumlah tenant; tanpa pemindaian lintas tenant. Aksi pelepasan sengaja bertempo manusia.                                                                                                                                                                                                                                                                   |
| 6   | Aksesibilitas            | Tanpa perubahan UI. Layar operator belum dibangun; saat dibangun, ia membawa kontrak WCAG layar platform lain (kolom alasan berlabel, prompt step-up, konfirmasi yang menyebut konsekuensi).                                                                                                                                                                                                                     |
| 7   | SEO                      | Tidak berlaku: tidak ada halaman publik yang berubah.                                                                                                                                                                                                                                                                                                                                                            |
| 8   | UI/UX                    | Pihak yang kalah dalam verifikasi melihat permukaan kesehatan yang ada (`failing`, alasan `ACCOUNT_ALREADY_REGISTERED`) alih-alih pending yang diam. Alur pelepasan hanya API untuk sementara.                                                                                                                                                                                                                   |
| 9   | Kompatibilitas           | Migrasi forward-only; baris yang ada tetap `registration`; jawaban pendaftaran tak berubah untuk setiap penyedia yang ada; endpoint baru dan hasil `claim: "lost"` bersifat aditif. OpenAPI mendokumentasikan rute baru dan `409` pada `attest-device`.                                                                                                                                                          |
| 10  | Kompleksitas operasional | Tanpa job atau variabel lingkungan baru. Satu role NOLOGIN baru (pemilik fungsi baca-saja), satu permission platform yang mewajibkan faktor MFA terdaftar dan diberikan oleh migrasi hanya ke owner tenant setup (job backfill tidak pernah memberikannya; tenant platform selain tenant setup butuh baris role-permission eksplisit). Satu baris runbook untuk operator: verifikasi di luar sistem, lalu lepas. |
| 11  | Implikasi jangka panjang | Tabel menjadi daftar periksa bagi setiap konektor mendatang: penyedia yang dapat membuktikan id-nya pindah dari `registration` ke `verification` dalam perubahan yang sama. Aksi pelepasan platform dan locator-nya dapat digeneralisasi ke sengketa lintas tenant mendatang. Baris yang dibuat berdasar `registration` mempertahankan klaim itu seumur hidupnya.                                                |

## Pertanyaan terbuka

Tidak ada yang memblokir. Dua tindak lanjut tercatat di README modul:

1. Akun Graph API masuk `VERIFIED_CLAIM_KINDS` dalam perubahan di mana konektornya melaporkan kesehatan `ok`.
2. (Ditutup pada revisi ini, audit L1.) Konektor Telegram kini mengklaim sebelum `setWebhook`.
