🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:df81d0fb093a7899c296478501ba76234ba84ea63f8932f0ca40693a2803714c -->

<!-- i18n-source-hash: sha256:0 -->

# `whatsapp_delivery`

Kapabilitas pengiriman WhatsApp generik (Issue #963, [ADR-0133](../../../docs/adr/0133-generic-delivery-capability-whatsapp-promotion.id.md) fase 1).

Modul ini **mengirimkan** pesan WhatsApp yang diputuskan modul lain untuk dikirim — pengingat booking, pemberitahuan hr_payroll, adapter commerce di hilir. Ia tidak punya pendapat tentang apa yang layak dikirim dan tidak membawa redaksi bisnis selain templat netral `system.notice`. Ia khusus WhatsApp dengan sengaja: `WhatsappDeliveryPort` **bukan** fasad multi-kanal (itu akan menjadi orkestrasi notifikasi, yang tidak diterima ADR-0133 bagian 7).

## "Tanpa outbox kedua", dinyatakan dengan tepat

ADR-0074 sudah menjadikan `push_delivery` outbox kedua, sehingga batasan di issue tidak bisa dibaca harfiah. Yang dilakukan modul ini, dan yang diikat ADR-0133 bagian 3:

- Ia adalah **tabel antrean kanal** (`awcms_whatsapp_messages`), yang ketiga di repo ini setelah `awcms_email_messages` dan `awcms_push_messages`. Ia **tidak** bergabung ke `awcms_domain_events` (panggilan provider di dalam transaksi klaim melanggar ADR-0006) dan **tidak** memperluas tabel e-mail (tabel berbentuk campuran dengan dua dispatcher yang berebut).
- Ia memakai ulang **mekanisme lease**, bukan yang baru: klaim dengan `FOR UPDATE SKIP LOCKED`, `next_attempt_at` merangkap kedaluwarsa lease, kirim **di luar** transaksi mana pun, finalisasi per baris.
- **Satu antrean per kanal per deployment, tidak pernah satu per domain.** Booking, hr_payroll, commerce, dan setiap konsumen berikutnya mengantre ke antrean tunggal ini lewat port. Konsumen tidak pernah menambah tabel, dispatcher, atau panggilan provider WhatsApp miliknya sendiri. Yang ditolak aturan ini adalah **antrean WhatsApp kedua**.

## Port

`_shared/ports/whatsapp-delivery-port.ts`, adapter `whatsappDeliveryPortAdapter` di `application/whatsapp-enqueue.ts`:

- `enqueue(tx, input)` adalah **satu INSERT di transaksi pemanggil** (sehingga booking yang di-rollback tidak mengirim pengingat). Tidak ada `send`: provider dipanggil hanya oleh dispatcher, di luar transaksi. Pemanggil tidak pernah tahu jawaban provider secara sinkron.
- Penolakan dan penekanan **dikembalikan**, tidak dilempar: `refused` (`CONSENT_REQUIRED`, `TEMPLATE_UNKNOWN`, `DISABLED`, `RATE_LIMITED`, ditambah `RECIPIENT_INVALID`, `RECIPIENT_UNRESOLVED`, `EXPIRY_REQUIRED`) dan `suppressed` (`hard_failure`, `opt_out`). Kunci idempotensi wajib dan unik per tenant; pengulangan dijawab `duplicate`.
- `getStatusByCorrelation` membaca kembali status lewat id rekaman milik pemanggil sendiri (penerima disamarkan, tidak pernah nomornya); `cancelByCorrelation` membatalkan pesan yang masih menunggu dan tidak berbuat apa-apa setelah terkirim.
- Port **tidak melakukan pemeriksaan akses dan tidak menulis baris audit**: konsumen mengotorisasi dan mengaudit aksi bisnisnya sendiri.

Konsumen mendaftarkan templat dengan `registerWhatsappTemplate` (kunci berawalan modul, mis. `booking.reminder`). Sebuah templat punya **tepat satu tujuan** dan daftar variabel yang diizinkan; variabel yang tidak ada dalam daftar **dibuang** oleh renderer, itulah yang menjaga pemberitahuan gaji bebas dari data gaji.

## Kelas tujuan dan persetujuan

| Tujuan          | Persetujuan                                                         | Penekanan yang dihormati                   |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `transactional` | tidak ada                                                           | semua alasan                               |
| `security`      | tidak ada; `expiresAt` wajib; tidak pernah diblok opt-out pemasaran | hanya kegagalan permanen                   |
| `marketing`     | eksplisit, per penerima, dicatat beserta sumbernya                  | semua alasan, dan persetujuan yang dicabut |

**Persetujuan tidak bergantung pada keanggotaan segmen.** Keputusan (`domain/whatsapp-eligibility.ts`) hanya menerima baris penekanan dan baris persetujuan; berada dalam segmen, daftar, atau audiens kampanye tidak pernah berarti setuju. Ia dijalankan saat enqueue **dan lagi saat dispatch**, sehingga pencabutan berlaku dalam hitungan menit bahkan untuk baris yang baru saja diklaim. Mencabut persetujuan, atau menekan sebuah nomor, membatalkan pesan penerima yang masih menunggu dalam transaksi yang sama.

Pesan `security` yang melewati `expires_at` menjadi `expired`, **tidak dicoba ulang terlambat**. Baris yang membawa rahasia (OTP) dikosongkan body dan variabelnya saat mencapai status akhir apa pun, dan rahasia itu tidak pernah sampai ke baris percobaan, baris audit, log, maupun event.

## Nomor telepon

Dinormalisasi ke E.164 atau **ditolak, tidak pernah ditebak** (nomor nasional `08…` dibaca hanya bila `WHATSAPP_DEFAULT_COUNTRY_CODE` diatur). Disimpan mentah di **satu kolom** (`awcms_whatsapp_messages.recipient`) karena tidak ada adapter yang bisa mengirim ke sebuah hash; `recipient_hash` (HMAC berkunci, lihat di bawah) menggerakkan persetujuan, penekanan, dan pembatasan laju; `recipient_masked` adalah yang dibawa setiap daftar, baris log, baris audit, dan event. Tabel persetujuan dan penekanan hanya menyimpan hash dan bentuk yang disamarkan.

## Provider

**Pengirim deployment** (`senderAccountId = null`) dipilih per **deployment** dari environment, tidak pernah per permintaan (token yang dikirim dalam permintaan akan membuat admin satu tenant bisa membuat deployment berbicara sebagai pihak lain). Tidak pernah di database, log, atau teks galat. **Pengirim milik tenant** adalah jalur yang berbeda: lihat [Perutean pengirim](#perutean-pengirim-issue-1141) di bawah.

- `WHATSAPP_PROVIDER=log` — mencatat "akan dikirim", tidak memanggil apa pun.
- `fonnte` (`WHATSAPP_FONNTE_TOKEN`) — teks bebas lewat API HTTP Fonnte.
- `meta` (`WHATSAPP_META_ACCESS_TOKEN`, `WHATSAPP_META_PHONE_NUMBER_ID`) — pesan **templat** WhatsApp Cloud API. Templat tanpa `providerTemplate` yang disetujui gagal secara final; ia tidak pernah jatuh kembali ke teks bebas.

Provider yang hilang atau tidak dikenal tidak membuat dispatcher crash dan tidak diam-diam menjadi `log`: ia menjadi provider yang menggagalkan setiap pengiriman **tanpa coba ulang**, dan `config:validate` menolak `WHATSAPP_ENABLED=true` tanpa provider. Setiap panggilan melewati `ssrfSafeFetch` dengan batas waktu total; hanya **adapter** yang mengisi circuit breaker, sehingga penolakan per pesan (nomor buruk, templat buruk) tidak pernah memicunya. Provider yang melaporkan sebuah nomor tidak bisa menerima WhatsApp membuat dispatcher mencatat penekanan `hard_failure`.

## Perilaku saat nonaktif

Tanpa `WHATSAPP_ENABLED=true`, `enqueue` menjawab `refused: DISABLED` dan tidak menulis apa pun, dan `bun run whatsapp:dispatch` tidak mengklaim satu baris pun. `bun run whatsapp:queue:purge` berjalan **terlepas dari itu** (untuk setiap tenant): deployment yang mematikan WhatsApp masih punya baris dari saat ia menyala.

## Retensi: `delegated`

Purge lebih dulu mengedaluwarsakan baris non-terminal yang basi (mengosongkan OTP), lalu hanya menghapus baris terminal. DELETE-nya menyebut status akhir (`sent`, `failed`, `cancelled`, `expired`) dan memakai `updated_at` sebagai kursor, sehingga pesan yang menunggu gangguan provider berlalu — atau pengingat yang dijadwalkan berhari-hari ke depan — tidak pernah dihapus. Percobaan dihapus sebelum pesan (urutan FK). Persetujuan dan penekanan tidak pernah dipurge: keduanya adalah keputusan privasi, dan menghapus penekanan akan melanjutkan pengiriman ke orang yang meminta berhenti.

## Permukaan admin

`/admin/whatsapp` (entri navigasi dikunci pada `whatsapp_delivery.messages.read`): status pengiriman, pesan terbaru beserta pembatalan, percobaan terbaru, penyimpanan persetujuan, daftar penekanan, dan templat terdaftar. Setiap panel dikunci pada izinnya sendiri. Kesepuluh izin di-seed oleh `sql/179`; dua izin perutean pengirim (`senders.read`, `sender_policy.configure`, hanya API, belum ada layar) oleh `sql/323`.

## Catatan keamanan dan batas yang diketahui (audit PR #975)

- **Hash penerima berkunci.** `HMAC-SHA256(key, tenantId 0x00 "whatsapp:recipient" 0x00 e164)` di bawah ring rahasia `WHATSAPP_RECIPIENT_HASH_KEYS` (pasangan `keyId:base64`, yang pertama menulis, semuanya dibaca, id kunci disimpan di dalam nilai sebagai `k1:<hex>`; bentuk ADR-0137 bagian 2). Hash yang hanya digarami dengan id tenant dapat dibalik dalam sekitar satu milidetik (ruang nomor kecil dan mask membocorkan empat digit terakhir), dan baris persetujuan serta penekanan tidak menyimpan plaintext, sehingga ini tidak akan pernah bisa dimigrasikan kemudian. Tanpa ring yang dapat dipakai, enqueue, persetujuan, dan penekanan **menolak** dan dispatcher tidak mengklaim apa pun (gagal-tertutup); `config:validate` mewajibkan ring saat `WHATSAPP_ENABLED=true`. **Id kunci tidak boleh dihentikan selama masih ada baris persetujuan atau penekanan, atau backup yang dapat dipulihkan, yang membawanya**: baris itu tidak dapat di-hash ulang. Rotasi adalah "tambahkan kunci baru di depan"; sengaja tidak ada job hash ulang.
- **Satu pemilik per baris.** Lease klaim disesuaikan dengan seluruh batch (`limit` kali batas waktu provider), lease diperbarui dan diverifikasi tepat sebelum tiap baris, dan finalisasi mencocokkan nilai lease persis yang ditulis oleh pass ini, sehingga lease yang kedaluwarsa di tengah batch dilewati, bukan dikirim dua kali. Klaim ulang atas baris `sending` yang kedaluwarsa dihitung sebagai percobaan, baris yang melewati batas retry digagalkan, dan lemparan saat memproses satu baris hanya menggagalkan baris itu. Sisa risiko: at-least-once ke provider tetap ada (crash setelah provider menerima dan sebelum finalisasi dapat mengirim ulang).
- **Opt-out dilindungi.** Memberi persetujuan ulang di atas baris yang dicabut ditolak kecuali permintaan menyatakan `reinstateWithdrawn`, membawa `evidenceRef`, bukan `source: "import"`, dan pemanggil memegang `consents.restore` yang berisiko tinggi sebagai ganti `consents.create`. Pencabutan tetap ada di `withdrawal_history`, dan pemulihan diaudit dengan severity warning serta dipancarkan sebagai event.
- **Kedaluwarsa tidak bergantung pada dispatcher.** `whatsapp:queue:purge` menandai setiap baris non-terminal yang melewati `expires_at` sebagai `expired` dan mengosongkan OTP, untuk setiap tenant, terlepas dari flag, breaker, dan keadaan tenant.
- **Teks provider disunting sebelum disimpan.** Baris yang membawa rahasia tidak menyimpan detail provider (`Provider reported <code>.`); baris lain dibuang nilai persis body dan variabelnya sendiri. Adapter Fonnte tidak punya sinyal "penerima tidak valid" terstruktur, sehingga tidak pernah membuat penekanan hard-failure dari teks bebas; kode numerik Meta tetap mempertahankan vonis itu.
- **Pembatasan laju.** Pesan `security` punya bucket per penerima sendiri (`WHATSAPP_RATE_SECURITY_PER_RECIPIENT_PER_HOUR`, default 5), sehingga pemberitahuan tidak dapat menghabiskannya dan banjir OTP tidak dapat diarahkan ke satu nomor. Hitungannya sengaja bersifat racy saat konkurensi.
- **Pengulangan idempoten mengabaikan payload.** `enqueue` kedua dengan `(tenant, idempotencyKey)` yang sama mengembalikan `duplicate` apa pun templat, variabel, atau penerimanya; pemanggil yang memakai ulang kunci untuk pesan lain kehilangannya secara diam-diam. Kunci harus diturunkan dari id rekaman pemanggil sendiri.
- **Opt-out versus pesan yang sedang berjalan.** Pencabutan membatalkan baris `queued` dan `retry_wait` dan dispatcher memeriksa ulang persetujuan sebelum setiap pengiriman, tetapi baris yang sudah `sending` sedang dalam panggilan provider dan tidak dapat ditarik; jendela itu dibatasi oleh batas waktu provider.
- **Erasure belum diimplementasikan.** Deskriptor `subjectData` menyatakan `anonymize` untuk keempat tabel, tetapi belum ada jalur eksekutor yang diuji untuknya; erasure subjek data untuk penerima WhatsApp adalah item terbuka (dan mengosongkan `recipient_hash` menghapus penekanan, sehingga tidak boleh dijalankan pada nomor yang ditekan tanpa keputusan).

## Perutean pengirim (Issue #1141)

[ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) bagian 4. Satu tenant dapat memiliki beberapa pengirim WhatsApp (satu nomor Meta Cloud API per brand, kelak perangkat StarSender) di [`channel_accounts`](../channel-accounts/README.id.md), dan sebuah pesan dapat dikirim lewat salah satunya. **Satu antrean, satu dispatcher, tanpa dual write**: pengirim adalah **kunci pada antrean yang sudah ada**, bukan antrean kedua.

### Apa yang berubah pada port, dan siapa yang terdampak

`WhatsappDeliveryPort` naik dari `1.0.0` ke **`1.1.0`, secara aditif** (`capability-contract-versions.ts`, `awcms-family-compatibility.yaml`):

| Ditambahkan (semuanya opsional) | Arti                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `senderAccountId`               | Akun milik tenant yang seharusnya mengirim. Bukan token, bukan id nomor telepon, bukan id perangkat.            |
| `inReplyToMessageId`            | Afinitas utas: pesan ini melanjutkan pesan sebelumnya ke penerima yang sama dan **memakai pengirim yang sama**. |
| `businessScope`                 | `{ type, id }`: brand atau unit; kunci kebijakan pengirim bawaan.                                               |
| penolakan                       | `SENDER_UNAVAILABLE`, `SENDER_AFFINITY_CONFLICT`, `REPLY_TARGET_UNKNOWN`.                                       |

**Kompatibilitas (dinyatakan, dan diuji).** Tidak ada field, tanda tangan, atau penolakan yang sudah ada yang berubah. Panggilan yang tidak mengisi field baru apa pun, untuk tenant tanpa kebijakan pengirim, diantre dengan `senderAccountId = null` (**pengirim deployment**) dan menempuh jalur yang sama, provider yang sama, kredensial yang sama, dan payload event yang sama seperti di `1.0.0`. Karena itu `booking`, dan adapter commerce di balik router mode `legacy`/`upstream` per tenant milik `awcms-one` (ADR-0047 hilir; [ADR-0133](../../../docs/adr/0133-generic-delivery-capability-whatsapp-promotion.id.md) bagian 6), dapat dikompilasi dan berperilaku **tanpa perubahan**. Tenant dalam mode `legacy` tidak pernah mencapai port ini, sehingga perutean pengirim tidak berlaku baginya sampai cutover (tenant berada tepat di satu mode, jadi tetap tidak ada antrean kedua dan tidak ada dual write); `awcms-one` mengadopsi input baru setelah subtree sync sebagai merge commit, dan default StarSender sebuah produk turunan adalah **konfigurasi kebijakan**, diterapkan per tenant, tidak pernah perubahan kode. Konsumen yang melakukan `switch` lengkap atas alasan penolakan (tidak ada di repositori ini: booking memetakan alasan yang tak dikenal ke kode kasar) harus menambah ketiga anggota itu sebelum meneruskan pengirim. Konsumen yang menerima id pengirim dari **pengguna** harus memberi otorisasi atas pilihan itu sendiri: port menegakkan otoritas tenant, ia tidak melakukan pemeriksaan akses (konsumen mengotorisasi aksi bisnisnya sendiri, ADR-0011).

### Pengirim mana yang didapat sebuah pesan

Berurutan, sekali, saat enqueue, **di-snapshot pada baris dan tak dapat diubah** (`sender_account_id`, `sender_selection`, `sender_policy_version`, lingkup bisnis; database menolak UPDATE atas salah satunya, untuk setiap peran):

1. pengirim utas, bila `inReplyToMessageId` menyebut pesan sebelumnya ke penerima yang sama (pengirim eksplisit yang berbeda adalah `SENDER_AFFINITY_CONFLICT`; target yang tak dikenal, milik tenant lain, atau untuk penerima lain adalah `REPLY_TARGET_UNKNOWN`);
2. jika tidak, `senderAccountId` eksplisit;
3. jika tidak, **bawaan lingkup bisnis** (`awcms_whatsapp_sender_policies`), lalu bawaan seluruh tenant;
4. jika tidak, pengirim deployment (`null`).

Bawaan itu adalah **kebijakan prospektif dengan versi konfigurasi**: `PUT /api/v1/whatsapp/sender-policy` (berisiko tinggi, `whatsapp_delivery.sender_policy.configure`, `Idempotency-Key`, diaudit pada `warning`) mengubah apa yang didapat pesan **berikutnya**; pesan yang sudah diantre tetap memegang pengirim dan versi yang diberikan kepadanya. `defaultSenderAccountId: null` adalah keputusan eksplisit memakai pengirim deployment untuk suatu lingkup. **Tidak ada default provider di kode**: produk turunan yang ingin StarSender (atau Meta) sebagai bawaannya mengonfigurasi kebijakan.

### Pengirim yang tidak bisa mengirim tidak pernah mengirim lewat yang lain

Pengirim dapat dipakai hanya bila `channel_accounts` menyatakannya **saat ini**: akun milik **tenant ini** (id tenant lain dan id tak dikenal adalah satu jawaban yang sama), identitas pengirim WhatsApp, `connected`, grant koneksinya aktif, dan kapabilitas (`dm`, `reply`, atau `broadcast` untuk pemasaran) diberikan beserta bukti terhadap matriks saat ini (`ChannelAccountPort`). Selain itu:

| Saat     | Keadaan pengirim                                                                                                       | Hasil                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| enqueue  | tidak dapat dipakai karena alasan apa pun, atau provider tak punya adapter di deployment ini (StarSender sampai #1142) | `refused: SENDER_UNAVAILABLE`, tidak ada yang diantre, **tidak pernah** pengirim, nomor, atau provider lain |
| dispatch | tak dikenal, dicabut, dinonaktifkan, koneksi tidak aktif, kapabilitas ditarik, tanpa adapter                           | `failed` terminal dengan `sender_unavailable`; provider tidak pernah dipanggil                              |
| dispatch | degraded, pending, token menunggu refresh, tanpa key ring, control plane mati                                          | jalur **ditahan**: baris tetap menunggu, tidak ada yang diklaim, anggaran retry tidak terpakai              |
| dispatch | provider menolak kredensial pengirim (`unauthorized`)                                                                  | baris itu gagal; sisa jalur gagal-tertutup **tanpa panggilan lagi**                                         |

Tidak ada rotasi ke nomor lain untuk menghindari batas provider, rating kualitas, atau kegagalan (ADR-0148 I4, I5); pengalihan eksplisit adalah enqueue **baru**.

### Adapter dan rahasia: dari rekaman tenant, tidak pernah dari permintaan

Adapter Meta dibangun **per jalur, per pass** dari rekaman pengirim itu sendiri (`external_id` adalah `phone_number_id`) dan kredensialnya sendiri, didekripsi **di memori** untuk tenant dari baris yang diklaim oleh `ChannelSenderCredentialPort` (key ring aplikasi, AES-256-GCM, associated data yang mengikat tujuan, tenant, dan baris). Tipe input port tidak punya field tempat token bisa menumpang, dan endpoint kebijakan menolak body yang menyelundupkannya. Adapter resolusi pengirim (`channel-account-port-adapter.ts`, dipakai di jalur enqueue) **tidak pernah mengimpor secret store**; hanya `scripts/whatsapp-dispatch.ts` yang menyusun adapter kredensial, itulah sebabnya `CHANNEL_SECRETS_ENCRYPTION_KEYS` diberikan kepada `whatsapp:dispatch` saja di antara job yang menjangkau modul ini. Pengirim yang dicabut karena itu berlaku pada **klaim berikutnya**.

### Kesehatan, kuota, throttle, breaker, dan klaim adil per pengirim

- **Jalur dan klaim adil.** Satu pass melayani setiap pengirim yang punya baris jatuh tempo sebagai jalurnya sendiri, yang paling lama menunggu lebih dulu, paling banyak `limit / jalur` baris per jalur, sehingga satu nomor yang macet atau ter-throttle tidak dapat membuat yang lain kelaparan.
- **Breaker.** Satu circuit breaker per pengirim (`whatsapp-delivery:sender:<id akun>`); pengirim deployment tetap `whatsapp-delivery`. Satu nomor yang gagal tidak menghentikan nomor lain.
- **Kuota dan throttle.** `WHATSAPP_SENDER_RATE_PER_HOUR` (default 1000) dan `WHATSAPP_SENDER_RATE_PER_DAY` (default 10000), dihitung dari apa yang benar-benar **dikirim** pengirim ditambah yang sedang berjalan. Batas yang tercapai membuat jalur menunggu; baris tidak pernah dialihkan. Ini batas atas seluruh deployment, bukan pengaturan per pengirim.
- **Diagnostik.** `GET /api/v1/whatsapp/senders` (`whatsapp_delivery.senders.read`): per pengirim, ketersediaan (kode alasan kasar), antrean, kuota, dan apakah ter-throttle. Tidak ada kredensial, referensi rahasia, nomor telepon, atau id perangkat yang pernah diproyeksikan; daftar pesan mendapat `senderAccountId` dan `senderSelection`. Event `awcms.whatsapp.message.*` mendapat `senderAccountId` (tidak ada untuk pengirim deployment, sehingga payload itu tidak berubah); "diterima" provider tidak pernah berarti "terkirim".

### Persetujuan dan penekanan: penerima, bukan pengirim

Persetujuan, penekanan, kedaluwarsa, kelas tujuan, kunci idempotensi, dan batas laju penerima dikunci pada **penerima** (dan diperiksa saat enqueue serta sekali lagi saat dispatch), tidak pernah pada pengirim: mengganti pengirim tidak mengubah siapa yang sudah setuju, dan opt-out atau alamat yang ditekan menghentikan setiap pengirim milik tenant. Pemasaran lewat pengirim membutuhkan kapabilitas `broadcast` (terbatas untuk provider tak resmi, sehingga di sana membutuhkan bukti kontrak).

### Batas perubahan ini (terbuka, dinyatakan)

- **Hanya `whatsapp_cloud` yang punya adapter.** Pengirim StarSender ditolak saat enqueue dan gagal-tertutup saat dispatch sampai Issue #1142 menambahkan adapternya di balik flag sendiri dan pengakuan risiko per operator (tidak dibangun di sini).
- **Persetujuan belum dikunci per lingkup bisnis** (per tenant dan penerima, seperti sebelumnya): opt-in satu brand berlaku bagi brand lain milik tenant. Mengunci persetujuan per lingkup adalah keputusan skema untuk tabel persetujuan, tidak diambil di sini; opt-out dan penekanan adalah arah yang aman (berlaku di seluruh tenant).
- **Tanpa override pengirim per tujuan** dalam kebijakan (pack menyebutnya opsional) dan **tanpa override batas per pengirim** (batas berlaku seluruh deployment).
- **Breaker dan kesehatan per pengirim ada di dalam proses**, seperti breaker deployment: ia direset saat proses dispatcher dimulai ulang; kuota dihitung dari antrean dan bertahan melewati restart. Dispatcher tidak menulis baris kesehatan.
- **Tidak ada layar admin** untuk pengirim atau kebijakan (pengelola koneksi adalah #1154); API-nya lengkap.
- **Penugasan akun per orang** (assignment `channel_accounts`) tidak diterapkan oleh port; konsumen yang membiarkan pengguna memilih pengirim harus memeriksanya.
- **Jendela balapan satu transaksi:** akun yang dicabut di antara pemeriksaan enqueue dan INSERT ditangkap oleh guard database, yang melempar di dalam transaksi pemanggil (nyaring, gagal-tertutup); pencabutan setelah INSERT ditangkap saat dispatch.

## Bukan bagian fase ini

Webhook masuk (tanda terima pengiriman, balasan "stop" — ADR-0133 bagian 10, Q2), adapter StarSender (Issue #1142), pengungkapan nomor mentah untuk admin (Q7), Telegram, dan orkestrasi notifikasi belum dibangun. Pemilihan pengirim per tenant (Q3) **sudah dibangun sejak Issue #1141**: lihat [Perutean pengirim](#perutean-pengirim-issue-1141). Adapter kompatibilitas commerce dan cutover per tenant (ADR-0133 bagian 6, fase 2 sampai 4) adalah pull request terpisah yang lebih belakangan.

## Runtime Bun WhatsApp / status UI terencana

`bun run whatsapp:dispatch` sudah mengirim melalui API provider dari antrean Bun tunggal. Perutean Meta multi-pengirim ([#1141](https://github.com/ahliweb/awcms/issues/1141)) memakainya, dan pekerjaan StarSender serta webhook [#1142–#1143](https://github.com/ahliweb/awcms/issues/1142) wajib memakainya juga, tanpa worker Node.js/Socket.IO. SSE/WS Bun nanti hanya menampilkan status; diterima provider bukan delivered. [Standar runtime](../../../docs/awcms/bun-delivery-realtime-runtime.id.md).
