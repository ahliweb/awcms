🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0157-social-publishing-is-an-account-scoped-publication-intent-and-per-account-job-module.md)

<!-- i18n-source-hash: sha256:4b504b7acdbd3bcb3eb95fd9283e14a9d850508f5d917e0dac56e62e335b6828 -->

# ADR-0157 — `social_publishing` adalah modul intent-publikasi berbasis akun dan job per akun; provider adalah plug-in yang tidak dapat melebarkan apa yang boleh dilakukan sebuah akun

- **Status:** Diusulkan
- **Tanggal:** 2026-11-03
- **Pengambil keputusan:** ahliweb (pemilik). Belum ditinjau; sampai diterima, tidak ada isi ADR ini yang merupakan keputusan maintainer dan modul tetap `experimental` dan mati secara default.
- **Menyelesaikan (bila diterima):** detail admisi modul yang disyaratkan Issue #1145 "di PR-nya sendiri menurut `21_module_admission_governance.md`" (tabel, permission, versi port, gerbang peluncuran). ADR-0148 sudah menerima kapabilitas C3 dan syarat-syaratnya; ADR ini hanya menambahkan apa yang sengaja diserahkan ADR-0148 kepada issue implementasi.
- **Memperluas:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) (§1 C3, §2 invarian I1 sampai I3, I5, I10, I12; §10 Fase D), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.id.md), [ADR-0006](0006-offline-first-sync-outbox.id.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.id.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md)
- **Terkait:** Issue #1145 (irisan ini), #1140 (akun), #1146 sampai #1151 (konektor per provider, masing-masing issue sendiri dan persetujuan provider sendiri), #1139; `docs/awcms/omnichannel-foundation.id.md` bagian 2.3

## Konteks

Terverifikasi pada `main` per 3 November 2026:

