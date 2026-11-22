🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](dpia-hr-payroll-phase-3.md)

<!-- i18n-source-hash: sha256:d17f89a5dce69ecb5aeed3737a43c91370cadb5d440717a04c1483dcd0956c03 -->

# DPIA (DRAF) — payroll HR fase 3 (`hr_payroll`)

> **STATUS: DRAF — belum disetujui; menunggu tanda tangan pengendali data dan
> tinjauan penasihat hukum.** Ini bukan DPIA yang selesai atau disetujui. Ini
> draf yang disusun agen (keputusan pemilik K13, 22 November 2026): akuntabilitas
> menurut UU PDP (UU No. 27 Tahun 2022) tidak dapat didelegasikan ke agen,
> sehingga dokumen ini tidak punya kekuatan hukum sampai pengendali melengkapi
> bagian 7. Ini bukan nasihat hukum. **Issue #976 tetap terbuka dan #957 tetap
> terblokir** sampai dokumen ini ditandatangani.

| Bidang           | Isian                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dokumen          | DPIA tingkat platform, **dokumen (A)**, atas desain fase 3 (komentar dukungan keputusan pada #976, bagian 1)                                                                       |
| Disusun          | 22 November 2026, oleh agen AI atas kondisi repositori `main` pada commit `16c8ebcd`                                                                                               |
| Metode           | Struktur ISO/IEC 29134, dipetakan ke kewajiban penilaian dampak UU PDP. Nomor pasal hanya dikutip bila penulis yakin; rujukan lain bertuliskan "verifikasi dengan penasihat hukum" |
| Dokumen (B)      | Adendum per-deployment **tidak ditulis di sini**; templat dan gerbang go-live-nya dilacak di #1449                                                                                 |
| Cakupan          | Kompensasi, rekening pembayaran, slip gaji, data pemotongan dan iuran, jalur baca, postur retensi                                                                                  |
| Yang ada di kode | **`hr_payroll` belum punya tabel, route, atau migrasi.** Kontrol di bawah ditandai _di kode_ hanya bila ada di `main` hari ini; sisanya _didesain_ atau _direncanakan_             |

**Aturan membaca.** "Di kode" berarti berkas, tes, atau gerbang di repositori ini
yang dapat dijalankan pembaca. "Didesain" berarti diputuskan di ADR atau di
[`hr-payroll.id.md`](hr-payroll.id.md) tetapi belum dibangun. Kontrol yang
didesain bukan bukti perlindungan.

## 1. Deskripsi pemrosesan

### 1.1 Tujuan dan dasar pemrosesan

| Butir          | Pernyataan draf                                                                                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tujuan         | Membayar pegawai dan pekerja dengan benar dan tepat waktu; menghitung dan mencatat pemotongan serta iuran yang menjadi kewajiban pemberi kerja; memberi tiap orang slip gajinya sendiri; menjaga catatan yang dapat diaudit dan dikoreksi (`hr-payroll.md` 2.3, 7).                                            |
| Dasar kandidat | Hubungan kerja dan kewajiban hukum pemberi kerja (ketenagakerjaan, pajak, jaminan sosial). **Persetujuan bukan dasar yang diusulkan**: pegawai tidak bebas menolak (ADR-0138 bernalar sama). Dasar UU PDP mana yang berlaku, dan apakah suatu kategori butuh dasar lain, adalah urusan penasihat hukum (L-P2). |
| Bukan tujuan   | Penilaian kinerja, profiling, pemasaran, pelatihan AI, penjualan atau pembagian ke pihak ketiga. Tidak ada konteks AI atau Hermes yang menerima data payroll (AI hanya-baca dan tanpa konteks payroll).                                                                                                        |

### 1.2 Subjek dan kategori data

Subjek: pegawai dan pekerja sebuah tenant (tenant user yang tertaut ke sebuah
employment, ADR-0094 keputusan 1). Sumber: staf HR tenant, data fase 1
(`hr_workforce`) dan fase 2 (`hr_commission`).

| Kategori                                               | Contoh                                                | Tempat tinggal                                               | Klasifikasi (draf)                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Referensi identitas                                    | `profile_id` buram                                    | `awcms_hr_employments` (FK komposit)                         | Umum. **Tidak ada nama, NIK, NPWP, kontak, atau alamat di tabel HR mana pun** (ADR-0132 bagian 2)        |
| Kepegawaian dan kehadiran                              | nomor pegawai, terms, menit kehadiran                 | tabel `hr_workforce` (sudah mendarat)                        | Umum                                                                                                     |
| Kompensasi                                             | basis gaji, jumlah dasar, tanggal berlaku             | `awcms_hr_compensation` (didesain)                           | **Data keuangan pribadi; kemungkinan data pribadi spesifik** (lihat 1.3)                                 |
| Rekening pembayaran                                    | referensi bank atau dompet                            | `awcms_hr_payout_accounts` (didesain, ADR-0137)              | **Data keuangan pribadi; kemungkinan data pribadi spesifik**; ciphertext + hash berkunci + mask          |
| Baris run, slip gaji                                   | pendapatan, potongan, pemotongan, iuran pemberi kerja | `awcms_hr_payroll_run_lines`, `awcms_hr_payslips` (didesain) | Data keuangan pribadi                                                                                    |
| Identitas pajak yang dipakai sebuah run                | NIK, NPWP                                             | hanya `profile_identity`; di-resolve sisi server saat perlu  | Identifier pribadi; tidak pernah disalin (`hr-payroll.md` 3, 11.2)                                       |
| Akrual komisi (fase 2, sudah mendarat)                 | jumlah akrual, versi aturan, referensi sumber         | `awcms_hr_commission_accruals`                               | Data keuangan pribadi; penanda `payroll-boundary` (`sql/311`)                                            |
| Baris audit dan audit baca                             | aktor, permission, id record, hitungan                | audit log, `awcms_sensitive_read_windows` (`sql/224`)        | Hanya id dan hitungan, secara konstruksi                                                                 |
| Bukti kesehatan, biometrik, geolokasi, foto, perangkat | tidak dikumpulkan payroll                             | bukan fase 3                                                 | Di luar cakupan; bukti kehadiran geolokasi adalah ADR-0138 (DPIA per tenant sendiri, jangan diduplikasi) |

### 1.3 Data pribadi spesifik

UU PDP membedakan data pribadi umum dari **spesifik** dan mencantumkan **data
keuangan pribadi** di antara kategori spesifik (Pasal 4; **verifikasi dengan
penasihat hukum**, sebagaimana diminta komentar dukungan keputusan pada #976).
`hr-payroll.md` 13.2 hanya menyebut kesehatan, biometrik, dan geolokasi sebagai
data spesifik dan tidak menyebut data keuangan: **bila penasihat hukum
mengonfirmasi, bagian 13.2 harus dikoreksi** (koreksi itu bagian dari daftar
periksa di bagian 7, butir 9). Sebelum dikonfirmasi, draf ini memperlakukan
gaji, rekening pembayaran, dan data pemotongan sebagai data pribadi spesifik,
pembacaan yang berhati-hati. Memproses data pribadi spesifik adalah salah satu
indikator risiko tinggi yang mewajibkan penilaian dampak (Pasal 34; verifikasi).

### 1.4 Pemeriksaan indikator risiko tinggi Pasal 34 (untuk dikonfirmasi DPO)

| Indikator                                     | Fase 3             | Catatan                                                              |
| --------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| Keputusan otomatis berdampak hukum signifikan | Kemungkinan tidak  | Perhitungan deterministik dan disetujui manusia (SoD, ADR-0132/0136) |
| Data pribadi spesifik                         | **Kemungkinan ya** | Data keuangan pribadi (1.3)                                          |
| Skala besar                                   | Tergantung tenant  | Adendum per-deployment (#1449)                                       |
| Evaluasi atau pemantauan sistematis           | Mungkin            | Menit kehadiran masuk ke gaji; tanpa skor (`workforce-metrics.md`)   |
| Mencocokkan atau menggabungkan dataset        | Mungkin            | HR + komisi + payroll terhubung lewat id employment secara desain    |
| Teknologi baru                                | Tidak              | Komponen standar                                                     |
| Pembatasan hak subjek data                    | Mungkin            | Penghapusan dibatasi retensi (2.4)                                   |

Kesimpulan draf: **DPIA diperlukan**, bukan opsional.

### 1.5 Peran: pengendali dan prosesor (O5 tetap terbuka)

Keputusan pemilik O5 (apakah operator platform pengendali, prosesor, atau
keduanya, **per deployment**) **masih terbuka** (`hr-payroll.md` 16). Asumsi
draf, hanya untuk dibahas: tiap **tenant** adalah pengendali data pegawainya
(penalaran ADR-0094 keputusan 1 dan ADR-0138); **operator** adalah prosesor
untuk data payroll tenant dan dapat menjadi pengendali untuk data akun,
keamanan, dan auditnya sendiri. Konsekuensi yang menunggu O5: siapa menjawab
permintaan subjek, siapa menandatangani ketentuan pemrosesan, siapa memberi
notifikasi pelanggaran, siapa memegang adendum per-deployment. Dilacak di
#1449. Draf ini tidak memutuskan O5.

Pihak lain: penyedia hosting dan backup (sub-prosesor; posisi lintas negara,
bagian 3.4); tidak ada payment provider, berkas bank, atau transfer keluar
nomor rekening yang ada atau diputuskan (ADR-0137 bagian 7: issue lanjutan,
lewat outbox, tidak pernah di dalam transaksi).

### 1.6 Aliran data (diagram teks)

```
Pegawai / staf HR  --TLS-->  Astro + API (role awcms_app, konteks tenant diset)
                                   |  authorizeInTransaction (RBAC+ABAC default-deny, step-up bila terdaftar)
                                   v
                       PostgreSQL (FORCE RLS per tenant; tabel payroll hanya di-grant ke awcms_app)
                         |            |                     |
                         |            |                     +--> backup (terenkripsi, ADR-0123; kunci rekening di luar DB dan backup)
                         |            +--> audit log: id, hitungan, nama permission (tanpa jumlah)
                         +--> outbox domain-event: id/jenis/hitungan (tanpa jumlah, tanpa nama)
                                   |
                                   +--> NOTIFIKASI slip gaji lewat email/push: tanpa jumlah (hr-payroll.md 11)
Jalur turunan DILARANG: proyeksi reporting, pencarian situs, komentar, edge cache,
ekspor laporan, konteks AI/Hermes, sync ke node offline, role worker (awcms_worker).
```

Nomor rekening hanya didekripsi di memori oleh reveal yang diaudit (ADR-0137
bagian 4); tidak ada berkas bank atau panggilan provider.

## 2. Kebutuhan dan proporsionalitas

### 2.1 Minimisasi (di kode atau didesain)

- Tidak ada field identitas di tabel HR mana pun; NIK dan NPWP tetap di
  `profile_identity` (didesain, ADR-0132 bagian 2; tabel fase 1 di kode
  mengikutinya).
- Tidak ada alasan kesehatan (jenis time-off kasar), tidak ada bukti foto,
  biometrik, atau perangkat selamanya (O6); geolokasi hanya-verdict, mati secara
  default (ADR-0138, diimplementasikan #970, `sql/306`).
- Event, baris audit, dan notifikasi slip gaji membawa id, jenis, dan hitungan,
  tidak pernah jumlah (`hr-payroll.md` 10, 11.3).
- Batas payroll mencegah salinan kedua yang lebih lebar: tidak ada proyeksi,
  indeks pencarian, komentar, entri cache, atau ekspor atas tabel payroll
  (`payroll-data-boundary.ts`, bagian 4).

### 2.2 Akurasi

Versi kompensasi berlaku-efektif dan append-only; versi aturan tidak dapat
diubah setelah terbit; run final tidak dapat diubah dan dikoreksi dengan
pembalikan (`hr-payroll.md` 7.1 sampai 7.4, didesain). Membaca kehadiran dan
komisi sebagai snapshot pada baris berarti koreksi belakangan mengalir ke
periode berikutnya. Risiko salah transkripsi aturan tetap ada (R-15).

### 2.3 Retensi

**Tidak ada periode wajib menurut undang-undang yang ditegaskan di mana pun di
repositori.** Postur hari ini: riwayat kehadiran dan shift fase 1 dibatasi
descriptor `data_lifecycle`; baris keuangan (akrual, dan baris fase 3 yang
direncanakan) disimpan selama umur tenant, dan `hr_commission` sengaja tidak
mendeklarasikan descriptor retensi untuknya karena tidak ada yang akan benar
(`src/modules/hr-commission/module.ts`; entri `BOUNDED_BY_DESIGN` beralasan untuk
`awcms_hr_commission_accruals` dan `_transitions` di
`scripts/data-lifecycle-table-coverage-check.ts`). Penasihat hukum harus
menetapkan periode per kelas record dan memutuskan apakah rute purge harus ada
sebelum run pertama (L-P5, L-P6). Risiko residual R-07, #1447.

### 2.4 Hak subjek data

| Hak                     | Cara fase 3 menjawabnya                                                                                                                                                                                                                                                                   | Status                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Akses, portabilitas     | Ekspor `subject-data`, dijawab **per tenant** (ADR-0094 keputusan 1) dengan nilai bermask; tabel batas payroll diekspor di balik gerbangnya sendiri dan laporan tersimpan ekspor hanya menyimpan id dan penanda, tidak pernah penghasilan (#1018, `tests/subject-export-payroll.test.ts`) | Di kode untuk kerangkanya; descriptor fase 3 didesain |
| Rektifikasi             | Menambah versi berlaku-efektif baru atau membalik run; riwayat tidak diedit sehingga jejak audit tetap sah; slip gaji yang imutabel tidak ditulis ulang (L-C2)                                                                                                                            | Didesain; penasihat hukum mengonfirmasi L-C2          |
| Penghapusan             | Dibatasi retensi hukum: profil di-**anonimkan**, baris HR dan payroll tetap dan di-resolve ke profil teranonim (ADR-0094 keputusan 2, `retain_under_obligation`); penghapusan maker/checker dan diaudit `critical` (ADR-0094 keputusan 3). Backup kedaluwarsa dengan sendirinya (L-P8)    | Kerangka di kode; postur untuk penasihat hukum (L-P7) |
| Keberatan, pembatasan   | Proses ditetapkan pengendali; tidak ada saklar teknis untuk payroll                                                                                                                                                                                                                       | Terbuka: adendum (B), #1449                           |
| Pemberitahuan ke subjek | Pemberitahuan pegawai tentang tujuan, kategori, retensi, hak: kecukupan untuk penasihat hukum (L-P11)                                                                                                                                                                                     | Terbuka: #1449                                        |

## 3. Penilaian risiko

### 3.1 Skala

Kemungkinan L dan dampak I masing-masing 1 (jarang / kecil) sampai 5 (hampir
pasti / bahaya berat bagi seseorang: penipuan, diskriminasi, kehilangan
penghidupan, terbukanya posisi keuangan). **Skor = L x I.** 1-5 rendah, 6-11
sedang, 12-19 tinggi, 20-25 kritis. Skala dan setiap skor adalah **usulan draf**
penulis; DPO menetapkan skala dan dapat mengubah skor mana pun. "Inheren"
mengasumsikan desain fase 3 persis seperti tertulis tetapi **tanpa kontrol
dibangun**; "residual" mengasumsikan kontrol bertanda _di kode_ ditambah kontrol
_didesain_ yang diimplementasikan sebagaimana tertulis.

### 3.2 Register risiko

| Id   | Risiko                                                                                                                                                           | Inheren L x I | Residual L x I | Perlakuan                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------- | -------------------------------------------------------------------- |
| R-01 | Pembacaan kompensasi atau baris tanpa wewenang oleh pemegang permission baca yang lebar (PS-06, PS-18)                                                           | 4 x 5 = 20    | 2 x 5 = 10     | Mitigasi (4.1, 4.2); pemisahan PS-06 belum didesain                  |
| R-02 | Akses lintas tenant ke data gaji                                                                                                                                 | 2 x 5 = 10    | 1 x 5 = 5      | Mitigasi (RLS, 4.1)                                                  |
| R-03 | Kecurangan orang dalam: penerima gaji menyetujui gajinya sendiri, menghitung dan membayar sendirian, menukar rekening sebelum bayar (PS-01, PS-02, PS-03, PS-12) | 3 x 5 = 15    | 2 x 5 = 10     | Mitigasi (SoD didesain; belum dibangun)                              |
| R-04 | Jejak audit tidak lengkap atau dapat dirusak; pemanenan massal lewat reveal atau pembacaan berhalaman                                                            | 3 x 4 = 12    | 2 x 4 = 8      | Mitigasi (4.2)                                                       |
| R-05 | Job tanpa pengawasan atau role worker menjangkau data payroll                                                                                                    | 3 x 5 = 15    | 1 x 5 = 5      | Mitigasi (4.1)                                                       |
| R-06 | Gaji tersalin ke permukaan turunan: proyeksi, pencarian, komentar, cache, ekspor, injeksi formula CSV                                                            | 3 x 5 = 15    | 2 x 5 = 10     | Mitigasi (4.1); residual #1095                                       |
| R-07 | Retensi lebih lama dari yang sah, atau tidak ada rute purge (PS-17)                                                                                              | 4 x 3 = 12    | 4 x 3 = 12     | **Terbuka: #1447**                                                   |
| R-08 | Body respons penuh tersimpan di `awcms_idempotency_keys` selama jendela retensi memuat penghasilan                                                               | 3 x 4 = 12    | 3 x 4 = 12     | **Terbuka: #1450** (komisi dimask, PR #1439 dalam tinjauan)          |
| R-09 | Uang, nomor rekening, atau identifier di log, pesan error, baris audit, event                                                                                    | 3 x 4 = 12    | 3 x 4 = 12     | **Terbuka: #1450** (tes canary fase 3)                               |
| R-10 | Respons mutasi mengembalikan penghasilan ke pemanggil yang hanya butuh pengakuan                                                                                 | 3 x 4 = 12    | 3 x 4 = 12     | **Terbuka: #1450** (komisi: PR #1439)                                |
| R-11 | Staf operator (platform atau hosting) mengakses data payroll tenant tanpa ketentuan yang jelas; O5 belum diputuskan                                              | 3 x 5 = 15    | 3 x 5 = 15     | **Terbuka: #1449**                                                   |
| R-12 | Pelanggaran data payroll tidak terdeteksi atau tidak diberitahukan dalam periode yang diwajibkan                                                                 | 3 x 5 = 15    | 3 x 5 = 15     | **Terbuka: #1448**                                                   |
| R-13 | Pemrosesan lintas negara oleh penyedia hosting atau backup tanpa posisi transfer yang sah (L-P10)                                                                | 3 x 4 = 12    | 3 x 4 = 12     | **Terbuka: #1449** (adendum B)                                       |
| R-14 | Kehilangan atau pencurian backup berisi rekening; restore tanpa kunci; hilangnya key ring membuat rekening tak terbaca                                           | 3 x 5 = 15    | 2 x 5 = 10     | Mitigasi (4.1, ADR-0137 bagian 6); drill #968                        |
| R-15 | Perhitungan keliru merugikan pegawai (kesalahan data aturan, pembulatan, mata uang tak cocok; PS-07 sampai PS-09)                                                | 3 x 4 = 12    | 2 x 4 = 8      | Mitigasi (didesain); penasihat hukum L-A, L-D                        |
| R-16 | Permintaan subjek tertangani keliru (penghapusan vs retensi; dijawab per tenant; slip gaji tidak ditulis ulang)                                                  | 3 x 3 = 9     | 2 x 3 = 6      | Mitigasi (2.4); L-P7                                                 |
| R-17 | Celah residual batas payroll, residual #1095 nomor 1 sampai 7 ("dipersempit, belum ditutup")                                                                     | 2 x 5 = 10    | 2 x 5 = 10     | **Diterima dengan tinjauan**, dilacak di #1095 dan #1436 (lihat 5.2) |

Skor residual yang bertumpu pada kontrol _didesain_ bersifat bersyarat: bila
kontrol tidak dibangun sebagaimana tertulis, residual sama dengan skor inheren.
R-07, R-08, R-09, R-10, R-11, R-12, dan R-13 **belum punya pengurangan residual**
dan adalah risiko yang harus punya perlakuan yang diterima pengendali sebelum
go-live.

## 4. Kontrol

### 4.1 Kontrol di kode hari ini (diverifikasi di `main`, 22 November 2026)

| Kontrol                                                              | Bukti                                                                                                                                                                                                                                                              | Risiko           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Permukaan turunan terlarang untuk tabel dan event payroll            | `src/modules/_shared/payroll-data-boundary.ts` (satu daftar; ditegakkan registry reporting, site-search, comments, edge-cache dan ekspor laporan); `tests/payroll-data-boundary.test.ts`                                                                           | R-06, R-01       |
| Hanya role request yang boleh menyentuh tabel keluarga payroll       | `PAYROLL_ALLOWED_GRANTEES = ["awcms_app"]` di `payroll-data-boundary.ts`; dicek `bun run payroll:sql-boundary:check` (migrasi) dan `bun run payroll:catalog-boundary:check` (katalog); penanda batas `sql/311`                                                     | R-05, R-17       |
| Tabel payroll dipaksa masuk batas menurut nama dan penanda           | `scripts/lib/payroll-catalog-boundary.ts`; `tests/payroll-catalog-boundary.test.ts`, `tests/payroll-catalog-boundary-1077.test.ts`, `tests/payroll-name-exceptions-1276.test.ts`                                                                                   | R-17             |
| Audit baca sensitif, fail-closed, sadar-laju, hanya id dan hitungan  | `src/modules/logging/application/sensitive-read-audit.ts`, penghitung jendela `sql/224`, `tests/integration/sensitive-read-audit.integration.test.ts`; fixture route fail-closed `tests/fixtures/sensitive-read-fail-closed.ts` (`expectAuditFailureYieldsNoData`) | R-01, R-04       |
| Gerbang bahwa guard pada permission sensitif memanggil audit         | `bun run sensitive-reads:check` (`src/modules/_shared/sensitive-reads.ts`, default-deny atas setiap aksi non-tulis modul sensitif, dengan alasan `NOT_SENSITIVE_READS`)                                                                                            | R-01, R-04       |
| Ekspor subjek tidak pernah menyimpan penghasilan di cache replay     | `tests/subject-export-payroll.test.ts` (Issue #1018)                                                                                                                                                                                                               | R-08, R-16       |
| Idempotency key dipurge terjadwal                                    | descriptor `domain_event_runtime.idempotency_keys` di `src/modules/domain-event-runtime/module.ts` (default 30 hari, batas bawah 7, atas 90), grant di `sql/276`                                                                                                   | R-08 (membatasi) |
| Netralisasi formula CSV untuk setiap penulis CSV                     | `src/lib/security/csv-formula.ts`, pemindaian struktural `tests/csv-formula-neutralisation.test.ts`                                                                                                                                                                | R-06             |
| Primitif enkripsi field untuk rekening pembayaran                    | `src/lib/security/field-encryption.ts` (AES-256-GCM, key ring, AAD berawalan panjang atas purpose, tenant, dan id baris; ring hash berkunci terpisah; catatan implementasi ADR-0137). **Tabel rekening yang memakainya belum ada.**                                | R-14 (sebagian)  |
| Isolasi tenant: FORCE RLS, FK komposit, pemisahan role               | policy RLS di `sql/` dan `bun run security:readiness` (readiness mem-pin policy dan role menurut ekspresi kanonik); `tests/security-readiness-rls.test.ts`. Berlaku untuk tabel fase 1 dan 2 di kode                                                               | R-02             |
| Cakupan subject-data dan lifecycle per tabel, digerbangi             | descriptor `subjectData` dan `dataLifecycle` (misalnya `src/modules/hr-commission/module.ts`), gerbang cakupan `bun run data-lifecycle:table-coverage:check` (ADR-0094; PS-17 mewajibkan satu per tabel fase 3 di migrasinya)                                      | R-16, R-07       |
| Bukti geolokasi mati default, hanya-verdict, DPIA per tenant sendiri | ADR-0138, `sql/306` (tidak diduplikasi di sini)                                                                                                                                                                                                                    | cakupan          |
| Step-up bila faktor MFA terdaftar                                    | `requireStepUp` (`mfa-session-assurance.ts`), diterapkan pada aksi sensitif oleh ADR-0141 bagian 4. Tidak tanpa syarat: pemegang tanpa faktor terdaftar tidak dihentikan (PS-13)                                                                                   | R-03, R-04       |

### 4.2 Kontrol didesain, belum dibangun (belum dihitung sebagai perlindungan)

| Kontrol                                                                                                                                                          | Diputuskan di                                                 | Dibutuhkan untuk | Risiko       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------- | ------------ |
| Rekening: ciphertext, HMAC berkunci, mask, reveal diaudit (`warning`), step-up bersyarat                                                                         | ADR-0137, ADR-0141; #959                                      | #959             | R-01, R-14   |
| SoD hitung / setujui / bayar di database, dapat dikonfigurasi per tenant; penerima gaji tidak pernah aktor (PS-01)                                               | ADR-0132, ADR-0136; `hr-payroll.md` 7.5                       | #957, #960       | R-03         |
| Persetujuan terikat pada perhitungan yang ditinjau (`calculation_revision`, `totals_digest`, PS-03)                                                              | `hr-payroll.md` 7.5, 9                                        | #957, #960       | R-03         |
| Pembalikan run yang sudah dibayar dan pemulihan tanpa pembayaran ganda (PS-02)                                                                                   | ADR-0136 Amandemen A1 (**Proposed**) dan penasihat hukum L-C3 | #957             | R-03, R-15   |
| Permission baca terpisah: total tanpa baris per pegawai (PS-06). **Baru temuan: 11.1 masih mencantumkan satu `runs.read`; pemisahannya belum ditulis ke desain** | `hr-payroll.md` 17.2 (PS-06)                                  | #957, #961       | R-01         |
| Run final imutabel, kunci periode, koreksi hanya lewat pembalikan                                                                                                | `hr-payroll.md` 7.2, 7.4                                      | #957, #960       | R-03, R-15   |
| Versi aturan imutabel, maker/checker, sitasi wajib (PS-07 sampai PS-09)                                                                                          | `hr-payroll.md` 7.3                                           | #958             | R-15         |
| Tautan pemilik slip gaji dijaga (self-link ditolak, re-link diaudit; PS-14)                                                                                      | `hr-payroll.md` 7.5, 9                                        | #957, #961       | R-01         |
| Batas run besar, paginasi (PS-16)                                                                                                                                | `hr-payroll.md` 14                                            | #960             | ketersediaan |
| Drill backup dan restore termasuk restore tanpa key ring                                                                                                         | #968; ADR-0137 bagian 6; ADR-0123                             | #968             | R-14         |

### 4.3 Direncanakan dalam tinjauan

PR #1439 (terbuka, **belum di `main`**, sehingga tidak dihitung di 4.1)
memask hasil mutasi akrual komisi dengan tanda terima allow-list, menyimpan body
bermask di baris idempotency, dan menambah job batas-katalog harian di bawah role
khusus tanpa hak istimewa. Setelah digabung, ia menurunkan R-08 dan R-10
**hanya untuk `hr_commission`** dan memperkuat R-17. `hr_payroll` masih butuh
pola yang sama (#1450).

## 5. Risiko residual

### 5.1 Risiko residual beserta issue-nya

| Risiko                                                                 | Issue                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| R-07 retensi dan rute purge                                            | **#1447** (baru)                                                                            |
| R-12 notifikasi pelanggaran                                            | **#1448** (baru)                                                                            |
| R-11 akses operator dan O5; R-13 transfer; adendum (B) dan gerbangnya  | **#1449** (baru)                                                                            |
| R-08, R-09, R-10 body tersimpan, log, tanda terima mutasi `hr_payroll` | **#1450** (baru)                                                                            |
| R-14 backup, restore, penyimpanan kunci                                | #968 (sudah ada)                                                                            |
| R-03 kecurangan orang dalam (PS-01 sampai PS-03, PS-12), R-01 (PS-06)  | #957, #959, #960 (sudah ada, terblokir DPIA ini); ADR-0136 Amandemen A1 menunggu maintainer |
| R-15 kesalahan data aturan                                             | #958; daftar periksa penasihat hukum 17.3 A dan D                                           |
| R-16 permintaan subjek                                                 | penasihat hukum L-P7, L-C2; jawaban per tenant sudah di kode (ADR-0094)                     |
| R-17 residual batas payroll                                            | #1095 dan #1436 (lihat 5.2)                                                                 |

### 5.2 Residual #1095 nomor 1 sampai 7, dinyatakan ulang sebagai risiko privasi

Batas (pemindaian migrasi statis plus pemeriksaan katalog) adalah **pertahanan
berlapis terhadap kebocoran yang tidak disengaja atau kasatmata**; tinjauan
migrasi (CODEOWNERS plus tinjauan keamanan untuk `sql/` yang menyentuh payroll)
adalah kontrol utama. Residual itu "dipersempit, belum ditutup" dan untuk draf
ini **diterima dengan tinjauan**, bukan diterima sebagai tertutup:

1. Migrasi yang sudah ditinjau masih dapat membangun ulang tabel payroll di balik
   konstruksi yang tidak dimodelkan; lapisan katalog mendeteksi sisanya tetapi
   tidak mencegahnya.
2. Daftar helper terbatas: fungsi tak terdaftar yang menjalankan teks query
   adalah lubang sampai didaftarkan.
3. Tabel non-keluarga dengan RLS mati dan grant ke `awcms_worker` atau `PUBLIC`
   hanya ditandai bila menyerupai tabel payroll (kemiripan kolom 70%, minimal 5
   kolom).
4. Pembangunan ulang yang mengubah lebih dari 30% kolom ledger lolos dari
   pemeriksaan menyerupai.
5. Di luar cakupan secara desain: slot replikasi logis tidak dibaca; superuser
   dipercaya menurut definisi.
6. Anggota extension tidak dibaca; hanya `ALTER EXTENSION ... ADD` yang ditolak.
7. Batas dead-branch pada pemeriksaan pemanggilan audit tidak berubah.

Pelacakan: #1095 tetap terbuka untuk ini; arah dari pemindaian deny-list ke
allow-list adalah #1436. PR #1439 menambah pemeriksaan katalog terjadwal dan
merupakan keputusan pemilik K3 atas dua keputusan terbuka #1095. Peninjau DPIA
perlu mencatat bahwa residual 5 dan 6 melekat (mempercayai pemilik database dan
superuser) dan masuk ke risiko akses operator R-11, yang tidak dapat ditutup
pemindai mana pun.

## 6. Konsultasi

| Siapa                                          | Tujuan                                                                                                                                                                                                                   | Status                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Pejabat pelindungan data (atau orang ditunjuk) | Menetapkan skala, mengonfirmasi skor, menjawab pemeriksaan risiko tinggi (1.4), mengonfirmasi kewajiban DPO                                                                                                              | **Belum dikonsultasikan** (L-P10)                    |
| Penasihat hukum                                | Daftar periksa hukum `hr-payroll.md` 17.3 (A sampai E), data keuangan sebagai data spesifik (L-P3), retensi (L-P5, L-P6), penghapusan (L-P7), backup (L-P8), pelanggaran (L-P9), transfer (L-P10), pemberitahuan (L-P11) | **Belum dikonsultasikan**; blok sign-off 17.4 kosong |
| Pegawai atau perwakilannya                     | Bila pengendali memutuskan patut (ISO/IEC 29134)                                                                                                                                                                         | Keputusan pengendali                                 |
| Keamanan                                       | Tinjauan independen register ini terhadap kode                                                                                                                                                                           | Disarankan sebelum tanda tangan                      |

Lokasi bukti: repositori ini (`docs/awcms/`) kecuali penasihat hukum memilih
lokasi privat; bila privat, catat hash dan rujukannya di `hr-payroll.md` 17.4.

## 7. Keputusan dan tanda tangan (sengaja dikosongkan)

**Belum selesai, belum disetujui.** Pengendali dapat menyetujui, menyetujui
dengan syarat, atau tidak menyetujui. Siklus tinjau yang diusulkan: pada setiap
perubahan kategori data, prosesor baru, profil yurisdiksi baru, pelanggaran, atau
minimal setahun sekali.

| Bidang                                                              | Isian |
| ------------------------------------------------------------------- | ----- |
| Nama perwakilan pengendali data                                     |       |
| Jabatan                                                             |       |
| Tanggal                                                             |       |
| Keputusan (disetujui / disetujui dengan syarat / tidak disetujui)   |       |
| Syarat atau perubahan yang diperlukan (masing-masing menjadi issue) |       |
| Risiko residual yang diterima (daftar id)                           |       |
| Nama dan jabatan DPO atau penasihat yang dikonsultasikan            |       |
| Nama penasihat hukum yang meninjau                                  |       |
| Tanda tangan                                                        |       |

Daftar periksa (dari komentar dukungan keputusan pada #976), tidak ada yang dijawab draf ini:

- [ ] O5 diputuskan untuk deployment acuan (#1449).
- [ ] Dasar hukum per kategori (L-P2); klasifikasi data keuangan (L-P3).
- [ ] Retensi dalam tahun per kelas record (L-P5); archive-then-purge diterima atau rute purge diwajibkan (L-P6) (#1447).
- [ ] Postur penghapusan (L-P7) dan backup (L-P8) diterima.
- [ ] Kewajiban, periode, dan pemberi notifikasi pelanggaran (L-P9) (#1448).
- [ ] Lokasi hosting, posisi lintas negara, kewajiban DPO (L-P10).
- [ ] Pemberitahuan pegawai memadai (L-P11).
- [ ] DPIA ini ditandatangani; risiko residual di atas diterima atau ditangani.
- [ ] Lokasi bukti dicatat di `hr-payroll.md` 17.4.
- [ ] Templat adendum per-deployment diterbitkan dan dijadikan gerbang go-live (#1449).
- [ ] `hr-payroll.md` 13.2 dikoreksi bila penasihat hukum mengonfirmasi data keuangan adalah data spesifik.
- [ ] Penasihat hukum mengonfirmasi bahwa memperlakukan DPIA sebagai dokumen (A) plus adendum per-deployment (B) memenuhi maksud undang-undang; bila tidak, gerbang di #957 tetap seperti tertulis.

## 8. Sumber

[`hr-payroll.id.md`](hr-payroll.id.md) (2.3, 7, 10, 11, 13.2, 13.3, 16 O5, 17 PS-04 dan
daftar periksa 17.3); ADR-0132, ADR-0136, ADR-0137, ADR-0138 (DPIA geolokasi per
tenant, tidak diduplikasi), ADR-0141, ADR-0094, ADR-0123; Issue #976 dan komentar
dukungan keputusannya; PR #1439 dan Issue #1095. Nomor pasal UU PDP: verifikasi
terhadap teks resmi di JDIH bersama penasihat hukum.
