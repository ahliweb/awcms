🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](starsender-adapter-runbook.md)

<!-- i18n-source-hash: sha256:77d7ab450d21b153e93bc1febc66430cea3077362256a2ed4a8cf01f2501d71b -->

<!-- i18n-source-hash: sha256:0 -->

# Adapter StarSender — runbook operasional (Issue #1142)

Pembaca: operator yang menyalakan adapter WhatsApp StarSender opsional untuk sebuah deployment, dan petugas jaga yang menemukan perangkat StarSender bermasalah. Catatan keputusan: [ADR-0148](../adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) bagian 4 dan 7, ditambah [ADR-0158](../adr/0158-starsender-adapter-conditions-that-differ-from-adr-0148-operator-attested-device-state-held-lanes-and-an-unapproved-acknowledgement-text.id.md) yang **Diusulkan**, yang mencatat di mana adapter ini melampaui ADR-0148 (status perangkat diatestasi operator, lane ditahan, hasil tak diketahui) dan butuh keputusan pemilik. Sebelum diterima tidak ada yang dapat mengirim di sini: teks pernyataan belum disetujui dan flag mati. Modul: [`whatsapp_delivery`](../../src/modules/whatsapp-delivery/README.id.md) (adapter) dan [`channel_accounts`](../../src/modules/channel-accounts/README.id.md) (akun, pernyataan risiko, atestasi).

## 0. Apa yang Anda nyalakan

StarSender adalah gateway WhatsApp **tidak resmi**. Ia bukan antarmuka yang diizinkan Meta. Memakainya dapat melanggar ketentuan WhatsApp dan nomor dapat dibatasi atau diblokir; AWCMS tidak dapat mencegah atau memulihkannya dan **tidak mengklaim** persetujuan Meta, pengiriman bebas blokir, atau status pengiriman yang andal. Jawaban `success` dari StarSender hanya berarti **StarSender menerima permintaan**: AWCMS mencatat pesan sebagai `sent` (diterima), tidak pernah sebagai terkirim atau terbaca, dan tidak menyimpan id pesan penyedia (dokumentasi tidak menunjukkannya).

**Tidak ada fallback otomatis.** Perangkat yang gagal, terputus, atau belum disetujui tidak pernah mengirim lewat perangkat, nomor, atau penyedia lain; mengalihkan secara eksplisit adalah enqueue baru yang berwenang dan diperiksa persetujuannya. Tidak ada rotasi perangkat untuk menghindari batas penyedia.

Ia memakai antrean dan dispatcher WhatsApp yang **sudah ada** (`bun run whatsapp:dispatch`, di bawah runtime Bun yang dipatok). Tidak ada antrean kedua, dispatcher kedua, maupun endpoint masuk.

## 1. Gerbang, sesuai urutan penutupannya

Semuanya harus terpenuhi agar pesan sampai ke StarSender. Gerbang-gerbang itu sengaja independen; tidak ada yang menyiratkan yang lain.

| #   | Gerbang                                                                                                                                    | Penentu                           | Gagal sebagai                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------- |
| 1   | `WHATSAPP_STARSENDER_ENABLED=true` (mati secara bawaan; juga butuh `WHATSAPP_ENABLED` dan `CHANNEL_ACCOUNTS_ENABLED`)                      | Operator, per deployment          | enqueue `refused: SENDER_UNAVAILABLE`; baris yang diklaim `failed`    |
| 2   | Teks risiko **disetujui** pemilik bisnis (perubahan kode yang ditinjau)                                                                    | Pemilik bisnis (manusia)          | tidak ada pernyataan yang bisa dicatat (`409 RISK_TEXT_NOT_APPROVED`) |
| 3   | Tenant memegang **pernyataan aktif** atas teks terkini                                                                                     | Orang-orang tenant, satu per satu | `RISK_ACKNOWLEDGEMENT_REQUIRED`, terminal                             |
| 4   | Perangkat **diatestasi** terhubung oleh operator yang memegang pernyataannya sendiri                                                       | Operator                          | perangkat tetap `pending`; database menolak `connected`               |
| 5   | Kapabilitas `dm` diberikan **dengan bukti** untuk perangkat                                                                                | Administrator tenant              | `CAPABILITY_DENIED`, terminal                                         |
| 6   | Hanya pemasaran: `broadcast` berstatus **restricted** untuk StarSender, jadi butuh bukti `contract_reference` atau `written_authorization` | Administrator tenant              | `CAPABILITY_DENIED`, terminal                                         |
| 7   | Per penerima: persetujuan, supresi, kedaluwarsa (tidak berubah, diperiksa saat enqueue dan lagi saat dispatch)                             | Penerima                          | ditolak / dibatalkan seperti pesan WhatsApp lain                      |

