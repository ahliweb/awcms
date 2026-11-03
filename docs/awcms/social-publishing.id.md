🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](social-publishing.md)

<!-- i18n-source-hash: sha256:edcf36c081ebd9bb000741712bf4ff19860b884c2ce62844d3852142f4911ab6 -->

# Penerbitan sosial (`social_publishing`)

> **Status:** fondasi terimplementasi, **tanpa konektor provider**. Issue [#1145](https://github.com/ahliweb/awcms/issues/1145), [ADR-0157](../adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.id.md) (**Diusulkan**), kapabilitas C3 dari [ADR-0148](../adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) dan [`omnichannel-foundation.id.md`](omnichannel-foundation.id.md) bagian 2.3. Migrasi `sql/330` sampai `sql/331`. Modul berstatus `experimental` dan mati secara default.

## 1. Apa ini

Modul yang mengubah "sebuah artikel diterbitkan" (atau "operator ingin ini disampaikan") menjadi **satu publikasi** dengan snapshot konten immutable dan **satu job per `channel_account` tujuan**, lalu mengantarkan tiap job lewat adapter provider, di luar transaksi apa pun, dicoba ulang dengan aman dan tidak pernah diputar ulang.

Ia adalah tuan rumah plug-in. Ia mengirim antarmuka, registri, antrean, dispatcher, aturan persetujuan dan jadwal, serta API. Ia **tidak mengirim adapter provider** dan tidak melakukan panggilan provider: konektor Facebook, Instagram, Threads, TikTok, YouTube, dan LinkedIn adalah issue terpisah (#1146 sampai #1151), yang masing-masing juga membutuhkan persetujuan aplikasi provider atau bukti audit (langkah bisnis, bukan langkah kode). Sampai satu terdaftar, mengaktifkan modul tidak menerbitkan apa pun.

## 2. Data

| Tabel                              | Fakta kunci                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_social_publishing_settings` | Satu baris per tenant. `auto_publish_enabled` default `false`; `approval_required` default `true`                                                                                                                                                                                                                    |
| `awcms_social_publish_rules`       | `(tenant, trigger, akun)` unik. `enabled`. Penunjuk ke akun, bukan hibah. Paling banyak 200 per tenant                                                                                                                                                                                                               |
| `awcms_social_publications`        | Intent. `source_kind` (`article`, `manual`), `source_id`, trigger, `state`, snapshot immutable (`title`, `caption`, `link_url`, `media_snapshot`, `content_hash`), `not_before`, stempel persetujuan dan pembatalan. Unik per (artikel, trigger)                                                                     |
| `awcms_social_publish_jobs`        | Satu per (publikasi, akun). `provider`, `account_kind`, `variant`, `idempotency_key` (unik per tenant), `status`, `attempt_count`, `max_attempts`, `hold_count`, `next_attempt_at` (juga lease klaim), id dan URL post dari provider, kegagalan berkode dan frasa tetap. **Tanpa token dan tanpa referensi rahasia** |
| `awcms_social_publish_attempts`    | Ledger append-only, unik per (job, nomor percobaan): hasil, kode tetap, frasa tetap                                                                                                                                                                                                                                  |

Status agregat sebuah publikasi (`pending_approval`, `queued`, `in_progress`, `partially_published`, `published`, `failed`, `cancelled`, `refused`) **diturunkan** dari job-nya saat dibaca.

Mesin status:

```text
publication.state:  pending_approval -> ready -> cancelled        refused (final, nol job)
                    pending_approval -> cancelled
job.status:         queued -> publishing -> published (final)
                                         -> retry_wait -> publishing ...
                                         -> failed -> queued (hanya retry manual)
                    queued | retry_wait -> cancelled (final)
```

Trigger database menegakkan: snapshot dan identitas tidak pernah berubah; job `published` dan `cancelled` tidak pernah berubah; job gagal hanya bisa kembali ke `queued`; penghitung percobaan tidak pernah turun; job hanya dibuat untuk publikasi yang hidup dan akun `connected` milik tenant yang sama.

## 3. Alurnya

1. **Event artikel.** `blog_content` memanggil `SocialPublishingPort.onArticlePublished` di dalam transaksi terbitnya. Dengan flag deployment mati, saklar tenant mati, atau tanpa aturan untuk trigger itu, ia menjawab `{ jobsCreated: 0 }` dan tidak berbuat apa-apa. Selain itu ia membangun snapshot (excerpt atau judul sebagai caption, `https://{origin APP_URL}/blog/{tenantCode}/{slug}` sebagai tautan, gambar unggulan di-resolve lewat `MediaLibraryPort`), lalu enqueue untuk setiap akun aturan yang aktif. Ia berjalan dalam savepoint: kegagalan apa pun hanya membatalkan tulisan modul ini dan artikel tetap terbit.
2. **Publikasi manual.** `POST /api/v1/social-publishing/publications` menerima judul, caption, tautan opsional, objek media opsional, dan id akun. Pemanggil harus dapat memakai setiap akun.
3. **Aturan enqueue, per akun, berurutan.** Akun boleh menerbitkan sekarang (port `channel_accounts`: terhubung, koneksi aktif, kapabilitas `publish` diberikan beserta bukti pada matriks saat ini); provider punya adapter; peta kapabilitas adapter dapat membawa konten (varian, panjang caption termasuk tautan, tipe dan ukuran gambar). Kegagalan apa pun adalah kode yang dikembalikan untuk akun itu. Akun dievaluasi sebelum apa pun ditulis, sehingga permintaan yang semua akunnya ditolak tidak mencatat apa pun.
4. **Persetujuan dan jadwal.** Bila persetujuan diwajibkan, publikasi menunggu; dispatcher tidak mengklaim apa pun sebelum `approve`. Publikasi manual tidak dapat disetujui pembuatnya. `not_before` menunda dispatch; `schedule` memindahkannya selama belum ada yang di-dispatch.
5. **Dispatch.** `bun run social-publishing:dispatch`, tiga fase: klaim (lease, advisory lock per akun, bagian adil dan batas harian, pemeriksaan ulang akun), kirim (kredensial datang dari credential port, dan irisan ini menyusun yang menolak setiap permintaan, jadi belum ada yang terkirim; adapter dipanggil dengan klien `ssrfSafeFetch` yang tidak mengikuti pengalihan, timeout yang membatalkan permintaan, dan circuit breaker per akun), finalisasi (compare-and-set pada percobaan yang diklaim, ledger, event, audit).

## 4. Perilaku saat gagal

| Situasi                                                                  | Hasil                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Akun dicabut, dinonaktifkan, kapabilitas ditarik, koneksi dicabut        | Job `failed` (`ACCOUNT_*`), provider tidak pernah dipanggil, tidak ada yang dialihkan                                                                                                                                                                                                                     |
| Akun terdegradasi, pending, grant kedaluwarsa, secret store tak tersedia | Job ditahan (`queued`, `hold_count + 1`, tanpa memakai percobaan); `HOLD_EXHAUSTED` setelah 12 penahanan                                                                                                                                                                                                  |
| Provider pasti tidak menerima (adapter berkata `retryable`)              | `retry_wait` dengan backoff eksponensial (maksimum 4 jam); `RETRIES_EXHAUSTED` bila habis                                                                                                                                                                                                                 |
| Timeout, adapter yang melempar, atau `unknown` dari adapter              | **Post mungkin ada.** Provider yang men-dedupe kunci idempotensi (`supportsIdempotencyKey`): `retry_wait`, kunci sama, satu post. Selain itu: `needs_reconciliation`, tidak pernah dicoba ulang dispatcher; operator memeriksa akun dan mencoba ulang dengan `confirmPossiblyPublished`, atau membatalkan |
| Dibatasi laju                                                            | Sama, dan `retryAfterSeconds` provider hanya dapat memperpanjang tunggu                                                                                                                                                                                                                                   |
| Kredensial tak lagi diterima                                             | `failed` `NEEDS_REAUTH`; tidak pernah dicoba ulang oleh backoff                                                                                                                                                                                                                                           |
| Provider menolak konten                                                  | `failed` dengan kode tetap; tidak pernah dicoba ulang oleh backoff                                                                                                                                                                                                                                        |
| Job lain dari publikasi yang sama gagal                                  | Tidak berpengaruh pada saudara yang sudah terbit; retry manual hanya memindahkan job yang gagal                                                                                                                                                                                                           |
| Worker crash saat mengirim                                               | Lease habis: jawaban yang hilang. Provider yang men-dedupe mendapat kunci yang sama lagi sebagai percobaan baru; job provider lain menjadi `needs_reconciliation` (`LEASE_EXPIRED_UNKNOWN`) dan tidak pernah dikirim ulang dispatcher (database juga menolak klaim ulangnya)                                                                                                         |
| Breaker terbuka untuk sebuah akun                                        | Job-nya tidak diklaim; akun lain tidak terpengaruh                                                                                                                                                                                                                                                        |

## 5. Catatan keamanan

- Job tidak pernah membawa kredensial, dan **di irisan ini tidak ada yang dapat membaca satu pun untuk penerbitan** (temuan audit H1): job dispatch disusun dengan port kredensial yang menolak setiap permintaan (`noPublishCredentialPort`) dan tidak memegang `CHANNEL_SECRETS_ENCRYPTION_KEYS`. `ChannelPublisherCredentialPort` ada (kapabilitas `channel_account` 1.1.0) untuk konektor pertama, yang membawanya di bawah **role DB terpisah** (ADR-0157 bagian 6). Dispatcher tanpa adapter gagal tertutup (`PROVIDER_ADAPTER_UNAVAILABLE`) sebelum kredensial diminta.
- **Mengapa role worker tidak dilebarkan.** Revisi pertama menambah migrasi yang membuat `awcms_worker` dapat membaca access token sosial. Audit independen menunjukkan bahwa `whatsapp:dispatch` berbagi role dan key ring itu, sehingga worker WhatsApp yang diretas dapat mendekripsi token sosial semua tenant sejak hari migrasi berjalan, bahkan tanpa adapter. Itu ditarik: `sql/328` tidak disentuh. Konektor pertama harus menambah role DB sendiri, dengan pembacaan khusus-kolom dan kebijakan restriktif sendiri yang mengikuti status akun dan state grant (audit M2) dan sepakat dengan adapter kredensial tentang rahasia mana yang di-resolve akun yang meminjam kredensial induknya (audit L10). Sampai saat itu tidak ada token sosial yang dapat dibaca role job mana pun.
- Adapter menerima `request.http` (`ssrfSafeFetch`) dan tanpa `fetch` mentah; kredensial ada di memori untuk satu panggilan dan tidak pernah dicatat, disimpan, dijadikan event, diaudit, atau ditaruh di galat, dan pesan galat adapter yang dilempar tidak pernah disimpan. Kode kegagalan adalah kosakata tertutup yang dideklarasikan tiap adapter (`errorCodes`); kode di luarnya dicatat sebagai kode generik untuk hasilnya, sehingga string provider atau kredensial tidak dapat sampai ke baris lewat sebuah "kode".
- Akses per akun: membuat publikasi, aturan, dan bertindak pada publikasi atau job mensyaratkan pemanggil dapat memakai setiap akun tujuan (aturan penugasan dan business scope `channel_accounts`); selain itu adalah `422 ACCOUNT_NOT_USABLE` atau `404` yang seragam. Pembacaan hanya digerbangi permission.
- Setiap mutasi idempoten (`Idempotency-Key`), diaudit dengan id, kode, dan hitungan (tidak pernah caption, judul, atau URL), dan menolak kredensial mesin. Event membawa id, enum, dan hitungan.

## 6. Permission

`publications.read`, `publications.publish`, `publications.schedule`, `publications.approve`, `publications.cancel`, `jobs.retry`, `rules.read`, `rules.configure`, `settings.configure` (modul `social_publishing`, di-seed `sql/331`). Semuanya ada di ledger `NOT_YET_SCREENED` sampai layar hadir. Tenant yang dibuat sebelum migrasi ini membutuhkan `bun run identity-access:permissions:backfill`.

## 7. Konfigurasi

`SOCIAL_PUBLISHING_ENABLED` (mati secara default). Ia membutuhkan `CHANNEL_ACCOUNTS_ENABLED=true` (`config:validate` menolak kombinasi lain) dan `CHANNEL_SECRETS_ENCRYPTION_KEYS` untuk dispatcher. `APP_URL` harus `https` agar event artikel membawa tautan; bila tidak, event dicatat sebagai publikasi yang ditolak (`LINK_INVALID`).

## 8. Matriks akseptansi (issue #1145) dan tesnya

| Akseptansi                                                           | Tes                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2 tenant x 3+ akun, isolasi token                                    | `social-publishing.integration.test.ts` "N accounts of two tenants", "ITS OWN credential"                                 |
| Kegagalan sebagian dan replay                                        | "a rejected account does not change a published one", "a published job can never be retried..."                           |
| Pencabutan                                                           | "revoked account", "revoked connection and a withdrawn capability", "degraded account HOLDS"                              |
| Validasi MIME dan media                                              | `social-publishing.test.ts` kelayakan media; "unsupported content is REFUSED per account"                                 |
| SSRF                                                                 | "the adapter's HTTP client is ssrfSafeFetch"                                                                              |
| Kuota dan retry aman                                                 | "daily cap holds under concurrent dispatchers", "concurrent dispatchers send every job exactly once", "RETRIES_EXHAUSTED" |
| Idempotensi per (artikel, trigger, akun)                             | "an article event is idempotent per (article, trigger, account)", "concurrent identical article events"                   |
| Persetujuan, jadwal                                                  | "nothing is claimable before approval", "a schedule defers dispatch"                                                      |
| Tanpa antrean ganda, migrasi forward-only, RLS FORCE                 | `social-publishing-contract.test.ts`, tes "FORCE RLS"                                                                     |
| Hasil tak diketahui tidak pernah dicoba ulang secara buta (audit M1) | "M1 (the auditor's PoC)", "deduping provider is retried with the same key", "the timeout CANCELS the request"             |
| Role worker tidak membaca token sosial (audit H1)                    | "H1: the worker role cannot see a social token"; tes kontrak pada `sql/328` dan allowlist job                             |
| HTTP adapter tidak pernah mengikuti pengalihan (audit M3)            | `social-publishing.test.ts` "never follows a redirect"                                                                    |
| Modul mati per tenant menghentikan enqueue dan dispatch (M4)         | "M4: a tenant that switched the module OFF"                                                                               |
| Persetujuan ditahan di database (L2, L3)                             | "L2: the database refuses...", "L3: an approved publication cannot gain a target"                                         |
| Port tidak pernah menggagalkan terbit, flag mati adalah no-op        | "off unless the deployment enables it", "an unexpected failure inside the port never aborts..."                           |

## 9. Keterbatasan tersisa

- **Tanpa adapter provider** (#1146 sampai #1151): belum ada yang terbit. Persetujuan aplikasi provider adalah langkah bisnis di luar repositori ini.
- **Tanpa layar admin.** Layar admin SISTEM dibangun di sini ([ADR-0051](../adr/0051-admin-screens-consolidated-in-awcms.id.md)); kontrak layarnya adalah UP-08 sampai UP-16 di [`omnichannel-ui-ux-screen-contracts.id.md`](omnichannel-ui-ux-screen-contracts.id.md).
- **Tanpa sapuan retensi** untuk publikasi, job, dan percobaan (diparkir di daftar `BOUNDED_BY_DESIGN` dengan alasan tercatat). Ia membutuhkan keputusan pemilik tentang berapa lama bukti apa yang diterbitkan atas nama tenant disimpan.
- **Tanpa template caption**, tanpa pemformatan per provider selain menolak konten yang melebihi plafon panjang, tipe, atau ukuran, tanpa varian video, short, atau story (kosakatanya tertutup dan dicadangkan).
- Jendela crash antara "provider menerima post" dan "job difinalisasi" hanya tertutup di mana provider menghormati kunci idempotensi yang diteruskan.
- Pembacaan (daftar dan detail) digerbangi permission, bukan akses per akun.
- Circuit breaker per proses: tiap proses dispatcher punya statusnya sendiri.
- **Residual audit dicatat, tidak diperbaiki di irisan ini** (keputusan 3 November 2026). Teks lengkap di [ADR-0157](../adr/0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.id.md) bagian 6:
  - **L4:** bacaan hanya digerbangi `publications.read` dan `rules.read`, bukan akses per akun atau business scope; pemegangnya melihat caption, judul, link yang belum terbit dan `accountId` brand lain. Saring berdasarkan akses `channel_accounts` sebelum tenant multi-brand memakai modul ini.
  - **L6:** `externalPostId` (sampai 255 karakter) dan URL post (https) adalah teks bebas dari adapter, disimpan dan ditampilkan apa adanya. Setiap konektor memvalidasi format id dan host URL per provider, atau menjawab `unknown`.
  - **L8:** hak media, penarikan artikel, dan takedown media tidak diperiksa ulang saat dispatch; snapshot dibekukan saat enqueue. Hook pembatalan atau pemeriksaan ulang saat klaim dibutuhkan sebelum konektor pertama.
  - **L9:** `prepare` berjalan sebelum `authorize` (pola rute seluruh repositori), sehingga pemanggil tanpa izin dapat membedakan 400 atau 422 dari 403. Diterima sebagai pola repositori.
  - **M2, L10:** syarat role DB terpisah milik konektor (bagian 5).
  - **M-1, L-7:** konektor mendeklarasikan `supportsIdempotencyKey` dengan jujur dan menjawab `unknown`, bukan `retryable`, setelah permintaan apa pun yang mungkin sudah diproses; lease kedaluwarsa untuk provider tanpa kunci dedupe tidak pernah dikirim ulang.
- Saklar modul-mati per tenant dihormati enqueue dan dispatch, dan setiap rute lewat guard akses, tetapi publikasi yang sudah `published` tetap terbit (tidak ada yang menarik kembali sebuah post).
- **ADR-0157 berstatus Diusulkan.** Penerimaan maintainer, dan tinjauan keamanan jalur kredensial beserta role DB terpisahnya sebelum konektor mana pun keluar dari flag, masih dibutuhkan.
