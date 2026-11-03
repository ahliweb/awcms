🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:5353ba176315bdd446ea94943389a2324a6d0e3c1b15430f5237afa24477bc19 -->

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
3. **Dispatch** (`bun run social-publishing:dispatch`): klaim dengan lease dan advisory lock per akun (bagian adil dan batas harian), resolve ulang akun, dekripsi kredensial dalam transaksi yang ditutup sebelum panggilan, panggil adapter dengan klien `ssrfSafeFetch` dan breaker per akun, finalisasi dengan compare-and-set.

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

- Tanpa adapter provider, tanpa layar admin, tanpa template caption, tanpa sapuan retensi (lihat keterbatasan tersisa di `docs/awcms/social-publishing.id.md`).
- Jendela crash antara "provider menerima post" dan "job difinalisasi" hanya tertutup sejauh provider menghormati kunci idempotensi yang diteruskan.
- **Ia belum dapat menerbitkan, disengaja (temuan audit H1).** Role `awcms_worker` tidak dapat membaca token sosial (`sql/328` tidak berubah) dan job dispatch tidak memegang key ring: ia disusun dengan `noPublishCredentialPort`, yang menolak setiap permintaan. Jalur kredensial hadir bersama konektor pertama (#1146) di bawah **role DB terpisah** (misalnya `awcms_social_dispatch`), yang juga harus (M2) mengikuti status akun (`connected` atau `degraded`) dan state grant (`active` atau `expired`) dalam kebijakan barisnya, dan (L10) sepakat dengan adapter kredensial tentang rahasia yang di-resolve akun yang meminjam kredensial induknya. `whatsapp:dispatch` tidak terpengaruh.
- Hasil yang tidak diketahui (timeout, lemparan setelah permintaan terkirim) dicoba ulang otomatis hanya untuk adapter yang mendeklarasikan `supportsIdempotencyKey`; selain itu job berstatus `needs_reconciliation` dan menunggu operator (`POST jobs/{id}/retry` dengan `confirmPossiblyPublished`, atau batal). Klien HTTP adapter tidak mengikuti pengalihan dan dibatalkan oleh signal panggilan.
- Residual audit dicatat, tidak diperbaiki di sini: M2 dan L10 di atas; L4, L6, L8, dan L9 audit independen adalah residual terdokumentasi (rincian di PR #1240).
