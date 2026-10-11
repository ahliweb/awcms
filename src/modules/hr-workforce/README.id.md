🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:f3c316a66a09a71460abf525644e2939f1649491288e333c2d2d0b3f59a0d172 -->

# `hr_workforce`

**Konteks ketenagakerjaan** (Issue #945,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.id.md), fase 1
keluarga `hr_*`). Paket desainnya adalah
[`docs/awcms/hr-payroll.id.md`](../../../docs/awcms/hr-payroll.id.md) bagian 2.1, 3,
dan 4.1; berkas ini adalah peta kodenya.

## Apa yang ada, dan apa yang belum

Ini adalah **fondasi** (employment, terms berlaku-efektif, settings, dan
karyawan-melihat-miliknya) plus **shift dan port ketersediaan staf** (Issue #946).
**Belum ada:** kehadiran, koreksi, komisi, dan payroll (issue berikutnya di bawah
ADR yang sama) —
dan **tidak akan pernah** ada field foto, biometrik, atau sidik-jari perangkat
(keputusan pemilik O6).

Status `experimental`: flag mati, belum ada layar admin, dan modul tidak
mendeklarasikan `navigation`. Ia menjadi `active` bersama layar pertamanya.

## Aturan yang membuatnya aman

- **Referensi, bukan salinan.** `awcms_hr_employments.profile_id` adalah foreign
  key komposit `(tenant_id, profile_id)` ke `awcms_profiles`. Tidak ada kolom nama,
  kontak, tanggal lahir, NIK, atau NPWP di tabel HR mana pun; tampilan membaca
  `profile_identity`. Sebuah tes memastikan kolom seperti itu tidak muncul.
- **Satu employment aktif per profil dan per login**, lewat partial unique index
  (`sql/176`), bukan kode handler. Rehire adalah employment baru setelah yang
  pertama diakhiri.
- **Terms hanya-tambah dan berlaku-efektif.** Perubahan menutup baris terbuka dan
  menyisipkan yang berikutnya; terms tidak pernah tumpang tindih; `terminated`
  bersifat terminal dan menandai header; rantai atasan tidak siklik dan paling
  dalam sepuluh sisi, dihitung termasuk bawahan di bawah seorang karyawan (satu
  fungsi SQL yang dipakai trigger dan pra-cek handler). Penulisan sisi atasan
  mengambil satu advisory lock per tenant, sehingga dua sisi bersamaan yang
  menutup siklik tidak bisa sama-sama commit. Masing-masing adalah trigger, sehingga sesi yang melewati
  aplikasi tidak bisa merusaknya.
- **Merge profil** antara dua profil yang sama-sama berstatus bekerja aktif
  ditolak oleh trigger pada `awcms_profiles` (ADR-0132 bagian 2).
- **Karyawan melihat miliknya** adalah `ownershipGrant` (ADR-0063) pada
  `tenant_user_id` yang tersimpan, dilewatkan lewat opsi `ownershipGrant` baru di
  `defineTenantRoute`. Ia hanya MELEBARKAN `employments.read`; ABAC deny, scope,
  dan SoD tetap berlaku, kredensial mesin tidak pernah membawanya, dan id yang
  tidak ada serta baris milik orang lain adalah 403 yang sama. Penautannya sendiri
  adalah `employments.assign`: berisiko tinggi dan diaudit.
- **Aksi berisiko tinggi** (`create`, perubahan terms, `assign`, `delete`,
  `restore`, `configure`) mewajibkan `Idempotency-Key` dan diaudit tanpa nama,
  jabatan, nomor, atau alasan; satu-satunya pengenal yang dibawanya adalah UUID
  login pada baris `assign`.

## Shift dan port ketersediaan staf (Issue #946, `sql/184`-`sql/185`)

`awcms_hr_shift_templates` adalah **pola** (jam mulai lokal, durasi TERLEWAT, satu
istirahat opsional, zona IANA). `awcms_hr_shift_assignments` adalah interval UTC
setengah-terbuka `[starts_at, ends_at)` yang konkret per employment, `work` atau
`time_off`, `draft` -> `published` -> `cancelled`. Menaruh template pada tanggal
lokal menyelesaikan jam dinding ke UTC **sekali**, di aplikasi
(`domain/hr-shift-time.ts`), dan menyimpan instan beserta zona tempat ia
diselesaikan, sehingga mengubah template kemudian tidak pernah menggeser
penugasan. Pada celah daylight-saving dipakai offset sebelum perubahan (02:30
yang tidak ada menjadi 03:30), pada tumpang tindih kemunculan lebih awal yang
menang, dan shift yang melintasi perubahan mempertahankan panjang terlewat yang
sebenarnya (tes tabel, termasuk Europe/Berlin, America/New_York, dan zona
setengah-jam).

- **Tanpa tumpang tindih per employment**, lintas kind, di antara baris non-batal.
  Trigger mengambil advisory lock per-(tenant, employment) SEBELUM melihat, sehingga
  dua penulis serentak berserial dan yang kedua ditolak (`23P01`); handler
  mengambil lock yang sama dan memeriksa lebih dulu, menjawab `409 SHIFT_CONFLICT`
  dengan id penugasan lain di `error.details`. Tanpa constraint eksklusi
  `btree_gist`: ia butuh `CREATE EXTENSION` berhak-istimewa yang tak diminta migrasi
  mana pun di sini (`sql/171` mencatat keputusan yang sama).
- **Status hanya maju**; baris terbit atau batal tak dapat diubah (trigger), dan
  tidak ada yang pernah dihapus (DELETE ditolak + trigger). Tidak ada
  `shifts.update`: draft dibatalkan lalu dibuat ulang, shift terbit dibatalkan,
  tidak pernah disunting.
- **Tanpa alasan, catatan, atau teks bebas di mana pun.** Time off membawa
  `timeOffKind` kasar (`leave`, `holiday`, `other`); cuti sakit adalah data
  kesehatan. Sebuah tes menegaskan tidak ada kolom semacam itu.
- **Publish dan cancel berisiko tinggi** (`Idempotency-Key`, diaudit dengan id dan
  kind saja). Karyawan membaca jadwal TERBIT miliknya lewat `ownershipGrant` pada
  `GET /shift-assignments?mine=true`; draft butuh `shifts.read`.
- **`StaffAvailabilityPort`** (`_shared/ports/staff-availability-port.ts`, tidak
  mengimpor apa pun; adapter `application/staff-availability-adapter.ts`; kontrak
  `docs/awcms/cross-domain-contracts.id.md` bagian 4). Ia mengembalikan, per
  referensi staf opak (id employment), `resolved` atau `unknown` plus interval
  kerja: kerja terbit, dikurangi istirahat tiap penugasan, dikurangi time off,
  dipotong ke jendela, interval bersebelahan digabung
  (`domain/availability-intervals.ts`, murni). Tiga field per orang; tanpa nama,
  kantor, kode, kind, atau grade. Ia pembacaan dalam transaksi tenant pemanggil
  (FORCE RLS berlaku, dan tenant juga ada di setiap predikat), tidak
  mengotorisasi, tidak mengaudit, dan tidak menulis; composition root KONSUMEN
  mengotorisasi permission miliknya lebih dulu. `unknown` = tak ditemukan, tenant
  lain, soft-delete, atau tak ada term `active` yang menyentuh jendela, sengaja
  tak dapat dibedakan. Shift kerja dihitung hanya bila term `active` pada
  tanggal mulai LOKAL-nya. Tes teks-sumber gagal bila adapter pernah menyebut
  tabel kompensasi, payroll, komisi, atau payout. Tidak ada kode Booking yang
  diimpor di mana pun; Booking (issue berikutnya) akan memakai tipe port.

## Keputusan hak subjek data (cakupan ADR-0094)

| Tabel                         | `subjectData`                                                    | Alasan                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `awcms_hr_employments`        | tercakup: `profile_id`, `tenant_user_id` + stempel; diekspor     | Catatan kepegawaian milik subjek sendiri. Dipertahankan di bawah kewajiban ketenagakerjaan/pajak/jaminan sosial pemberi kerja (`retain_under_obligation`); tautannya tetap dan mengarah ke profil yang sudah dianonimkan.                                                                                                                              |
| `awcms_hr_employment_terms`   | tercakup: hanya stempel aktor; **tidak diekspor**; dipertahankan | Mencapai orangnya hanya lewat `employment_id`, yang tidak bisa dinyatakan kolom subjek langsung. Subjek membaca riwayatnya sendiri lewat `GET .../terms` yang diberi hak kepemilikan. Hanya-tambah, sehingga penghapusan tidak bisa menulis ulangnya. Join employment-ke-subjek langsung di ekspor adalah tindak lanjut tercatat (lihat Keterbatasan). |
| `awcms_hr_shift_assignments`  | tercakup: hanya stempel aktor; **tidak diekspor**; dipertahankan | Kapan seseorang dijadwalkan dan kapan berhalangan (kategori kasar, tak pernah alasan). Mencapai orangnya hanya lewat `employment_id`, butir terbuka yang sama dengan terms (di bawah). Subjek membaca jadwal terbit miliknya lewat `?mine=true`. Tak pernah dihapus, baris terbit tak dapat diubah.                                                    |
| `awcms_hr_shift_templates`    | `NO_SUBJECT_DATA` (alasan tercatat)                              | Pola tanpa orang; hanya stempel aktor.                                                                                                                                                                                                                                                                                                                 |
| `awcms_hr_workforce_settings` | `NO_SUBJECT_DATA` (alasan tercatat)                              | Baris konfigurasi tenant; hanya stempel `updated_by`.                                                                                                                                                                                                                                                                                                  |

Kelima tabel didaftarkan ke `data_lifecycle` sebagai `delegated`, tanpa purge:
riwayat HR dipertahankan selama masa hukum pemberi kerja (menurut penasihat
hukum, tidak ditegaskan di sini); archive-then-purge untuk baris HR adalah tindak
lanjut tercatat.

## Tata letak

| Path                                        | Isinya                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `module.ts`                                 | Deskriptor: 16 permission, `dataLifecycle` + `subjectData`                          |
| `domain/hr-shift-types.ts`                  | Kind, status, dan batas shift — murni                                               |
| `domain/hr-shift-time.ts`                   | Penyelesaian jam dinding ke UTC, aturan celah/tumpang tindih DST — murni            |
| `domain/availability-intervals.ts`          | Aljabar interval dan aturan waktu kerja — murni                                     |
| `domain/hr-shift-validation.ts`             | Validator template dan penugasan yang ketat (tanpa teks bebas) — murni              |
| `application/hr-shift-directory.ts`         | SQL template dan penugasan: draft, publish, cancel, daftar                          |
| `application/staff-availability-adapter.ts` | Adapter `StaffAvailabilityPort` (hanya-baca)                                        |
| `domain/hr-workforce-types.ts`              | Tipe dan status employment — murni                                                  |
| `domain/hr-workforce-validation.ts`         | Validator request ketat (tanpa field personal, tanpa tanggal akhir turunan) — murni |
| `domain/hr-workforce-permissions.ts`        | Objek guard literal yang diteruskan ke `authorizeInTransaction`                     |
| `application/hr-workforce-directory.ts`     | Seluruh SQL: list/get, buat, ubah terms, assign, delete/restore, settings           |
| `application/hr-workforce-route-support.ts` | Idempotensi, validasi body, dan dasar kepemilikan yang dipakai bersama oleh route   |
| `src/pages/api/v1/hr-workforce/**`          | 11 berkas route tipis, masing-masing otorisasi lewat `defineTenantRoute`            |

## Butir terbuka dan postur fase 1 yang tercatat

Terbuka (dilacak, tidak disembunyikan):

- **Penugasan shift juga belum di-join ke ekspor subjek** (issue 985 mencakup
  kedua tabel), karena alasan yang sama dengan terms (`exportable: false`; karyawan membaca jadwal terbit miliknya lewat
  `?mine=true`). Tindak lanjut yang sama menutup keduanya.
- **Tidak ada purge `data_lifecycle` untuk baris shift** (dinyatakan `delegated`,
  kelas retensi `financial_tax` seperti baris HR lain; periodenya milik penasihat
  hukum pemberi kerja). **Tidak ada domain event** (`awcms.hr.shift.assigned` tetap
  provisional sampai Booking memakainya), **tidak ada layar admin**, **tidak ada
  restore template** (template yang dihapus membebaskan kodenya; buat ulang), dan
  **penugasan pada atau setelah terminasi tidak ditolak** (port cukup mengabaikan
  terms yang bukan `active`).
- **Terms belum di-join ke ekspor subjek.** `awcms_hr_employment_terms` bernilai
  `exportable: false` karena deskriptor subjek tidak bisa menyatakan join
  `employment_id` ke seseorang. Ekspor akses-subjek saat ini hanya membawa header
  employment; karyawan membaca terms-nya sendiri lewat
  `GET /employments/{id}/terms`. Ini **butir terbuka**: join langsung
  employment-ke-subjek di ekspor harus mendarat sebelum modul keluar dari
  `experimental`.
- **Belum ada purge.** Deskriptor `data_lifecycle` menyatakan siklus yang
  dimaksud (soft delete, lalu purge setelah masa retensi pemberi kerja) tetapi
  belum ada yang mem-purge; archive-then-purge untuk baris HR adalah tindak lanjut.

Postur fase 1 yang diketahui (didokumentasikan, tanpa kode tambahan di PR ini):

- **Penautan `assign` tidak terikat pada karyawannya.** Tidak ada yang
  membuktikan login yang ditautkan adalah orang yang dimaksud employment. Pemegang
  `assign` dapat menautkan login MILIKNYA ke employment mana pun lalu
  membacanya lewat ownership grant. Kendalinya adalah permission itu sendiri
  (berisiko tinggi, diaudit, idempoten, tidak pernah diberikan ke role secara
  default): baris audit mencatat login MANA yang menerima kepemilikan
  (`linkedTenantUserId`, sebuah UUID, beserta yang sebelumnya) sehingga
  penyalahgunaan dapat ditelusuri, dan tenant dapat menyusun aturan SoD atas
  `assign`. Tidak ada step-up.
- **`employments.read` berlaku se-tenant.** Tidak ada business scope `office`
  yang membatasinya di fase 1; pembacaan per kantor dan per atasan (skenario S4
  dan S6 paket desain) butuh adapter scope dan alasan kepemilikan `manager_of`,
  keduanya issue berikutnya.
- **Atasan yang di-soft-delete meninggalkan referensi menggantung.** Menghapus
  lunak employment yang menjadi atasan seseorang tidak menulis ulang terms
  bawahannya, sehingga `managerEmploymentId` menunjuk baris yang sudah dihapus
  (masih ada, `deletedAt` terisi). Apa pun yang menelusuri rantai harus menangani
  atasan yang terhapus; aturan kedalaman dan siklus tetap menghitungnya.
- Resolver kepemilikan membaca satu boolean tentang sebuah baris sebelum guard
  memutuskan (di dalam transaksi tenant, di bawah RLS); id yang tidak ada dan baris
  milik orang lain sama-sama dijawab 403, jadi bukan oracle keberadaan, tetapi
  pembacaan terjadi sebelum keputusan.

## Keterbatasan

- Belum ada layar admin; `experimental`.
- Tenant yang sudah ada perlu `bun run identity-access:permissions:backfill`
  untuk menerima permission yang di-seed (keterbatasan setiap seed permission).
- Nomor karyawan dan tanggal masuk tidak bisa disunting langsung (hapus lalu buat
  ulang selama itu kesalahan); endpoint sunting header adalah issue berikutnya.
- Tabel terms belum di-join ke ekspor subjek (lihat di atas).
- `btree_gist` tidak dipakai: tumpang tindih terms adalah trigger, bukan
  exclusion constraint.
