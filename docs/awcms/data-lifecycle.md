# Data Lifecycle — panduan operasional dan kepatuhan

> **Status dokumen (AWCMS, tahap foundation-rebuild).** Modul
> `data_lifecycle` di bawah adalah mekanisme generik yang pada base
> `awcms-mini` sudah diimplementasikan penuh (registry descriptor, mesin
> dry-run/archive/purge, legal hold, job terjadwal, test integrasi
> lengkap). Di AWCMS, **belum ada implementasi kode untuk modul ini**, dan
> belum ada satu pun descriptor tabel bervolume tinggi terdaftar karena
> belum ada modul ERP yang menghasilkan tabel semacam itu. Dokumen ini
> menjelaskan **target arsitektur dan kontrak** yang akan diporting dan
> diperluas dengan descriptor ERP begitu modul finance/inventory/HR-
> payroll dibangun. Baca klaim "sudah terdaftar"/"sudah berjalan" sebagai
> spesifikasi target, bukan status implementasi hari ini.
>
> **Catatan retensi khusus ERP.** Data finansial dan payroll pada platform
> ERP umumnya tunduk pada periode retensi hukum/pajak yang jauh lebih
> ketat dan lebih panjang daripada retensi konten CMS (mis. kewajiban
> penyimpanan bukti transaksi/pajak/pembukuan sesuai UU KUP dan peraturan
> perpajakan terkait, umumnya bertahun-tahun, seringkali melebihi retensi
> tipikal 1-5 tahun untuk log audit keamanan). Setiap descriptor untuk
> tabel finance/payroll (ledger entries, payroll records, tax invoice)
> WAJIB meninjau kebutuhan retensi legal/kontraktual aktualnya sendiri
> sebelum menetapkan `retentionMinDays`/`retentionMaxDays` — jangan
> mewarisi begitu saja angka retensi CMS/telemetry generik dari base.

Modul `data_lifecycle` (`type: "system"`) — registry tabel
bervolume tinggi kontribusi-modul dan mesin lifecycle aman (retensi,
partisi, arsip, legal hold, purge). Dokumen ini fokus pada panduan
operasional dan pemetaan kepatuhan; detail teknis lengkap akan ada di
`src/modules/data-lifecycle/README.md` begitu modul ini diimplementasikan.

## Ringkasan modul

