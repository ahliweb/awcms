🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:7e5ece5ccb8c5139bc6226bbec43bd7c98f1b3d937aaad4523d9d859d6dd3e9c -->

# `social_publishing`

Penerbitan sosial berbasis akun (Issue #1145, [ADR-0157](../../../docs/adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.id.md), [ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) kapabilitas C3; desain di [`docs/awcms/social-publishing.id.md`](../../../docs/awcms/social-publishing.id.md)) di belakang `SocialPublishingPort` yang sudah dipanggil `blog_content` saat artikel diterbitkan.

Status: `experimental`, **mati secara default** (`SOCIAL_PUBLISHING_ENABLED`), tanpa entri navigasi sampai layar admin hadir. **Modul ini dikirim tanpa adapter provider**: konektornya adalah #1146 sampai #1151, masing-masing dengan persetujuan provider sendiri. Sampai satu terdaftar, mengaktifkan modul tidak menerbitkan apa pun (provider tanpa adapter ditolak saat enqueue dan menggagalkan job saat dispatch).

## Yang dimiliki

| Tabel                              | Menyimpan                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_social_publishing_settings` | Dua saklar tenant: `auto_publish_enabled` (default `false`) dan `approval_required` (default `true`)                                                                                                                       |
| `awcms_social_publish_rules`       | `channel_account` mana yang dituju sebuah event artikel (unik per trigger dan akun; dinonaktifkan, tidak pernah dihapus)                                                                                                   |
| `awcms_social_publications`        | Satu publikasi dengan snapshot konten IMMUTABLE (judul, caption, tautan, snapshot media, hash konten), siklus persetujuan dan pembatalan, `not_before`                                                                     |
| `awcms_social_publish_jobs`        | Satu job per (publikasi, akun): snapshot provider dan varian, status (`needs_reconciliation` bila hasilnya tidak diketahui), percobaan, penahanan, id dan URL post dari provider. **Tanpa token, tanpa referensi rahasia** |
| `awcms_social_publish_attempts`    | Ledger append-only: sebuah hasil, kode tetap, frasa tetap                                                                                                                                                                  |

Ia membaca model akun hanya lewat port `channel_account` (`ChannelPublisherPort`, `ChannelPublisherCredentialPort`, versi kapabilitas 1.1.0) dan memverifikasi media lewat `MediaLibraryPort`. Ia tidak memiliki akun, kredensial, media, atau isi artikel.

## Alur

1. **Enqueue** (`application/publication-enqueue.ts`), dalam transaksi pemanggil, hanya tulis biasa. Per akun, berurutan: bolehkah akun menerbitkan sekarang (dicabut, dinonaktifkan, terdegradasi, tanpa kapabilitas `publish` yang diberikan beserta bukti: ditolak), apakah provider punya adapter, dapatkah peta kapabilitasnya membawa konten itu. Penolakan adalah kode yang dikembalikan, tidak pernah penurunan, dan bila setiap akun ditolak tidak ada yang tercatat.
2. **Setujui / jadwalkan** (rute). Tidak ada yang dapat diklaim sebelum disetujui; pembuat tidak dapat menyetujui publikasi manual miliknya; `not_before` menunda.
3. **Dispatch** (`bun run social-publishing:dispatch`): klaim dengan lease dan advisory lock per akun (bagian adil dan batas harian), resolve ulang akun, minta kredensial ke credential port dalam transaksi yang ditutup sebelum panggilan (irisan ini menyusun port yang menolak setiap permintaan), panggil adapter dengan klien `ssrfSafeFetch` dan breaker per akun, finalisasi dengan compare-and-set.

## Invarian dan di mana masing-masing ditegakkan

| Invarian                                                           | Ditegakkan oleh                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tenant lebih dulu                                                  | RLS `ENABLE` + `FORCE` dengan `USING` dan `WITH CHECK` pada kelima tabel, foreign key komposit `(tenant_id, id)`, RBAC/ABAC default-deny di setiap rute            |
| Job tidak memegang kredensial                                      | Tidak ada kolom yang bisa (`tests/integration/social-publishing.integration.test.ts` menegaskannya pada `information_schema`); dispatcher me-resolve per panggilan |
| Konten adalah snapshot                                             | Trigger `awcms_social_publications_snapshot_guard`; job tidak pernah membaca ulang artikel                                                                         |
| `published` bersifat final; kegagalan sebagian tidak diputar ulang | Trigger `awcms_social_publish_jobs_guard`; retry dan batal hanya bekerja pada job yang belum terkirim                                                              |
| Idempoten per (artikel, trigger, akun)                             | Indeks unik dan `buildSocialPublishIdempotencyKey`                                                                                                                 |
| Konten yang tak didukung ditolak, bukan diturunkan                 | `checkAdapterSupport`; peta adapter adalah plafon, bukan hibah                                                                                                     |
| Tanpa jaringan dalam transaksi; aman SSRF                          | Dispatcher tiga fase; adapter menerima `request.http` (`ssrfSafeFetch`) dan tanpa `fetch` mentah                                                                   |
| Akun yang dicabut menghentikan job-nya; tidak ada yang dialihkan   | `resolvePublisher` saat enqueue dan saat klaim; final vs tahan di `classifyAccountReason`                                                                          |
| Transaksi terbit artikel tidak pernah gagal karena modul ini       | `onArticlePublished` berjalan dalam savepoint dan menjawab `{ jobsCreated: 0 }`                                                                                    |

## API (`/api/v1/social-publishing`, OpenAPI `openapi/modules/social-publishing.openapi.yaml`)

| Rute                                          | Permission                                    |
| --------------------------------------------- | --------------------------------------------- |
| `GET publications`, `GET publications/{id}`   | `publications.read`                           |
| `POST publications`                           | `publications.publish` (+ pemakaian per akun) |
| `POST publications/{id}/approve`              | `publications.approve`                        |
| `POST publications/{id}/cancel`               | `publications.cancel`                         |
| `POST publications/{id}/schedule`             | `publications.schedule`                       |
| `POST jobs/{id}/retry`                        | `jobs.retry`                                  |
| `GET rules`, `POST rules`, `PATCH rules/{id}` | `rules.read` / `rules.configure`              |
| `GET settings`, `PATCH settings`              | `rules.read` / `settings.configure`           |
| `GET providers`                               | `publications.read`                           |

Setiap mutasi memerlukan `Idempotency-Key` dan menolak kredensial mesin; setiap rute menjawab `503 SOCIAL_PUBLISHING_DISABLED` kecuali deployment mengaktifkan modul. Memakai sebuah akun juga memerlukan akses per akun `channel_accounts` (aturan penugasan dan business scope).

## Composition root

`POST /api/v1/blog/posts/{id}/publish` dan `scripts/blog-scheduled-publish.ts` memilih port lewat `resolveSocialPublishingPort`: adapter nyata hanya bila `SOCIAL_PUBLISHING_ENABLED` menyala, selain itu no-op milik `blog_content`, sehingga deployment yang tidak mengonfigurasi apa pun tidak berubah. Hanya `scripts/social-publishing-dispatch.ts` yang menyusun adapter kredensial dan memegang `CHANNEL_SECRETS_ENCRYPTION_KEYS`.

## Batasan yang diketahui

- Tanpa adapter provider, tanpa layar admin, tanpa template caption (lihat keterbatasan tersisa di `docs/awcms/social-publishing.id.md`).
- **Retensi (admisi Issue #1145, `sql/357`).** `bun run social-publishing:retention:purge` (harian, sebagai `awcms_worker`) menghapus satu publikasi utuh (percobaan, job, publikasi) hanya bila setiap job-nya terminal dan ia lebih tua dari jendela: **default 730 hari, batas 365 sampai 3650, default usulan yang boleh diubah pemilik** (`domain/social-publishing-lifecycle.ts`). Job yang menunggu atau `needs_reconciliation` dan publikasi `pending_approval` tidak pernah dihapus; legal hold pada salah satu dari tiga descriptor menghentikannya. Jendela diukur dari `terminal_at`, stempel yang hanya ditulis trigger database (bukan `updated_at`, yang dapat ditulis app dan worker). Kebijakan baris restriktif menolak DELETE worker atas apa pun yang lebih muda dari 365 hari atau belum terminal, tetapi lantai itu **per baris**: keutuhan satu publikasi dan legal hold ditegakkan oleh purge (aplikasi), bukan oleh database.
- Jendela crash antara "provider menerima post" dan "job difinalisasi" tertutup otomatis hanya sejauh provider menghormati kunci idempotensi yang diteruskan. Job `publishing` yang lease-nya habis menjadi `needs_reconciliation` (`LEASE_EXPIRED_UNKNOWN`) untuk provider lain dan tidak pernah dikirim ulang dispatcher.
- **Ia belum dapat menerbitkan, disengaja (temuan audit H1).** Role `awcms_worker` tidak dapat membaca token sosial (`sql/328` tidak berubah) dan job dispatch tidak memegang key ring: ia disusun dengan `noPublishCredentialPort`, yang menolak setiap permintaan. **Role DB terpisah** sudah ada sejak `sql/358`: `awcms_social_dispatch`, baca khusus-kolom atas empat tabel channel, tanpa privilege tabel, dan kebijakan restriktif yang hanya meloloskan access token koneksi sosial (`active`/`expired`) yang dipakai langsung oleh akun `connected`/`degraded` ber-kapabilitas `publish` `granted` (M2); akun yang meminjam kredensial induk ditolak sebagai `CREDENTIAL_UNAVAILABLE` (L10). Kebijakan rahasia dikunci per KONEKSI, jadi `resolvePublishCredential` juga mensyaratkan kapabilitas `publish` `granted` milik akun YANG DIMINTA sebelum rahasia apa pun dibaca (`CAPABILITY_DENIED`), dan dua kebijakan lain menyembunyikan setiap akun dan koneksi di luar enam provider sosial. `security:readiness` mengunci ketiganya pada ekspresi persisnya dan menjalankan probe ber-rollback yang harus melihat tepat satu rahasia. Ia dikirim `NOLOGIN` dan belum ada yang terhubung sebagai role itu: konektor pertama (#1146) mengaktifkannya dengan connection string dan key ring ber-scope job, setelah tinjauan manusia atas jalur kredensial. `whatsapp:dispatch` tidak terpengaruh.
- **Keputusan terbuka (dicatat, fail-closed):** perubahan ini sengaja TIDAK menambah variabel connection string, grant key ring, atau komposisi `resolvePublishCredential` ke `social-publishing:dispatch`. Tanpa adapter tidak ada yang dikirim, dan memberi key ring sebelum tinjauan jalur kredensial akan menciptakan ulang paparan yang ditarik H1. Perubahan konektor melakukan ketiganya bersamaan.
- Hasil yang tidak diketahui (timeout, lemparan setelah permintaan terkirim) dicoba ulang otomatis hanya untuk adapter yang mendeklarasikan `supportsIdempotencyKey`; selain itu job berstatus `needs_reconciliation` dan menunggu operator (`POST jobs/{id}/retry` dengan `confirmPossiblyPublished`, atau batal). Klien HTTP adapter tidak mengikuti pengalihan dan dibatalkan oleh signal panggilan.
- **L6 ditutup:** setiap adapter mendeklarasikan `externalPostIdPattern` ter-anchor dan `postUrlHosts`-nya (registry menolak yang tidak); id post yang tidak cocok, atau tidak cocok dengan alfabet identifier `sql/359`, membuat hasilnya UNKNOWN (`INVALID_POST_ID`) dan tidak pernah disimpan; `|` tingkat atas tidak dihitung ter-anchor; URL pada host yang tidak dideklarasikan dibuang, dan URL yang disimpan kehilangan query dan fragment-nya.
- Residual audit dicatat, tidak diperbaiki di sini (teks lengkap di ADR-0157 bagian 6): **L4** bacaan tidak dibatasi per akun atau business scope (pemegang `publications.read` melihat caption yang belum terbit dan `accountId` brand lain); **L8** hak media, penarikan artikel, dan takedown media tidak diperiksa ulang saat dispatch (snapshot dibekukan saat enqueue); **L9** `prepare` berjalan sebelum `authorize`, pola rute seluruh repositori, sehingga pemanggil tanpa izin dapat membedakan 400 atau 422 dari 403; **M-1/L-7** konektor mendeklarasikan `supportsIdempotencyKey` dengan jujur dan menjawab `unknown`, bukan `retryable`, setelah permintaan apa pun yang mungkin sudah diproses.
