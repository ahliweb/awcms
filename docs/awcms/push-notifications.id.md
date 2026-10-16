🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](push-notifications.md)

<!-- i18n-source-hash: sha256:1ae39542b8769758f4b4a63b097f5a46e7e2a851bb06ba5f8b366b458f435fa9 -->

<!-- i18n-source-hash: sha256:0 -->

# Notifikasi Push — Rahasia Auth Saat Disimpan dan Runbook Rollout

Cakupan: modul `push_delivery` (ADR-0074), khususnya cara `auth_secret` RFC 8291
per-langganan disimpan (Issue #1089, tindak lanjut #1082). Modulnya dijelaskan di
`src/modules/push-delivery/README.id.md`.

## Apa yang berubah

`awcms_push_subscriptions.auth_secret` dulu plaintext, terbaca oleh `awcms_app`
dan `awcms_worker`. Sekarang berupa **ciphertext** di `auth_secret_ciphertext`
(`sql/314`): AES-256-GCM lewat helper ADR-0137 bersama, dengan cincin kunci
sendiri `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` (format `keyId:base64,...` dan aturan
rotasi sama dengan `TELEGRAM_CHAT_ENCRYPTION_KEYS`: kunci pertama menulis, semua
kunci membaca).

AAD-nya `(purpose, tenant_id, endpoint_hash)`. Ini meniru
`awcms_telegram_bindings.chat_ciphertext` (yang mengikat `id` baris) dengan satu
perbedaan sengaja: pendaftaran adalah upsert dengan kunci
`(tenant_id, endpoint_hash)`, sehingga `id` baris yang bertahan baru diketahui
setelah statement berjalan, sedangkan hash diketahui sebelumnya dan tidak pernah
berubah. Ciphertext yang disalin ke langganan atau tenant lain gagal autentikasi.

## Keputusan dan trade-off

| Keputusan                                                        | Pilihan                                                                                                                                                                                              | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cincin kunci tidak ada saat pendaftaran                          | **Gagal-tertutup**: `503 PUSH_MISCONFIGURED`, tidak ada yang disimpan; `GET` melaporkan `webPush.enabled=false`                                                                                      | Fallback plaintext akan terus menulis baris yang harus dikejar backfill sehingga rollout tidak pernah konvergen, dan diam-diam mempertahankan paparan yang justru dihapus perubahan ini. Perangkat yang gagal daftar bisa mencoba lagi setelah kunci diset; rahasia yang bocor tidak bisa ditarik. Baris `fcm` tidak membawa rahasia dan tidak butuh cincin.                                                                                                                                     |
| Dispatcher, baris punya ciphertext                               | Dekripsi; **tidak pernah** fallback ke plaintext                                                                                                                                                     | Fallback membiarkan plaintext basi menutupi ciphertext yang gagal (dirusak/dipindah).                                                                                                                                                                                                                                                                                                                                                                                                            |
| Dispatcher, baris tanpa ciphertext                               | Pakai plaintext lama                                                                                                                                                                                 | Hanya selama masa transisi; berakhir dengan backfill dan drop kolom.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Dispatcher, ciphertext tetapi tanpa cincin / kunci sudah dibuang | Kegagalan **dapat diulang** dengan pesan tetap                                                                                                                                                       | Konfigurasi yang bisa diperbaiki operator; pesan tidak hilang.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Dispatcher, ciphertext gagal autentikasi                         | Kegagalan **tidak dapat diulang**                                                                                                                                                                    | Data dirusak atau dipindah; mengulang tidak membantu.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Baris memegang kedua kolom                                       | Ditolak CHECK ("tepat satu")                                                                                                                                                                         | Ciphertext basi tidak boleh menutupi plaintext yang lebih baru.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Kolom plaintext                                                  | **Dipertahankan** pada perubahan ini (fase 1)                                                                                                                                                        | Migrasi tidak bisa mengenkripsi; menjatuhkannya sebelum backfill menghancurkan rahasia semua langganan yang ada.                                                                                                                                                                                                                                                                                                                                                                                 |
| Grant worker                                                     | `INSERT` dicabut; `UPDATE` dipersempit ke `status, disabled_reason, last_success_at, updated_at, auth_secret, auth_secret_ciphertext` (dipin di `WORKER_COLUMN_GRANTS`); `SELECT` dan `DELETE` tetap | Worker dulu bisa menulis ulang `endpoint`/`p256dh_key`, atau DELETE baris lalu INSERT ulang dengan endpoint penyerang dan ciphertext korban yang disalin (`id`/`endpoint_hash` sama). Worker **masih bisa** menghapus langganan (purge membutuhkannya; hanya menghentikan notifikasi) dan menulis dua kolom rahasia (backfill membutuhkannya; sampah di sana membuat pengiriman gagal, tidak bisa mengalihkannya). Worker **tidak bisa** INSERT, atau mengubah endpoint, hash-nya, maupun kunci. |
| Identitas baris saat pengiriman                                  | Dispatcher menolak (tidak dapat diulang, pesan tetap) baris yang `endpoint`-nya tidak ber-hash ke `endpoint_hash`                                                                                    | Pertahanan berlapis: hash adalah AAD ciphertext, dan baris palsu tidak boleh dikirim dengan rahasia yang sudah didekripsi. Diperiksa di luar transaksi DB, sehingga penolakan tidak dihitung sebagai kegagalan database oleh circuit breaker.                                                                                                                                                                                                                                                    |

## Runbook operator: urutan rollout

Urutan penting. Langkah 4 sebelum 1 atau 2 menghentikan pendaftaran (by design);
menjatuhkan kolom sebelum langkah 5 menghilangkan rahasia.

1. **Buat dan simpan cincin kunci** (secret store, bukan repo):
   `PUSH_AUTH_SECRET_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)`. Harus
   berbeda dari setiap cincin lain. Berikan ke **aplikasi**, `push:dispatch`, dan
   `push:auth-secret:backfill` (sudah ada di `ops/awcms-jobs.env-allowlist`).
   `bun run config:validate` memeriksanya saat `PUSH_PROVIDER=web_push`.
2. **Deploy rilis** (menjalankan `sql/314`: menambah kolom, melonggarkan CHECK,
   mempersempit UPDATE worker). Sejak itu: perangkat baru/terdaftar ulang berupa
   ciphertext; baris lama tetap terkirim dari plaintext.
3. **Jalankan backfill sekali** (sebagai `awcms_worker`):
   `bun run push:auth-secret:backfill`. Idempoten dan dapat dilanjutkan: jalankan
   ulang setelah crash atau exit non-nol (exit 2 = ada tenant yang menyentuh batas
   batch; exit 1 = tanpa cincin kunci). Konversi dilakukan dalam batch keyset
   terbatas, satu transaksi per batch.
4. **Verifikasi**: `bun run security:readiness` pada pemeriksaan "Push
   subscription auth secrets are encrypted at rest" harus PASS (melaporkan jumlah
   baris plaintext selama masih ada; severity warning karena di tengah rollout hal
   itu wajar).
