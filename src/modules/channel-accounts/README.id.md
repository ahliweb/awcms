🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:2bb0ae6f3f83b21016f453aeb94a6f7dc8c67452178ebcbbb699a96fc1153333 -->

# `channel_accounts`

**Control plane akun dan kredensial** dari fondasi omnichannel (Issue #1140, [ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) kapabilitas C1; paket desain [`docs/awcms/omnichannel-foundation.md`](../../../docs/awcms/omnichannel-foundation.id.md); enkripsi field [ADR-0137](../../../docs/adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md)).

Modul ini menyimpan **akun eksternal yang terhubung** milik tenant (nomor WABA WhatsApp atau perangkat StarSender, Page Facebook, profil Instagram atau Threads, kanal YouTube, bot Telegram, login ESP Mailketing beserta identitas pengirimnya), **koneksi penyedia** di baliknya (grant OAuth 2.0, token API, token bot, kunci perangkat), **bukti kapabilitas per akun**, **referensi secret**, metadata langganan webhook, kesehatan, dan siapa yang boleh mengoperasikan tiap akun.

**Modul ini tidak mengirim apa pun dan tidak memanggil penyedia.** Tidak ada antrean, dispatcher, panggilan HTTP penyedia, maupun layar admin di sini. Adapter penyedia, pertukaran token OAuth, perutean pengirim di `whatsapp_delivery` (#1141), publikasi (#1145), dan layar pengelola koneksi (#1154) adalah issue berikutnya yang mengikuti model akun ini. Tautan sosial situs web bukan akun terhubung.

Status: `experimental` dan **mati secara default** (`CHANNEL_ACCOUNTS_ENABLED`), tanpa entri navigasi sampai layarnya ada (entri navigasi tanpa halaman adalah 404 permanen).

## Invarian (ADR-0148 bagian 2) dan di mana masing-masing ditegakkan

| Invarian                            | Ditegakkan oleh                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 tenant lebih dulu                | RLS `ENABLE` + `FORCE` dengan `USING` dan `WITH CHECK` pada delapan tabel, foreign key komposit `(tenant_id, id)`, RBAC/ABAC default-deny pada tiap rute. Brand adalah **business scope** `(business_scope_type, business_scope_id)`; tidak ada atribut ABAC baru. `404` seragam untuk akun yang tidak ada, milik tenant lain, atau tidak di-assign (tanpa oracle IDOR) |
| I1 satu akun eksternal, satu tenant | Unique index parsial `(provider, external_id) WHERE deleted_at IS NULL`, **lintas tenant**. Duplikat adalah `409 ACCOUNT_ALREADY_REGISTERED` baik milik sendiri maupun milik tenant lain. Akun yang dihapus melepas klaimnya                                                                                                                                            |
| I2 kapabilitas fail-closed per akun | `evaluateCapability` (`domain/provider-matrix.ts`): sel matriks, baris `granted` tersimpan, bukti, versi matriks saat ini, akun `connected`, koneksi `active`. Baris yang tidak ada ditolak. Error yang dilempar wajib diperlakukan sebagai penolakan                                                                                                                   |
| I3 secret lewat referensi           | `awcms_channel_secrets` (AES-256-GCM lewat helper bersama, AAD = purpose + tenant + id secret). `CHECK` hanya menerima envelope `v2:`. Tidak ada view, respons, baris audit, log, atau catatan idempotensi yang memuat nilai atau referensi                                                                                                                             |
| I7 data member LinkedIn dilarang    | Sel matriks `barred` (tidak pernah dapat diberikan, apa pun buktinya); barisnya tidak dapat didaftarkan                                                                                                                                                                                                                                                                 |
| I9 inbound terverifikasi            | `awcms_channel_webhook_subscriptions`: `CHECK (verification_mode <> 'unauthenticated' OR accepts_content_events = false)`. Token callback disimpan sebagai hash. Belum ada rute yang membaca tabel ini                                                                                                                                                                  |
| I13 aditif, hanya maju              | Hanya tabel baru di `sql/318`-`320`; tidak ada perubahan perilaku untuk deployment yang tidak mengonfigurasi apa pun                                                                                                                                                                                                                                                    |

## Matriks penyedia (cermin kode)

`domain/provider-matrix.ts` adalah cermin kode dari bagian 3 paket kesiapan (v1). `tests/channel-accounts-provider-matrix.test.ts` mem-parse tabel dokumentasi dan gagal bila ada sel yang berbeda. Sel adalah `candidate`, `restricted` (hanya dapat dipakai dengan bukti `contract_reference` atau `written_authorization`), `not_offered`, `unverified`, `not_applicable`, atau `barred`. `GET /api/v1/channel-accounts/providers` menyajikannya.

## API (`/api/v1/channel-accounts`, OpenAPI `openapi/modules/channel-accounts.openapi.yaml`)

| Rute                                                              | Izin                                       | Catatan                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `GET providers`                                                   | `accounts.read`                            | Matriks                                                                                                                 |
| `GET/POST accounts`, `GET/PATCH/DELETE accounts/{id}`             | `accounts.read` / `create` / `revoke`      | Daftar keyset; PATCH mengganti nama atau `disabled` / aktifkan ulang (`pending`); DELETE adalah soft delete final       |
| `PUT accounts/{id}/credential`                                    | `credentials.manage`                       | **Hanya tulis.** Wajib terdaftar MFA, step-up kondisional, `Idempotency-Key`, diaudit `warning`                         |
| `POST accounts/{id}/disconnect`                                   | `accounts.revoke`                          | `revoked`, kredensial milik akun dihapus permanen, webhook dicabut. `warning`                                           |
| `GET accounts/{id}/health`                                        | `accounts.read`                            | Dilaporkan konektor, tidak pernah diklaim oleh manusia                                                                  |
| `GET accounts/{id}/capabilities`, `PUT .../{capability}`          | `accounts.read` / `capabilities.configure` | Sembilan kapabilitas dengan sel matriks dan putusan efektif. Ditolak saat penulisan bila matriks tak pernah mengizinkan |
| `GET/POST accounts/{id}/assignments`, `DELETE .../{assignmentId}` | `accounts.read` / `assignments.assign`     | Owner / operator / viewer; tambahan atas pemeriksaan izin                                                               |
| `GET connections`, `POST connections/{id}/revoke`                 | `accounts.read` / `accounts.revoke`        | Revoke membersihkan dan menghapus semua kredensial dan mencabut akun terikat. Final (trigger)                           |
| `POST connections/oauth/start`, `GET .../callback`                | `accounts.create`                          | Lihat di bawah                                                                                                          |

`AccessAction` adalah kosakata tertutup yang dipakai bersama semua modul, sehingga nama kerja paket dipetakan ke sana: connect ke `create`, disconnect ke `revoke`, `capabilities.grant` ke `capabilities.configure`, `assignments.manage` ke `assignments.assign`. Izin `senders.use` dan `whatsapp_delivery.*` dari paket **tidak** di-seed di sini: belum ada yang menegakkannya sampai #1141.

Setiap mutasi kecuali start dan callback OAuth mewajibkan `Idempotency-Key` (hash permintaan HMAC berkunci; respons disimpan dalam bentuk tersamar). Setiap rute menolak machine credential (`403 INTERACTIVE_SESSION_REQUIRED`) dan menjawab `503 CHANNEL_ACCOUNTS_DISABLED` kecuali deployment mengaktifkan modul.

## Akses per akun

Tiga lapis, semuanya default-deny: izin tingkat tenant; gerbang **assignment** (akun yang punya assignee hanya terlihat dan dapat dioperasikan oleh mereka pada jenis yang dibutuhkan, ditambah pemegang `assignments.assign`); dan **ABAC business scope** (akun yang terikat pada scope mensyaratkan pemanggil memegang scope itu, dievaluasi ulang lewat chokepoint yang sama sehingga kebijakan deny dan decision log tetap berlaku).

## OAuth

`POST oauth/start` membuat `state` sekali pakai (256 bit acak, hanya disimpan sebagai SHA-256, terikat ke tenant **dan** orang, 10 menit) dan, bila adapter menawarkan PKCE, tantangan S256 dengan verifier yang disimpan sebagai ciphertext. Redirect URI adalah callback tetap deployment dan **tidak pernah menjadi input**. Dibutuhkan `ChannelOAuthAdapter` terdaftar (`application/oauth-adapter-registry.ts`, satu fungsi murni yang menyusun URL otorisasi); issue ini tidak mendaftarkan satu pun, sehingga jawabannya `422 PROVIDER_ADAPTER_UNAVAILABLE`.

`GET oauth/callback` diotorisasi seperti panggilan lain (membawa sesi). Ia memverifikasi `state` (ada, belum kedaluwarsa, belum dipakai, tenant ini, orang ini, redirect URI ini; **setiap** kegagalan adalah `400 STATE_INVALID`), mengonsumsinya dengan compare-and-swap, dan meninggalkan **hand-off tahan lama**: koneksi `pending` yang menyimpan kode otorisasi sebagai ciphertext. Kode tidak ditukar di sini karena itu I/O penyedia yang tidak boleh berjalan di dalam transaksi permintaan (ADR-0148 I10). Job konektor menyelesaikan grant dengan `activateConnectionGrant` (atau `failConnectionGrant`).

Refresh dijaga **lease** (`acquireRefreshLease`, compare-and-set pada baris koneksi: dari N pesaing satu menang), `completeRefresh` hanya menerima versi lease pemegangnya, dan `failRefresh` melakukan backoff eksponensial terbatas atau, pada kegagalan permanen, mengakhiri grant dan men-degrade akunnya. Grant yang dicabut bersifat final (ditegakkan trigger), kredensialnya dibersihkan dan dihapus, dan akunnya dicabut.

## Secret

`SecretStorePort` (`application/secret-store.ts`) punya satu adapter, key ring aplikasi: `CHANNEL_SECRETS_ENCRYPTION_KEYS` (pasangan `keyId:base64`, kunci pertama menulis, semua membaca, masing-masing 32 byte, tanpa default, tanpa fallback plaintext, di luar database dan backup-nya). Adapter KMS atau vault dapat menggantikannya tanpa mengubah pemanggil. Satu-satunya metode yang mengembalikan plaintext, `resolve`, untuk konektor dan dispatcher pada issue berikutnya; `tests/channel-accounts-secret-handling.test.ts` memastikan tidak ada rute yang mengimpornya. Tiap resolusi dihitung per tenant dan purpose (`snapshotSecretDecryptCounts`) untuk peringatan dispatcher. Restore tanpa ring gagal tertutup.

**Rotasi:** tambahkan kunci di depan, deploy, jalankan `bun run channel-accounts:secrets:rekey` (idempoten, dapat dilanjutkan, berkelompok, aman terhadap balapan; berjalan sebagai `awcms_app`), pastikan tidak ada yang tersisa di bawah key id lama, baru hapus kunci itu. Job keluar dengan 1 tanpa ring, 2 bila ada tenant yang belum selesai, 3 bila ada baris yang tidak dapat didekripsi.

## Retensi dan jawaban subjek data

Tiap tabel menjawab kedua pertanyaan pada perubahan yang sama. Deskriptor `subjectData` ada di `module.ts` (tabel hanya-stempel adalah `severed_with_subject_row`; assignment dapat diekspor dan dihapus permanen saat penghapusan; tabel kesehatan adalah `NO_SUBJECT_DATA` beralasan). Retensi adalah entri `BOUNDED_BY_DESIGN` beralasan per tabel: tiap tabel dibatasi oleh penulisan manual, unique key, atau sweep terbatas `sweepExpiredOAuthStates` yang berjalan di jalur tulis start OAuth (menghapus state kedaluwarsa tanpa rujukan beserta ciphertext verifier-nya dan menggagalkan hand-off yang ditinggalkan). Deskriptor lifecycle terdelegasi ditolak karena memerlukan grant baca `awcms_worker` pada tabel control plane. Tidak ada role worker yang memegang hak apa pun atas tabel ini.

## Batasan yang diketahui

- Belum ada adapter penyedia, pertukaran token, panggilan refresh, pemeriksaan kesehatan, atau penerima webhook; `recordAccountHealth` dan `activateConnectionGrant` adalah titik masuk yang dipanggil issue-issue itu.
- Belum ada domain event (`channel.account.*`) yang diterbitkan: belum ada konsumen, dan garis besar kontrak menyerahkannya kepada issue yang membutuhkannya.
- Belum ada `ChannelAccountPort` yang diekspor; `resolveCapability` adalah fungsi yang akan dibungkusnya (konsumen pertama: #1141).
- Key ring harus berisi kunci yang berbeda dari ring modul lain (`config:validate` memeriksa ring Telegram dan push).
