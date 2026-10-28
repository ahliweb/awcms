🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.md)

<!-- i18n-source-hash: sha256:3a1d39f2620d922ba86a9caaf50efcc735c5b8af5e49a3382690ab1a951da5ae -->

# ADR-0155 — Penangkapan lead dan kontak situs web adalah modul sistem khusus intake, `website_engagement`, dengan provenance token sumber dan Origin

- **Status:** Diusulkan
- **Tanggal:** 2026-10-27
- **Pengambil keputusan:** ahliweb (maintainer) — **penerimaan adalah keputusan maintainer, bukan keputusan dokumen ini**
- **Menyelesaikan (bila diterima):** gerbang admisi modul Issue #1153. Sebelum diterima, #1153 belum siap diimplementasikan.
- **Memperluas:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) (§2 invarian I1, I7, I8, I9, I12; §6 aturan penautan kontak; §10 baris Fase C untuk #1153), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md), [ADR-0103](0103-newsletter-is-its-own-module.id.md) (pola intake publik), [ADR-0037](0037-data-lifecycle-module-admission.id.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.id.md)
- **Harus selaras dengan (belum diputuskan):** ADR-0153 (Issue #1163, pipeline lead/prospek). ADR ini tidak mendahului hasilnya; lihat §6.
- **Terkait:** Issue #1153, #1139, #1144, #1163; `docs/awcms/21_module_admission_governance.id.md`

**Hanya dokumen dan tata kelola. NOT YET IMPLEMENTED IN THIS REPO.** ADR ini tidak menambah modul, tabel, migrasi, rute, path OpenAPI, kanal AsyncAPI, atau dependensi. Tidak ada di sini yang menjadi bukti bahwa penangkapan situs web berfungsi.

## Konteks

Terverifikasi pada `main` per 27 Oktober 2026:

- Issue #1153 meminta kontrak event lead/kontak situs web yang tenant-scoped dan dapat dikonsumsi publik, dengan origin tenant terverifikasi, atribusi sumber, dan provenance consent eksplisit, untuk adapter CRM hilir. ADR-0148 menerima _desain_-nya (Fase C, "independen dari C1, selaras I9") tetapi **tidak menamai modul, kategori, atau rumah** baginya, dan menyatakan tiap issue implementasi lulus kesiapannya sendiri.
- Tidak ada modul yang memiliki data kontak yang dikirim pengunjung. Audit menemukan:
  - `form_drafts`: penyimpanan draf multi-langkah terautentikasi. Bukan intake publik.
  - `newsletter`: intake anonim, tetapi objeknya daftar pelanggan dengan double opt-in (ADR-0103). Semantiknya tidak cocok untuk pertanyaan sekali kirim.
  - `comments`: konten publik termoderasi dengan timing token dan Turnstile.
  - `booking`: reservasi.
  - `tenant_domain`: resolusi host ke tenant. `site_profile`: pengaturan per situs. Tidak ada entitas "situs web" kelas satu di repositori.
- Blok bangunan yang dapat dipakai ulang sudah ada dan wajib dipakai, bukan diduplikasi: `src/lib/security/{rate-limit,request-body-limit,request-origin,turnstile,field-encryption,idempotency-key-bound}.ts`, registri `data_lifecycle`, `domain_event_runtime` dengan outbox, penanganan consent `visitor_analytics`.
- ADR-0148 §10 dan paket kesiapan menjadikan "tantangan anti-abuse diputuskan" butir Definition-of-Ready untuk #1153, dan komentar #1139 menyebut pilihan itu "perlu keputusan di PR". Belum tercatat.
- `commerce` awcms-one di hilir memiliki pelanggan CRM. Hulu tidak boleh membuat otoritas pelanggan kedua (I7).

## Keputusan (diusulkan)

### 1. Modul baru: `website_engagement`, kategori **System**, hanya intake

Modul `type: "system"` baru (pohon keputusan doc 21: kapabilitas lintas modul yang dapat dipakai ulang, bukan domain ERP). Ia memiliki tepat tiga hal: **sumber (source)**, **submission**, dan **event outbox** yang mengumumkan submission. Ia **bukan** CRM, **bukan** pipeline lead, **bukan** mesin form, dan **bukan** widget chat.

Rumah yang ditolak: memperluas `newsletter`, `comments`, atau `form_drafts` (masing-masing membengkokkan modul yang ADR-nya mendefinisikan objek dan semantik respons publik yang berbeda; lihat Opsi).

Sengaja **di luar** modul: tahap, pemilik, skoring, deduplikasi, konversi, penggabungan orang, tindak lanjut (semua #1163 / hilir); HTML sembarang, unggah berkas, live chat, dan widget tertanam (issue hanya membolehkan widget setelah tinjauan CSP/SSRF/multi-domain, keputusan terpisah di kemudian hari); membangun mesin form kedua (modul menyimpan payload **terbatas dan tervalidasi skema**; rendering form tetap di situs web).

### 2. Model data (bentuk, bukan DDL; migrasi menyusul bersama implementasi)

Semua tabel tenant-scoped dengan RLS `FORCE` dan RBAC/ABAC default-deny (I1).

- **`engagement_sources`**: satu baris per situs/kanal form milik tenant: `id`, `tenant_id`, `code` (unik per tenant), `name`, `tenant_domain_id` opsional (host yang diizinkan), `status`, `form_schema_version`, `consent_copy_version`, mode tantangan, `token_hash`, `token_prefix`, stempel rotasi, soft delete. **Tiga situs web dalam satu tenant adalah tiga source**; dua domain tenant dapat dipetakan ke satu atau lebih source.
- **`engagement_submissions`**: `id`, `tenant_id`, `source_id`, `event_id` (kunci idempotensi/replay dari klien), `received_at`, `occurred_at`, `kind` (daftar tertutup: `contact`, `lead`, `interaction`), `payload` (terbatas, field daftar-izin), `locale`, atribusi (`referrer_host`, field UTM, path landing; tanpa query URL penuh), blok consent (§5), `privacy_class`, `status`, dan pengenal langsung (email, telepon, nama) yang **terenkripsi** dengan helper field-encryption bersama plus hash berkunci untuk pencarian (pola ADR-0137). Unik `(tenant_id, source_id, event_id)` adalah kunci replay.
- Tidak ada identitas pengunjung yang disimpulkan: tanpa fingerprint, tanpa cookie, tanpa IP polos (hanya hash berkunci berumur pendek untuk rate limit, tidak disimpan pada submission).

### 3. Provenance terautentikasi: token sumber plus pemeriksaan Origin/host (selaras ADR-0148 I9 dan kondisi #1139)

1. Tenant di-resolve **dari token sumber** (bearer opak berentropi tinggi per source, disimpan hanya sebagai hash berkunci, ditampilkan sekali saat dibuat, dapat dirotasi dan dicabut). `tenant_id`, `source_id`, atau `tenant_code` di body atau query **diabaikan bila ada dan ditolak bila bertentangan** (tes substitusi tenant ID).
2. `Origin` request (cadangan: host `Referer`) harus cocok dengan host yang terdaftar untuk source itu lewat `tenant_domain`. Ketidakcocokan ditolak sebelum penulisan database. Token adalah rahasia bearer yang terlihat di sumber halaman, sehingga **tidak** dianggap bukti bahwa pemanggil adalah situs web: pemeriksaan Origin, tantangan, dan rate limit adalah kontrol setara. Klien non-browser dapat memalsukan `Origin`; maka pemeriksaan Origin adalah pertahanan berlapis, bukan satu-satunya gerbang, dan pengiriman server-ke-server memakai mode non-browser terpisah (ditandatangani dengan rahasia lain) yang di luar cakupan sampai diminta.
3. CORS: endpoint menjawab preflight hanya untuk origin terdaftar milik source (pendekatan `newsletter-cors`), tanpa wildcard dan tanpa kredensial.

### 4. Perilaku endpoint intake publik

- `POST /api/v1/website-engagement/submissions` (berversi, publik, anonim; OpenAPI + AsyncAPI pada PR implementasi).
- Urutan pemeriksaan, termurah dulu dan **sebelum kerja database**: metode dan content-type, `Content-Length` dan batas body streaming, rate limit per IP dan per source (pakai ulang `rate-limit`), pemeriksaan token dan Origin, tantangan anti-abuse (§7), validasi skema, lalu satu transaksi.
- Validasi: himpunan field tertutup per `form_schema_version`, batas panjang, tanpa HTML (teks disimpan sebagai teks dan di-escape saat output, tak pernah dirender mentah), tanpa unggahan, tanpa fetch URL (SSRF: modul **tidak** melakukan request keluar saat ingest).
- Idempoten: `(source, event_id)` ganda mengembalikan badan sukses netral yang **sama** dan tidak membuat baris atau event kedua. Respons tak pernah mengungkap apakah seseorang atau alamat sudah dikenal (prinsip ADR-0103).
- Kegagalan memakai envelope standar dengan pesan generik; log dan audit membawa fingerprint tersamarkan, tak pernah payload atau alamat.
- Field honeypot dan token waktu-isi minimum (seperti `comments`) adalah sinyal tambahan murah; tidak menggantikan tantangan.

### 5. Consent, opt-out, dan minimisasi UU PDP (UU No. 27/2022)

- Submission diterima hanya bila form menyatakan tujuan pemrosesan. Catatan menyimpan **provenance consent**: `consent_given` (boolean eksplisit, tak pernah pre-centang atau disimpulkan), `consent_purpose` (daftar tertutup, mis. `respond_to_inquiry`, `marketing_follow_up`), `consent_copy_version` (versi teks persis yang ditampilkan), `consent_source` (kode source dan path halaman), `consent_at`. Menjawab pertanyaan dan tindak lanjut pemasaran adalah tujuan **terpisah** dengan kotak terpisah; consent pemasaran tak pernah tersirat dari pertanyaan (ADR-0148 I8).
- **Opt-out / penarikan** adalah operasi kelas satu oleh pengendali (admin, diaudit) dan oleh subjek data lewat kanal hak subjek kelak (ADR-0094). Penarikan menandai submission dan memancarkan event penarikan; konsumen hilir wajib menghormatinya. Permintaan penarikan publik mentah di luar irisan pertama dan dicatat sebagai keterbatasan.
- **Minimisasi:** kumpulkan hanya field yang dideklarasikan skema source; tanpa nomor identitas nasional, tanpa data kategori khusus (validator menolak nama field itu, seperti `form_drafts` menolak nama berbentuk rahasia); pengenal langsung terenkripsi saat disimpan dan disamarkan di daftar admin, log, dan event (event membawa referensi dan kelas privasi, bukan alamat, kecuali konsumen diberi izin eksplisit).
- **Retensi:** dideklarasikan sejak hari pertama dalam migrasi lewat registri `data_lifecycle` (ADR-0148 I12): jendela retensi default per tenant, expire-lalu-purge, sadar legal hold, deskriptor subject-data per ADR-0094. ADR ini mengusulkan default untuk dikonfirmasi maintainer; pengendali (tenant) menetapkan jendela akhir.
- DPIA pengendali dan teks consent adalah **persetujuan manusia yang tidak dapat diberikan ADR ini** (seperti ADR-0148).

### 6. Seam CRM yang tidak mendahului ADR-0153

Satu-satunya permukaan keluar adalah domain event yang dipublikasikan lewat outbox (konsumen terdeklarasi deskriptor ADR-0134), mis. `website_engagement.submission.received`, dalam envelope ADR-0148 §6: `tenant_id`, `source_id` (analog channel account), `event_id` (analog provider event id), `occurred_at`, provenance terautentikasi (`source_token`, `origin_verified`), `correlation_id`, `privacy_class`, plus blok consent dan atribusi. Event membawa **referensi submission opak** dan minimum yang diperlukan; konsumen membaca rincian lewat port resmi dengan izinnya sendiri.

- Tidak ada orang yang dibuat, dicocokkan, atau digabung di sini. Menautkan submission ke orang CRM hanya terjadi di hilir lewat `contact_link_evidence` dengan metode deterministik (pengunjung mengetik pengenal pada form first-party, persis yang dicatat modul ini) (ADR-0148 §6).
- **Apa pun hasil ADR-0153 yang diterima mengatur sisi konsumen.** Bila ADR-0153 menerima konteks `lead_pipeline`, ia berlangganan event ini; bila disusun dari modul yang ada, modul-modul itu berlangganan; bila ditolak, konsumen hilir (awcms-one) berlangganan. Kontrak event modul ini adalah seam stabil pada ketiganya. Bila hasil ADR-0153 menuntut bentuk event atau pemilik penangkapan yang berbeda, ADR ini harus diamendemen sebelum implementasi dilanjutkan.

### 7. Tantangan anti-abuse: PERTANYAAN TERBUKA untuk maintainer

**Opsi yang direkomendasikan (tidak diputuskan dokumen ini): Cloudflare Turnstile**, memakai ulang `src/lib/security/turnstile.ts` (verifikasi sisi server dengan pemeriksaan action, hostname, dan kesegaran, body terbatas, token tak pernah dilog). Dibutuhkan per source dan mengikuti profil deployment: bila `TURNSTILE_ENABLED` mati (offline/LAN) modul jatuh ke kontrol **tanpa pihak ketiga** saja (token, Origin, rate limit, honeypot, timing token, proof-of-work opsional) dan source ditandai `challenge: none`, yang wajib terlihat di UI admin. Default deployment publik: tantangan wajib.

| Kriteria               | **A. Turnstile (direkomendasikan)**                                                                              | B. Proof-of-work self-hosted (mis. ALTCHA)                                      | C. Hanya honeypot + timing token + rate limit | D. CAPTCHA gambar/puzzle (reCAPTCHA/hCaptcha)    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Keamanan               | Kuat terhadap bot umum; diverifikasi server; ikatan action/hostname; satu pihak ketiga melihat sinyal pengunjung | Menaikkan biaya per submission; lebih lemah vs bot bertekad; tanpa pihak ketiga | Hanya menghentikan bot naif                   | Kuat; aliran data pihak ketiga lebih berat       |
| Aksesibilitas (WCAG)   | Biasanya tak terlihat atau satu klik; tanpa puzzle gambar; dapat dioperasikan keyboard                           | Tak terlihat; memakai CPU di ponsel kelas bawah                                 | Sepenuhnya tak terlihat                       | Puzzle gambar/audio kasus aksesibilitas terburuk |
| Privasi / UU PDP       | Data pengunjung diproses Cloudflare di luar Indonesia: pengendali wajib mengungkapkan                            | Tanpa pihak ketiga; paling cocok untuk deployment ketat                         | Tanpa pihak ketiga                            | Pihak ketiga plus kekhawatiran pelacakan         |
| Performa / SEO / UX    | Satu skrip hanya di halaman form (origin CSP ditambah hanya bila aktif); tanpa layout shift saat tak terlihat    | Tanpa skrip eksternal; menambah waktu hashing sebelum kirim                     | Tanpa biaya                                   | Skrip lebih berat, gesekan terlihat              |
| Maintainability        | Adapter sudah ada dan diperkeras; satu pasang env tambahan per deployment                                        | Kode baru yang harus dipelihara; lebih banyak tes                               | Komponen yang ada                             | Adapter kedua                                    |
| Skalabilitas / operasi | Dialihkan ke penyedia; ketergantungan gagal **tertutup**, sehingga gangguan memblokir form                       | Skala dengan CPU kita; tanpa ketergantungan                                     | Tanpa ketergantungan                          | Ketergantungan penyedia                          |
| Profil offline/LAN     | Tidak tersedia (mati); jatuh ke C                                                                                | Berfungsi                                                                       | Berfungsi                                     | Tidak tersedia                                   |

Alasan untuk A: sudah ada di repositori dan telah ditinjau, aksesibilitas terbaik dan gesekan terendah, dan daftar akseptansi issue (Origin palsu, payload berbahaya, form ganda) ditangani oleh kontrol lain di §3 dan §4, bukan oleh tantangan saja. B adalah alternatif terkuat bila maintainer lebih memilih tanpa pemrosesan pihak ketiga; dapat ditambahkan kelak sebagai mode `challenge` kedua tanpa mengubah kontrak. **Maintainer yang memutuskan; menerima ADR ini dengan jawaban berbeda hanya mengubah §7 dan adapter tantangan pada implementasi.**

### 8. Otorisasi, audit, akses baca admin

- Akses baca admin **default-deny** di balik triple izin yang di-seed (mis. `website_engagement.submission.read`), plus izin terpisah untuk `source.manage` (buat, rotasi, cabut) dan `submission.withdraw`/`purge`. Di-seed ke peran yang diputuskan owner, ditegakkan endpoint dan `requiredPermission` navigasi (jebakan berulang repo ini, menurut AGENTS.md).
- Audit (dengan redaksi): buat/rotasi/cabut source, penampakan token, pembacaan submission dengan pengenal terdekripsi, penarikan, purge. Intake publik sendiri dicatat sebagai metrik tersamarkan, bukan baris audit per request anonim.
- Entri navigasi dan halaman adminnya dikirim dalam perubahan yang sama (aturan AGENTS.md).

### 9. Urutan dan gerbang

Implementasi (migrasi 321-322 dicadangkan untuk issue ini) dimulai hanya setelah: ADR ini **Diterima**, pertanyaan §7 dijawab, dan arah ADR-0153 cukup jelas untuk mengonfirmasi §6 (atau §6 diamendemen). Lalu pemeriksaan normal: tinjauan keamanan (permukaan tulis publik tak terautentikasi), `bun run check` penuh, OpenAPI dan AsyncAPI sinkron, dokumen EN/ID, changeset, dan daftar akseptansi issue (dua domain, tiga situs dalam satu tenant, Origin palsu, duplikat, opt-out, payload berbahaya, substitusi tenant ID, lokalisasi, WCAG, RLS DB, tes 2 tenant).

## Opsi yang dipertimbangkan (rumah modul)

| Kriteria          | **A. Modul sistem baru `website_engagement` (dipilih)**                        | B. Perluas `newsletter`                                                        | C. Perluas `comments` atau `form_drafts`         | D. Bangun hanya di hilir (`awcms-one`)                    |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------- |
| Keamanan          | Satu permukaan tulis publik yang ditinjau; token/Origin/consent di satu tempat | Mencampur aturan respons netral daftar pelanggan dengan penyimpanan pertanyaan | Semantik moderasi/draf tak terkait dengan intake | Memindahkan permukaan publik dari gerbang hulu (ADR-0055) |
| Maintainability   | Sempit, dapat dilepas, satu tanggung jawab                                     | Mengaburkan definisi modul di ADR-0103                                         | Pengaburan sama, plus kopling ke tes tak terkait | Tiap produk menurunkan ulang                              |
| Performa          | Rate limit dan retensi dapat disetel sendiri                                   | Batas dan indeks bersama                                                       | Bersama                                          | Sama dengan A                                             |
| Skalabilitas      | Baris dan source, bukan antrean; outbox untuk konsumen                         | Sama, kusut                                                                    | Sama, kusut                                      | Sama dengan A                                             |
| Kompatibilitas    | Aditif; tidak aktif sampai ada source                                          | Mengubah kontrak modul yang berjalan                                           | Mengubah kontrak modul yang berjalan             | Divergen dari hulu                                        |
| Biaya operasional | Satu modul lagi, tanpa flag (tidak aktif tanpa source)                         | Permukaan baru terkecil, kopling tertinggi                                     | Seperti B                                        | Terendah di hulu                                          |

## Konsekuensi

- **Positif:** satu permukaan intake publik yang dapat ditinjau dengan provenance, consent, dan retensi diputuskan di awal; seam event stabil untuk konsumen CRM mana pun yang ditetapkan ADR-0153; tanpa mesin form kedua atau otoritas pelanggan kedua.
- **Negatif / trade-off:** satu modul lagi; endpoint tulis publik tak terautentikasi yang harus dipertahankan selamanya; token bearer yang secara alami publik, sehingga Origin, tantangan, dan rate limit harus semuanya bertahan; ketergantungan pihak ketiga bila Turnstile dipilih.
- **Netral:** tidak aktif sampai tenant membuat source; tidak mengubah modul yang ada; deployment offline/LAN tetap dapat menangkap dengan kontrol tanpa pihak ketiga.
- **Keterbatasan tercatat:** tanpa kanal penarikan publik pada irisan pertama; tanpa mode server-ke-server bertanda tangan; tanpa widget; tanpa live chat (perlu persetujuan sendiri); tanpa deduplikasi atau pencocokan orang.
- **Persetujuan manusia yang masih dibutuhkan:** penerimaan maintainer; keputusan tantangan §7; pengendali/DPO untuk teks consent, DPIA, dan jendela retensi; tinjauan keamanan saat implementasi.

## Alternatif yang ditolak

- **Mesin form kedua** yang merender dan menyimpan form sembarang: di luar cakupan, menduplikasi rendering form situs, dan memperluas permukaan validasi.
- **Memercayai header Origin saja**: klien non-browser dapat memalsukannya.
- **Mengambil tenant dari body request atau dari Host saja**: risiko substitusi yang disebut kondisi #1139; resolusi host-saja juga gagal untuk form yang di-host pihak ketiga.
- **Menyimpan IP penuh, fingerprint, atau cookie untuk "mengenali" pengunjung**: melanggar minimisasi dan aturan tanpa identitas tersimpulkan.
- **Membuat atau mencocokkan orang CRM di hulu**: ADR-0148 I7 dan pertanyaan ADR-0153.
