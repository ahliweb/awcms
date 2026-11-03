---
name: awcms-social-publishing
description: Modul social_publishing ADA di repo ini (Issue #1145, ADR-0157; migrasi `sql/330`-`sql/332`) sebagai fondasi berbasis akun di belakang `SocialPublishingPort` yang sudah ada: satu publikasi dengan snapshot konten immutable, SATU JOB PER `channel_account` TUJUAN, persetujuan, jadwal, antarmuka `SocialPublishAdapter` dengan peta kapabilitas per provider, dan dispatcher yang memanggil provider di luar transaksi apa pun. TIDAK ada adapter provider nyata yang dikirim (konektor adalah #1146-#1151, masing-masing dengan persetujuan provider sendiri). Gunakan saat menambah atau mengubah konektor provider, status publikasi atau job, jalur enqueue atau dispatch, jalur kredensial, endpoint di bawah `/api/v1/social-publishing`, atau saat memasang composition root. Menyatakan invarian yang tidak boleh dilanggar konektor (job tidak memegang token, konten yang tak didukung ditolak bukan diturunkan, `published` bersifat final, tidak ada yang dialihkan). Epik awcms-mini (#643-#647) adalah spesifikasi ARSIP, bukan peta kode ini.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:13526d19274d367d27796d40554e89133284f33322f8b3c61b132ca45f099981 -->

# AWCMS — Social Publishing (publikasi dan job berbasis akun)

> **STATUS — fondasi terimplementasi, tanpa konektor.** `src/modules/social-publishing/`
> ada, berstatus `experimental` dan MATI secara default (`SOCIAL_PUBLISHING_ENABLED`).
> Modul ini dikirim **tanpa adapter provider**: sampai sebuah konektor (#1146 sampai
> #1151) mendaftarkannya, mengaktifkan modul tidak menerbitkan apa pun. Layar admin
> belum dibangun (sembilan permission ada di ledger `NOT_YET_SCREENED`). Baca
> [`ADR-0157`](../../../docs/adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.id.md),
> [`docs/awcms/social-publishing.id.md`](../../../docs/awcms/social-publishing.id.md) dan
> [`src/modules/social-publishing/README.id.md`](../../../src/modules/social-publishing/README.id.md)
> lebih dulu; skill ini adalah daftar singkat apa yang TIDAK boleh dilanggar.

## Bentuknya

- **Publikasi** (`awcms_social_publications`): satu publikasi logis dengan snapshot
  konten IMMUTABLE (judul, caption, tautan, snapshot media dari `media_library`,
  hash konten), `state` (`pending_approval`, `ready`, `cancelled`, `refused`).
  Status agregat DITURUNKAN dari job, tidak pernah disimpan
  (`domain/social-publish-retry.ts#deriveAggregateStatus`).
- **Job** (`awcms_social_publish_jobs`): satu per (publikasi, `channel_account`).
  Ia menamai akun dan TIDAK memegang token maupun referensi rahasia.
- **Aturan** (`awcms_social_publish_rules`): akun mana yang dituju sebuah event
  artikel. Penunjuk, bukan hibah.
- **Ledger** (`awcms_social_publish_attempts`): hasil, kode tetap, frasa tetap.
  Tidak pernah caption, badan respons provider, atau kredensial.

## Invarian (masing-masing ditegakkan tes; jangan lemahkan satu pun)

1. **Job tidak pernah membawa kredensial.** Dispatcher me-resolve-nya untuk akun
   itu saat dispatch lewat `ChannelPublisherCredentialPort`, di memori, dalam
   transaksi yang ditutup SEBELUM panggilan provider. Adapter kredensial
   (`channel-sender-credential-adapter.ts`) hanya diimpor oleh composition root
   dispatch (`tests/whatsapp-sender-routing.test.ts` mengunci daftarnya).
2. **Gagal tertutup per akun.** `ChannelPublisherPort.resolvePublisher` ditanyakan
   saat enqueue DAN saat dispatch: dicabut atau dinonaktifkan menggagalkan job,
   terdegradasi atau grant kedaluwarsa MENAHAN-nya (tanpa memakai percobaan,
   terbatas), dan tidak ada yang pernah dialihkan ke akun atau provider lain
   (ADR-0148 I5).
3. **Peta kapabilitas adalah plafon, bukan hibah.** `SocialPublishCapabilities`
   milik adapter hanya bisa MENOLAK konten (`VARIANT_UNSUPPORTED`,
   `MEDIA_TYPE_UNSUPPORTED`, `MEDIA_TOO_LARGE`, `CONTENT_TOO_LONG`). Gambar tidak
   pernah diposting sebagai teks; caption tidak pernah dipotong agar muat.
4. **`published` bersifat final** (trigger di `sql/330`). Kegagalan saudara,
   retry job lain, pass yang diulang, atau pembatalan tidak dapat mengirim atau
   menulis ulangnya.
5. **Tanpa jaringan di dalam transaksi.** Klaim, kirim, dan finalisasi adalah tiga
   fase; adapter menerima `request.http`, yang ADALAH `ssrfSafeFetch`, dan tidak
   menerima `fetch` mentah.
6. **Idempoten lewat kunci.** Satu publikasi per (artikel, trigger), satu job per
   (publikasi, akun), ditambah `buildSocialPublishIdempotencyKey`. Event artikel
   yang berulang tidak membuat apa pun untuk akun yang sudah punya job.
7. **Port tidak pernah menggagalkan artikel.** `onArticlePublished` berjalan dalam
   savepoint dan mengembalikan `{ jobsCreated: 0 }` pada kegagalan apa pun.

## Menambah konektor provider (#1146 sampai #1151)

1. Admisi di issue-nya sendiri: persetujuan aplikasi provider atau bukti audit
   adalah langkah BISNIS, dan sel `publish` pada matriks provider
   (`channel-accounts/domain/provider-matrix.ts`) harus sudah mengizinkannya.
2. Implementasikan `SocialPublishAdapter` (`domain/social-publish-adapter.ts`):
   kunci `provider` seperti di matriks, peta `capabilities` yang jujur, dan
   kosakata `errorCodes` yang tertutup (kode di luarnya tidak pernah ditulis ke baris),
   dan `publish()` yang mengembalikan HASIL (`published`, `retryable`, `rate_limited`,
   `needs_reauth`, `rejected`) alih-alih melempar untuk jawaban provider biasa.
   Pakai `request.http` saja; teruskan `request.idempotencyKey` ke provider bila
   ia punya; jangan pernah mencatat, mengembalikan, atau menyimpan
   `request.credential`.
3. Daftarkan dari `scripts/social-publishing-dispatch.ts#registerSocialAdapters`
   DAN dari proses yang melayani API, agar enqueue melihat registri yang sama.
4. Bila purpose token provider bukan `provider_access_token`, `api_token`, atau
   `device_key`, atau kunci providernya tidak ada di `sql/332`, worker TIDAK BISA
   melihat rahasianya: itu butuh migrasi sendiri yang ditinjau (konektor Telegram
   membutuhkannya).
5. Uji terhadap `tests/support/fake-social-publish-adapter.ts` untuk kontraknya dan
   tambahkan tes provider itu sendiri; fake tidak pernah diimpor dari `src/`.

## Berkas

| Perhatian                  | Di mana                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Descriptor, permission     | `src/modules/social-publishing/module.ts`, `sql/331`                                                            |
| Skema, trigger, RLS        | `sql/330`; visibilitas rahasia worker `sql/332`                                                                 |
| Aturan konten dan dukungan | `src/modules/social-publishing/domain/social-publish-content.ts`                                                |
| Enqueue                    | `src/modules/social-publishing/application/publication-enqueue.ts`                                              |
| Dispatch                   | `src/modules/social-publishing/application/social-publish-dispatch.ts`, `scripts/social-publishing-dispatch.ts` |
| Jalur artikel              | `src/modules/social-publishing/application/social-publishing-port-adapter.ts`                                   |
| Rute                       | `src/pages/api/v1/social-publishing/`, `openapi/modules/social-publishing.openapi.yaml`                         |
| Event                      | `asyncapi/awcms-domain-events.asyncapi.yaml` (empat `awcms.social_publishing.*`)                                |
| Tes                        | `tests/social-publishing*.test.ts`, `tests/integration/social-publishing.integration.test.ts`                   |

## Catatan arsip

Epik `social_publishing` yang lebih awal (#643 sampai #647) ada di `awcms-mini`,
sebuah ARSIP: tabel akunnya sendiri dan string `token_reference`
(`awcms-mini:src/modules/social-publishing/application/social-account-directory.ts`),
adapter Meta, LinkedIn, dan Telegram-nya
(`awcms-mini:src/modules/social-publishing/infrastructure/`) dan template caption-nya
TIDAK dibawa (ADR-0055: tidak ada yang di-port dari sana). Bacalah sebagai
spesifikasi apa yang harus ditangani sebuah konektor, jangan sebagai kode untuk
disalin: di sini akun adalah baris `channel_accounts` dan kredensial adalah rahasia
`channel_accounts`.