- `SocialPublishingPort` ada di `src/modules/_shared/ports/social-publishing-port.ts`; `blog_content` memanggilnya tepat setelah artikel diterbitkan, di dalam transaksi terbit, dan kini memasang adapter no-op di kedua composition root (`POST /api/v1/blog/posts/{id}/publish`, `scripts/blog-scheduled-publish.ts`). Tidak ada modul `social_publishing`.
- `channel_accounts` (Issue #1140) menyimpan akun terhubung tenant, bukti kapabilitas per akun (`publish` adalah sel matriks), kredensial sebagai referensi terenkripsi, dan aturan akses. Ia tidak mengirim apa pun.
- `whatsapp_delivery` (Issue #1141) menunjukkan bentuk antrean kanal yang dibutuhkan: baris yang diklaim dengan lease, dispatch di luar transaksi apa pun, akun yang di-resolve saat dispatch, kegagalan akun yang ditahan versus final, tanpa pengalihan.
- ADR-0148 menerima C3 dengan syarat berikut: job merujuk `channel_account` dan baris kapabilitas `publish` yang diberikan dan tidak pernah token; konten (teks dan referensi media terverifikasi) di-snapshot saat enqueue; idempoten per `(artikel, trigger, akun)`; status persetujuan bila tenant mensyaratkannya; dispatch di luar transaksi dengan `ssrfSafeFetch` dan breaker per akun; penggantian no-op berada di balik flag, default mati; akun yang dicabut atau terdegradasi menghentikan job-nya; kapabilitas yang tak didukung ditolak, tidak pernah diturunkan.

Risikonya adalah yang lazim untuk penerbitan ke banyak akun: abstraksi "terbitkan ke semua" yang memposting ulang apa yang sudah berhasil ketika satu akun gagal, membawa kredensial di baris job, menerbitkan konten yang sudah diedit karena membaca ulang artikel saat kirim, atau memperlakukan "provider mendokumentasikannya" sebagai "akun ini boleh melakukannya".

## Keputusan

### 1. Satu modul, `social_publishing`, kategori System, dibangun di atas `channel_accounts`

Modul `type: "system"` (pohon keputusan doc 21: infrastruktur lintas modul yang dapat dipakai ulang, bukan domain ERP). Ia memiliki persis: **aturan terbit** (akun mana yang dituju sebuah event), **intent publikasi** (satu publikasi logis dengan snapshot konten immutable), satu **job per `channel_account` tujuan**, dan **ledger** per percobaan. Ia membaca model akun hanya lewat port `channel_account`. Ia tidak memiliki akun, kredensial, media, atau isi artikel. Semantik kampanye produk (kalender, audiens, atribusi) tetap di luar.

Status `experimental`, mati secara default di balik `SOCIAL_PUBLISHING_ENABLED`, tanpa entri navigasi sampai layar admin hadir dalam perubahannya sendiri (entri navigasi tanpa halaman adalah 404 permanen). Default tenant: `auto_publish_enabled = false` dan `approval_required = true`, sehingga mengaktifkan flag deployment saja tidak pernah menerbitkan apa pun.

### 2. Model data (`sql/330` sampai `sql/331`, forward-only; revisi pertama ADR ini juga mengusulkan migrasi ketiga, ditarik: lihat §6)

Semua tabel tenant-scoped, RLS `ENABLE` dan `FORCE` dengan `USING` dan `WITH CHECK`, foreign key komposit `(tenant_id, id)` (RLS tidak berlaku pada pemeriksaan FK), dan indeks untuk setiap foreign key.

- `awcms_social_publishing_settings`: satu baris per tenant: `auto_publish_enabled`, `approval_required`.
- `awcms_social_publish_rules`: `(tenant_id, trigger, channel_account_id)` unik, `enabled`. Jalur artikel menerbitkan ke setiap akun aturan aktif untuk trigger-nya.
- `awcms_social_publications` (**intent**): `source_kind` (`article` atau `manual`), `source_id`, `trigger`, **snapshot konten** (`title`, `caption`, `link_url`, snapshot media berisi URL publik terverifikasi, tipe MIME, ukuran, teks alt, credit line, dan status hak), `content_hash`, `state` (`pending_approval`, `ready`, `cancelled`, `refused`), stempel persetujuan dan pembatalan, `not_before`. Kolom konten immutable (trigger). Unik per `(tenant_id, source_id, trigger)` untuk artikel, sehingga event terbit yang berulang menemukan intent yang sama.
- `awcms_social_publish_jobs`: satu per `(intent, channel_account)`: `idempotency_key` (unik per tenant: hash atas tenant, sumber, trigger, dan akun), `provider` dan `account_kind` di-snapshot saat enqueue, `variant` (bentuk konten yang dipilih untuk provider ini), `status` (`queued`, `publishing`, `retry_wait`, `published`, `failed`, `cancelled`), `attempt_count`, `hold_count`, `next_attempt_at` (juga lease klaim), id dan URL post dari provider, kegagalan berkode, dan pesan yang sudah dibersihkan. **Tidak ada kolom yang dapat menampung token atau referensi rahasia**: job menamai akun, dan dispatcher me-resolve kredensial akun itu saat dispatch. `published` bersifat final dan identitasnya immutable (trigger).
- `awcms_social_publish_attempts`: ledger per percobaan, `UNIQUE (job_id, attempt_no)`, tidak pernah isi dan tidak pernah payload provider.

Job yang hasilnya TIDAK DIKETAHUI (§6) berstatus `needs_reconciliation`. Status agregat intent (`queued`, `partially_published`, `published`, `failed`, `cancelled`, dan `needs_reconciliation` bila ada job berstatus itu) **diturunkan** dari job-nya saat dibaca, tidak pernah disimpan, sehingga tidak dapat menyimpang dari job.

Jaminan database selain keunikan (semuanya ditolak database apa pun yang dilakukan aplikasi): publikasi `ready` yang mensyaratkan persetujuan punya penyetuju, dan untuk publikasi manual penyetujunya bukan pembuatnya; job tidak pernah ditambahkan ke publikasi yang sudah disetujui (persetujuan itu untuk target yang dimilikinya); snapshot dan identitas job tidak pernah berubah; `published` dan `cancelled` final; `needs_reconciliation` hanya keluar ke `queued` (retry terkonfirmasi operator) atau `cancelled`.

### 3. Adapter provider adalah plug-in yang tidak dapat melebarkan otoritas

`SocialPublishAdapter` adalah antarmuka dengan **peta kapabilitas** terdeklarasi per provider: varian konten yang didukung (`text`, `image`, `video`, `short`, `story`), panjang caption maksimum, tipe MIME gambar yang diterima, dan ukuran gambar maksimum. Sebuah registri memetakan kunci provider ke paling banyak satu adapter; provider tanpa adapter tidak dapat menerbitkan (`PROVIDER_ADAPTER_UNAVAILABLE`), yang merupakan keadaan setiap provider nyata setelah irisan ini (#1146 sampai #1151 mendaftarkan adapter mereka). Peta adapter adalah **plafon, bukan hibah**: job dibuat hanya bila kapabilitas `publish` akun `granted` beserta bukti dan versi matriks terkini, akun `connected`, koneksinya `active`, **dan** peta adapter mendukung varian konten. Varian yang tak didukung ditolak saat enqueue dan tidak pernah diturunkan (gambar yang tidak dapat dikirim ke provider hanya-teks ditolak, tidak diposting sebagai teks). Satu-satunya adapter yang ditulis di irisan ini adalah fake dalam memori yang dipakai tes, tidak pernah didaftarkan kode aplikasi.

### 4. Enqueue, idempotensi, snapshot, kegagalan sebagian

- Jalur artikel (`SocialPublishingPort.onArticlePublished`) dan jalur manual (`POST /api/v1/social-publishing/publications`) keduanya berjalan dalam transaksi pemanggil dan hanya melakukan tulisan biasa: tanpa panggilan provider, tanpa jaringan, tanpa pembacaan rahasia.
- Snapshot saat enqueue: teks, tautan, dan snapshot media yang di-resolve lewat `MediaLibraryPort` (objek harus terverifikasi, tenant yang sama, tipe MIME yang diizinkan, dalam batas ukuran, dan memiliki status hak selain tidak diketahui). Job tidak pernah membaca ulang artikel, sehingga suntingan dan pembatalan terbit kemudian tidak mengubah apa yang dikirim. Referensi media yang tidak valid menolak seluruh publikasi (`MEDIA_NOT_ELIGIBLE`) alih-alih memposting teks saja.
- Idempotensi per `(artikel, trigger, akun)` lewat kunci unik; jalur manual juga mensyaratkan `Idempotency-Key`. Panggilan berulang tidak membuat apa pun baru untuk akun yang sudah punya job dan hanya menambah job untuk akun yang baru memenuhi syarat.
- **Kegagalan sebagian tidak pernah diputar ulang**: job adalah baris yang independen. Job gagal atau ditahan tidak mengubah apa pun pada saudara yang sudah terbit; retry (`jobs.retry`) bekerja pada satu job gagal saja; batal hanya menghentikan job yang belum terbit; `published` final lewat trigger. Artikel sumber tidak pernah disentuh.
- Kontrak port tidak berubah dan `jobsCreated` menghitung job yang benar-benar dibuat. Port tidak pernah melempar untuk penolakan bisnis (lemparan di dalam transaksi terbit akan menggagalkan penerbitan artikel); penolakan dicatat pada intent (`refused` dengan alasan berkode) dan diaudit.

### 5. Persetujuan, penjadwalan, otoritas

- Bila tenant mensyaratkan persetujuan, intent dimulai `pending_approval`; tidak ada yang dapat diklaim sampai `publications.approve`. Intent manual tidak dapat disetujui pembuatnya sendiri (pemisahan tugas: `SELF_APPROVAL_FORBIDDEN`). `not_before` menunda dispatch; `publications.schedule` mengubahnya sebelum dispatch.
- Permission (semuanya di-seed `sql/331` dan ditegakkan rute dalam perubahan yang sama): `publications.read`, `publications.publish`, `publications.schedule`, `publications.approve`, `publications.cancel`, `jobs.retry`, `rules.read`, `rules.configure`, `settings.configure`. Memakai sebuah akun juga mensyaratkan akses per akun milik `channel_accounts` (aturan penugasan dan business scope) lewat chokepoint akses; akun yang tidak dapat dipakai pemanggil adalah satu `422 ACCOUNT_NOT_USABLE` yang sama dengan akun tak dikenal atau milik tenant lain (tanpa oracle keberadaan).
- Setiap mutasi idempoten di tempat ia berisiko tinggi, diaudit dengan atribut yang disamarkan (id, kode, dan hitungan, tidak pernah caption atau URL), dan menolak kredensial mesin (sikap yang sama dengan `channel_accounts`).

### 6. Dispatch

`bun run social-publishing:dispatch` (cron) mengklaim job dengan `FOR UPDATE SKIP LOCKED` dan lease, dalam transaksi singkat, lalu melepas koneksi dan memanggil provider **di luar transaksi apa pun**. Setiap klaim me-resolve ulang akun lewat port (akun atau koneksi yang dicabut menggagalkan job secara final, yang terdegradasi atau kedaluwarsa menahannya, tidak pernah menghitung percobaan), menegakkan bagian adil per akun dan batas harian per akun di bawah advisory lock per akun (sehingga dispatcher bersamaan tidak dapat melampaui), dan memakai circuit breaker per akun. Tenant yang mematikan modul tidak di-enqueue maupun di-dispatch (baris enablement modul dibaca di kedua jalur; pembacaan yang gagal tidak pernah dianggap "aktif"). Galat provider diklasifikasi (`published`, `retryable`, `rate_limited`, `needs_reauth`, `rejected`, `unknown`), dibersihkan, dan diberi kode, dan kode itu adalah kosakata TERTUTUP yang dideklarasikan tiap adapter (`errorCodes`): kode di luarnya dicatat sebagai kode generik untuk hasilnya, sehingga tidak ada string provider atau kredensial yang sampai ke baris lewat sebuah "kode". Vonis milik dispatcher sendiri (`PROVIDER_TIMEOUT`, `ADAPTER_ERROR`) tidak pernah ditulis ulang ke kosakata adapter.

**Hasil yang tidak diketahui tidak pernah dicoba ulang secara buta.** Klien HTTP adapter adalah `ssrfSafeFetch` yang terikat pada abort signal panggilan dengan `maxRedirects: 0` (API provider tidak mengalihkan panggilan terbit, dan guard bersama meneruskan header permintaan, termasuk bearer `Authorization`, ke target pengalihan). Timeout dispatcher MEMBATALKAN permintaan; tidak membiarkannya terbengkalai. Tetapi timeout, atau adapter yang melempar, setelah permintaan terkirim berarti post mungkin sudah ada. Karena itu tiap adapter mendeklarasikan apakah provider-nya men-dedupe pada kunci idempotensi (`supportsIdempotencyKey`): bila ya, job dicoba ulang otomatis dengan kunci yang sama (provider menerbitkan sekali); bila tidak, job menjadi `needs_reconciliation` dan tidak pernah dicoba ulang dispatcher. Operator yang sudah memeriksa akun mencobanya ulang dengan konfirmasi eksplisit (`confirmPossiblyPublished`), atau membatalkannya. Hal yang sama berlaku untuk crash antara "provider menerima post" dan "job difinalisasi": jendelanya tidak terbatas pada crash, ia adalah setiap jawaban yang hilang, dan untuk provider tanpa kunci dedupe satu-satunya perlindungan adalah operator.

#### Jalur kredensial TIDAK ada di irisan ini (keputusan 3 November 2026, temuan audit H1)

Revisi pertama ADR ini mengusulkan migrasi ketiga, yang melebarkan kebijakan baris `awcms_worker` pada `awcms_channel_secrets` (diatur `sql/328`, hanya WhatsApp) ke access token akun sosial yang mampu menerbitkan. Audit independen menunjukkan ini membatalkan #1233: `whatsapp:dispatch` berjalan sebagai role yang sama dengan key ring yang sama (`CHANNEL_SECRETS_ENCRYPTION_KEYS`), sehingga worker WhatsApp yang diretas dapat membaca dan mendekripsi token sosial semua tenant, sejak migrasi diterapkan dan walau belum ada adapter. **Pelebaran itu ditarik.** Irisan ini tidak menyentuh `sql/328`, tidak memberi job dispatch key ring apa pun, dan menyusunnya dengan port kredensial yang menolak setiap permintaan (`noPublishCredentialPort`). Dispatcher tanpa adapter gagal tertutup dengan `PROVIDER_ADAPTER_UNAVAILABLE` sebelum kredensial diminta, dan enqueue menolak akunnya lebih dulu. `ChannelPublisherCredentialPort.resolvePublishCredential` ada (kapabilitas `channel_account` 1.1.0) tetapi tidak ada yang menyusunnya untuk worker.

**Syarat konektor pertama (#1146):** kredensial sampai ke dispatcher sosial hanya di bawah **role database terpisah** (misalnya `awcms_social_dispatch`) dengan pembacaan tabel kanal khusus-kolom dan kebijakan baris restriktif sendiri, dan dengan key ring hanya untuk job itu. Dampaknya pada `whatsapp:dispatch` harus dinyatakan dalam perubahan itu: worker WhatsApp tetap memakai role `awcms_worker` dan kebijakan `sql/328` yang tidak berubah, dan tidak ada yang bisa dibaca role itu yang melebar. Perubahan itu juga harus memenuhi dua syarat yang dicatat audit:

- **M2.** Kebijakan baris harus mengikuti status akun dan grant, bukan hanya kapabilitas: akun `connected` atau `degraded` (bukan dicabut, dinonaktifkan, atau pending) dan koneksi yang grant-nya `active` atau `expired` (bukan dicabut atau gagal). Akun atau koneksi yang dicabut harus langsung keluar dari pandangan role.
- **L10.** Akun yang meminjam kredensial dari induknya (anak sebuah kontainer seperti WABA) tidak akan pernah dapat memakai token induk di bawah kebijakan yang berkunci pada rahasia akun itu sendiri; kebijakan role dan adapter kredensial harus sepakat tentang referensi mana yang di-resolve sebuah akun, atau akun seperti itu ditolak sebagai `CREDENTIAL_UNAVAILABLE` dan menyatakannya.

Risiko residual setelah perubahan itu adalah yang diterima ADR-0148 bagian 5 untuk dispatcher, kini dinyatakan untuk job kedua di bawah rolenya sendiri: `social-publishing:dispatch` yang diretas dapat mendekripsi token yang mampu menerbitkan milik setiap tenant.

### 7. Port dan versi

`channel_account` naik `1.0.0` ke `1.1.0` (aditif: `resolvePublisher` dan `resolvePublishCredential`; `resolveWhatsappSender` tidak berubah). `social_publishing` didaftarkan pada `1.0.0` sebagai port yang sudah dikonsumsi `blog_content` (opsional). Composition root memilih adapter nyata **hanya bila `SOCIAL_PUBLISHING_ENABLED` menyala**; selain itu no-op yang ada tetap, sehingga deployment yang tidak mengonfigurasi apa pun berperilaku persis seperti sebelumnya.

### 8. Di luar cakupan irisan ini

Konektor per provider dan persetujuan providernya (#1146 sampai #1151), layar admin (permission dicatat di ledger cakupan layar), template caption dan pemformatan per provider selain plafon panjang, ingest komentar dan analitik, progres realtime (ADR-0154), dan perilaku balasan atau DM apa pun. Unggah media ke provider adalah urusan konektor; irisan ini men-snapshot referensi yang terverifikasi.

## Opsi yang dipertimbangkan

| Kriteria        | **A. Modul baru di atas `channel_accounts` (dipilih)**            | B. Perluas `blog_content`                                       | C. Modul per provider                              |
| --------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| Keamanan        | Satu jalur enqueue dan dispatch yang ditinjau; tanpa token di job | Mencampur kepenulisan artikel dengan dispatch dekat-kredensial  | Tiap modul menurunkan ulang pencabutan dan breaker |
| Maintainability | Provider adalah adapter di balik satu antarmuka                   | `blog_content` mendapat antrean yang tidak seharusnya ia miliki | N antrean, N model persetujuan                     |
| Kompatibilitas  | Port sudah ada; no-op tetap default                               | Mengubah kontrak modul yang berjalan                            | Melanggar ADR-0148 C3 ("satu modul")               |
| Operasi         | Satu job, satu lease, satu set diagnostik                         | Berbagi dengan irama terbit                                     | N job                                              |

## Konsekuensi

- **Positif:** fondasi yang ditinjau yang dicolok setiap konektor; kegagalan sebagian dan replay mustahil secara konstruksi; kredensial hanya sampai ke dispatcher; konten yang tak didukung ditolak secara terlihat.
- **Negatif / trade-off:** satu modul baru dan satu job baru; port `channel_account` bertambah; sampai jalur kredensial hadir bersama konektor pertama di bawah role DB sendiri (§6) tidak ada job yang dapat diterbitkan sama sekali; sampai konektor mendaftar, mengaktifkan modul tidak menerbitkan apa pun (disengaja); jendela crash antara provider menerima post dan job difinalisasi dibatasi oleh dukungan idempotensi provider sendiri, tidak dihilangkan.
- **Keterbatasan tercatat:** tanpa layar admin; tanpa template caption; satu adapter fake dalam memori untuk tes; unggah media per provider, header batas laju, dan pemetaan kebijakan konten milik konektor.
- **Persetujuan manusia yang masih dibutuhkan:** penerimaan maintainer atas ADR ini; untuk tiap konektor, persetujuan aplikasi provider atau bukti audit (langkah bisnis); tinjauan keamanan jalur kredensial dan role DB terpisahnya sebelum konektor mana pun keluar dari flag.

## Alternatif yang ditolak

- **Membaca artikel saat kirim:** menerbitkan konten yang sudah diedit atau dibatalkan terbitnya; snapshot adalah kontraknya.
- **Satu job per publikasi dengan N akun di dalamnya:** satu kegagalan memaksa replay seluruh himpunan atau status sebagian buatan sendiri; satu baris per akun menjadikan status sebagian sebagai modelnya.
- **Menyimpan token provider atau referensinya di job:** melebarkan jangkauan kredensial ke setiap pembaca antrean; referensi akun ditambah resolusi saat dispatch menjaganya tetap pada dispatcher.
- **Menurunkan konten yang tak didukung (gambar ke teks):** diam-diam mengubah apa yang telah disetujui tenant.