5. **Nanti (PR terpisah, setelah setiap deployment lolos langkah 4)**: migrasi
   menjatuhkan `auth_secret`, mengetatkan CHECK agar mewajibkan ciphertext, dan
   entri `awcms_push_subscriptions.auth_secret` dihapus dari
   `WORKER_CREDENTIAL_COLUMN_EXCEPTIONS`.

### Rotasi

Tambahkan kunci baru di depan (`k2:<baru>,k1:<lama>`), deploy, pertahankan `k1`
sampai tidak ada baris yang membawanya. Membuang id kunci yang masih dipakai
membuat baris itu tidak terkirim (kegagalan dapat diulang, "cincin tidak punya
kunci"). Perangkat yang mendaftar ulang otomatis dienkripsi ulang dengan kunci aktif.

### Rollback

Mengembalikan **aplikasi** ke rilis tanpa perubahan ini saat baris sudah
ciphertext merusak pengiriman untuk baris tersebut (kode lama hanya membaca
`auth_secret`) dan membuat upsert pendaftaran lama gagal pada CHECK "tepat satu".
Pilih maju, atau kosongkan ciphertext hanya untuk baris yang bisa dikumpulkan
ulang. Migrasinya aditif; tidak ada migrasi turun.

### Batasan yang diketahui

- Rotasi belum punya mode re-key: baris dienkripsi ulang dengan kunci aktif hanya saat perangkat mendaftar ulang, dan tidak ada hitungan baris per kunci, jadi memastikan kunci yang dipensiunkan tak lagi dipakai dilakukan manual (L3, dicatat sebagai tindak lanjut).
- Pendaftaran adalah upsert pada `(tenant_id, endpoint_hash)`; pengguna lain di tenant yang sama yang tahu endpoint persis sebuah perangkat dapat menimpa pemilik baris itu. Ini sudah ada sebelum #1089 dan tidak diubah di sini (L4, dicatat sebagai tindak lanjut).

### Logging

Rahasia plaintext maupun ciphertext tidak muncul di baris log, baris audit, event,
atau respons API; pesan kegagalan dispatcher adalah string tetap.