**Teks pernyataan yang dikirim adalah DRAF.** `src/modules/channel-accounts/domain/risk-acknowledgements.ts` mengirimkannya dengan `approval: null`, sehingga gerbang 2 tertutup sampai pemilik bisnis menyetujui redaksinya (penasihat hukum untuk salinan DPIA, daftar tanda tangan ADR-0148) dan perubahan yang ditinjau mengisi `approval` (serta menaikkan `textVersion` bila redaksi berubah; versi baru membatalkan semua pernyataan sebelumnya). Itu langkah manusia yang tidak dapat dilakukan repositori ini.

## 2. Mengaktifkannya untuk satu tenant

1. Deploy build yang memuat `sql/340` dan `sql/341`; jalankan `bun run db:migrate`. Untuk tenant yang sudah ada jalankan `bun run identity-access:permissions:backfill` (tiga izin `risk_acknowledgements` adalah baru).
2. Setel `WHATSAPP_STARSENDER_ENABLED=true` untuk proses web **dan** job `whatsapp:dispatch` (allowlist env job sudah memuat namanya; bangkitkan ulang dan deploy ulang `ops/awcms-jobs.env-*` bila Anda memakainya). Tanpa flag, adapter tidak ada, apa pun konfigurasi lainnya.
3. Tenant mendaftarkan perangkat: `POST /api/v1/channel-accounts/accounts` dengan `provider: starsender`, `accountKind: device`, `authMode: device_key`, lalu menulis **API key perangkat** dengan `PUT .../accounts/{id}/credential` (hanya-tulis, pemegang yang terdaftar MFA, step-up). Key tidak pernah dikembalikan, dicatat di log, diaudit, atau dijadikan event. Jangan pernah menaruh key asli sebuah produk di repositori ini.
4. Setiap operator yang akan mengatestasi perangkat membaca teksnya (`GET /api/v1/channel-accounts/risk-acknowledgements?provider=starsender`) dan mencatat pernyataan **miliknya sendiri** (`POST` ke jalur yang sama dengan `textVersion` yang dibacanya).
5. Administrator tenant mencatat bukti untuk `dm` (dan `reply`) pada perangkat (`PUT .../capabilities/dm`).
6. Operator mengatestasi bahwa perangkat sudah terpasang (orang yang punya faktor MFA butuh step-up segar, seperti untuk kredensial; menyatakan juga sama): `POST .../accounts/{id}/attest-device`. Ini **diatestasi operator, bukan diverifikasi**: StarSender tidak mendokumentasikan panggilan status (bagian 4). Catatan kesehatan berbunyi `OPERATOR_ATTESTED`.
7. Kirim dengan `senderAccountId`, atau atur pengirim bawaan prospektif sebuah business scope (`PUT /api/v1/whatsapp/sender-policy`). Produk turunan yang ingin StarSender sebagai bawaannya mengonfigurasi kebijakan itu; **tidak ada bawaan penyedia di kode**.

## 3. Membacanya di produksi