Base teknis AWCMS (`awcms-mini`) sudah punya pola beberapa job retensi/
purge spesifik-resource (audit log purge, analytics purge, form-draft
purge) yang masing-masing mengimplementasikan retensi/batching/audit
sendiri-sendiri. `data_lifecycle` menambah **registry kontribusi-modul**
(kontrak statis kode yang dideklarasikan tiap modul pemilik tentang tabel
bervolume tingginya sendiri) plus **mesin lifecycle aman** (dry-run
planning, bounded archive/purge, legal hold) yang beroperasi lewat
kontrak itu — tidak pernah langsung ke skema modul lain ("no shared-table
write").

## Registry descriptor (target, contoh ERP)

Setiap modul pemilik mendeklarasikan `HighVolumeTableDescriptor` di
`module.ts`-nya sendiri (`dataLifecycle` array,
`src/modules/_shared/module-contract.ts`) — nama tabel, kolom
tenant/cursor, kelas retensi + batas aman, kelayakan partisi, kebijakan
arsip, perilaku deletion, keberlakuan legal hold, index wajib, batas
batch, dan mode eksekusi (`"delegated"` — adopter mekanisme yang sudah
ada; atau `"generic"` — dieksekusi langsung oleh mesin ini). Divalidasi
`bun run data-lifecycle:registry:check` (bagian `bun run check`) dan
`security:readiness`'s `checkDataLifecycleRegistryValid`.

Descriptor di bawah adalah **contoh target ERP** (belum terdaftar di
kode — belum ada modul finance/inventory/HR-payroll):

| Descriptor key                       | Tabel                            | Owner               | Mode        | Kelas retensi            |
| ------------------------------------- | --------------------------------- | -------------------- | ----------- | -------------------------- |
| `logging.audit_events`               | `awcms_audit_events`        | `logging`           | `delegated` | `audit_security`         |
| `finance.ledger_entries`             | `awcms_ledger_entries`      | `finance`           | `delegated` | `financial_record`       |
| `hr_payroll.payroll_records`         | `awcms_payroll_records`     | `hr_payroll`        | `delegated` | `payroll_record`          |
| `integration.webhook_delivery_events`| `awcms_webhook_delivery_events` | `integration`   | `delegated` | `operational_telemetry`  |
| `data_lifecycle.data_lifecycle_runs` | `awcms_data_lifecycle_runs` | `data_lifecycle`    | `generic`   | `operational_queue`      |

## Retensi data (per descriptor)

Prinsip: **tidak ada satu periode retensi legal universal** — setiap
descriptor mendeklarasikan kelas retensi dan batas amannya sendiri,
dipetakan ke kebutuhan bisnis/kepatuhan tabel itu spesifik, bukan angka
generik yang dipaksakan ke semua data. Untuk AWCMS, ini berarti kelas
`financial_record`/`payroll_record` HARUS ditinjau terhadap kewajiban
retensi pajak/pembukuan aktual (lihat catatan di atas), bukan sekadar
disalin dari kelas `audit_security`/`analytics_telemetry` warisan base.

| Descriptor                            | Default (ilustratif)  | Batas aman (min–max, ilustratif) | Rasional                                                                                                                           |
| --------------------------------------- | ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `logging.audit_events`                | 730 hari                | 365–1825 hari                       | Security/audit log: 1–5 tahun sesuai kebutuhan — titik tengah rentang                                                              |
| `finance.ledger_entries`              | **belum ditetapkan**    | **wajib review legal/pajak**         | Kewajiban penyimpanan bukti pembukuan/transaksi finansial biasanya jauh melebihi retensi audit log teknis — jangan default ke angka generik base |
| `hr_payroll.payroll_records`          | **belum ditetapkan**    | **wajib review legal/ketenagakerjaan** | Kewajiban retensi data gaji/ketenagakerjaan bervariasi per yurisdiksi/kontrak — perlu keputusan eksplisit, bukan warisan default    |
| `integration.webhook_delivery_events` | 90 hari                 | 7–730 hari                          | Telemetry integrasi eksternal (payment gateway/marketplace/logistik) — retensi jauh lebih pendek dari data finansial itu sendiri    |
| `data_lifecycle.data_lifecycle_runs`  | 180 hari                | 30–1825 hari                        | Riwayat eksekusi lifecycle ITU SENDIRI adalah bukti kepatuhan (ISO 27001/22301) — retensi menengah, diarsipkan sebelum purge fisik |

`retentionDaysOverride` (dry-run on-demand, `POST
/api/v1/data-lifecycle/dry-run`) selalu di-clamp ke `[retentionMinDays,
retentionMaxDays]` descriptor — operator tidak bisa memaksa retensi di
luar batas aman yang dideklarasikan pemilik tabel, dan **legal hold
tetap menang** di atas override apa pun (lihat §Legal hold).

## Legal hold

`awcms_data_lifecycle_legal_holds` (RLS FORCE, tenant-scoped).
Field: `descriptorKey` (nullable = tenant-wide), `scopeDescription`,
`reason` (wajib, minimum 10 karakter), `authorityReference` (wajib —
nomor surat pengadilan/regulator/otoritas pajak), `authorityMetadata`
(jsonb, non-secret), `status` (`active`/`released`), `startsAt`/`endsAt`
(informational — `endsAt` TIDAK otomatis melepas hold, lihat di bawah),
`requestedBy`/`approvedBy`, `releasedBy`/`releasedAt`/`releaseReason`.

**Precedence tidak bisa dilewati**: hold aktif (tenant-wide atau
menyasar descriptor spesifik) membuat SEMUA baris eligible pada
descriptor itu dilaporkan `held`, bukan `purgeable` — dicek di
`planLifecycleDryRun` SEBELUM cabang archive/purge apa pun, dan
`retentionDaysOverride` agresif sekalipun tidak bisa membuka jalan
purge. Field `legalHold.applicable` pada descriptor adalah metadata
dokumentasi murni (apakah kelas data ini masuk akal untuk di-hold) —
**bukan** gerbang teknis; hold record nyata selalu berlaku terlepas dari
nilai field itu (mencegah modul pemilik mendeklarasikan tabelnya sendiri
"tidak berlaku hold" untuk menghindar). Untuk data finansial/payroll,
legal hold ini adalah mekanisme yang relevan saat ada audit pajak atau
sengketa ketenagakerjaan yang mewajibkan preservasi data melebihi
retensi rutin.

**Default-deny release**: `data_lifecycle.legal_hold.create` dan
`data_lifecycle.legal_hold.release` adalah permission TERPISAH — role
yang bisa membuat hold tidak otomatis bisa melepasnya. Release wajib
`releaseReason` (≥10 karakter), permission eksplisit, `Idempotency-Key`,
dan audit `critical`. Hold yang `endsAt`-nya sudah lewat TETAP `active`
sampai ada aksi release eksplisit — mencegah hold "kedaluwarsa diam-diam"
saat data yang dilindungi masih relevan secara hukum.

## Dry-run lifecycle planning

`GET /api/v1/data-lifecycle/registry` (daftar descriptor) →
`POST /api/v1/data-lifecycle/dry-run` (`{ descriptorKey,
retentionDaysOverride? }`) — murni `SELECT count(*)`, tanpa mutasi sama
sekali, tanpa `Idempotency-Key` (tidak ada efek samping untuk
diamankan), tanpa persist row (berbeda dari dry-run job terjadwal di
bawah, yang MEMANG mencatat snapshot run history untuk visibilitas
backlog dari waktu ke waktu). Melaporkan `eligibleCount`/`heldCount`/
`archivedCount`/`purgeableCount`/`blockedCount`.

## Job terjadwal (`bun run data-lifecycle:archive-purge`)

`scripts/data-lifecycle-archive-purge.ts` — dibangun di atas shared
worker runner: advisory lock, timeout, SIGTERM/SIGINT-aware cancellation,
JSON telemetry. Iterasi tenant-first; legal hold di-fetch ulang tiap
tenant tiap invocation (hold baru berlaku mulai pass berikutnya, bukan
menunggu invocation berikutnya).

- Descriptor `"generic"` (`data_lifecycle.data_lifecycle_runs`): archive
  batch (bila `archive.archivable`) lalu purge batch, keduanya bounded
  (`batchLimit` per pass, `maxPasses` safety bound). Hanya
  `deletion.mode === "hard_delete"` yang dieksekusi.
- Descriptor `"delegated"` (audit/finance/payroll/integration): snapshot
  dry-run saja, TIDAK PERNAH mutasi — purge asli tetap lewat job masing-
  masing yang sudah ada (atau akan dibangun bersamaan modul pemiliknya).
- `--dry-run`: tanpa mutasi untuk kedua mode, snapshot tetap dicatat.

`bun run data-lifecycle:archive-purge --dry-run --json-output=<path>`
aman dijalankan produksi untuk pratinjau sebelum dijadwalkan nyata.

### Ketepatan batas cursor (microsecond vs millisecond)

`timestamptz` PostgreSQL presisi mikrodetik; `Date` JavaScript hanya
milidetik. Setiap perbandingan batas cursor (`archivedThrough` untuk
purge, `resumeAfter` untuk resume archive) perlu di-pad
`CURSOR_BOUNDARY_SAFETY_MARGIN_MS` (1ms) — tanpa ini, baris batas
sendiri gagal memenuhi perbandingan `<=`/`>` terhadap nilai dirinya
sendiri yang sudah terpotong presisi (dibuktikan empiris di base
`awcms-mini` lewat test volume besar — lihat dokumentasi teknis modul
untuk detail lengkap begitu diporting). Dampak bila tidak ditangani:
purge kehilangan tepat satu baris tiap siklus (baris batas tidak pernah
terhapus), dan archive resume mengarsipkan ulang baris terakhir tanpa
henti sampai batas `DEFAULT_MAX_PASSES`.

## Archive port dan restore procedure (local/offline archive)

Provider-neutral (`domain/archive-port.ts`); default DAN target adapter
pertama: `local_offline` (`infrastructure/local-archive-adapter.ts`) —
menulis artefak JSONL/CSV ke `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`,
checksum SHA-256, manifest tercatat di
`awcms_data_lifecycle_archive_manifests` (lokasi, jumlah baris, rentang
cursor, checksum, versi skema, referensi prosedur restore).
`external_object_storage` adalah nilai valid untuk `archive.port`
(typing forward-compatible) tapi belum ada adapter nyata.

**Prosedur restore (local/offline archive):**

1. Cari manifest lewat `GET /api/v1/data-lifecycle/runs` (korelasi
   `jobRunId`/`correlationId`) atau langsung query
   `awcms_data_lifecycle_archive_manifests` (akses admin/operator).
2. Verifikasi integritas SEBELUM memakai artefak apa pun:
   `ArchivePort.verify(artifactLocation, checksumHex)` — recompute
   SHA-256 dan bandingkan; harus `true` sebelum lanjut.
3. Baca isi artefak: `ArchivePort.read(artifactLocation)` — mengembalikan
   baris sebagai `Record<string, unknown>[]`. **Nilai balik JSON/CSV-
   native** (string/number/boolean/null/object), BUKAN otomatis
   ter-cast ke tipe kolom Postgres aslinya (mis. kolom `timestamptz`
   kembali sebagai string ISO, bukan objek `Date`) — operator restore
   HARUS meng-cast ulang per kolom sesuai skema tujuan, tidak diasumsikan
   sudah tepat. Untuk data finansial (mis. kolom `numeric` untuk nilai
   uang), casting yang salah adalah risiko integritas data yang lebih
   serius daripada pada data CMS — validasi tipe dan presisi secara
   eksplisit.
4. Restore-KE-tabel-sumber adalah **prosedur manual operator terpisah**
   yang terdokumentasi — port ini sengaja TIDAK menulis balik ke tabel
   sumber secara otomatis (batasan "no shared-table write" yang sama
   berlaku: hanya kode modul PEMILIK tabel yang boleh menulis ke
   tabelnya). Restore berarti operator (dengan akses admin DB langsung,
   di luar API) menjalankan `INSERT` manual dari baris yang sudah dibaca
   ke tabel tujuan, memvalidasi `tenant_id`/constraint sebelum insert.
5. Rekonsiliasi: bandingkan `rowCount` manifest dengan jumlah baris hasil
   `read()` — harus sama persis; ketidakcocokan berarti artefak korup
   atau salah lokasi, HENTIKAN restore dan investigasi sebelum lanjut.

Target pengujian end-to-end (checksum + read + rekonsiliasi jumlah baris)
mengikuti pola test integrasi base `awcms-mini` begitu modul ini
diimplementasikan di AWCMS.

## Kebijakan partisi dan panduan runbook

`partition.eligible`/`partition.granularity` pada descriptor adalah
**panduan**, bukan otomasi — otomasi operasi partisi hanya dilakukan bila
keamanan PostgreSQL bisa dibuktikan, dan migrasi destruktif seluruh tabel
yang sudah ada dalam satu PR tetap di luar cakupan. Descriptor bervolume
tinggi (mis. `logging.audit_events` bulanan; tabel transaksi finance/
inventory volume tinggi begitu modulnya ada) adalah kandidat masa depan;
descriptor volume rendah (form drafts, run history) menandai
`eligible: false` (volume belum menjustifikasi kompleksitas partisi).

**Runbook (bila suatu saat diimplementasikan — checklist evaluasi, bukan
langkah eksekusi yang sudah teruji):**

1. Buktikan volume nyata menjustifikasi partisi (metrik row count/growth
   rate, bukan asumsi) — lihat §Metrics di bawah.
2. Migrasi partisi PostgreSQL WAJIB non-destruktif: buat tabel baru
   ter-partisi, salin data via batch (bukan `ALTER TABLE` langsung pada
   tabel besar aktif), swap nama via transaksi pendek, verifikasi jumlah
   baris cocok persis sebelum drop tabel lama.
3. RLS policy dan index harus dibuat ulang PERSIS sama pada setiap child
   partition — tidak cukup pada tabel induk saja (PostgreSQL declarative
   partitioning mewarisi RLS dari induk hanya untuk beberapa operasi;
   uji eksplisit sebelum mengklaim aman).
4. Grant role aplikasi (`awcms_worker`/`awcms_app`) harus diverifikasi
   ulang berlaku pada partition baru (grant pada tabel induk partitioned
   tidak selalu otomatis mewarisi ke semua child yang dibuat belakangan,
   tergantung strategi `ALTER DEFAULT PRIVILEGES`).
5. Uji beban nyata (query plan `EXPLAIN ANALYZE` pada query
   representatif) SEBELUM dan SESUDAH partisi — partisi yang salah
   granularitas bisa memperlambat, bukan mempercepat.
6. Rencana rollback eksplisit sebelum cutover produksi.

## Config dan readiness checks

Satu var baru (target): `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (default
`./var/data-lifecycle-archive`). `security:readiness` menambah dua check
(`checkDataLifecycleRegistryValid` — critical, memvalidasi ulang seluruh
registry; `checkDataLifecycleLegalHoldReleaseSeparate` — critical,
memverifikasi `legal_hold.create`/`.release` tetap permission terpisah
dan `release` tetap terklasifikasi high-risk).

## Metrics

Mengikuti pola `src/lib/observability/metrics-port.ts` — label
berkardinalitas rendah, tidak pernah tenant id/row content:
`job_run_total`/`job_run_duration_ms`/`job_run_item_count` (generik dari
shared worker runner, otomatis berlaku untuk
`data-lifecycle:archive-purge` tanpa instrumentasi tambahan). Volume/
backlog/held-data per descriptor tersedia lewat `GET /api/v1/
data-lifecycle/runs` (riwayat run, count teragregasi) dan
`GET /api/v1/data-lifecycle/registry` (deskriptor terdaftar) — bukan
metrik Prometheus khusus tambahan (agregat run history sudah menjawab
"backlog seberapa besar" tanpa menduplikasi mekanisme metrics-port untuk
data yang sama).

## Pemetaan kepatuhan

Prinsip yang berlaku pada SETIAP baris tabel di bawah: **retensi adalah
keputusan per data class yang dideklarasikan pemilik tabel** (lihat
§Retensi data), bukan satu angka legal universal yang diklaim benar
untuk semua yurisdiksi/jenis data. Modul ini menyediakan MEKANISME
(registry, dry-run, legal hold, archive, purge aman) — organisasi
pengguna AWCMS tetap wajib menetapkan periode retensi aktual sesuai
regulasi perpajakan, ketenagakerjaan, dan kebijakan internalnya sendiri
untuk data finance/payroll — ini adalah tanggung jawab tambahan
dibanding base CMS generik, bukan sesuatu yang otomatis benar begitu
kode diporting.

### UU PDP (Undang-Undang Pelindungan Data Pribadi, UU No. 27/2022)

| Prinsip UU PDP                                                     | Implementasi (target)                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pembatasan penyimpanan (data disimpan tidak lebih lama dari perlu) | Setiap descriptor mendeklarasikan `retentionMinDays`/`retentionMaxDays`/`defaultRetentionDays` eksplisit; dry-run mengekspos backlog "eligible" sebelum purge nyata dijalankan                                                       |
| Hak penghapusan/permintaan subjek data                             | Purge bounded + audit ada sebagai MEKANISME; keputusan KAPAN menghapus atas permintaan subjek tetap keputusan operasional operator, bukan otomatis dari modul ini — untuk data payroll/HR, keputusan ini juga harus mempertimbangkan kewajiban retensi ketenagakerjaan yang mungkin mengalahkan permintaan hapus |
| Akuntabilitas pemrosesan                                           | Setiap purge (mode `"generic"`) diaudit `critical` dengan `descriptorKey`/`purgedCount`/`cutoffIso`; run history menyimpan bukti eksekusi teragregasi                                                                                |
| Legal hold vs hak hapus                                            | Legal hold OVERRIDE hak penghapusan rutin — kepatuhan terhadap kewajiban hukum lain (mis. audit pajak, sengketa ketenagakerjaan) yang sah secara hukum mengalahkan permintaan hapus rutin, konsisten dengan pengecualian lazim UU PDP untuk kewajiban hukum |

### PP PSTE (Penyelenggaraan Sistem dan Transaksi Elektronik, PP No. 71/2019)

| Aspek                                                             | Implementasi (target)                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kewajiban retensi data elektronik untuk keperluan penegakan hukum | Legal hold mechanism eksplisit memungkinkan operator mem-preserve data melebihi retensi rutin saat diminta otoritas berwenang, dengan `authorityReference` sebagai bukti dasar hukum permintaan |
| Keandalan sistem elektronik                                       | Bounded batch (tidak pernah unbounded DELETE), advisory lock (tidak pernah purge ganda konkuren), checksum arsip (integritas terverifikasi)                                                     |

### ISO/IEC 27001:2022 Annex A (kontrol relevan-kode)

| Kontrol                              | Implementasi (target)                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.5.33 Protection of records         | Archive manifest + checksum + restore procedure sebelum purge fisik (untuk descriptor archivable)                                                  |
| A.5.34 Privacy and protection of PII | Dry-run/run history mengagregasi count, tidak pernah row content/PII individual                                                                    |
| A.8.10 Information deletion          | Bounded, audited, permission-gated purge; `deletion.mode` eksplisit per tabel                                                                      |
| A.5.15 Access control                | ABAC default-deny + RLS pada semua endpoint; permission terpisah create/release legal hold                                                         |
| A.8.15 Logging                       | Setiap purge (`"generic"`) dan aksi legal hold diaudit `critical`/`warning` via `recordAuditEvent` yang sudah ada (tidak ada mekanisme audit baru) |

### ISO/IEC 27002:2022 (panduan implementasi kontrol di atas)

Panduan retensi berbasis-kelas (bukan satu angka global) selaras 27002
§5.33 ("retention periods should take into account... legal, statutory,
regulatory and contractual requirements" — plural, per jenis data).
Panduan penghapusan aman (27002 §8.10) tercermin di `deletion.mode`
eksplisit per descriptor (`hard_delete`/`anonymize`/
`status_transition_then_purge`) alih-alih satu strategi seragam.

### ISO/IEC 27005:2023 (manajemen risiko)

| Risiko                                    | Mitigasi (target)                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purge tak terbatas mengunci tabel lama    | `batchLimit` wajib per descriptor (divalidasi registry gate, maksimum absolut 50.000), statement bounded, tidak pernah `DELETE` tanpa `LIMIT`                          |
| Legal hold dilewati diam-diam             | Precedence dicek unconditional sebelum cabang purge mana pun; `legalHold.applicable` bukan gerbang teknis (lihat §Legal hold)                                          |
| Purge lintas-tenant tak sengaja           | RLS FORCE + filter `tenant_id` eksplisit di setiap query; job iterasi tenant SATU PER SATU via transaksi tenant-scoped terpisah, tidak pernah satu query lintas-tenant |
| Artefak arsip korup/tidak bisa dipulihkan | Checksum SHA-256 wajib per manifest, `verify()` sebelum pemakaian, diuji end-to-end                                                                                |
| Kredensial bocor lewat log/arsip          | `artifactLocation` selalu path/URI, tidak pernah kredensial; tidak ada mekanisme baru yang menulis raw secret ke log                                              |
| Purge dini data finance/payroll melanggar retensi hukum | Descriptor `finance.*`/`hr_payroll.*` wajib review legal sebelum `retentionMinDays`/`retentionMaxDays` ditetapkan (lihat catatan di awal dokumen) — risiko yang tidak ada padanannya di base CMS generik |

### ISO/IEC 27701:2025 (ekstensi privasi untuk ISO 27001, PIMS)

Dry-run dan run history mengagregasi (count per descriptor per tenant),
tidak pernah mengekspos identifier/nilai baris individual — selaras
prinsip minimisasi data PIMS. Legal hold `authorityMetadata` (jsonb)
didokumentasikan sebagai non-secret tapi tetap tenant-scoped RLS — tidak
pernah lintas tenant meski berisi metadata otoritas eksternal.

### ISO/IEC 22301 (kontinuitas bisnis)

Archive-sebelum-purge (untuk descriptor archivable) adalah bukti retensi
yang bisa dipulihkan pasca insiden — manifest + checksum + restore
procedure yang terdokumentasi dan teruji (bukan hanya diklaim) adalah
bagian dari kesiapan pemulihan data historis. Lihat juga
[`resilience-dr-verification.md`](resilience-dr-verification.md) untuk
cakupan backup/restore penuh basis data (independen dari mekanisme
arsip modul ini — archive manifest melengkapi, bukan menggantikan,
backup database rutin).

## Batasan yang dicatat, bukan diabaikan

- **Belum ada modul ini sama sekali di AWCMS** — gap utama pada tahap
  fondasi saat ini, terpisah dari batasan-batasan teknis di bawah yang
  berlaku begitu porting dari base selesai.
- **Descriptor ERP di atas hanyalah contoh ilustratif** — belum ada
  modul finance/inventory/HR-payroll/integration nyata untuk didaftarkan;
  daftar aktual akan ditentukan saat modul-modul tersebut dibangun.
- **`scope: "global"` descriptor** perlu diterima registry validator
  (forward-compatible) tapi dilewati (bukan salah eksekusi) oleh dry-run
  planner dan archive/purge engine begitu diimplementasikan.
- **Tidak ada admin UI screen khusus** direncanakan sebagai bagian
  acceptance criteria awal — API dulu, layar `/admin/data-lifecycle`
  adalah follow-up yang masuk akal.
- **Adapter object-storage eksternal** — `local_offline` saja pada
  target implementasi awal.
- **Cursor tie edge case** — lihat §Ketepatan batas cursor di atas; batas
  1ms yang mungkin tersisa setelah fix (berdasarkan pengalaman base),
  tidak dieliminasi sepenuhnya secara teoretis.
</content>
