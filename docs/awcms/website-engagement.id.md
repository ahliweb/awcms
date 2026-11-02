🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](website-engagement.md)

<!-- i18n-source-hash: sha256:4c3c79910886fd0e2a2a9daaa115ccf961f332648ac8289ec89f4b645dfb6e44 -->

# Website engagement — intake lead dan kontak (Issue #1153, ADR-0155)

Mengimplementasikan [ADR-0155](../adr/0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.id.md) (Accepted). Modulnya `website_engagement`, tipe `system`, status `experimental`, di [`src/modules/website-engagement/`](../../src/modules/website-engagement/README.id.md). Migrasi `sql/325` (skema), `sql/326` (izin), `sql/327` (penjaga integritas). Fragmen OpenAPI-nya `openapi/modules/website-engagement.openapi.yaml`; kontrak event ada di `asyncapi/awcms-domain-events.asyncapi.yaml`.

## Apa ini, dan apa yang bukan

Situs web milik tenant mengirim **permintaan kontak**, **lead**, atau **interaksi** ke satu endpoint publik. Modul menyimpannya beserta **provenance**-nya (sumber mana, host terverifikasi mana, tantangan apa yang melindunginya) dan **persetujuan**-nya (apa yang dicentang pengunjung secara eksplisit, terhadap versi teks persis yang mana, di halaman mana), lalu mengumumkannya lewat event outbox. Adapter CRM hilir (`awcms-one`) mengonsumsi event itu.

Modul ini **hanya intake**. Bukan CRM, bukan pipeline lead, bukan mesin formulir, bukan widget obrolan. Ia **tidak membuat, mencocokkan, atau menggabungkan orang** (ADR-0148 I7), **tidak menyimpulkan identitas pengunjung** (tidak ada sidik jari, cookie, IP, atau user agent yang disimpan), **tidak melakukan konversi CRM**, **tidak menerima HTML maupun unggahan**, dan **tidak membuat permintaan keluar saat menerima data** (jadi tidak ada permukaan SSRF). Tahap, pemilik, penilaian, dan deduplikasi adalah urusan hilir (ADR-0153).

## Audit apa yang sudah ada

| Modul           | Mengapa bukan rumahnya                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `form_drafts`   | Penyimpan draf multi-langkah yang terautentikasi, bukan intake publik.                                                            |
| `newsletter`    | Anonim, tetapi objeknya daftar pelanggan dengan double opt-in dan jawaban netral identik (ADR-0103).                              |
| `comments`      | Konten publik bermoderasi dengan token waktu dan Turnstile.                                                                       |
| `site_profile`  | Pengaturan per situs. Tidak ada entitas "situs web" kelas satu; situs web adalah **source** di sini.                              |
| `tenant_domain` | Resolusi host ke tenant. **Dipakai ulang**: source mendaftar baris `awcms_tenant_domains`, dan bootstrap host menjawab preflight. |
| proteksi bot    | `src/lib/security/{rate-limit,request-body-limit,request-origin,turnstile,field-encryption}` **dipakai ulang**, tidak disalin.    |

## Kontrak publik (v1)

`POST /api/v1/website-engagement/submissions`, `Content-Type: application/json`, tanpa `Authorization`, tanpa header tenant. Himpunan field **tertutup**; kunci tak dikenal menghasilkan `400` dan tidak pernah dipantulkan.