| Gejala                                                                               | Arti / yang dilakukan                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failure_code = device_disconnected`, baris di `retry_wait`, satu panggilan per pass | StarSender melaporkan perangkat tidak terhubung. **Lane** perangkat **ditahan** (satu panggilan, tidak lebih) dengan backoff terbatas terhadap `WHATSAPP_SEND_MAX_RETRIES`, lalu `failed` terminal. Pasang ulang ponsel di StarSender, lalu atestasi lagi bila akun sempat terdegradasi. Tidak ada yang dialihkan.                                              |
| `failure_code = unauthorized`                                                        | StarSender menolak key perangkat (401/403): key dirotasi atau milik perangkat lain. Tulis ulang kredensial. Lane ditahan dengan backoff.                                                                                                                                                                                                                        |
| `failure_code = outcome_unknown`                                                     | Timeout, reset, atau **5xx APA PUN**: permintaan mungkin sudah diproses (gateway yang gagal mungkin sudah meneruskan pesan). **Tidak dicoba ulang** (StarSender tidak mendokumentasikan kunci idempotensi; percobaan ulang bisa mengirim pesan dua kali). Dihitung terhadap breaker perangkat. Periksa penerima/dasbor StarSender sebelum enqueue ulang manual. |
| `failure_code = rate_limited`                                                        | HTTP 429 atau pesan batas. Dicoba ulang dengan backoff, terbatas. Rentetan berulang membuka circuit breaker perangkat itu; perangkat lain tidak terpengaruh.                                                                                                                                                                                                    |
| `failure_code = rejected`                                                            | StarSender menolak pesan ini (termasuk HTTP 200 dengan `success:false`). Terminal. Redaksi penyedia tidak pernah disimpan.                                                                                                                                                                                                                                      |
| `failure_code = malformed_response`                                                  | HTTP 200 dalam bentuk yang tidak dikenal adapter ini. **Tidak dianggap diterima.** Terminal. Lihat bagian 6: kontraknya mungkin berubah.                                                                                                                                                                                                                        |
| `sender_unavailable` dengan alasan `RISK_ACKNOWLEDGEMENT_REQUIRED`                   | Pernyataan tenant dicabut, atau teksnya berubah. Nyatakan ulang versi terkini, lalu atestasi ulang perangkat yang terdegradasi.                                                                                                                                                                                                                                 |
| `GET /api/v1/whatsapp/senders`                                                       | Per perangkat: ketersediaan (alasan kasar), antrean, kuota, dibatasi atau tidak. Tidak pernah key, id perangkat, atau nomor.                                                                                                                                                                                                                                    |

Kejujuran kesehatan: `healthCheck` melaporkan **circuit breaker perangkat saja**. Ia bukan probe konektivitas, karena satu-satunya panggilan yang terdokumentasi adalah pengiriman itu sendiri. Breaker dan kode kegagalan di atas adalah sinyalnya; status perangkat di `channel_accounts` adalah apa yang diatestasi operator.

## 4. Menghentikannya

- **Satu perangkat:** nonaktifkan (`PATCH .../accounts/{id}` dengan `status: disabled`) atau putuskan (`POST .../disconnect`, menghapus key tersimpan). Berlaku pada claim berikutnya, dan dalam `WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS` baris di dalam pass yang sedang berjalan. Baris antrean ke perangkat itu gagal terminal; tidak ada yang dialihkan.
- **Pemakaian penyedia oleh satu tenant:** cabut pernyataannya (`POST .../risk-acknowledgements/{id}/revoke`). Mencabut yang **terakhir** mendegradasi perangkat terhubung tenant dalam transaksi yang sama dan setiap pengiriman langsung ditolak. Catatannya tetap ada (siapa menerima apa, kapan dicabut).
- **Seluruh deployment:** cabut `WHATSAPP_STARSENDER_ENABLED` dan restart web dan job. Enqueue menolak, baris antrean gagal saat dispatch, penyedia tidak pernah dipanggil.

Rotasi key dengan menulis ulang kredensial (menggantikannya). **Mengganti key perangkat memindahkan perangkat kembali ke `pending` (`CREDENTIAL_REPLACED`) dalam transaksi yang sama dan ia harus diatestasi lagi**: status teratestasi adalah klaim tentang pemasangan key itu, bukan key mana pun yang tersimpan berikutnya. Key yang dipakai bersama dua perangkat adalah salah konfigurasi: setiap perangkat mengisolasi key, breaker, dan lane-nya sendiri.

## 5. Webhook: tidak ada, dengan sengaja

Dokumentasi publik StarSender menjelaskan webhook masuk (pesan masuk `message`, `from`, `timestamp`) tetapi **tanpa autentikasi permintaan**: tidak ada tanda tangan, header rahasia, atau tantangan. ADR-0148 I9 melarang memercayai kerahasiaan URL untuk konten yang mengubah status pelanggan, dan matriks menjaga `inbound` StarSender tetap `unverified`. Maka:

- **Tidak ada rute webhook StarSender** (`tests/starsender-adapter.test.ts` menegaskannya), tidak ada skema tanda tangan yang dikarang, dan tidak ada status pengiriman atau kontak yang diserap dari StarSender.
- Adapter berjalan dalam **mode status-tidak-diketahui**: pesan `sent` (diterima) dan tetap demikian. Tidak akan pernah ada yang berkata "terkirim" atau "terbaca".
- Apakah mekanisme kompensasi dapat diterima (misalnya endpoint polling, bila StarSender mendokumentasikannya) **tidak diputuskan di sini**; ia butuh adendum ADR dan bukti. Sampai itu, status dan kontak StarSender tidak masuk.

## 6. Verifikasi terhadap API live sebelum produksi (BELUM dilakukan dalam perubahan ini)

Fixture kontrak di `tests/fixtures/starsender/contract-fixtures.ts` berasal dari satu halaman dokumentasi publik (dibaca 3 November 2026): hanya badan **sukses** yang terdokumentasi. Setiap badan kegagalan adalah asumsi. Sebelum mengaktifkannya di produksi, dengan perangkat uji StarSender dan nomor Anda sendiri:

1. Konfirmasi permintaan: `Authorization` membawa key perangkat mentah (tanpa `Bearer`), `to` menerima digit `62…`, `messageType: "text"` plus `body` mengirim teks.
2. Rekam badan galat nyata untuk: nomor tidak valid, perangkat terputus, key salah, kuota/batas laju habis. Bandingkan dengan fixture; ubah `classifyStarsenderResponse` dan fixture **bersama-sama**.
3. Periksa apakah `data` pernah membawa id pesan. Bila ya dan stabil, menambahkannya adalah perubahan yang disengaja (`providerMessageId` memungkinkan penyelidikan pengiriman ganda) dan butuh tinjauan sendiri.
4. Periksa apakah StarSender menawarkan panggilan status perangkat tanpa efek samping. Bila ya, sebuah konektor dapat menggantikan atestasi operator (dan `attest-device` dapat dipensiunkan).
5. Periksa apakah StarSender menawarkan kunci idempotensi permintaan. Bila ya, `outcome_unknown` (timeout, reset, 5xx apa pun) dapat menjadi dapat-dicoba-ulang.
6. Periksa redaksi persis jawaban "perangkat tidak terhubung" dan batas laju. `DEVICE_DISCONNECTED` dan `RATE_LIMITED` di `domain/starsender-contract.ts` adalah pola teks bebas yang mungkin juga cocok dengan pesan tentang **penerima** (misalnya "nomor tidak terhubung ke WhatsApp"); keduanya hanya menahan lane atau menunda percobaan ulang (tidak pernah vonis tingkat penerima), tetapi harus diperketat terhadap jawaban nyata, bukan ditebak.

## 7. Risiko sisa (dinyatakan, tidak disembunyikan)

- **Kontrak belum terverifikasi** (bagian 6): nama field dan redaksi kegagalan belum terbukti terhadap API live.
- **Status perangkat diatestasi operator**: control plane tidak dapat tahu bahwa perangkat benar-benar terpasang. Perangkat terputus ditemukan lewat pengiriman yang gagal (lane ditahan), bukan probe; worker tidak punya hak tulis, sehingga ia tidak menandai akun `degraded` sendiri.
- **Pernyataan siapa yang dihitung**: perangkat terikat pada pernyataan tempat ia diatestasi, dan mencabut pernyataan ITU mendegradasinya; keputusan pengiriman sendiri bertanya "apakah tenant memegang pernyataan aktif atas teks terkini", bukan "apakah pengatestasinya masih aktif". Apakah pernyataan milik orang yang dinonaktifkan atau dihapus harus berhenti dihitung **belum diputuskan** (catatan bertahan setelah penghapusan orangnya, dengan sengaja) dan aturan yang bersih tidak ditemukan; nonaktifkan pernyataan orang itu dengan mencabutnya.
- **At-least-once**: crash setelah StarSender menerima dan sebelum baris difinalisasi dapat mengirim ulang (sifat antrean yang sudah ada). Timeout tidak dicoba ulang justru untuk menghindari risiko duplikat yang lebih besar.
- **Teksnya draf** sampai pemilik menyetujuinya, dan pernyataan tersimpan membuktikan seseorang menekan sebuah versi, bukan bahwa ia memahaminya.
- **Kredensial pengirim per tenant dan jangkauan dispatcher** adalah risiko sisa yang diterima ADR-0148 bagian 5, tidak berubah.
- **Persetujuan pemasaran masih dikunci per tenant dan penerima**, bukan business scope (keputusan terbuka M4 dari #1231, tidak disentuh di sini).