| Field                                  | Catatan                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceToken`                          | `wes1.<tenantId>.<sourceId>.<secret>`; tenant dibuka **dari token**                                                                     |
| `tenantId`, `sourceId`                 | opsional, **tidak pernah dipercaya**; ditolak bila berbeda dari token                                                                   |
| `eventId`                              | 8 sampai 64 karakter, kunci idempotensi klien; `(source, eventId)` yang sama disimpan sekali                                            |
| `kind`                                 | `contact` (butuh `contact.message` dan email atau telepon), `lead` (email atau telepon), `interaction` (`interaction.type` tertutup)    |
| `contact`                              | `name`, `email`, `phone`, `company`, `subject`, `message`; hanya teks                                                                   |
| `consent`                              | `purposes` (`respond_to_inquiry`, `marketing_follow_up`), `copyVersion`, `pagePath`                                                     |
| `attribution`                          | `landingPath` dan `referrerHost` (dicek bentuknya, disimpan, **tidak pernah diambil**), lima field `utm*`; tanpa URL penuh, tanpa query |
| `locale`, `topic`, `occurredAt`        | tag bahasa `en` / `id`; kode topik; waktu dalam 7 hari terakhir                                                                         |
| `challengeToken`, `honeypot`, `fillMs` | respons Turnstile; honeypot (biarkan kosong); waktu pengisian yang dilaporkan klien                                                     |

### Urutan keputusan (termurah dulu, sebelum pekerjaan database)

1. rate limit per IP (`WEBSITE_ENGAGEMENT_RATE_LIMIT_*`), 2. `Content-Type`, 3. body dibatasi **16 KiB**, 4. validasi **bentuk**, 5. key ring ada (gagal tertutup), 6. parse token dan id tenant/source, 7. **bukti**: tenant, saklar modul, status source, pembandingan hash berkunci di dalam konteks tenant milik token, dan host Origin terverifikasi terhadap domain aktif milik source, 8. batas per source (**setelah** bukti, sehingga token palsu tidak bisa menghabiskan jatah source asli), 9. aturan source itu sendiri (jenis yang diterima, persetujuan), 10. probe duplikat, 11. honeypot dan waktu pengisian, 12. tantangan (di luar transaksi mana pun), 13. satu transaksi: insert, `ON CONFLICT DO NOTHING`, event outbox.

### Satu penolakan sebelum bukti

Token yang tak bisa di-parse, tenant atau source tak dikenal, secret salah, source dijeda atau dicabut, tenant ditangguhkan, modul nonaktif, dan Origin tak terdaftar semuanya menjawab **`403 SUBMISSION_REFUSED` yang sama** tanpa pemberian CORS, serta membayar putaran database dan komputasi hash berkunci yang sama. Kiriman baru, duplikat, dan tangkapan honeypot menjawab **`200` yang sama**. Setelah bukti, jawabannya spesifik (`CONSENT_REQUIRED`, `CONSENT_COPY_MISMATCH`, `KIND_NOT_ACCEPTED`, `429`).

## Provenance: token dan Origin (ADR-0155 bagian 3)

- **Token** buram, 256-bit, disimpan hanya sebagai HMAC di bawah key ring modul, ditampilkan sekali saat pembuatan atau rotasi, dapat dirotasi (yang lama berhenti seketika) dan dicabut. Ia **rahasia pembawa yang ada di sumber halaman**, jadi bukan bukti bahwa pemanggil adalah situs web itu.
- **Origin** (atau, hanya bila tidak ada header `Origin`, host `Referer`) harus cocok dengan domain **aktif dan tidak terhapus** yang didaftarkan untuk source itu. `Origin` yang ada tetapi tak dapat dipakai (`null`, ekstensi) ditolak, tidak pernah diturunkan menjadi `Referer`. `Origin` palsu dari klien non-browser mungkin terjadi, sehingga pengecekan Origin adalah **pertahanan berlapis**, setara dengan tantangan dan rate limit. Mode server-ke-server bertanda tangan di luar cakupan.
- **Tiga situs web dalam satu tenant adalah tiga source; dua domain tenant dipetakan ke satu atau lebih source** (`awcms_engagement_source_domains`). Sebuah source menerima tepat host miliknya sendiri.
- CORS hanya memantulkan origin terverifikasi, tidak pernah `*`, tidak pernah berkredensial, `Vary: Origin` pada setiap jawaban. Preflight (`OPTIONS`, selalu `204`) memberi akses untuk domain tenant aktif terverifikasi mana pun, berbagi jatah per-IP dengan POST, dan hanya mengizinkan header `content-type`; POST lalu memverifikasi ulang token dan host per source.
- **Substitusi tenant-id** ditutup tiga cara: `tenantId`/`sourceId` di body atau query yang berbeda ditolak, `tenant_code` di query ditolak sepenuhnya, dan token yang menyebut tenant yang bukan pemilik source tidak menemukan baris apa pun (pencarian terjadi di dalam konteks RLS tenant itu). Tidak ada jalur bootstrap `SECURITY DEFINER` yang ditambahkan.

## Tantangan anti-penyalahgunaan (pertanyaan ADR-0155 bagian 7)

**Turnstile**, yang direkomendasikan ADR, memakai ulang `src/lib/security/turnstile.ts`, **diverifikasi terhadap host Origin terverifikasi milik permintaan itu sendiri** (bukan satu hostname global, sehingga tenant multi-domain bekerja) dengan action `website_engagement`. Per source: `challengeMode` `turnstile` atau `none`. Bila deployment tidak menjalankan Turnstile (offline/LAN, atau `TURNSTILE_ENABLED` mati), source berjalan hanya dengan kontrol non-pihak-ketiga (token, Origin, rate limit, honeypot, waktu pengisian); tiap kiriman tersimpan mencatat `challenge_outcome` (`turnstile_verified`, `not_required`, `source_none`) dan daftar source menampilkan `challengeEffective`, sehingga **"none" tidak pernah dikira "terverifikasi"**. Bila wajib, token hilang, secret hilang, gangguan, dan ketidakcocokan semuanya gagal **tertutup** dengan penolakan yang sama. Penerimaan ADR-0155 oleh maintainer tetap menjadi jawaban bagian 7; mode proof-of-work dapat ditambahkan nanti sebagai `challengeMode` kedua tanpa mengubah kontrak.

## Persetujuan, opt-out, dan minimisasi (UU PDP)

- `contact`/`lead` yang disimpan butuh `respond_to_inquiry` **dan** `copyVersion` yang sama dengan versi source saat ini; `marketing_follow_up` adalah tujuan terpisah, tidak pernah tersirat. `interaction` tidak membawa detail kontak dan tidak ada persetujuan. Database menolak kombinasi lain (`awcms_engagement_submissions_shape_check`).
- **Penarikan** adalah tindakan terkontrol-audit oleh pengendali (`submissions.withdraw`): menandai, satu event `submission.withdrawn` (idempoten saat konkuren), dan reveal ditolak sesudahnya. Kanal milik pengunjung sendiri adalah issue hak subjek data berikutnya (ADR-0094) dan merupakan keterbatasan tercatat.
- **Terenkripsi saat disimpan**: nama, email, telepon, perusahaan, subjek, dan pesan adalah satu amplop AES-256-GCM yang terikat pada tujuan, tenant, dan id baris; hash berkunci email dan telepon tersedia untuk pencarian; daftar menampilkan nilai tersamar. Tidak ada yang mendekripsi kecuali endpoint **reveal** teraudit di bawah izinnya sendiri.
- **Retensi** dideklarasikan sejak hari pertama lewat `data_lifecycle` (`awcms_engagement_submissions`, kursor `received_at`, **bawaan 180 hari**, batas 30-730, hard delete, sadar legal hold). Bawaan itu untuk dikonfirmasi maintainer dan tenant menentukan jendela akhir. Role worker dapat menemukan dan menghapus baris usang dan **tidak** dapat membaca identifier, hash, atau ciphertext apa pun.
- **DPIA**, teks persetujuan, dan jendela retensi adalah persetujuan manusia yang tidak dapat diberikan perubahan ini.

## Sambungan keluar: event CRM

`awcms.website_engagement.submission.received` (versi `1.0`, kontrak `1`) dan `...submission.withdrawn`, lewat outbox dalam transaksi yang sama dengan penulisan (konsumen yang dideklarasikan lewat deskriptor ADR-0134 dapat berlangganan). Payload (skema `WebsiteEngagementSubmissionReceived` di AsyncAPI) membawa `submissionId` buram, `sourceId`/`sourceCode`, `clientEventId` (padanan provider-event-id), `kind`, `provenance` terautentikasi, `consent`, `attribution`, jenis `identifiers` yang dimilikinya, dan `privacyClass` — **tidak pernah** nama, alamat, nomor telepon, atau pesan. Konsumen membaca detail dari `POST /submissions/{id}/reveal` di bawah `submissions.reveal` (kredensial mesin boleh), yang diaudit. Apa pun hasil ADR-0153 berlangganan event ini; bila butuh bentuk berbeda, ADR-0155 harus diamandemen dulu (ADR-0155 bagian 6).

## Catatan keamanan

| Aspek            | Kontrol                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolasi tenant   | RLS `FORCE` pada ketiga tabel dengan `WITH CHECK`; tenant datang dari token; foreign key komposit; trigger menolak domain tenant lain                                     |
| Default-deny     | Setiap rute admin di balik izin yang di-seed; POST publik satu-satunya handler tanpa autentikasi; kredensial mesin tidak boleh tindakan akuntabel                         |
| SSRF             | Tidak ada: tidak ada permintaan keluar saat menerima data; `referrerHost` hanya string yang dicek bentuknya; `verifyUrl` Turnstile adalah konfigurasi, bukan input        |
| Pemalsuan Origin | Origin satu dari empat kontrol setara; `null` dan host mirip ditolak; tanpa penurunan ke `Referer`                                                                        |
| Kebocoran token  | HMAC saat disimpan, ditampilkan sekali, tidak pernah didaftar, tidak pernah ada di baris audit, baris idempotensi, event, atau log; replay create/rotate menghilangkannya |
| Enumerasi        | satu penolakan sebelum bukti, biaya sama; id admin menjawab satu 404 lintas tenant; probe duplikat hanya terjangkau setelah bukti                                         |
| Redaksi log      | body, token, alamat, dan token tantangan tidak pernah dilog; hanya metrik hasil berkode (`website_engagement_submission_total`)                                           |
| Replay           | `(tenant, source, eventId)` unik; `occurredAt` dibatasi 7 hari terakhir; Turnstile sekali pakai dan tidak dipakai untuk duplikat yang sudah dikenal                       |
| XSS tersimpan    | hanya teks, markup dan karakter kontrol ditolak, di-escape saat keluaran oleh yang merendernya                                                                            |

## Keputusan widget (cakupan issue: hanya bila kendala CSP, SSRF, dan multi-domain lolos)

**Tidak dibangun.** Widget tertanam akan menjadi skrip pihak ketiga yang berjalan di halaman milik tenant sendiri, yang membutuhkan tinjauan CSP per domain tenant (pembukaan `script-src` di setiap situs pelanggan), cerita aset-ter-hosting dan versi, keputusan apakah widget boleh memuat Turnstile di halaman yang tidak dikuasai tenant, dan tinjauan multi-domain atas batas `postMessage`/iframe-nya. Tidak ada yang terbukti di sini, kontrak di atas lengkap tanpanya, dan situs web merender formulirnya sendiri (ADR-0155 bagian 1 menolak mesin formulir kedua). Tinjau ulang sebagai ADR tersendiri bila tenant membutuhkannya. **Live chat di luar cakupan** dan butuh persetujuan sendiri.

## Layar admin (ditunda) dan kontrak UX-nya

Modul **tidak mendeklarasikan entri navigasi** (entri navigasi tanpa halaman adalah 404 permanen). Kelima izin berada di `NOT_YET_SCREENED`. Saat layar operator hadir, dalam perubahan yang sama dengan entri navigasinya: tampilkan token **sekali** di area salin dengan konfirmasi eksplisit "sudah saya simpan" dan jangan render ulang; tampilkan `challengeEffective` sebagai teks yang terlihat, bukan hanya warna, dan tandai `none`; tampilkan nilai tersamar saja dan taruh reveal di balik aksi eksplisit dengan alasan; dan penuhi aturan WCAG 2.2 AA di `docs/awcms/14_ui_ux_design_system.md` (label, urutan fokus, pengumuman status, tanpa makna hanya-warna). Tidak ada UI pada perubahan ini, jadi tidak ada permukaan a11y yang diuji di sini.

## Keterbatasan (tercatat)

Tidak ada kanal penarikan publik; tidak ada mode server-ke-server bertanda tangan; tidak ada widget; tidak ada live chat; tidak ada deduplikasi atau pencocokan orang; tidak ada layar admin; tidak ada masa tenggang token saat rotasi (token lama berhenti seketika); limiter per-IP berjalan di dalam proses kecuali Redis dikonfigurasi; pencocokan host berdasarkan hostname (port diabaikan).

## Pengoperasian

Setel `WEBSITE_ENGAGEMENT_KEYS` (lihat `.env.example`), aktifkan modul untuk tenant di Module Management (aktif secara bawaan), buat source dengan `POST /sources` yang mendaftar id domain tenant, berikan ke situs web token sekali-tampil, versi teks persetujuan yang ditampilkannya, dan `eventId` yang dibuat per render formulir. Rotasi dengan `POST /sources/{id}/rotate`; hentikan situs dengan `POST /sources/{id}/revoke`.
