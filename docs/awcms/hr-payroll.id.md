🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](hr-payroll.md)

<!-- i18n-source-hash: sha256:741470b3af46e281d0c928e4b68ebe6b90243e2d70973e36b11f21256ac0e0e0 -->

# HR dan payroll — workforce, komisi, payroll (paket desain)

> **Status:** diterima oleh [ADR-0132](../adr/0132-hr-payroll-module-family-admission.id.md)
> (Issue #916). **Desain, ditambah satu irisan yang sudah mendarat:** _fondasi_
> fase 1 (modul `hr_workforce`, `experimental`, `sql/176`–`sql/177`: employment,
> terms berlaku-efektif, settings, karyawan-melihat-miliknya; Issue #945) dan
> _irisan shift_ (`sql/184`–`sql/185`: template shift, penugasan shift dengan aturan
> tumpang-tindih yang ditegakkan database, dan adapter `StaffAvailabilityPort`;
> Issue #946), _irisan kehadiran_ (`sql/198`–`sql/199`: event kehadiran hanya-tambah
> dan koreksi dengan persetujuan; Issue #947), serta _fondasi aturan_ fase 2 (modul
> `hr_commission`, `experimental`, `sql/182`–`sql/183`: aturan komisi berversi dan
> evaluasinya yang murni; Issue #950) sudah ada. Buku besar akrual komisi dan payroll
> masih hanya desain: belum ada tabel, route, atau migrasi untuk itu.
> Paket ini memuat PRD-lite per fase, state machine, ERD dan kamus data, matriks
> izin/RLS, matriks masking, audit dan idempotensi, skenario penerimaan
> RBAC/ABAC, analisis ancaman dan privasi, event sementara, dan keputusan
> pemilik yang masih terbuka. Keputusan dan alternatif yang ditolak ada di ADR.
> Polanya mengikuti [`procurement.md`](procurement.id.md),
> [`inventory-ledger.md`](inventory-ledger.id.md) dan
> [`tax-calculation.md`](tax-calculation.id.md). Nama tabel, izin, dan route di
> bawah adalah **usulan untuk isu implementasi** dan baru nyata ketika migrasi,
> OpenAPI, dan tes mendarat; bila paket ini menulis "harus", itu adalah
> persyaratan bagi isu-isu tersebut.

## 1. Keluarga, fase, dan gerbangnya

| Fase | Kunci modul     | Cakupan                                                                               | Bergantung pada                         | Dapat dibangun ketika                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | --------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `hr_workforce`  | konteks kepegawaian, kehadiran, koreksi, shift, **port ketersediaan staf**            | `tenant_admin`, `profile_identity`      | sekarang (DoD biasa, tinjauan keamanan port baru dan jalur kepemilikan)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2    | `hr_commission` | aturan komisi dan ledger akrual                                                       | `hr_workforce`                          | fase 1 mendarat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3    | `hr_payroll`    | kompensasi, rekening pembayaran, periode, run, baris, slip gaji, versi aturan payroll | `hr_workforce`, `hr_commission` (lunak) | **O4 dan O7 terjawab (2026-10-10); mode SoD yang dapat dikonfigurasi diputuskan ADR-0136, mengamandemen ADR-0132 (§7.5); enkripsi-saat-diam rekening pembayaran diputuskan (**selesai: [ADR-0137](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md), hanya desain, [x]**); tinjauan keamanan (**tercatat: [§17.2](#172-hasil-per-area), [x] sebagai tinjauan; temuan pemblokirnya PS-01 sampai PS-04 masih harus ditulis ke desain**); tinjauan hukum atas kontrol versi-aturan mesin (profil yurisdiksi apa pun milik konsumen, O4) (**BELUM: daftar periksa [§17.3](#173-daftar-periksa-tinjauan-hukum-untuk-penasihat-hukum-tidak-dijawab-di-sini), tanda tangan [§17.4](#174-tanda-tangan-diisi-penasihat-hukum-sengaja-dikosongkan) kosong, [ ]**); gladi restore** |

**Di luar cakupan untuk seluruh keluarga:** buku besar dan entri akuntansi apa
pun; dokumen fiskal (SPT tahunan, bukti potong); pembuatan berkas bank dan
panggilan penyedia pembayaran apa pun (isu berikutnya, lewat outbox, tidak
pernah di dalam transaksi database); saldo dan akrual cuti; pinjaman dan
tunjangan; pelacakan pelamar; penilaian kinerja; **komisi afiliasi** (penerima
berbeda, bukan pegawai); bukti kehadiran foto, biometrik, dan sidik-jari perangkat (tidak pernah, O6); bukti geolokasi-saja diputuskan di ADR-0138 dan dibangun oleh Issue #970, mati untuk setiap tenant secara default (§4.3).

## 2. PRD-lite

### 2.1 Fase 1 — Workforce

**Masalah.** Bisnis yang menjadwalkan orang membutuhkan satu jawaban untuk
"siapa bekerja di sini, di mana, di bawah siapa, dan kapan", yang dapat
ditanyakan modul booking atau POS tanpa mengetahui apa pun tentang gaji, dan
tanpa tabel `employees` pribadi yang menyalin nama dan nomor identitas nasional.

**Tujuan.** Konteks kepegawaian yang **merujuk** profil `profile_identity`,
kehadiran append-only dengan koreksi yang disetujui, template dan penugasan shift
dengan deteksi konflik, dan port sempit yang mengekspos interval kerja.

**Pengguna.** Pegawai (clock-in, melihat kehadiran dan jadwal sendiri);
supervisor (menyetujui koreksi dan melihat lingkup kantornya); penjadwal
(menugaskan shift; tidak dapat membaca gaji); administrator HR (kepegawaian,
tautan akun); modul Booking (membaca ketersediaan lewat port); auditor.

| Kriteria penerimaan (dari isu)                                                                                                | Di mana                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Kepegawaian menyimpan referensi `profile_identity` dan tidak pernah menyalin nama, kontak, identitas nasional                 | §3, `profile_id` FK komposit; tak ada kolom pribadi di tabel HR mana pun |
| Unit organisasi, atasan, status berlaku-efektif                                                                               | §4.1 `employment_terms`                                                  |
| Event kehadiran, koreksi, persetujuan lewat `workflow_approval`                                                               | §4.2                                                                     |
| Bukti geolokasi-saja adalah fitur terpisah, mati secara default per tenant; bukti foto, biometrik, dan perangkat tidak pernah | §4.3 (ADR-0138, dibangun #970; mati default)                             |
| Template dan penugasan shift dengan deteksi konflik                                                                           | §4.4                                                                     |
| Port ketersediaan staf untuk Booking                                                                                          | §5                                                                       |

### 2.2 Fase 2 — Komisi

**Masalah.** Staf dibayar bagian dari apa yang dijual atau diserahkannya. Dihitung
di spreadsheet atau di tiap konsumen, penjualan yang sama bisa dibayar dua kali,
pengembalian tidak pernah ditarik kembali, dan tarif yang berubah diam-diam
menulis ulang bulan lalu.

**Tujuan.** Aturan berversi, ledger akrual yang memposting setiap sumber tepat
sekali dan mengompensasi alih-alih mengubah, dan siklus hidup sampai payable dan
paid.

**Pengguna.** Administrator komisi (aturan), manajer penjualan atau layanan
(menyetujui akrual), pegawai (melihat akrual sendiri), payroll (fase 3 memakai
akrual payable), adapter hilir (memposting akrual).

| Kriteria penerimaan                                                                 | Di mana  |
| ----------------------------------------------------------------------------------- | -------- |
| Aturan berversi + ledger akrual pending → approved → payable → paid/voided/reversed | §6.1, §8 |
| Referensi sumber unik, akrual tepat-sekali                                          | §6.2     |
| Reversal mengompensasi, tidak pernah mengubah                                       | §6.3     |
| Bukan komisi afiliasi; konsumen sumber adalah adapter hilir                         | §6.4     |

### 2.3 Fase 3 — Payroll (diterima, digerbangi)

**Masalah.** Gaji adalah perhitungan berkonsekuensi paling tinggi dan paling
teregulasi yang dilakukan tenant: salah sekali adalah peristiwa hukum dan
manusiawi, perubahan regulasi adalah perubahan data bukan perubahan kode, dan
orang yang berwenang menghitung, menyetujui, dan mencairkan tidak boleh satu
orang.

**Tujuan.** Periode dan run dengan tugas terpisah, aturan sebagai data
berlaku-efektif, run finalized immutable yang dikoreksi dengan reversal, dan slip
gaji yang hanya terlihat oleh pemiliknya.

**Pengguna.** Penyusun payroll (menghitung), penyetuju payroll (menyetujui dan
memfinalisasi), pencair (mencatat pembayaran), pegawai (slip sendiri), auditor,
pembaca keuangan (total, lewat pembacaan terotorisasi).

| Kriteria penerimaan                                                  | Di mana             |
| -------------------------------------------------------------------- | ------------------- |
| Periode, run, baris, slip gaji                                       | §7                  |
| SoD: hitung vs setujui vs bayar, dapat dikonfigurasi per tenant      | §7.5, O7 (terjawab) |
| Kunci periode; run finalized immutable; koreksi dengan reversal      | §7.2, §7.4          |
| Aturan berlaku-efektif, netral yurisdiksi                            | §7.3                |
| Profil Indonesia adalah data aturan, dimiliki masing-masing konsumen | §7.3, O4 (terjawab) |

## 3. Referensi identitas dan apa yang tidak pernah disimpan keluarga ini

Baris kepegawaian membawa `profile_id` sebagai **foreign key komposit
`(tenant_id, profile_id)` ke `awcms_profiles (tenant_id, id)`**: mekanisme yang
dipakai procurement untuk pemasoknya
([ADR-0128](../adr/0128-generic-procurement-supplier-receiving-transfer-module-admission.id.md)
§2), ditopang `UNIQUE (tenant_id, id)` yang ditambahkan `sql/174` pada
`awcms_profiles`. Keputusannya, enam alternatif, dan putusan masing-masing ada di
ADR-0132 §2. Konsekuensi untuk setiap tabel di paket ini:

- **Tidak pernah menjadi kolom tabel HR mana pun:** nama, nama hukum, e-mail,
  telepon, alamat, tanggal lahir, **NIK**, **NPWP**. Tampilan membaca
  `profile_identity` (nama, identifier ter-mask). Fase 3 me-resolve identifier
  pajak atau nasional dari `profile_identity` ketika sebuah run membutuhkannya,
  dengan aturan masking yang sama.
- **Tautan login** (`tenant_user_id`, FK komposit nullable ke
  `awcms_tenant_users`) adalah dasar kepemilikan layanan mandiri, bukan
  identitas. Mengatur atau mengubahnya berisiko tinggi (`assign`), diaudit, dan
  begitulah "slip gaji ini milik saya" diputuskan.
- **`_shared/ports/party-directory-port.ts` tidak ada.** Berkas itu disebut
  [`erp-extension-contracts.md`](erp-extension-contracts.id.md) §4 dan ADR-0020;
  teks kontrak dikoreksi dalam perubahan ini. Port pe-resolve ringkasan dibangun
  hanya ketika konsumen dalam-proses kedua membutuhkannya.
- **Merge:** merge profil tidak pernah menulis ulang kepegawaian; merge antara dua
  profil yang sama-sama memiliki kepegawaian _aktif_ ditolak oleh PR fase 1.
- **Visibilitas yatim:** profil yang di-soft-delete atau dianonimkan membuat
  kepegawaian tetap terbaca lewat id, dengan `profile_identity` memasok nama apa
  pun yang masih dipegangnya. Riwayat HR dipertahankan di bawah kewajiban hukum
  pemberi kerja (§13.2), tidak di-severance bersama profil.

## 4. Desain Workforce (fase 1)

### 4.1 Konteks kepegawaian

`awcms_hr_employments` — header stabil: `profile_id`, `employee_no` (unik per
tenant di antara baris hidup), `hired_on`, `tenant_user_id` opsional, cap
soft-delete. `awcms_hr_employment_terms` — baris **berlaku-efektif, append-only**:
`office_id` (FK komposit ke `awcms_offices`; pohon kantor **adalah** unit
organisasi dan tipe business-scope `office`), `manager_employment_id` (FK
komposit ke diri sendiri, rantai asiklik dan berkedalaman terbatas), `job_title`,
`employment_type` (`permanent`, `fixed_term`, `part_time`, `casual`), `status`
(`active`, `on_leave`, `suspended`, `terminated`), `effective_from`,
`effective_to`. Terms satu kepegawaian tidak pernah tumpang tindih (trigger).
Perubahan menutup baris saat ini dan menyisipkan berikutnya; riwayat tidak pernah
disunting. `department_label` adalah teks deskriptif dan **bukan** scope.
Terminated bersifat terminal untuk kepegawaian; masuk kembali adalah kepegawaian
baru pada profil yang sama.

### 4.2 Kehadiran dan koreksi

`awcms_hr_attendance_events` **append-only** (tanpa UPDATE/DELETE untuk
`awcms_app`, dan trigger): `employment_id`, `kind` (`clock_in`, `clock_out`,
`break_start`, `break_end`), `occurred_at` (diklaim, UTC), `recorded_at` (server),
`source` (`self`, `supervisor`, `kiosk`, `import`), `client_event_key`,
`office_id`, `supersedes_event_id`. Unik `(tenant_id, employment_id,
client_event_key)`: kiosk atau POS offline yang memutar ulang antreannya memposting
setiap event sekali, dan replay mengembalikan yang asli. `occurred_at` yang lebih
dari batas selisih waktu terkonfigurasi di masa depan ditolak; `occurred_at` yang
usang diterima (offline) dan ditandai `late` untuk ditinjau.

**Koreksi** (`awcms_hr_attendance_corrections`) tidak pernah menyunting event. Ia
mengusulkan event tambahan atau pengganti dengan alasan wajib, memulai instance
`workflow_approval`, dan saat disetujui menambahkan event baru yang `supersedes`
yang lama. Catatan efektif adalah "event yang tidak digantikan". Persetujuan
**wajib dan gagal-tertutup**: tenant tanpa workflow `hr.attendance_correction`
terbit mendapat `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` saat submit. Guard
persetujuan-diri mencegah baik pemohon maupun pegawai yang dikoreksi menyetujuinya
(rekan yang mengajukannya atas nama mereka tidak menghindarinya).
Teks alasan adalah data pribadi dan tidak pernah ikut dalam baris audit atau
event.

**Seperti yang dibangun (Issue #947, `sql/198`–`sql/199`).** Dua penyempurnaan teks
di atas, keduanya ditegakkan database. (1) `source` punya nilai kelima,
`correction`, yang hanya ditulis koreksi yang disetujui (event juga membawa
`correction_id`; guard mensyaratkan koreksi `approved` dan event cocok persis pada
kind, instan, employment, dan target, sekali saja). (2) Aturan waktu usang dibagi
menurut sumber, untuk memenuhi aturan putar-ulang offline sekaligus kendali
pemalsuan: event `self`/`supervisor` mengklaim "sekarang", jadi waktu klaim yang
lebih tua dari skew tenant **ditolak** (`ATTENDANCE_BACKDATED`: pakai koreksi); event
`kiosk`/`import` adalah antrean yang diputar ulang, jadi waktu usang **diterima**
hingga 7 hari dan ditandai `late` lewat 15 menit (lebih tua: ditolak). Baris koreksi
hanya mengubah status dan status itu harus mengikuti putusan `workflow_approval`,
baik pemohon maupun pegawai yang dikoreksi (login yang tertaut saat permintaan,
dipotret di `subject_tenant_user_id`, dan yang tertaut sekarang) tidak boleh menjadi
penyetuju atau menyelesaikannya (CHECK, trigger atas baris keputusan workflow
termasuk delegat yang bertindak atas nama salah satunya, chokepoint, dan handler;
pengecualian rantai atasan sengaja tidak termasuk), dan
instance workflow dimulai tanpa fakta. Koreksi yang instan usulannya lebih jauh ke
masa depan daripada skew tenant ditolak saat dibuat dengan `422
ATTENDANCE_TIME_IN_FUTURE` (guard event akan menolaknya saat persetujuan dan
koreksi tertahan `pending` selamanya); tanggal masuk dan terminasi employment tidak
diperiksa, karena guard event tidak memeriksa keduanya untuk event bersumber-koreksi.
Putusan diterapkan otomatis: consumer domain-event `hr_workforce.attendance_correction_settler` (#998, ADR-0134) memanggil `settleCorrection` yang sama dengan `POST .../attendance-corrections/{id}/settle` saat `workflow_approval` menerbitkan event `approved` / `rejected` / `cancelled` milik instance-nya (dispatcher berjalan sebagai `awcms_worker` dengan grant sempit `sql/280`); penolakan membiarkan koreksi `pending` dengan baris audit `auto_settle_skipped` dan route manual tetap ada. Setelah penyelesaian otomatis berhasil, consumer mengantrekan satu e-mail ke pemohon (#1044): capability opsional `workflow_notification`, baris outbox yang dikirim kemudian oleh `email:dispatch`, satu template per hasil (`hr.attendance_correction_applied` / `_rejected` / `_cancelled`, EN/ID) yang menyebut pegawai dan tanggal dan tak pernah alasan; INSERT worker pada `awcms_email_messages` dibatasi per kolom (`sql/302`). Pemohon boleh menyelesaikan koreksinya sendiri yang rejected / cancelled (tidak ada yang diterapkan); persetujuan tetap dipisahkan. Mencatat event untuk orang lain diaudit (setiap event `supervisor`, dan event `kiosk`/`import` yang ditandai `late`). Dasar baca: sendiri (`?mine=true`, setiap employment pemanggil yang hidup, jadi
orang yang dipekerjakan kembali membaca yang lama dan yang baru) dan
rantai atasan di bawah pemanggil (`?reports=true`) adalah ownership grant pada route
BACA; employment yang di-soft-delete memutus rantai. Kunci permission yang ditambahkan
adalah `clock.create`, `attendance.create`/`read`, dan
`corrections.create`/`read`/`cancel`/`approve`. Daftar lengkap penundaan ada di
README modul.

### 4.3 Bukti geolokasi, foto, dan perangkat

**Keputusan pemilik O6 (dijawab 2026-10-10, DoR awcms-one):** kehadiran
**boleh** memakai **geolokasi saja** — **tanpa foto, tanpa biometrik, dan tanpa
sidik-jari perangkat, selamanya** — dan **mati secara default per tenant**.
**Diputuskan di ADR-0138 (Diterima, 2026-10-12) dan diimplementasikan oleh
Issue #970 (`sql/306`): tabel, dua permission (`attendance_evidence.read`,
`geolocation_evidence.configure`), evaluator geofence, dan route di bawah
`/api/v1/hr-workforce/geolocation/*` sudah ada, dan saklar mati untuk setiap tenant
sampai seseorang yang memegang permission khusus mengaktifkannya dengan rujukan
DPIA, pemberitahuan, dan geofence.**
Posisi yang dilaporkan klien dapat dipalsukan: putusan adalah indikator
pendukung untuk ditinjau manusia, bukan bukti, dan tidak memutuskan apa pun
sendiri. `attendance_evidence.read` berlaku seluruh tenant dan khusus HR (belum
ada scope atasan). Penghapusan putusan mengikuti batas retensi menunggu
keputusan penasihat hukum, dan mengaktifkan fitur di tenant mana pun menunggu
persetujuan itu (ADR-0138, "Status implementasi"). Keputusannya:

- **Bukti hanya-putusan.** Hanya pada `clock_in`/`clock_out`, server
  mengevaluasi satu sampel posisi terhadap geofence tenant dan menyimpan putusan
  (`inside`/`outside`/`not_provided`) dengan pita jarak dan akurasi kasar.
  **Tidak ada koordinat yang pernah tersimpan**, di log, event, baris audit, atau
  ekspor. Koordinat mentah dan dibulatkan, putusan di klien, serta jendela mentah
  berumur pendek ditolak.
- **Tabel append-only terpisah** yang terhubung ke event (tidak ada kolom lokasi
  pada `awcms_hr_attendance_events`), sehingga bukti dipurge tanpa menyentuh
  event yang relevan untuk gaji.
- **Mati untuk setiap tenant**; mengaktifkan butuh
  `hr_workforce.geolocation_evidence.configure` (tidak di-seed ke peran bawaan),
  rujukan DPIA tercatat, versi pemberitahuan terbit, dan geofence; diaudit pada
  `critical`. Mematikan selalu boleh.
- **Pengakuan pemberitahuan** per karyawan adalah bukti pemberitahuan, bukan
  persetujuan sebagai dasar hukum; menolak mencatat `not_provided` dan tidak
  pernah memblokir clock.
- **Dibatasi tujuan:** hanya kehadiran di lokasi sah; putusan selain `inside`
  menaikkan bendera tinjauan manusia dan tidak memutuskan apa pun otomatis.
- **Daftar pembaca:** `hr_workforce.attendance_evidence.read` untuk HR dan
  supervisor dalam cakupan, baris milik sendiri lewat `ownershipGrant`;
  penjadwal, kasir, pemasar, dan operator payroll tidak punya jalur.
- **Retensi** lewat descriptor `data_lifecycle` yang dibuat bersama tabelnya
  (30 / 90 / 180 hari min / bawaan / maks, hard delete, tanpa arsip, legal hold
  menimpa), plus descriptor subject-data untuk ekspor dan penghapusan (ADR-0094).
- **Dikecualikan eksplisit:** foto, biometrik, sidik-jari perangkat atau pengenal
  jaringan; koordinat tersimpan; pelacakan atau riwayat; lokasi di luar dua
  event; panggilan provider; keputusan merugikan otomatis; posisi dari kiosk atau
  impor.

Opsi foto (disimpan lewat `media_library`) serta opsi biometrik atau sidik-jari
perangkat yang masih dibiarkan terbuka oleh draf awal bagian ini tetap
**dihapus**: pemilik mengecualikannya.

### 4.4 Shift dan deteksi konflik

`awcms_hr_shift_templates`: `code`, `name`, `local_start` (waktu), `duration_minutes`
(1–1440), `break_offset_minutes` dan `break_minutes` (opsional), `time_zone`
(IANA), `office_id` opsional, soft-delete. Template adalah **pola**.
`awcms_hr_shift_assignments`: `employment_id`, `template_id` opsional, `kind`
(`work`, `time_off`), `starts_at`, `ends_at` (UTC `timestamptz`, setengah-terbuka
`[starts_at, ends_at)`, `ends_at > starts_at`, work ≤ 24 jam, time off ≤ 31 hari),
satu istirahat opsional `[break_starts_at, break_ends_at)` di dalam interval,
snapshot `time_zone`, `office_id`, `status` (`draft`, `published`, `cancelled`).
**Materialisasi** template menjadi penugasan me-resolve jam dinding lokal ke UTC
sekali, saat penugasan, dan menyimpan keduanya; menyunting template kemudian tidak
pernah menggeser penugasan yang ada. Shift malam adalah interval yang melewati
tengah malam, bukan baris berkunci tanggal. Time off membawa `time_off_kind` kasar
(`leave`, `holiday`, `other`) dan **tidak pernah alasan**: cuti sakit adalah data
kesehatan.

**Aturan konflik.** Untuk satu kepegawaian, tidak ada dua penugasan dengan
`status <> 'cancelled'` yang boleh tumpang tindih sebagai interval setengah-terbuka,
**lintas kind** (work di atas time off bentrok). Pelanggaran adalah `409
SHIFT_CONFLICT` yang hanya menyebut id penugasan yang bentrok. Penegakan: satu
transaksi yang mengunci baris kepegawaian `FOR UPDATE`, memeriksa tumpang tindih,
lalu menulis. **Sebagaimana dibangun (Issue #946, `sql/184`):** trigger `BEFORE
INSERT OR UPDATE` mengambil advisory lock lingkup-transaksi berkunci (tenant,
employment) lalu menolak baris non-batal yang tumpang tindih (`23P01`,
`HR_SHIFT_CONFLICT`); handler mengambil lock yang sama dan memeriksa lebih dulu,
sehingga penolakan adalah `409` bernama dan bukan transaksi yang teracuni, dan sesi
pemeliharaan pun tidak bisa membuat tumpang tindih. Constraint eksklusi `btree_gist`
tidak dipakai (ekstensinya butuh `CREATE EXTENSION` berhak-istimewa yang tak diminta
migrasi mana pun di repo ini; `sql/171` mencatat keputusan yang sama). Hanya penugasan `published` yang terlihat oleh port ketersediaan.
Penugasan terbit dibatalkan, tidak pernah dihapus.

## 5. Port ketersediaan staf

### 5.1 Tujuan dan kepemilikan

Booking (Issue #915, ADR-0131) harus tahu kapan seorang staf dapat dipesan. Ia
membacanya lewat `StaffAvailabilityPort`, tidak pernah tabel, tidak pernah cache
event dari skema keluarga ini, dan tidak pernah sesuatu yang dekat kompensasi. Port
adalah interface TypeScript murni di
`src/modules/_shared/ports/staff-availability-port.ts` (dibuat PR fase 1; tidak
mengimpor apa pun dari modul mana pun, ADR-0011); adapternya hidup di
`hr_workforce` dan membaca **hanya** `awcms_hr_shift_assignments` dan
`awcms_hr_employment_terms`. Composition root Booking (route atau job-nya)
menyuntikkan adapter.

### 5.2 Kontrak

```ts
export type StaffAvailabilityQuery = {
  /** Referensi staf opak (= employment id), 1..200, duplikat digabung. */
  staffRefs: readonly string[];
  /** Awal jendela, TERMASUK. Instan UTC ISO 8601 berakhiran `Z`. */
  fromUtc: string;
  /** Akhir jendela, TIDAK TERMASUK. Harus setelah `fromUtc`; rentang paling banyak 35 hari. */
  toUtc: string;
  /** Opsional: hanya interval yang ditugaskan ke kantor ini. */
  officeId?: string;
};

export type AvailabilityInterval = {
  startUtc: string; // termasuk
  endUtc: string; // tidak termasuk
};

export type StaffAvailability = {
  staffRef: string;
  /** `unknown` = tidak dapat dijamin: tidak ditemukan, tenant lain, soft-deleted,
   *  tidak aktif sepanjang jendela. Sengaja tak dapat dibedakan. */
  status: "resolved" | "unknown";
  /** Waktu kerja, terurut, saling lepas, digabung, dipotong ke jendela. Kosong
   *  bila `unknown`. Array kosong dengan `resolved` berarti "tidak dijadwalkan
   *  untuk apa pun". */
  intervals: readonly AvailabilityInterval[];
};

export type StaffAvailabilityResult = {
  asOf: string; // instan server saat jawaban dihitung
  staff: readonly StaffAvailability[];
};

export interface StaffAvailabilityPort {
  getAvailability(
    tx: TenantTx,
    query: StaffAvailabilityQuery
  ): Promise<StaffAvailabilityResult>;
}
```

### 5.3 Semantik (normatif)

- **Instan dan interval.** Setiap instan adalah UTC. Setiap interval setengah-terbuka
  `[start, end)`: awal termasuk, akhir tidak termasuk. Dua interval yang akhir satu
  sama dengan awal yang lain **berdampingan dan digabung**, sehingga konsumen tidak
  pernah melihat sambungan selebar nol. Jendela setengah-terbuka dengan cara yang
  sama; hasil **dipotong** ke jendela.
- **Tidak ada tanggal lokal melewati port.** Konsumen mengonversi hari lokal bisnis
  ke UTC sendiri; port tidak menerima maupun mengembalikan tanggal lokal atau zona,
  sehingga zona Indonesia (WIB UTC+7, WITA UTC+8, WIT UTC+9) dan aturan DST di masa
  depan adalah urusan konsumen dan tidak bisa berbeda antara kedua sisi. Penugasan
  di-resolve ke UTC saat dibuat (§4.4), sehingga suntingan template kemudian tidak
  mengubah apa pun.
- **Apa yang dihitung sebagai waktu kerja.** Gabungan penugasan `work` `published`
  yang tak-batal, **dikurangi** gabungan penugasan `time_off` `published` dan
  **dikurangi** istirahat tiap penugasan, untuk kepegawaian yang terms-nya `active`
  pada instan itu. Terms `on_leave`, `suspended`, dan `terminated` tidak
  menyumbang apa pun.
- **Gagal-tertutup.** Apa pun yang tidak dapat dijamin adapter adalah `unknown`
  dengan interval kosong. Tidak ada "tersedia secara default" dan tidak ada
  pembedaan "tidak ada" dari "tidak aktif" (tanpa oracle keberadaan).
- **Terbatas.** Paling banyak 200 staf dan jendela 35 hari per panggilan; permintaan
  lebih besar ditolak `400` dan harus dipecah pemanggil. Ukuran hasil dibatasi staf
  × penugasan di jendela.
- **Tanpa paparan payroll, secara struktural.** Hasil memiliki tiga field per staf:
  `staffRef`, `status`, `intervals`. Tanpa nama, kantor, kode template, label kind,
  grade, tarif, atau atribut HR apa pun. SQL adapter hanya menyebut jadwal
  (`awcms_hr_shift_assignments`), terms (`awcms_hr_employment_terms`) dan header
  employment (`awcms_hr_employments`, karena soft-delete ada di sana; tak satu pun
  memuat nama atau tarif); tes gagal bila pernah menyebut tabel kompensasi, payroll, atau komisi.
  Port ini membaca, jadi tidak membawa tulis dan tidak ada event.
- **Otorisasi dan audit.** Port tidak mengotorisasi dan tidak mengaudit apa pun
  (seperti didokumentasikan `InventoryLedgerPort`): composition root konsumen
  mengotorisasi izin _miliknya sendiri_ sebelum memanggil. Panggilan berjalan di
  `tx` ber-scope tenant milik pemanggil, sehingga FORCE RLS berlaku.
- **Tanpa hold.** Jawaban adalah pembacaan, bukan reservasi. Booking harus
  memeriksa ulang saat commit; `asOf` memungkinkannya mengetahui usia jawaban.
  `awcms.hr.shift.assigned` (§10) memungkinkannya membatalkan cache.

### 5.4 Kewajiban konsumen

Me-resolve nama tampilan lewat resource sendiri atau `profile_identity`, tidak
pernah dari port ini. Memperlakukan `unknown` sebagai tidak dapat dipesan. Tidak
menyimpulkan alasan ketidakhadiran seseorang dari celah. Tidak pernah mencatat
hasil lengkap beserta referensi staf pada level `info`.

## 6. Desain Komisi (fase 2)

### 6.1 Aturan dan ledger akrual

`awcms_hr_commission_rules`: `rule_key`, `version`, `status` (`draft`, `published`,
`retired`), `effective_from`, `effective_to`, `calculation` (`percent` dari jumlah
basis, atau `fixed` per unit), `rate` atau `fixed_amount`, `currency_code`,
`rounding_mode`, `source_type` yang dicakup. Versi published dan retired
**immutable** (trigger); perubahan adalah versi baru. Aturan yang dipakai pada
akrual adalah yang **berlaku pada `occurred_at` event**, tidak pernah `now()`.

> **Mendarat di #950 (hanya aturan).** `percent` dan `fixed` (per unit utuh) ada,
> ditambah batas bawah dan atas opsional yang dikenakan pada jumlah yang sudah
> dibulatkan; `status` bergerak `draft` → `published` → `retired` (draft juga boleh
> di-retire); jendela published tidak boleh tumpang-tindih dengan versi published
> lain dari aturan yang sama (trigger, dikunci advisory). Evaluasi adalah
> `src/modules/hr-commission/domain/hr-commission-evaluation.ts` yang murni (string
> desimal `bigint`, tanpa tier, tanpa bahasa ekspresi). Buku besar di bawah mendarat di #951.
>
> **Mendarat di #951 (buku besar, tanpa reversal).** `awcms_hr_commission_accruals`
> dan `awcms_hr_commission_transitions` (`sql/188`; permission `sql/189`);
> `operation` untuk sementara hanya `accrue` dan `amount` karenanya tidak negatif
> (baris negatif reversal adalah langkah berikutnya). Mesin statusnya `pending →
approved → payable → paid`, dan `voided` dari `pending` atau `approved`; log hanya
> ditulis oleh trigger milik akrual, sehingga status dan log tak dapat menyimpang.
> **Aturan berlaku-surut (diputuskan di #951, `sql/187`):** aturan dipilih dari
> tanggal event itu sendiri, sehingga mempublikasikan versi yang jendelanya dimulai
> sebelum hari ini (UTC) mengubah aturan mana yang berlaku untuk event yang belum
> diakrualkan; publish demikian membutuhkan `backdatedReason` (409 bila tidak ada),
> database menstempel `publish_backdated` dan menolak publish tanpa alasan walau
> aplikasi dilewati, dan baris audit hanya membawa flag-nya. Akrual yang sudah ada
> mengutip aturannya lewat foreign key dan tak pernah berubah. **PS-19** dirancang,
> belum dibangun: `paid` final dan dicapai sekali, indeks parsial melayani pemilihan
> `FOR UPDATE SKIP LOCKED` atas akrual payable, dan reversal tak pernah membuka
> kembali aslinya; catatan klaim milik #962. Belum: reversal, event
> `awcms.hr.commission.*`, baca-sendiri, dan scope `office`.

`awcms_hr_commission_accruals` adalah ledger. Fakta moneter —
`employment_id`, snapshot `rule_id` dan `rule_version`, `source_type`,
`source_ref`, `source_line`, `operation` (`accrue`, `reversal`), `base_amount`,
snapshot `rate`, `amount` bertanda, `currency_code`, `occurred_at` — **immutable**.
Hanya `status` dan capnya yang maju, oleh trigger transisi.
`awcms_hr_commission_transitions` adalah log append-only siapa memindahkan apa
kapan.

### 6.2 Akrual tepat-sekali

Kunci unik `(tenant_id, source_type, source_ref, source_line, employment_id,
operation)`. Adapter hilir memanggil port (`src/modules/_shared/ports/commission-accrual-port.ts`) dengan
identitas sumber; memposting identitas yang sudah ada dengan permintaan kanonis
yang sama mengembalikan yang asli (`replayed: true`); jumlah atau aturan berbeda
untuk identitas yang sama adalah `409 SOURCE_CONFLICT`. `employment_id` ada di
kunci agar satu baris sumber dapat dibagi antar staf, masing-masing mengakru sekali.
Ledger **mempercayai sumber pemanggil** persis seperti ledger inventaris (ia dapat
membuktikan sumber tidak diposting dua kali, bukan bahwa pesanan itu ada):
memverifikasi bahwa pesanan nyata, dibayar, dan milik aktor adalah kewajiban
adapter, ditulis dalam dokumentasi port. Header `Idempotency-Key` tambahan wajib
pada endpoint akrual HTTP.

### 6.3 Siklus hidup dan reversal

Lihat §8 untuk diagram. `pending → approved` (manajer selain penerima manfaat),
`approved → payable` (`release`), `payable → paid` (dicatat `accruals.pay`, atau
oleh run payroll finalized di fase 3). `voided` hanya dari `pending|approved`:
belum ada uang yang dikomit, tanpa baris kompensasi. Setelah `payable`, kesalahan
atau penjualan yang dikembalikan adalah **reversal**: akrual **baru** dengan
`operation = reversal`, `amount` negatif, `reverses_accrual_id`, di bawah identitas
sumbernya sendiri; fakta moneter yang asli tidak disentuh dan statusnya diberi cap
`reversed`. Reversal atas akrual yang sudah `paid` diperhitungkan oleh payroll
berikutnya (baris negatif), tidak ditarik dari run yang sudah tertutup. Reversal
sekali per akrual (unique index parsial) dan reversal tidak dapat di-reverse.

**Void berdasarkan identitas sumber (Issue #1109).** `CommissionAccrualPort.void`
membalik akrual sebuah `(sumber, employment)` bagi konsumen yang mem-void,
mengembalikan, atau membatalkan penjualan, tanpa konsumen mengetahui id modul ini.
Akrual `pending` atau `approved` menjadi `voided` (hasil `voided`; baris audit,
event `awcms.hr.commission.voided`, dan baris log transisi ditulis dalam transaksi
pemanggil); replay adalah `already_voided` dan tidak menulis apa pun; sumber yang
tidak dikenal adalah `not_found`. Akrual `payable` atau `paid` **ditolak sebagai
`period_closed`** dan tidak ada yang ditulis: sebelum baris reversal di atas ada,
tidak ada cara membalik uang yang mungkin sudah dipegang payroll tanpa melanggar
PS-19, sehingga kasus tertutup ditolak dan diserahkan ke manusia, tidak pernah
di-void diam-diam. Kontrak port: `commission_accrual` 1.1.0. Rincian:
`src/modules/hr-commission/README.id.md`.

**Login penerima di-snapshot (Issue #1019, `sql/236`/`sql/237`).** Pemisahan tugas
perlu tahu siapa penerimanya. Login employment (`tenant_user_id`) dapat dilepas dan
ditautkan kembali oleh pemegang `hr_workforce.employments.assign`, maka akrual
menstempel login itu saat lahir (`beneficiary_tenant_user_id`, diisi trigger; nilai
dari penulis dibuang; tak berubah seperti semua fakta moneter), dan approve, release,
serta pay ditolak untuk login hasil snapshot MAUPUN login saat ini. Bila employment
tak punya login tertaut maupun snapshot, penerima tak dapat diidentifikasi dan
transisi ditolak (**fail closed**, `409 BENEFICIARY_LOGIN_UNRESOLVED`) sampai sebuah
login ditautkan; `void` tetap boleh. Konsekuensi: komisi karyawan tanpa login tak
dapat disetujui, dirilis, atau dibayar sebelum login ditautkan.

### 6.4 Batas

Ini **komisi pegawai**: penerimanya selalu sebuah kepegawaian (sehingga ada orang
dengan identitas, kantor, dan atasan). Pembayaran afiliasi atau referral punya
penerima eksternal, ketentuan lain, dan ledger modul lain; paling banyak desain ini
adalah pola yang boleh mereka salin. **Konsumen event sumber** — baris pesanan yang
dibayar, reservasi yang selesai — adalah **adapter hilir** di repositori konsumen;
keluarga ini tidak mengimpor commerce maupun booking, dan adapter, bukan modul ini,
yang memutuskan event mana yang dapat dikomisikan.

## 7. Desain Payroll (fase 3)

### 7.1 Kompensasi dan rekening pembayaran

`awcms_hr_compensation`: versi **append-only, berlaku-efektif** per kepegawaian —
`effective_from`, `pay_basis` (`monthly`, `daily`, `hourly`), `base_amount`,
`currency_code`, `status` (`proposed`, `approved`, `rejected`), `proposed_by`,
`approved_by`. Perubahan diusulkan satu orang dan disetujui orang berbeda (guard
persetujuan-diri); `approved_by <> proposed_by` juga CHECK. Versi yang
`effective_from`-nya jatuh di periode **terkunci** ditolak (`backdate` adalah aksi
berisiko tinggi untuk kasus lebih sempit: periode terbuka sebelum hari ini).
`awcms_hr_payout_accounts`: referensi bank atau dompet per kepegawaian,
klasifikasi `sensitive`; **diputuskan oleh [ADR-0137](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md)
(hanya desain; belum ada yang diimplementasikan)**: nomor rekening hanya disimpan
sebagai ciphertext AES-256-GCM dengan id kunci di dalam nilai dan baris terikat
sebagai associated data, HMAC berkunci terikat tenant (`account_hash`, ring kunci
terpisah) untuk pencarian kesamaan, dan mask; **tidak ada kolom
`normalized_value` plaintext** (berbeda dari pola identifier pemasok ADR-0128,
yang hash tanpa kuncinya tidak dipakai di sini).

### 7.2 Periode, run, baris, slip gaji

`awcms_hr_payroll_periods`: `period_key` (`2026-10`), `starts_on`, `ends_on`,
`pay_date`, `status` (`open`, `locked`), cap kunci. **Tidak ada unlock**; kesalahan
di periode terkunci dikoreksi dengan reversal, dengan koreksi mengalir sebagai baris
penyesuaian ke periode terbuka berikutnya. `awcms_hr_payroll_runs`: `period_id`,
`run_no`, `kind` (`regular`, `off_cycle`, `reversal`), `status`, id **versi aturan**
dan versi kompensasi yang dipakai (snapshot), hitungan dan total (`numeric`, string
desimal di wire), dan satu cap aktor per transisi. `awcms_hr_payroll_run_lines`:
`run_id`, `employment_id`, `element_code`, `element_kind` (`earning`, `deduction`,
`employer_contribution`, `withholding`), `amount`, `basis`, `rule_version_id`,
ditambah **input non-pribadi** yang dipakai (menit kerja, jumlah unit) — tidak pernah
salinan gaji di luar jumlah itu sendiri. `awcms_hr_payslips`: satu per kepegawaian
per run, diturunkan saat finalisasi, **immutable**, `released_at` (pegawai
melihatnya hanya setelah rilis), `acknowledged_at`. Rincian slip dibaca dari baris.
Slip reguler unik per `(tenant, period, employment)` selama belum di-reverse:
pegawai dibayar sekali per periode per run reguler.

**Perhitungan membaca kehadiran dan komisi sebagai snapshot**: ringkasan kehadiran
(menit kerja dan lembur) dan akrual komisi payable dibaca **lewat dua port internal
keluarga** (bentuk ditunda ke PR fase 3) saat perhitungan dan dicatat pada baris.
Koreksi kehadiran kemudian tidak pernah mengubah run finalized; ia mengalir ke
periode berikutnya.

### 7.3 Aturan sebagai data berlaku-efektif

`awcms_hr_pay_rule_sets` / `awcms_hr_pay_rule_versions` mengikuti pola modul pajak
(ADR-0127): versi immutable setelah diterbitkan, berlaku-efektif, dan diterbitkan
dengan maker/checker. Versi diambil dari **himpunan jenis perhitungan tertutup** —
`fixed`, `percent` (dengan floor/cap), `progressive_bracket` (tingkat marginal),
`lookup` (kategori dan rentang basis memilih tarif) — atas komponen run yang diberi
nama (bruto, dasar kena pajak, dasar iuran). **Tidak ada mesin ekspresi dan tidak
ada `eval`**. Mesinnya **netral yurisdiksi**: tidak memuat tarif, batas, kategori,
maupun nama regulasi.

**Profil Indonesia (data aturan, bukan konstanta).** Isu menyebut PPh 21 menurut
PMK 168/2023, PP 49/2025, dan BPJS. Paket ini tidak menegaskan isinya: parameter
(bracket pemotongan bulanan menurut kategori status dengan penyesuaian berkala, tarif
iuran dan batas upah, pengali lembur, tunjangan hari raya) harus **ditranskripsi dari
teks regulasi oleh peninjau bernama, dengan kutipan dan tanggal berlaku disimpan pada
versinya**, dan regulasi berikutnya datang sebagai **versi baru**, tidak pernah
suntingan. **Keputusan pemilik O4 (dijawab 2026-10-10, DoR awcms-one): profil
payroll Indonesia dimiliki masing-masing konsumen.** Upstream hanya mengirim
**mesin dan berlaku-efektif** serta **tanpa tarif, batas, kategori, maupun teks
regulasi Indonesia** — bukan sebagai data seed dan bukan sebagai paket data repo
ini. Konsumen yang membutuhkan profil itu menyusunnya sebagai versi aturan di
repositorinya sendiri di bawah aturan provenans di atas (peninjau bernama,
kutipan, dan tanggal berlaku pada setiap versi) dan menanggung tinjauan
hukumnya sendiri. Cakupan profil itu (hanya PPh 21, atau juga BPJS, lembur, dan
tunjangan hari raya) karenanya keputusan konsumen, bukan upstream; regulasi yang
disebut di atas menggambarkan apa yang akan ditranskripsi profil konsumen dan
bukan komitmen paket ini.

### 7.4 Finalisasi, imutabilitas, dan koreksi

Run finalized immutable **di database**: trigger hanya mengizinkan transisi di §8
dan, per transisi, hanya kolom cap; `awcms_app` tidak memegang DELETE dan tabel
baris dibekukan sejak `approved`. **Koreksi adalah reversal:** run `reversal`
memposting baris yang meniadakan yang asli (merujuknya), yang asli diberi cap
`reversed`, dan run reguler baru menghitung ulang. Tidak ada yang disunting. Angka
run finalized dapat direproduksi dari snapshot-nya (versi aturan, versi kompensasi,
input kehadiran dan komisi), dan pembacaan rekonsiliasi (§14) membuktikan baris
berjumlah total run dan slip berjumlah baris.

### 7.5 Pemisahan tugas (keputusan pemilik O7 — terjawab: dapat dikonfigurasi per tenant)

Tugas adalah izin terpisah: **C** hitung (`runs.calculate`), **A** setujui
(`runs.approve`), **F** finalisasi (`runs.finalize`), **P** bayar (`runs.pay`),
**R** reverse (`runs.reverse`), ditambah **K** tulis kompensasi
(`compensation.update`) dan **U** terbitkan aturan (`rules.publish`).

| Pasangan dipegang satu orang             | Mode ketat (default) | Mode longgar | Mekanisme tingkat peran                                                                 |
| ---------------------------------------- | -------------------- | ------------ | --------------------------------------------------------------------------------------- |
| C × A (hitung dan setujui)               | dilarang             | **dilarang** | aturan SoD, `global_within_tenant`, `critical`, tanpa pengecualian; plus CHECK database |
| A × P (setujui dan bayar)                | dilarang             | **dilarang** | aturan SoD, `critical`, tanpa pengecualian; plus CHECK database                         |
| C × P (hitung dan bayar)                 | dilarang             | boleh        | hanya CHECK database per-instance (lihat "Aturan mana yang tingkat peran" di bawah)     |
| C × F, F × P                             | dilarang             | boleh        | hanya CHECK database per-instance                                                       |
| A × F (setujui dan finalisasi)           | **boleh**            | **boleh**    | tingkat tugas sama, F membekukan apa yang disetujui A                                   |
| K × A (ubah gaji dan setujui run)        | dilarang             | **dilarang** | aturan SoD, `critical`, tanpa pengecualian                                              |
| U × A (terbitkan aturan dan setujui run) | dilarang             | **dilarang** | aturan SoD, `high`                                                                      |
| R × P (reverse dan bayar)                | dilarang             | **dilarang** | aturan SoD, `high`                                                                      |
| S × (C, A, F, atau P) (lihat di bawah)   | dilarang             | **dilarang** | aturan SoD, `critical`, tanpa pengecualian                                              |

**Keputusan pemilik O7 (dijawab 2026-10-10, DoR awcms-one) dan catatan
keputusannya, ADR-0136: pemisahan tugas dapat dikonfigurasi per tenant.** Kolom
ketat adalah **default**: hitung ≠ setujui ≠ bayar. Tenant boleh **melonggarkannya**
menjadi **siapkan ≠ setujui**, dan **pelonggaran itu diaudit**. Belum ada yang
diimplementasikan; penegakannya mendarat di Issue #957.

- **Mode.** Pengaturan per tenant `payroll_sod_mode` ∈ {`strict` (default),
  `relaxed`} pada pengaturan modul. Pada mode `relaxed` tugas _penyiap_ — C, F,
  dan P — boleh dipegang satu orang, tetapi **penyetuju (A) tetap harus orang
  berbeda dari yang menghitung dan dari yang membayar**; setiap pasangan lain yang
  ditandai dilarang di kolom longgar tidak berubah. Tenant sangat kecil karenanya
  butuh **dua** orang berbeda untuk run itu sendiri, bukan tiga. Mode ketat butuh
  setidaknya **tiga orang berbeda**. Pengecualian C × P berbatas waktu yang dulu
  **dicabut**: CHECK per-instance toh akan menolaknya, dan cara sah agar satu
  orang menghitung dan membayar adalah melonggarkan seluruh tenant, yang diaudit
  dan dicap pada setiap run.
- **Izin yang tidak dipegang kedua sisi (O7a, bagian 2).** Mengubah mode adalah
  izin **S = `hr_payroll.sod_policy.configure`** (resource `sod_policy`, aksi
  `configure` yang sudah ada, berisiko tinggi). Aturan SoD melarang satu orang
  memegang S bersama C, A, F, atau P, tanpa pengecualian: penyiap tidak boleh bisa
  melonggarkan pemeriksaan yang mengikatnya, dan penyetuju tidak boleh bisa
  menentukan cakupan pemeriksaan atas keputusannya sendiri. S dipegang
  administrator tenant yang tidak mengerjakan tugas payroll. Tenant payroll dua
  orang karenanya butuh principal ketiga **hanya untuk konfigurasi, bukan per
  run**; tenant tanpa principal semacam itu tetap ketat. Dukungan tingkat
  platform tidak boleh memegang S atas nama tenant. Mengubah mode juga butuh
  `Idempotency-Key`, kode alasan, step-up bersyarat ADR-0141 §4 saat
  **melonggarkan** (mengetatkan diaudit tetapi tidak menuntut step-up), dan
  menulis baris audit berseverity `critical` yang memuat aktor serta mode
  sebelum/sesudah tanpa teks bebas. Setiap run mencatat mode yang berlaku saat
  dihitung (`sod_mode`, immutable setelah `calculate`), dan setiap baris audit run
  mode-longgar memuat `sodMode: "relaxed"`, sehingga mengubah pengaturan kemudian
  tidak pernah mengubah run yang sedang berjalan.
- **Aturan per-instance di database.** `approved_by <> calculated_by` dan
  `approved_by <> paid_by` berlaku **di kedua mode, tanpa syarat**.
  `finalized_by <> calculated_by` dan `paid_by` berbeda dari `calculated_by` dan
  `finalized_by` berlaku bila `sod_mode = 'strict'` pada run; inilah yang dilepas
  pelonggaran. Guard persetujuan-diri yang sudah ada juga berlaku pada `approve`
  di kedua mode.
- **Aturan mana yang tingkat peran (konsekuensi untuk dikonfirmasi di #957).**
  Deskriptor aturan SoD adalah data statis hanya-kode (ADR-0031) dan tidak bisa
  membaca pengaturan tenant. Aturan tingkat peran pada C × P, C × F, atau F × P
  karenanya akan menolak penugasan bahkan pada mode longgar. Ketiga pasangan itu
  ditegakkan **hanya per-instance** di database (bersyarat pada `sod_mode`);
  pasangan yang berlaku di kedua mode adalah aturan tingkat peran **dan** CHECK
  tanpa syarat. Biayanya: pada mode ketat orang yang memegang C dan P ditolak saat
  aksi kedua dilakukan, bukan saat peran ditugaskan.
- **O7a, diputuskan (ADR-0136).** "Siapkan ≠ setujui" melonggarkan tepat C × P,
  C × F, dan F × P. Ia **tidak** membolehkan penyetuju menghitung atau membayar.
  Ditolak: melonggarkan hanya C × A (penyetuju boleh membayar, yang menghapus
  kendali atas uang yang keluar dan menciptakan kembali pasangan fraud klasik
  setujui-dan-bayar), dan tidak melonggarkan apa pun tetapi mewajibkan tenant
  menambah orang (tidak memenuhi kebutuhan tenant kecil pemilik). Analisis penuh
  di ADR.
- **Amandemen ADR-0132, diselesaikan.** ADR-0132 menyatakan aturan per-instance
  "tidak bisa dikonfigurasi hilang". ADR-0136 mengamandemennya: aturan A ≠ C dan
  A ≠ P tidak bisa dikonfigurasi hilang; aturan C/F/P di antara mereka sendiri
  hanya dilepas oleh mode `relaxed` yang diaudit.

#### Matriks uji SoD (tes wajib untuk issue implementasi fase 3, #957)

Setiap baris adalah tes integrasi terhadap database nyata sebagai role runtime,
menegaskan kedua arah (aktor yang diizinkan bisa; setiap aktor lain tidak). C, A,
F, P, S seperti di atas; Alice, Bob, dan Carol adalah tiga pengguna tenant berbeda
dari satu tenant kecuali dinyatakan lain.

| #     | Mode    | Skenario                                                                                                          | Diharapkan                                                                                                                                                                | Lapisan               |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| SOD1  | ketat   | Alice menghitung, Bob menyetujui, Carol membayar                                                                  | tiap langkah berhasil                                                                                                                                                     | semua                 |
| SOD2  | ketat   | Alice menghitung lalu menyetujui run yang sama                                                                    | ditolak (`403`); tanpa perubahan state                                                                                                                                    | database + guard      |
| SOD3  | ketat   | Bob menyetujui, lalu Bob membayar                                                                                 | bayar ditolak                                                                                                                                                             | database              |
| SOD4  | ketat   | Alice menghitung, Bob menyetujui, Alice membayar                                                                  | bayar ditolak                                                                                                                                                             | database              |
| SOD5  | ketat   | Alice menghitung, Bob menyetujui, Alice memfinalisasi; dan Bob menyetujui, Carol memfinalisasi, Carol membayar    | finalisasi pertama ditolak; bayar kedua ditolak (F × P)                                                                                                                   | database              |
| SOD6  | ketat   | Alice menghitung, Bob menyetujui dan memfinalisasi, Carol membayar                                                | berhasil (A × F boleh)                                                                                                                                                    | database              |
| SOD7  | longgar | Alice menghitung, Bob menyetujui, Alice memfinalisasi dan membayar                                                | berhasil; setiap baris audit memuat `sodMode: "relaxed"`                                                                                                                  | database + audit      |
| SOD8  | longgar | Alice menghitung, Alice menyetujui                                                                                | ditolak                                                                                                                                                                   | database              |
| SOD9  | longgar | Alice menghitung, Bob menyetujui, Bob membayar                                                                    | bayar ditolak                                                                                                                                                             | database              |
| SOD10 | alih    | run dihitung pada mode ketat, lalu tenant melonggarkan, lalu run difinalisasi dan dibayar Alice                   | run tetap ketat (finalisasi atau bayar oleh penghitung ditolak)                                                                                                           | database (cap run)    |
| SOD11 | alih    | run dihitung pada mode longgar, lalu tenant mengetatkan                                                           | run tetap `relaxed`; A ≠ C dan A ≠ P tetap berlaku                                                                                                                        | database              |
| SOD12 | alih    | memperbarui `sod_mode` suatu run setelah `calculate`                                                              | ditolak (immutable)                                                                                                                                                       | trigger database      |
| SOD13 | alih    | mengubah mode tenant tanpa S                                                                                      | `403`; pengaturan tak berubah; tanpa baris audit perubahan                                                                                                                | otorisasi             |
| SOD14 | alih    | mengubah mode dengan S, sekali dengan dan sekali tanpa `Idempotency-Key`; key yang sama diulang                   | tanpa key ditolak; berhasil menulis tepat satu baris audit `critical` dengan mode sebelum/sesudah tanpa teks bebas; ulangan mengembalikan hasil pertama tanpa baris kedua | idempotency + audit   |
| SOD15 | alih    | melonggarkan dengan S saat principal terdaftar MFA dan tanpa step-up terbaru; mengetatkan pada kondisi sama       | melonggarkan butuh step-up; mengetatkan tidak                                                                                                                             | step-up (ADR-0141 §4) |
| SOD16 | alih    | nilai mode tidak valid, atau catatan teks bebas di payload                                                        | `400`; tidak ada yang tersimpan                                                                                                                                           | validasi              |
| SOD17 | peran   | menugaskan S dan salah satu C, A, F, atau P ke satu pengguna (masing-masing dari keempatnya, dan lewat dua peran) | ditolak saat penugasan (`sod_conflict`); saat aksi, pemegang yang sudah ada ditolak                                                                                       | penugasan SoD + aksi  |
| SOD18 | peran   | menugaskan C × A, A × P, K × A, U × A, R × P ke satu pengguna                                                     | masing-masing ditolak saat penugasan, di kedua mode; tak ada pengecualian yang diterima                                                                                   | penugasan SoD         |
| SOD19 | peran   | menugaskan C dan P ke satu pengguna pada mode ketat, pada mode longgar                                            | penugasan berhasil di keduanya (pasangan ini hanya per-instance); aksi kedua pada mode ketat ditolak seperti SOD4                                                         | penugasan + database  |
| SOD20 | peran   | mencoba pengecualian C × P berbatas waktu                                                                         | pengecualian semacam itu tidak ada (dicabut); permintaan ditolak                                                                                                          | pengecualian SoD      |
| SOD21 | isolasi | tenant T1 longgar, tenant T2 ketat; pengguna T2 beraksi pada run T2                                               | T2 tetap ketat; pengaturan dan baris audit T1 tak terlihat oleh T2 (RLS)                                                                                                  | RLS                   |
| SOD22 | mesin   | token API tanpa izin melakukan hitung, setujui, bayar, atau perubahan mode                                        | ditolak (`403`)                                                                                                                                                           | otorisasi             |

Finalize, pay, dan reverse sebaiknya mensyaratkan step-up principal bila terdaftar,
diterapkan **secara bersyarat** sebagaimana diresepkan ADR-0141 §4 (step-up tanpa
syarat adalah jebakan); aturan persisnya diputuskan di PR fase 3.

## 8. State machine

```
Koreksi kehadiran:      pending ──approve──> approved (menambah event pengganti)
                           │ ──reject──> rejected      └─withdraw─> withdrawn

Penugasan shift:        draft ──publish──> published ──cancel──> cancelled
                          └─────────────cancel──────────────────> cancelled

Akrual komisi:          pending ──approve──> approved ──release──> payable ──pay──> paid
                           │                   │                     │             │
                           └────void───────────┘                     └──reverse────┴─> reversed
                                (tak ada uang bergerak)                (baris negatif baru)

Periode payroll:        open ──lock──> locked              (tanpa unlock)

Run payroll:            draft ──calculate──> calculated ──approve──> approved
                          │  ^ recalc ┘          │                     │
                          │                      └──────cancel─────────┤
                          └────────cancel────────────────────────────> cancelled
                        approved ──finalize──> finalized ──pay──> paid
                        finalized|paid ──reverse──> reversed       (lewat run reversal)

Slip gaji:              diturunkan saat finalize (immutable) ──release──> released
```

Setiap mesin ditegakkan trigger `BEFORE UPDATE` yang mengizinkan tepat transisi itu
dan, per transisi, hanya kolom yang boleh diubahnya (pola ADR-0128 §4), sehingga
imutabilitas adalah sifat data, bukan handler. Event kehadiran, transisi, dan event
run append-only (tanpa hak UPDATE/DELETE dan trigger). Tidak ada di keluarga ini yang
di-hard-delete oleh role aplikasi.

## 9. ERD dan kamus data

```
awcms_profiles (profile_identity) <--(tenant_id,profile_id)-- awcms_hr_employments
awcms_tenant_users <--(0..1)-- awcms_hr_employments 1--n awcms_hr_employment_terms --> awcms_offices
                                       | 1--n  awcms_hr_attendance_events  1--n corrections
                                       | 1--n  awcms_hr_shift_assignments <-- awcms_hr_shift_templates
                                       | 1--n  awcms_hr_commission_accruals --> _commission_rules, _transitions
                                       | 1--n  awcms_hr_compensation, _payout_accounts
awcms_hr_payroll_periods 1--n awcms_hr_payroll_runs 1--n _run_lines, _payslips, _run_events
awcms_hr_pay_rule_sets 1--n awcms_hr_pay_rule_versions   (run mem-snapshot id versi)
```

### Fase 1 (`hr_workforce`)

| Tabel                             | Memuat                                                                        | Hak `awcms_app`                         | Klasifikasi                                |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| `awcms_hr_workforce_settings`     | batas selisih jam, kunci workflow koreksi; **tanpa pengaturan bukti**         | SELECT, INSERT, UPDATE                  | internal                                   |
| `awcms_hr_employments`            | FK `profile_id`, `employee_no`, `hired_on`, `tenant_user_id`, cap soft-delete | SELECT, INSERT, UPDATE (tanpa DELETE)   | rahasia (menautkan orang ke pemberi kerja) |
| `awcms_hr_employment_terms`       | kantor, atasan, jabatan, jenis, status berlaku-efektif                        | SELECT, INSERT, UPDATE (hanya menutup)  | rahasia                                    |
| `awcms_hr_attendance_events`      | event append-only                                                             | SELECT, INSERT                          | rahasia (data perilaku)                    |
| `awcms_hr_attendance_corrections` | perubahan yang diusulkan, alasan, id instance workflow, status                | SELECT, INSERT, UPDATE (hanya status)   | rahasia; teks alasan sensitif              |
| `awcms_hr_shift_templates`        | pola                                                                          | SELECT, INSERT, UPDATE (soft delete)    | internal                                   |
| `awcms_hr_shift_assignments`      | interval UTC, kind, status                                                    | SELECT, INSERT, UPDATE (status, terbit) | rahasia                                    |

### Fase 2 (`hr_commission`)

| Tabel                             | Memuat                                     | Hak `awcms_app`                       | Klasifikasi                     |
| --------------------------------- | ------------------------------------------ | ------------------------------------- | ------------------------------- |
| `awcms_hr_commission_rules`       | aturan berversi                            | SELECT, INSERT, UPDATE (hanya draft)  | rahasia                         |
| `awcms_hr_commission_accruals`    | ledger; fakta immutable + status yang maju | SELECT, INSERT, UPDATE (hanya status) | rahasia (penghasilan seseorang) |
| `awcms_hr_commission_transitions` | log transisi append-only                   | SELECT, INSERT                        | rahasia                         |

### Fase 3 (`hr_payroll`)

| Tabel                         | Memuat                                     | Hak `awcms_app`                                                       | Klasifikasi  |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------------- | ------------ |
| `awcms_hr_compensation`       | versi gaji berlaku-efektif                 | SELECT, INSERT, UPDATE (hanya status)                                 | **sensitif** |
| `awcms_hr_payout_accounts`    | referensi bank atau dompet, mask, hash     | SELECT, INSERT, DELETE (diaudit)                                      | **sensitif** |
| `awcms_hr_payroll_periods`    | periode dan kunci                          | SELECT, INSERT, UPDATE (hanya kunci)                                  | rahasia      |
| `awcms_hr_payroll_runs`       | header run, id snapshot, total, cap aktor  | SELECT, INSERT, UPDATE (dibatasi trigger)                             | **sensitif** |
| `awcms_hr_payroll_run_lines`  | jumlah per pegawai per elemen              | SELECT, INSERT, UPDATE/DELETE hanya selama draft/calculated (trigger) | **sensitif** |
| `awcms_hr_payslips`           | slip gaji turunan immutable                | SELECT, INSERT, UPDATE (`released_at`, `acknowledged_at`)             | **sensitif** |
| `awcms_hr_payroll_run_events` | log event run append-only                  | SELECT, INSERT                                                        | rahasia      |
| `awcms_hr_pay_rule_sets`      | identitas set aturan                       | SELECT, INSERT, UPDATE                                                | internal     |
| `awcms_hr_pay_rule_versions`  | aturan immutable berlaku-efektif + kutipan | SELECT, INSERT, UPDATE (hanya draft)                                  | internal     |

Uang dan kuantitas adalah `numeric`, **string** desimal di wire, tidak pernah
float. Setiap referensi lintas tabel, termasuk ke `awcms_profiles`,
`awcms_offices`, `awcms_tenant_users`, dan antar tabel HR, adalah foreign key
komposit `(tenant_id, id)`, sehingga RLS bukan satu-satunya tembok antara sebuah
kepegawaian dan data tenant lain. Setiap foreign key diindeks
(`db:fk-index:check`). Total fase 3 dihitung database dalam `numeric` eksak; klien
tidak pernah dapat menegaskan status, total, atau snapshot (body yang menyebutnya
adalah `400` yang menyebut field-nya).

## 10. Event sementara

Hanya didefinisikan di sini. Channel AsyncAPI, entri
`ModuleDescriptor.events.publishes`, dan produsen mendarat bersama fase pemiliknya.
Namespace keluarga adalah `awcms.hr.*`, mengikuti
`awcms.<area>.<entity>.<verb>` (bandingkan `awcms.procurement.document.finalised`);
pemetaan modul produsen persisnya dikonfirmasi ketika channel pertama ditambahkan.
Semuanya lewat outbox event domain **dalam transaksi produsen**; panggilan yang
ditolak atau di-replay tidak menerbitkan apa pun.

| Event                          | Fase | Kapan                                                             | Payload (hanya id, jenis, hitungan)                                                             |
| ------------------------------ | ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `awcms.hr.attendance.recorded` | 1    | event kehadiran baru (bukan replay) disimpan                      | `eventId`, `employmentId`, `kind`, `occurredAt`, `source`, `officeId`                           |
| `awcms.hr.shift.assigned`      | 1    | penugasan menjadi `published` (dan saat batal, `cancelled: true`) | `assignmentId`, `employmentId`, `kind`, `startsAt`, `endsAt`, `cancelled`                       |
| `awcms.hr.commission.accrued`  | 2    | akrual baru diposting (bukan replay)                              | `accrualId`, `employmentId`, `sourceType`, `ruleKey`, `ruleVersion`, `operation`                |
| `awcms.hr.commission.approved` | 2    | akrual disetujui                                                  | `accrualId`, `employmentId`                                                                     |
| `awcms.hr.commission.voided`   | 2    | akrual di-void (HTTP atau port; **dipancarkan sejak #1109**)      | `accrualId`, `employmentId`, `sourceType`, `ruleKey`, `ruleVersion`, `fromStatus`, `reasonCode` |
| `awcms.hr.payroll.finalized`   | 3    | run difinalisasi                                                  | `runId`, `periodKey`, `kind`, `employeeCount`, `currencyCode`                                   |
| `awcms.hr.payroll.reversed`    | 3    | run di-reverse                                                    | `runId`, `reversalRunId`, `periodKey`, `employeeCount`                                          |

**Tidak ada event yang membawa jumlah, nama, identifier, catatan, atau alasan.**
Konsumen keuangan yang membutuhkan total membacanya lewat pembacaan terotorisasi di
transaksinya sendiri. Tenant berpegawai tunggal jika tidak akan membocorkan gaji
lewat "agregat". Envelope: pesan `DomainEvent` dari
[`asyncapi/awcms-domain-events.asyncapi.yaml`](../../asyncapi/awcms-domain-events.asyncapi.yaml).
Konsumen adalah adapter dalam-tenant; keluarga ini tidak mendaftarkan satu pun.

## 11. Izin, RLS, masking, audit, dan idempotensi

### 11.1 Matriks izin dan RLS

Semua route adalah `defineTenantRoute`, mengotorisasi lewat
`authorizeInTransaction` (ADR-0063), default-deny, dan setiap izin di-seed migrasi
fasenya, diberikan ke **tidak ada** peran, dan sampai ke tenant yang sudah ada lewat
`identity-access:permissions:backfill`. Kunci berbentuk
`<module>.<activity>.<action>`. "**own**" = juga dapat dijangkau lewat
`ownershipGrant` pada `tenant_user_id` tersimpan (§12). "scope" = business scope
`office` dapat membatasinya.

| Modul · aktivitas            | Aksi (risiko)                                                                                                                                                         | Catatan                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `hr_workforce` · employments | read (scope), create, update, delete, restore, **assign** (tautkan akun, tinggi)                                                                                      | `assign` adalah dasar layanan mandiri                                  |
| · attendance                 | read (**own**, scope), create (**own** = clock; orang lain untuk supervisor/kiosk)                                                                                    | aman-replay lewat `client_event_key`                                   |
| · corrections                | read (**own**, scope), create (**own**), cancel (tarik kembali); keputusan lewat izin `workflow.*`                                                                    | persetujuan wajib, gagal-tertutup                                      |
| · shifts                     | read (**own**, scope), create, update, **publish** (tinggi), cancel                                                                                                   | `shifts.*` tak pernah menyiratkan `compensation.*`                     |
| · templates                  | read, create, update, delete                                                                                                                                          |                                                                        |
| · settings                   | read, **configure** (tinggi)                                                                                                                                          |                                                                        |
| `hr_commission` · rules      | read, create, update, **publish** (tinggi), **retire** (tinggi)                                                                                                       |                                                                        |
| · accruals                   | read (**own**, scope), create (port/adapter), **approve** (tinggi), **cancel**=void (tinggi), **release** (tinggi), **pay** (tinggi, aksi baru), **reverse** (tinggi) | penerima manfaat tak dapat menyetujui sendiri (guard persetujuan-diri) |
| `hr_payroll` · compensation  | read, create, **approve** (tinggi)                                                                                                                                    | gaji; tak ada daftar yang menampilkan jumlah tanpa `read`              |
| · payout_accounts            | read (ter-mask), update, **reveal** (tinggi)                                                                                                                          | `no-store`, diaudit, step-up sesuai keputusan fase 3                   |
| · periods                    | read, create, **lock** (tinggi)                                                                                                                                       | tanpa unlock                                                           |
| · runs                       | read (scope), create, **calculate** (tinggi, baru), **approve** (tinggi), **finalise** (tinggi), **pay** (tinggi, baru), **reverse** (tinggi), cancel (tinggi)        | §7.5                                                                   |
| · payslips                   | read (**own**), **release** (tinggi)                                                                                                                                  | pegawai melihat miliknya hanya setelah rilis                           |
| · rules                      | read, create, **publish** (tinggi), **retire** (tinggi)                                                                                                               |                                                                        |
| · sod_policy                 | read, **configure** (tinggi, resource baru; tak pernah dipegang bersama C, A, F, atau P)                                                                              | §7.5, ADR-0136                                                         |

Tabel: setiap tabel memiliki `tenant_id`, RLS `ENABLE` + `FORCE`, policy dengan
`USING` dan `WITH CHECK`, diuji sebagai role runtime (`awcms_app`) termasuk bahwa ia
tidak dapat membaca atau menulis baris tenant lain. `awcms_worker` diberi `SELECT`
hanya pada sumber proyeksi yang dibacanya. `awcms_app` **tidak memegang DELETE**
pada tabel mana pun kecuali dua yang disebut matriks. **RLS memisahkan tenant,
bukan tugas**: pemisahan antara penjadwal dan gaji adalah izin dan tabel terpisah,
itulah sebabnya SQL adapter ketersediaan diuji agar tidak menyebut tabel payroll.

### 11.2 Masking dan data sensitif

| Data                             | Tempat hidup                  | Ditampilkan                                                                         | Tidak pernah di                               |
| -------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Nama, kontak, alamat             | hanya `profile_identity`      | sesuai aturan `profile_identity`                                                    | tabel HR, event, log mana pun                 |
| NIK, NPWP                        | identifier `profile_identity` | ter-mask; di-resolve server oleh run bila perlu, tidak pernah disalin polos ke slip | tabel HR, log, audit, event, ekspor           |
| Gaji / jumlah dasar              | `awcms_hr_compensation`       | hanya untuk `compensation.read`; tidak ada di tampilan daftar                       | log, audit, event, respons lain               |
| Rekening bank/dompet             | `awcms_hr_payout_accounts`    | hanya mask; polos lewat satu `reveal` beraudit                                      | log, audit, event, ekspor                     |
| Jumlah slip gaji                 | baris run, slip               | pemilik (setelah rilis) dan `payslips.read` / `runs.read`                           | notifikasi (pemberitahuan tak membawa jumlah) |
| Alasan kehadiran, alasan koreksi | koreksi                       | pemohon, penyetuju, `corrections.read`                                              | baris audit, event                            |
| Jenis time-off                   | penugasan                     | hanya jenis kasar; tidak pernah alasan                                              | —                                             |

`account_ciphertext`, `account_hash`, dan `account_mask` rekening pembayaran adalah `redactedColumns` dan
tidak pernah ikut ekspor. Uang dalam respons adalah string desimal; di log tidak ada.

### 11.3 Audit dan idempotensi

| Aksi                                     | `Idempotency-Key`       | Level audit                                                                             | Replay                                                                  |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| buat kepegawaian / ubah terms            | ya                      | info                                                                                    | `employee_no` unik                                                      |
| tautkan atau ubah `tenant_user_id`       | ya                      | warning                                                                                 | pemeriksaan status                                                      |
| event kehadiran                          | ya + `client_event_key` | tidak ada (volume tinggi; event ITU catatannya)                                         | mengembalikan yang asli                                                 |
| permintaan / keputusan koreksi           | ya                      | info                                                                                    | pemeriksaan status; keputusan workflow diaudit oleh `workflow_approval` |
| terbitkan / batalkan shift               | ya                      | info                                                                                    | pemeriksaan status                                                      |
| akru komisi (adapter)                    | ya                      | info                                                                                    | identitas sumber mengembalikan yang asli                                |
| setujui / rilis / bayar / reverse akrual | ya                      | warning (reverse: critical)                                                             | pemeriksaan status + reversal unik                                      |
| usul / setujui kompensasi                | ya                      | warning                                                                                 | pemeriksaan status                                                      |
| tambah / hapus rekening pembayaran       | ya                      | warning                                                                                 | acknowledgement seragam (tanpa oracle)                                  |
| **reveal** rekening pembayaran           | tidak (pembacaan)       | warning, mencatat BAHWA pengungkapan terjadi, tidak pernah apa                          | —                                                                       |
| **pembacaan** sensitif (§13.3)           | tidak (pembacaan)       | info sekali per aktor, jenis, dan jendela; warning di tiap dekade pembacaan atau record | —                                                                       |
| **ekspor** dan unduhan ekspor (§13.3)    | tidak (pembacaan)       | warning, setiap kali, tidak pernah digabung                                             | —                                                                       |
| kunci periode                            | ya                      | critical                                                                                | pemeriksaan status                                                      |
| buat / **hitung** run                    | ya                      | info / warning                                                                          | `(period, run_no)` unik; pemeriksaan status                             |
| **setujui** run                          | ya                      | warning                                                                                 | pemeriksaan status                                                      |
| **finalisasi** run                       | ya                      | warning                                                                                 | pemeriksaan status; finalisasi kedua mengembalikan yang pertama         |
| **bayar** run                            | ya                      | warning                                                                                 | pemeriksaan status; pembayaran unik per run                             |
| **reverse** run                          | ya                      | critical                                                                                | sekali per run (unique index parsial)                                   |
| terbitkan / pensiunkan aturan            | ya                      | warning                                                                                 | pemeriksaan status                                                      |

Tidak ada baris audit yang membawa jumlah, nama, identifier, catatan, atau teks
alasan; correlation id menggabungkan baris audit, event outbox, dan baris ledger
apa pun. Replay tidak mengaudit apa pun.

## 12. Skenario penerimaan RBAC/ABAC (pernyataan yang dapat diuji)

Setiap pernyataan adalah tes integrasi yang harus ditulis isu implementasi terhadap
database nyata sebagai role runtime, lulus dua arah (aktor yang disebut dapat;
setiap aktor lain tidak). "Mekanisme" adalah apa yang sudah ada di repositori ini.

| #   | Pernyataan                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Mekanisme                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Pegawai dengan peran dasar saja membaca event kehadiran **miliknya sendiri** dan **tidak dapat** membaca milik pegawai lain (keduanya `403`).                                                                                                                                                                                                                                                                                                                                 | `ownershipGrant` untuk `attendance.read`, dihitung server dari `employment.tenant_user_id === ctx.tenantUserId`; hanya melebarkan, ABAC/tenant/SoD tetap menolak; decision log mencatat `ownership_grant:<reason>`.                              |
| S2  | Pegawai membaca **slip gaji miliknya yang sudah dirilis** dan tidak dapat membacanya sebelum rilis, maupun milik orang lain.                                                                                                                                                                                                                                                                                                                                                  | `ownershipGrant` pada `payslips.read` ditambah predikat status (`released_at IS NOT NULL`) pada kueri handler; tanpa atribut baru.                                                                                                               |
| S3  | Pegawai clock-in untuk dirinya sendiri; pegawai yang sama tidak dapat mencatat kehadiran rekan kerja.                                                                                                                                                                                                                                                                                                                                                                         | `ownershipGrant` pada `attendance.create` terbatas pada kepegawaian sendiri; mencatat untuk orang lain membutuhkan kunci `attendance.create` yang tidak dimodifikasi.                                                                            |
| S4  | Supervisor yang ditugaskan ke kantor O membaca kehadiran dan koreksi untuk kepegawaian **di O dan turunannya**, bukan kantor lain.                                                                                                                                                                                                                                                                                                                                            | business scope `office` dengan `requiredScopeType=office`, `requiredScopeId=<kantor kepegawaian>`, `requiredScopeRelations=["exact","descendant"]` dan adapter hierarki yang ada (ADR-0060); scope tak ter-resolve menolak aksi berisiko tinggi. |
| S5  | Supervisor dapat menyetujui koreksi bawahan tetapi **tidak dapat menyetujui** koreksinya sendiri.                                                                                                                                                                                                                                                                                                                                                                             | keputusan `workflow_approval` + guard persetujuan-diri yang ada (`approve` dengan `requestedByTenantUserId`).                                                                                                                                    |
| S6  | Manajer melihat bawahan langsungnya meski tidak memegang scope pada kantor bawahan.                                                                                                                                                                                                                                                                                                                                                                                           | alasan `ownershipGrant` yang dihitung server (`manager_of`) dari rantai atasan tersimpan; **bukan** atribut ABAC (`resource.managerTenantUserId` membutuhkan penerimaan sendiri dan tidak diasumsikan).                                          |
| S7  | Penjadwal pemegang `shifts.*` membuat dan menerbitkan penugasan dan **menerima `403` pada setiap route `compensation.*`, `payout_accounts.*`, `runs.*`, dan `payslips.*`.**                                                                                                                                                                                                                                                                                                   | RBAC default-deny: izin terpisah, tak satu pun diberikan peran penjadwal; tabel terpisah.                                                                                                                                                        |
| S8  | Adapter ketersediaan, dijalankan dengan `tx` ber-scope tenant, mengembalikan interval kerja dan **tidak ada yang lain**; SQL-nya tidak pernah menyebut tabel kompensasi atau payroll.                                                                                                                                                                                                                                                                                         | DTO allow-list `StaffAvailabilityPort`; tes teks-sumber atas adapter (gaya sama dengan `access:chokepoint:check`).                                                                                                                               |
| S9  | Pengguna yang menghitung sebuah run **tidak dapat menyetujuinya**; penyetuju **tidak dapat membayarnya**; pengguna yang memegang kedua izin ditolak saat penugasan peran dan, pada waktu-aksi, di kedua mode SoD.                                                                                                                                                                                                                                                             | CHECK DB pada baris run (`approved_by <> calculated_by`, `paid_by` berbeda) **dan** `sodRules` atas kunci izin (`global_within_tenant`, `critical`); guard persetujuan-diri pada `approve`.                                                      |
| S9a | Pada mode SoD `relaxed` satu orang boleh menghitung dan membayar run, tetapi penyetuju tetap **tidak dapat** menjadi penghitung atau pembayarnya (keduanya ditolak database); mengalihkan tenant ke `relaxed` tanpa izin konfigurasi (`hr_payroll.sod_policy.configure`) adalah `403`, dan dengan izin itu menulis baris audit `critical` berisi mode sebelum/sesudah tanpa teks bebas; run yang dihitung pada mode `strict` tetap ketat bila tenant melonggarkan sesudahnya. | CHECK DB bersyarat pada `sod_mode` run yang immutable; izin pengaturan; baris audit.                                                                                                                                                             |
| S10 | Pengguna yang mengubah kompensasi pegawai tidak dapat menyetujui run payroll yang memuatnya; kompensasi yang diusulkan A tidak dapat disetujui A.                                                                                                                                                                                                                                                                                                                             | aturan SoD K × A; CHECK `approved_by <> proposed_by`; guard persetujuan-diri.                                                                                                                                                                    |
| S11 | Marketer CRM (memegang `crm.*` dan `profile_identity.profile_management.read`) dan resepsionis (memegang booking dan baca-shift saja) menerima `403` pada setiap route `compensation`, `payout_accounts`, `runs`, `payslips`, dan `commission.accruals` dan **tidak melihat gaji atau identitas nasional** lewat daftar profil (hanya nama; identifier ter-mask).                                                                                                             | RBAC default-deny: tanpa izin payroll `hr_*`; masking `profile_identity` tidak berubah; tabel payroll tak terjangkau tanpa kuncinya sendiri.                                                                                                     |
| S12 | Mengungkap rekening pembayaran tanpa `payout_accounts.reveal` adalah `403`; dengannya respons `no-store`, baris audit pada `warning` mencatat bahwa itu terjadi dan oleh siapa tetapi tidak pernah nilainya.                                                                                                                                                                                                                                                                  | aksi berisiko tinggi `reveal`; pola reveal procurement.                                                                                                                                                                                          |
| S13 | Dengan modul dinonaktifkan untuk tenant T, setiap route modul itu ditolak untuk T dan tabel T tidak tersentuh; payroll T2 tidak terpengaruh.                                                                                                                                                                                                                                                                                                                                  | enable/disable modul (`awcms_tenant_modules`); FORCE RLS.                                                                                                                                                                                        |
| S14 | Kredensial mesin (token API) tidak dapat menjalankan `ownershipGrant`.                                                                                                                                                                                                                                                                                                                                                                                                        | ADR-0063 §A mengecualikan kredensial mesin.                                                                                                                                                                                                      |
| S15 | Permintaan yang menyuplai `employment_id`, `profile_id`, atau `office_id` tenant lain ditolak, meski id itu ada.                                                                                                                                                                                                                                                                                                                                                              | FK komposit `(tenant_id, id)` ditambah FORCE RLS; handler membaca ulang di dalam `withTenant`.                                                                                                                                                   |

**Apa yang membutuhkan penerimaan baru, dinyatakan terus terang.** Pembatasan
per-bawahan lewat _kebijakan_ ABAC (alih-alih alasan kepemilikan yang dihitung
server), scope grade-payroll atau pusat-biaya, dan pohon unit organisasi HR
(tindak lanjut §4.1) masing-masing membutuhkan atribut allow-list ABAC baru atau
tipe business-scope baru dengan perluasan adapter. Tak satu pun diasumsikan;
skenario di atas dapat dipenuhi tanpa itu.

## 13. Analisis ancaman dan privasi

### 13.1 Ancaman

| Ancaman                                                                   | Kontrol                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baca atau tulis lintas tenant data kepegawaian atau gaji                  | FORCE RLS + FK komposit + `defineTenantRoute`; RLS diuji sebagai `awcms_app`                                                                                                                                                             |
| Penjadwal atau marketer membaca gaji (horizontal dalam-tenant)            | izin dan tabel terpisah; S7, S11; port ketersediaan adalah allow-list                                                                                                                                                                    |
| Penyalahgunaan layanan mandiri: pegawai membaca slip/kehadiran orang lain | `ownershipGrant` dihitung dari tautan tersimpan, tidak pernah dari permintaan; kredensial mesin dikecualikan                                                                                                                             |
| Pembajakan tautan akun: menautkan login saya ke kepegawaian rekan         | `assign` berisiko tinggi, diaudit, dapat di-SoD; mengubahnya adalah event                                                                                                                                                                |
| Penipuan payroll: orang dalam mengubah gaji, menjalankan, dan membayar    | usul/setujui kompensasi; CHECK DB per-instance C/A/P; run finalized immutable; kunci periode; koreksi hanya dengan reversal                                                                                                              |
| Pembayaran ganda (klik ganda, retry, replay)                              | pemeriksaan status + `Idempotency-Key` + slip unik per periode/pegawai + pembayaran unik per run                                                                                                                                         |
| Pemalsuan kehadiran (mundur-tanggal, clock-in hantu)                      | event append-only, `recorded_at` server, supersesi oleh koreksi disetujui, batas selisih; tanpa penyuntingan                                                                                                                             |
| Pencurian waktu oleh rekan yang clock-in untuk orang lain                 | mencatat untuk orang lain membutuhkan kunci tak-dimodifikasi, diaudit lewat `source` dan aktor; bukti geolokasi, bila pernah dibangun, ada di §4.3 (O6)                                                                                  |
| Inflasi ledger oleh sumber komisi palsu                                   | identitas sumber unik; kewajiban adapter memverifikasi (terdokumentasi); `approve` oleh pihak ketiga                                                                                                                                     |
| Kebocoran lewat event, log, ekspor, notifikasi                            | hanya id/hitungan; uang tidak ada di log; `redactedColumns`; pemberitahuan slip tanpa jumlah                                                                                                                                             |
| Rekening pembayaran polos saat diam                                       | hanya ciphertext, HMAC berkunci untuk pencarian, ring kunci dengan rotasi, gagal-tertutup bila kunci hilang: [ADR-0137](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md) (**diputuskan, belum diimplementasikan**) |
| Brute-force rekening dari kolom hash atau dump                            | HMAC dengan kunci terpisah terikat tenant (bukan hash tanpa kunci); kunci di luar database dan backup-nya; restore tanpa kunci tak dapat reveal (ADR-0137 §3, §6)                                                                        |
| Pemanenan massal rekening lewat `reveal`                                  | `reveal` berisiko tinggi, `no-store`, diaudit `warning`, step-up bersyarat, rate limit per aktor, `403` tanpa izin (ADR-0137 §4)                                                                                                         |
| Oracle keberadaan (apakah X pegawai? apakah X dijadwalkan?)               | `unknown` tak dapat dibedakan; acknowledgement seragam untuk penambahan identifier                                                                                                                                                       |
| Penyalahgunaan aturan (tarif pajak diubah agar under-withhold)            | versi aturan immutable setelah terbit, diterbitkan maker/checker, kutipan wajib, audit pada `warning`                                                                                                                                    |
| Perubahan gaji mundur-tanggal setelah periode ditutup                     | kunci periode; `backdate` berisiko tinggi; tanpa unlock                                                                                                                                                                                  |
| Panggilan penyedia di dalam transaksi                                     | tidak ada; integrasi bank/penyedia apa pun lewat outbox di isu berikutnya                                                                                                                                                                |
| Replay kehadiran offline memalsukan waktu                                 | keunikan `client_event_key`; flag `late` untuk ditinjau; koreksi membutuhkan persetujuan                                                                                                                                                 |

### 13.2 Privasi (UU PDP 27/2022)

Ini analisis desain, bukan nasihat hukum; penerapannya adalah penilaian per
deployment.

- **Subjek data dan kategori.** Pegawai dan pekerja. Data pribadi umum: identitas
  (lewat `profile_identity`), kepegawaian, kehadiran, dan jadwal. Keuangan: gaji,
  rekening bank, pemotongan. **Data pribadi bersifat spesifik** menurut undang-undang
  harus diperlakukan lebih hati-hati: kesehatan (alasan cuti sakit: karena itu tidak
  ada alasan time-off yang disimpan), dan berpotensi data biometrik atau geolokasi (karena itu bukti foto, biometrik, dan perangkat dikecualikan selamanya, dan bukti geolokasi mati secara default dan hanya-putusan, ADR-0138, O6).
- **Dasar hukum dan tujuan.** Pemrosesan untuk hubungan kerja dan kewajiban hukum
  pemberi kerja (ketenagakerjaan, pajak, jaminan sosial). Setiap kolom punya tujuan
  yang dinyatakan lewat rasional `subjectData`-nya; data di luar tujuan itu (foto,
  lokasi presisi) tidak dikumpulkan.
- **Pengendali / prosesor (O5).** Apakah operator platform adalah pengendali,
  prosesor, atau keduanya **per deployment** menentukan siapa menjawab permintaan
  subjek, siapa menandatangani ketentuan pemrosesan, dan siapa memberi tahu
  pelanggaran. Ini **keputusan pemilik O5 dan terbuka**. Yang dirancang terlepas dari
  itu: isolasi per tenant, cakupan data-subjek untuk setiap tabel (ADR-0094), dan
  ekspor yang membawa nilai ter-mask.
- **Minimisasi.** Tanpa salinan field identitas; tanpa bukti; jenis time-off kasar;
  event tanpa jumlah; pemberitahuan slip tanpa jumlah; NIK dan NPWP tetap di
  `profile_identity`.
- **Hak subjek.** Akses dan portabilitas: ekspor `subject-data` mencakup setiap tabel
  dengan nilai ter-mask. Perbaikan: riwayat berlaku-efektif dikoreksi dengan
  menambah, bukan menyunting, sehingga jejak audit tetap valid. Penghapusan:
  **dibatasi retensi hukum** — catatan kepegawaian, kehadiran yang dipakai untuk gaji,
  payroll, dan pajak dipertahankan selama periode yang diidentifikasi penasihat
  hukum pemberi kerja (tidak ditegaskan di sini), lalu dihapus oleh `data_lifecycle`;
  penghapusan _profil_ menganonimkan nama, sementara baris HR tetap dan me-resolve
  ke profil teranonimkan (sikap ADR-0128 §7), dan slip gaji adalah snapshot yang
  tidak ditulis ulang.
- **Retensi.** Event kehadiran dan riwayat shift dibatasi deskriptor
  `data_lifecycle`; baris keuangan dipertahankan selama usia tenant sampai ada
  desain arsip-lalu-purge (tindak lanjut tercatat, seperti ADR-0128 §7).
- **Pengamanan.** Enkripsi in-transit; kontrol akses di atas; rekening pembayaran
  dienkripsi saat diam (desain di ADR-0137, diimplementasikan sebelum fase 3 dirilis); audit atas reveal; penanganan backup
  mengikuti runbook yang ada, dan restore membutuhkan rekonsiliasi di §14.
- **Kesiapan pelanggaran.** Audit dan decision log menjawab "siapa membaca apa":
  reveal rekening pembayaran punya baris auditnya sendiri, dan pembacaan
  kompensasi, baris-baris per karyawan, dan slip gaji karyawan lain, serta setiap
  ekspor, dicatat oleh audit pembacaan sensitif (§13.3, PS-18); kewajiban
  notifikasi mengikuti hasil O5.
- **Penilaian dampak.** Fase 1 (tanpa bukti) adalah pemrosesan data kepegawaian
  rutin; fase 3 dan fitur bukti apa pun membutuhkan penilaian dampak terdokumentasi
  sebelum implementasi.

### 13.3 Pembacaan, salinan turunan, dan ekspor (PS-18, Issue #978)

Temuan PS-18 punya dua sisi: pembacaan gaji tidak meninggalkan jejak, dan tidak ada
yang mencegah proyeksi, indeks pencarian, atau ekspor menjadi salinan kedua yang
lebih lebar dari payroll. Kedua kontrolnya **generik dan sudah ada di repositori**,
sehingga route payroll pertama tidak bisa ditulis tanpa keduanya. Hari ini
keduanya berupa gerbang; mereka mulai menggigit pada hari `hr_payroll`
mendeklarasikan izin atau route pertamanya.

**A. Audit pembacaan sensitif.** `recordSensitiveRead(tx, { permission, actorTenantUserId,
itemCount, resourceIds })` (`src/modules/logging/application/sensitive-read-audit.ts`)
dipanggil route pada **transaksi yang sama** dengan pembacaan, setelah otorisasi
dan sebelum data dikembalikan. Ia mencatat aktor, jenis, id record berupa UUID
(20 per baris; daftar lebih panjang dipecah ke beberapa baris, tidak ada yang dibuang), dan jumlah, **tidak pernah jumlah uang, nama, atau teks
bebas**: id non-UUID ditolak, pesannya konstanta, dan tipe inputnya tidak punya
kolom untuk nilai. Ia **fail-closed**: bila penghitung atau insert audit gagal,
transaksi pembacaan dibatalkan.

| Izin                                                      | Jenis (aksi audit)               | Severity pembukaan | Jendela                          |
| --------------------------------------------------------- | -------------------------------- | ------------------ | -------------------------------- |
| `hr_payroll.compensation.read`                            | `sensitive_read.compensation`    | info               | 300 dtk                          |
| `hr_payroll.runs.read` (pembacaan header dan baris sama)  | `sensitive_read.run_lines`       | info               | 300 dtk                          |
| `hr_payroll.payslips.read` (bukan pembacaan pemiliknya)   | `sensitive_read.payslip`         | info               | 300 dtk                          |
| `hr_payroll.<apa pun>.export`                             | `sensitive_read.export`          | warning            | tanpa: tiap panggilan satu baris |
| `hr_payroll.<apa pun>.download` (berkas ekspor tersimpan) | `sensitive_read.export_download` | warning            | tanpa: tiap panggilan satu baris |

_Sadar-laju._ Penelusuran digabung per `(tenant, aktor, modul, jenis)` dalam
jendela tetap: pembacaan pertama membukanya dan menulis satu baris; pembacaan
berikutnya hanya menaikkan penghitung di `awcms_sensitive_read_windows` (`sql/224`,
satu baris per aktor dan jenis, ditimpa di tempat, sehingga terbatas dan tidak
butuh purge); baris lanjutan pada `warning` ditulis saat jumlah pembacaan
jendela mencapai 10, 100, 1000 ... atau jumlah record-nya mencapai 100, 1000 ...,
membawa total berjalan; satu panggilan yang mengembalikan 100 record atau lebih
membuka jendelanya pada `warning`. Pembaca yang menelusuri seribu kali
menghabiskan tiga baris. Jejak audit tetap append-only: penghitung hidup di
tabelnya sendiri. Karyawan yang membaca slip gaji **miliknya sendiri** yang sudah
dirilis (ownership grant) tidak dicatat; handler yang memutuskannya, dan audit
berlaku untuk setiap pembacaan lain. `reveal` rekening pembayaran tetap punya
baris warning-nya sendiri (§11.3).

_Ditegakkan._ `bun run sensitive-reads:check` (di `bun run check`) gagal bila
(1) sebuah berkas membangun guard `authorizeInTransaction` untuk izin di
`src/modules/_shared/sensitive-reads.ts` dan tidak memanggil `recordSensitiveRead`
dengan izin itu; (2) `hr_payroll` mendeklarasikan izin `read`, `list`, `export`,
atau `download` tanpa kebijakan maupun entri (beralasan) di `NOT_SENSITIVE_READS`:
default-deny, sehingga izin baca BARU tidak bisa tak-teraudit karena terlupa;
(3) kebijakan atau pengecualian menyebut izin yang tidak dideklarasikan modul.
Hari ini pengecualiannya `periods.read`, `rules.read`, `sod_policy.read`,
`payout_accounts.read` yang ter-mask, dan `payout_accounts.reveal` (baris warning-nya sendiri). Pemeriksaannya sintaktis (panggilan ada di
berkas yang menjaga izin, tidak dibuktikan di setiap jalur); helper itu sendiri
dibuktikan oleh `tests/integration/sensitive-read-audit.integration.test.ts`.

_Bentuk fail-closed (Issue #1014 L6)._ Gate yang sama juga menolak panggilan `recordSensitiveRead`
yang tidak di-`await` atau di-`return`, dirantai dengan `.catch`/`.then`/`.finally`, atau berada
di dalam `try` yang `catch`-nya tidak melempar ulang: masing-masing tetap mengembalikan data
walau audit gagal. Gate ini sintaktis, jadi route #957 dan #961 **juga** harus membuktikannya
lewat perilaku: panggil `expectAuditFailureYieldsNoData`
(`tests/fixtures/sensitive-read-fail-closed.ts`) dengan badan handler; ia menyuntikkan penulisan
audit yang gagal dan mewajibkan penolakan atau respons non-2xx tanpa data. **Tes route itu adalah
kriteria penerimaan #957 dan #961.**

**B. Data payroll tidak pernah keluar lewat permukaan turunan.**
`src/modules/_shared/payroll-data-boundary.ts` adalah satu-satunya daftar nama
tabel terlarang (`awcms_hr_payroll_*`, `awcms_hr_compensation`,
`awcms_hr_payout_accounts`, `awcms_hr_payslips`, tunggal dan jamak, skema atau
kutipan apa pun) ditambah modul pemilik `hr_payroll`. Setiap registry yang dapat
menyebut tabel menegakkannya, dan masing-masing menolak lagi saat SQL dibangun:
registry proyeksi reporting beserta tiga enginenya, registry sumber site-search,
registry resource comments, `edge-cache:surfaces:check` (berdasarkan pemilik,
kosakata payroll di key atau pola, tumpang-tindih dengan route yang dilayani
modul payroll, pola diuji sebagai regex terhadap path payroll konkret, dan namespace URL HR -
Issue #1014 L5), dan ekspor laporan (ekspor dibuat dari proyeksi, dan
`generateProjectionExport` menolak lagi saat menulis). Sebuah tes membaca
`module-contract.ts` dan gagal bila muncul tipe deskriptor **baru** yang menyebut
tabel, sehingga registry berikutnya harus memutuskan. Proyeksi reporting bersumber `domain_event`
tidak boleh mengonsumsi tipe event payroll (`awcms.hr.payroll.*`, `awcms.hr.commission.*`;
kosakata yang sama dengan path). Dua registry dikecualikan
dengan sengaja, masing-masing dengan kontrolnya sendiri: `subjectData` (baris
milik subjek sendiri, dengan `redactedColumns`; PS-17 mewajibkan setiap tabel
payroll punya satu) dan `dataLifecycle` (retensi dan legal hold; PS-17
mewajibkannya juga).

_Jalan menuju laporan payroll._ Hari ini tidak ada. Laporan atas data payroll
membutuhkan **semua**: izinnya sendiri (bukan `reporting.*` saja), ukuran kohort
minimum yang di bawahnya angka ditahan (agregat atas kohort satu orang adalah gaji
orang itu), ADR-nya sendiri yang memutuskan keduanya, audit pembacaan sensitif
pada setiap pembacaan dan ekspor, dan perubahan `payroll-data-boundary.ts` dalam PR
yang sama, yang membuat `tests/payroll-data-boundary.test.ts` gagal sampai ADR itu
ada.

**C. CSV bebas-formula.** Setiap penulis CSV lewat
`src/lib/security/csv-formula.ts`: sel yang diawali `=`, `+`, `-`, `@`, TAB, atau CR
diberi satu tanda kutip tunggal di depan (OWASP). Ekspor reporting sengaja lossy;
arsip `data_lifecycle` bersifat _reversible_ (nilai yang sudah diawali `'` plus
pemimpin juga diberi awalan, dan `read()` membuang tepat satu kutip), sehingga
restore mengembalikan byte aslinya. Angka bertipe ditulis sebagai angka; string
numerik tidak dipercaya. `tests/csv-formula-neutralisation.test.ts` memindai `src/`
dan gagal bila penulis CSV tidak memakai helper itu. Sejak Issue #1014 L4 pemindaiannya
struktural (`scripts/lib/csv-writer-scan.ts`): penulis adalah berkas mana pun yang
menggabungkan sel dengan `.join(",")` dan baris dengan newline, apa pun namanya (termasuk fungsi
panah), dan SETIAP sel yang digabung harus berupa panggilan helper atau literal header tetap;
meng-import helper tidak membuktikan apa pun, dan pengecualian hanya berlaku untuk heuristik
nama/`text/csv`, tidak pernah untuk berkas yang benar-benar menggabungkan sel.

**D. Pengerasan setelah audit keamanan (Issue #978).** Versi pertama A sampai C
lulus tinjauan dengan syarat; yang berikut diperbaiki dan menjadi bagian desain di
atas.

- _Penggabungan membuang pengulangan, tidak pernah identitas._ Baris jendela
  menyimpan himpunan terbatas (500) id record yang sudah diaudit di jendela itu;
  panggilan yang menyebut id di luar himpunan menulis baris audit berisi tepat id
  baru (`reason: new_ids`), apa pun hitungannya. Satu pembacaan umpan disusul
  delapan pembacaan satu-record yang tertarget meninggalkan sembilan baris berisi
  id. Hanya pembacaan ulang id yang sudah diaudit dan penghitung yang digabung.
  Jendela baru melupakan himpunan itu: jejak berlaku per jendela. Di atas batas,
  id diaudit ulang (lebih banyak baris, tidak pernah lebih sedikit).
- _Jendela memakai jam database_ (`clock_timestamp()`), bukan jam aplikasi; input
  `now` khusus uji hanya dihormati bila `NODE_ENV` adalah `test`.
- _Gerbang membaca guard seperti route menulisnya._ Sekitar 160 route memakai
  `authorize: GUARDS.x.y`, bukan literal inline; gerbang menyelesaikannya lewat
  definisi guard. Klasifikasi default-deny atas **semua** aksi modul sensitif:
  aksi yang tidak ada di `WRITE_SHAPED_ACTIONS` (create, update, approve,
  finalise, pay, ...) harus punya kebijakan atau pengecualian beralasan, sehingga
  `view`, `print`, atau `reveal` baru tidak lolos dari daftar kata kerja baca.
  Berkas yang menyebut modul sensitif dan punya referensi `authorize:` yang tidak
  terselesaikan, atau `activityCode` non-literal, gagal. Berkas sumber yang
  menyebut tabel batas payroll harus memanggil `recordSensitiveRead` dengan
  izin yang mencakup tabel ITU (`PAYROLL_TABLE_READ_PERMISSIONS`: mengaudit
  `compensation.read` tidak lagi membersihkan berkas yang juga membaca
  `payslips`; audit ekspor atau unduh dari modul yang sama dihitung) atau
  terdaftar beralasan di `PAYROLL_TABLE_SOURCE_EXEMPTIONS` (`module.ts` hanya
  deskriptor dan dikecualikan). Ledger yang dikecualikan dipercaya hanya karena
  pemanggilnya mengaudit, dan itu kini diperiksa, bukan sekadar ditulis: fungsi
  bacanya (`listAccruals`, `getAccrual`, `reconcileAccruals`) hanya boleh
  diimpor (bernama, namespace, default, diekspor ulang, atau dinamis) oleh berkas
  di `PAYROLL_READ_FUNCTION_IMPORTS`, dan masing-masing wajib memanggil
  `recordSensitiveRead` untuk `hr_commission.accruals.read` sendiri
  (Issue #1015). **Batas sintaktis yang diketahui:** nama tabel yang dirakit dari
  potongan string bukan token yang dapat dilihat pemindai (sisi SQL dari siasat
  itu ditutup lapisan katalog di bawah; sisi aplikasi ditahan review dan aturan
  5); resolusi impor berdasarkan nama berkas, bukan graf modul; dan panggilan
  terbukti ada di berkas, bukan di setiap jalur handler; panggilan di cabang mati,
  setelah return awal, atau di bawah kondisi yang selalu salah lolos. Tes tingkat
  route yang diminta kata penerimaan #957 dan #961 yang menutup lapisan
  berikutnya.
- _Pola batas._ Satu pola kini mencocokkan tabel mana pun dengan segmen kata-gaji
  utuh (`payroll`, `compensation`, `salary`, `wage`, `payslip`, `payout`, tunggal
  atau jamak, prefiks apa pun), sehingga `awcms_hr_compensations`,
  `awcms_hr_salary_history`, dan `awcms_hr_employee_compensation` termasuk.
  `bun run payroll:sql-boundary:check` membaca `sql/` dan menggagalkan view,
  materialized view, `CREATE TABLE ... AS`, `SELECT ... INTO`, atau
  `INSERT ... SELECT` atas tabel terlarang, rule yang melintasi batas, fungsi
  (termasuk `SETOF <tabel payroll>`) yang membaca salah satunya atau memanggil
  fungsi yang membacanya, serta trigger yang melintasi batas ke dua arah, kecuali
  objek baru itu sendiri bernama di keluarga payroll (maka setiap gerbang
  registry menolaknya). **Lapisan katalog (Issue #1015).** Pemindaian teks bisa
  disiasati (nama dirakit di blok `DO`, `;` di dalam literal, view diganti nama
  sesudahnya, rantai fungsi, badan trigger dalam kutip tunggal), jadi lapisan
  statis kini sadar-kutip, tak peka huruf besar, melipat `'a' || 'b'`, mengikuti
  penggantian nama dan rantai pemanggilan, serta memeriksa isi blok `DO` dan
  literal `EXECUTE`; dan aturan yang sama ditegakkan pada KATALOG HASIL MIGRASI
  oleh `tests/integration/payroll-catalog-boundary.integration.test.ts` (job
  integrasi CI) dan `bun run payroll:catalog-boundary:check` (database mana
  pun): `pg_rewrite`/`pg_depend` untuk view dan rule, `pg_proc` untuk fungsi yang
  mengembalikan, menerima, menyebut, atau memanggil payroll (dan `EXECUTE` mana
  pun di luar keluarga), `pg_trigger` untuk trigger, dan ACL, sehingga tabel
  payroll (atau kolomnya) yang diberikan ke selain `awcms_app`
  (`PAYROLL_ALLOWED_GRANTEES`; `PUBLIC` dan `awcms_worker` gagal) dan fungsi
  payroll SECURITY DEFINER yang dapat dieksekusi `PUBLIC` atau role lain gagal.
  Worker tanpa pengawasan hanya boleh menjalankan fungsi payroll bila namanya ada
  di `PAYROLL_WORKER_EXECUTE_ALLOWLIST` (kosong saat ini), tidak mengembalikan
  set, bertipe hasil `smallint`/`integer`/`bigint`/`boolean`, dan tanpa tipe baris
  payroll pada signature-nya: hitungan, bukan baris. Pemanggilan dikenali
  berkutip dan berkualifikasi skema (`public."awcms_x"()`). Lapisan statis juga
  mengikuti `WITH ... INSERT ... SELECT`, `WITH ... SELECT ... INTO`, dan
  `CREATE TABLE ... AS WITH`, serta menggagalkan blok `DO` migrasi mana pun yang
  menjalankan `EXECUTE` kecuali migrasinya ada di `PAYROLL_DO_EXECUTE_ALLOWLIST`
  beserta alasan (dua entri saat ini, tak satu pun terkait payroll). Salinan
  data sekali-jalan yang tidak meninggalkan objek tak terlihat oleh katalog dan
  ditahan lapisan statis untuk nama yang dapat diselesaikannya; nama yang baru
  ada saat runtime ditahan katalog begitu ia menjadi relasi atau fungsi.
  **Celah yang ditutup oleh Issue #1077** (sisa temuan Medium dari tinjauan
  keamanan #1015, masing-masing dibuktikan probe di
  `tests/payroll-catalog-boundary-1077.test.ts` dan, terhadap katalog nyata, di
  tes integrasi): _M1_, keluarga itu sebuah nama, sehingga tabel yang di-rename
  keluar membuat kedua lapisan diam: kedua tabel ledger kini membawa `COMMENT ON
TABLE ... IS 'payroll-boundary: ...'` (`sql/311`), lapisan katalog menggagalkan
  relasi bertanda tanpa nama keluarga, tabel keluarga tanpa tanda, dan tabel di
  `PAYROLL_REQUIRED_TABLES` yang tidak ada di `public` (sehingga rename yang juga
  menghapus komentar tetap tertangkap); lapisan statis menggagalkan `ALTER ...
RENAME TO` dan `SET SCHEMA` yang keluar dari keluarga (tabel, view, foreign
  table, fungsi), tabel baru berawalan `awcms_hr_commission_` /
  `awcms_hr_payroll_` yang namanya bukan nama keluarga, dan setiap tabel yang
  ditulis atau dideklarasikan modul pemilik payroll yang bukan nama keluarga
  maupun entri beralasan di `PAYROLL_OWNED_NON_PAYROLL_TABLES` (saat ini
  `awcms_hr_commission_rules`), sehingga tabel fase-3 (baris run, periode,
  aturan) tidak bisa jatuh keluar karena penamaan yang kurang beruntung. _M2_,
  fungsi SECURITY DEFINER non-keluarga tidak boleh memakai `schema_to_xml`,
  `query_to_xml`, `table_to_xml`, `regclass`, `format()`, `ts_stat`, `dblink`,
  atau identifier `U&"..."` (katalog: `function-indirect-read`, dikecualikan
  hanya lewat `PAYROLL_CATALOG_EXEMPTIONS`; statis: token yang sama di migrasi,
  dan `U&"..."` di mana pun). _M4_, lapisan katalog kini membaca kepemilikan
  relasi dan fungsi (role runtime tidak boleh memiliki payroll), `pg_auth_members`
  (tak ada role yang boleh mewarisi `awcms_app` atau pemilik payroll, secara
  transitif), publication (`FOR ALL TABLES`, tabel payroll, atau skema `public`),
  dan foreign table (nama payroll atau tabel remote payroll di opsinya); lapisan
  statis menggagalkan `COPY <payroll> TO` dan `COPY (SELECT ... payroll) TO`. _M5_
  DIPERSEMPIT untuk migrasi, belum ditutup: blok `DO` yang menjalankan
  `EXECUTE`, SETIAP fungsi dinilai saat dibuat (pernyataan di badannya dijalankan
  lewat analisis yang sama dengan blok `DO`, sehingga create-call-drop fungsi
  `LANGUAGE sql` atau plpgsql yang me-rename, menyalin, atau membaca payroll
  tertangkap), setiap `UPDATE ... SET (SELECT ... payroll)` / `UPDATE ... FROM
payroll` / `MERGE ... USING payroll`, dan setiap pemakaian helper yang
  menjalankan teks query atau membaca di luar SQL (`query_to_xml` dan
  saudaranya, `ts_stat`, `ts_rewrite`, `crosstab`, `connectby`, `dblink`,
  `lo_from_bytea`, `lo_import`, `lo_export`, `lo_put`, `pg_read_file`,
  `pg_read_binary_file`; dikutip atau tidak, dengan atau tanpa `(`) gagal
  kecuali migrasinya ada di `PAYROLL_DO_EXECUTE_ALLOWLIST`. Daftar helper itu
  hanyalah daftar: helper yang menjalankan teks query dan belum ada di sana
  adalah celah sampai ditambahkan. _M6_,
  sapuan `pg_depend` generik (`dependent-on-payroll`) menggagalkan setiap policy,
  constraint CHECK atau FOREIGN KEY, default kolom, ekspresi indeks, statistik
  tambahan, atau kolom bertipe baris payroll yang berada pada tabel non-keluarga
  dan bergantung pada relasi, fungsi, atau tipe baris payroll. _M7_, `scripts/`
  kini dipindai `sensitive-reads:check` (query id-saja pada laporan kesiapan dan
  registri lifecycle terdaftar di `PAYROLL_TABLE_SOURCE_EXEMPTIONS` beserta
  alasan), dan `accrueCommission` / `transitionAccrual` menjadi impor yang
  dijaga, sehingga pemanggil BARU harus disebut. Info: fungsi dalam bahasa selain
  `sql`/`plpgsql` adalah temuan (`function-opaque-language`), dan
  `payroll:catalog-boundary:check` kini berjalan di job CI dan rilis terhadap
  database yang dimigrasikan.
  **Pengerasan setelah audit keamanan #1077** (masing-masing dengan probe di
  `tests/fixtures/payroll-boundary-probes.ts`): _H1_, trik rename tertangkap di
  lebih banyak pintu masuk daripada `ALTER TABLE`: `ALTER INDEX|SEQUENCE|VIEW|
MATERIALIZED VIEW|FOREIGN TABLE|TYPE ... RENAME TO / SET SCHEMA`, `COMMENT ON
TABLE` terakhir pada tabel keluarga harus membawa penanda `payroll-boundary`,
  `DROP TRIGGER` pada tabel payroll ditolak dan `DISABLE TRIGGER` harus
  diaktifkan lagi di migrasi yang sama, dan lapisan katalog menegaskan setiap
  tabel wajib membawa trigger yang diharapkan (`PAYROLL_REQUIRED_TRIGGERS`) serta
  tak ada indeks, constraint, policy, atau trigger bernama keluarga pada relasi
  non-keluarga. _M3_, pola indirect-read mencocokkan nama yang dikutip dan
  berkualifikasi skema (`pg_catalog."format"(...)`) serta `ts_rewrite`,
  `crosstab`, `connectby`, `lo_*`, `pg_read_*file`. _M4_, anggota
  `pg_read_all_data`, `pg_write_all_data`, `pg_maintain`, dan role superuser atau
  `BYPASSRLS` apa pun adalah temuan, begitu juga role runtime ber-`BYPASSRLS`.
  _M5_ (pemilik), pemilik relasi payroll atau fungsi keluarga harus pemilik
  ledger migrasi (`awcms_schema_migrations`, ditemukan dari katalog) atau ada di
  `PAYROLL_EXPECTED_OWNERS`; `ALTER ... OWNER TO` pada objek keluarga dan
  `REASSIGN OWNED` ditolak secara statis. _M6_, port komisi dalam-proses
  (`createCommissionAccrualPort`) menjadi impor yang dijaga tersendiri tanpa
  pengimpor yang diizinkan. _L1_, `ALTER EXTENSION ... ADD` ditolak. _L2_,
  constraint CHECK domain masuk sapuan dependensi. _L3_, pemindaian baca-sensitif
  juga membaca `.mts`, `.cts`, `.jsx`, dan `.cjs`.
  **Modelnya, dinyatakan jujur.** Pemindaian statis dan pemeriksaan katalog
  adalah pertahanan berlapis terhadap kebocoran yang TIDAK SENGAJA dan yang
  KASAT MATA. Penulis migrasi bertekad yang lolos tinjauan masih bisa mengelabui
  pemindai teks, sehingga **tinjauan setiap perubahan `sql/` yang menyentuh
  payroll (CODEOWNERS dan tinjauan keamanan yang diwajibkan AGENTS.md untuk modul
  sensitif) tetap kendali utama**; tak ada yang di sini menggantikannya.
  Pengerasan audit kedua: literal ber-escape (`E'...'`, `U&'...'`) sebagai badan
  `DO` atau fungsi ditolak langsung (escape-nya bisa mengeja nama payroll yang tak
  didekode pemindai mana pun); `DISABLE TRIGGER` dipasangkan per trigger
  (`ALL`/`USER` diperluas ke semua trigger wajib) dan katalog menggagalkan
  trigger wajib yang `tgenabled`-nya bukan `O`; katalog menggagalkan foreign key
  wajib yang hilang (log transisi harus tetap merujuk ledger) dan relasi
  non-keluarga yang memiliki 70% kolom tabel wajib (ledger yang di-rename atau
  disalin); ledger migrasi yang hilang tanpa pemilik terkonfigurasi adalah
  temuan (gagal-tertutup); `session_replication_role`, target rename tiruan
  berkutip (`"AWCMS_..."`, spasi di ujung), `ALTER TRIGGER ... RENAME` pada
  tabel payroll, dan tulis langsung ke `pg_class` / `pg_trigger` ditolak
  secara statis; penanda diterima dalam bentuk biasa dan dollar-quoted.
  **Operator:** pemilik yang diharapkan untuk objek payroll adalah pemilik
  ledger migrasi. Pada deployment PEMISAH-ROLE (migrasi dijalankan satu role,
  objek dimiliki role lain) setel `PAYROLL_EXPECTED_OWNERS=role1,role2` untuk
  `bun run payroll:catalog-boundary:check` (`.env.example`), jika tidak
  pemeriksaan melaporkan `payroll-owner`.
  **Sisa (dipersempit, belum ditutup):** migrasi yang ditinjau dapat membangun
  ulang tabel payroll di balik konstruksi yang tak dimodelkan pemindai, setelah
  itu lapisan katalog MENDETEKSI (trigger hilang, foreign key hilang, kolom
  tiruan, objek bernama keluarga yang tertinggal) tetapi tidak mencegah; daftar
  helper di atas terbatas; tabel non-keluarga dengan RLS mati yang diberi grant
  ke `awcms_worker` atau `PUBLIC` tidak ditandai secara umum (terlalu banyak
  tabel global yang sah), hanya bila menyerupai tabel payroll wajib; pembangunan
  ulang kolom-demi-kolom yang mengubah lebih dari 30% kolom ledger lolos dari
  pemeriksaan tiruan; SLOT replikasi logis PostgreSQL tidak dibaca (slot dengan plugin
  decoding membaca WAL, jadi setiap baris payroll, tanpa publication maupun entri
  ACL; slot milik operator dan tidak ada di lapisan katalog); dan superuser
  dipercaya secara definisi. Selain itu: katalog tidak membaca objek
  ekstensi, superuser, atau role `BYPASSRLS` (mereka melewati setiap grant
  secara definisi); `NO FORCE` / `DISABLE ROW LEVEL SECURITY` pada tabel payroll
  adalah urusan gerbang RLS lain; pemeriksaan belum dijadwalkan terhadap
  database yang DIDEPLOI (butuh kredensial dan cron operator, keputusan
  operasional); route mutasi yang ada (`approve`, `release`, `pay`, `void`, dan
  adapter port) diizinkan TANPA audit baca (`auditExemptImporters`): mereka
  mengembalikan accrual yang ditransisikan kepada pemanggil yang hanya memegang
  hak transisi, sehingga apakah mereka harus mencatat pembacaan atau
  mengembalikan bentuk tersamar adalah keputusan produk, tidak diambil di sini;
  fungsi yang tak pernah dipanggil namun berisi `recordSensitiveRead` tetap
  memenuhi gerbang baca-sensitif (batas dead-branch); `import(ident)` dinamis
  yang specifier-nya tak menampakkan bagian nama berkas ledger; penyamaran
  literal memperlakukan `${ ... }` di dalam template literal sebagai teks dan
  tidak memahami literal regex; dan gerbang membuktikan panggilan audit ada di
  berkas, bukan di setiap jalur handler.
  Pengecualian ada di `PAYROLL_CATALOG_EXEMPTIONS` (kosong; jalan keluarnya
  adalah nama keluarga payroll).
- _Komisi ada di dalam batas (keputusan pemilik)._ `awcms_hr_commission_accruals`
  (beserta log transisinya) dan modul `hr_commission` dilarang sebagai sumber
  proyeksi, pencarian, komentar, cache, dan ekspor, dan `hr_commission` adalah
  modul pembacaan-sensitif: `accruals.read` diaudit (kedua route GET yang ada kini
  memanggil `recordSensitiveRead`), `rules.read` dikecualikan (syarat aturan
  terbit, tanpa orang). **Trade-off:** penghasilan pribadi membawa risiko kohort
  kecil yang sama dengan gaji, yang lebih berat daripada kehilangan proyeksi
  ad-hoc atas akrual. Tidak ada yang sudah ada mendaftarkan satu pun, jadi tidak
  ada yang rusak.
- _Replay adalah pembacaan._ POST idempoten yang mengembalikan resource tersimpan
  saat replay (`POST /api/v1/hr-commission/accruals`, baik hasil "replayed"
  maupun replay `Idempotency-Key` yang tidak menjalankan producer) juga memanggil
  audit pembacaan; gerbang juga melaporkan nilai `authorize:` yang tidak dapat
  di-parse (ternary, tanda kurung, akses bracket, shorthand) di berkas sensitif,
  dan mencocokkan nama tabel tanpa membedakan huruf besar-kecil.
- _CSV._ Pemicu juga mencakup spasi atau karakter lebar-nol di depan pemicu ASCII,
  dan padanan lebar-penuh (karakter rumus U+FF1D, U+FF0B, U+FF0D, U+FF20). Arsip
  reversible diawali baris penanda `#awcms-csv-neutralised:v1`; `read()` hanya
  membuang kutip dari berkas yang membawanya, sehingga arsip yang ditulis sebelum
  perubahan ini dipulihkan byte demi byte.

**Kata penerimaan yang ditambahkan ke isu implementasi.**

- **#957:** setiap izin `hr_payroll` berbentuk-baca diklasifikasikan di
  `_shared/sensitive-reads.ts`; route `compensation.read` dan `runs.read` memanggil
  `recordSensitiveRead` pada transaksi pembacaan; tes membuktikan satu pembacaan
  meninggalkan satu baris audit dengan id dan jumlah tanpa nominal, bahwa nominal
  gaji tidak pernah muncul di baris log atau badan error (canary diperluas dari
  nomor rekening ke gaji), dan bahwa `sensitive-reads:check` serta gerbang batas
  payroll tetap hijau.
- **#961:** pembacaan slip gaji oleh siapa pun selain pemiliknya memanggil
  `recordSensitiveRead({ permission: "hr_payroll.payslips.read" })`; pembacaan
  pemilik atas slip gajinya sendiri yang sudah dirilis tidak; setiap ekspor dan
  unduhan ekspor memanggilnya dengan izin `<aktivitas>.export` / `.download` yang
  persis; CSV apa pun ditulis lewat `csvCellForWrite`.

## 14. Rollout, rollback, dan operasi

Setiap fase terbit sebagai isu biasa: migrasi (hanya maju), OpenAPI, AsyncAPI, tes
(RLS sebagai `awcms_app`, setiap guard berisiko tinggi dua arah, trigger state
machine, konkurensi pada aturan konflik dan finalisasi idempoten), tinjauan
keamanan (keluarga ini "modul sensitif" menurut AGENTS.md), dan registrasi modul
`experimental` sampai layar adminnya mendarat. Untuk berhenti memakai modul: berhenti
memanggilnya dan nonaktifkan per tenant; tabel inert. Menjatuhkannya adalah
keputusan kelas-restore. Setelah restore apa pun, jalankan rekonsiliasi workforce dan,
untuk fase 3, rekonsiliasi payroll (baris berjumlah total run, slip berjumlah baris,
tidak ada slip tanpa run finalized), bersama-sama: kehadiran, komisi, dan payroll
harus kembali dari titik waktu yang sama.

## 15. Batas yang diketahui dan tindak lanjut

- Saldo dan akrual cuti, pinjaman, tunjangan, negosiasi _kebijakan_ lembur, dan
  posting akuntansi bukan tujuan.
- Tanpa hierarki unit organisasi HR (kantor adalah unitnya); tanpa atribut ABAC
  garis-atasan.
- Reveal rekening pembayaran: step-up bersyarat pada faktor yang terdaftar dan rate
  limit per aktor, diputuskan di ADR-0137 §4 (tidak tanpa syarat, ADR-0141 §4);
  implementasinya issue berikutnya.
- Pengaman merge antara dua profil berpegawai-aktif (mendarat, #945), pertanyaan
  `btree_gist` (diputuskan: trigger advisory-lock, #946), dan tambahan `AccessAction` (`calculate`, `pay`) adalah keputusan saat implementasi.
- Arsip-lalu-purge untuk baris keuangan, layar admin, dan keluaran berkas bank
  adalah isu berikutnya.
- `awcms_profile_entity_links` boleh ditulis tambahan untuk penemuan ("modul mana
  menautkan profil ini"); opsional, tindak lanjut.
- Jawaban pemilik yang dicatat 2026-10-10 dan butuh pekerjaan sendiri sebelum
  implementasi apa pun: ADR yang mengamandemen ADR-0132 untuk mode SoD yang
  dapat dikonfigurasi (§7.5) beserta sub-pertanyaan terbukanya O7a; bukti
  kehadiran geolokasi kini diputuskan di ADR-0138 (hanya-putusan, mati bawaan;
  §4.3) dan hanya butuh issue implementasi tindak-lanjut, dengan DPIA per tenant
  sebelum diaktifkan.
  implementasi apa pun: mode SoD yang dapat dikonfigurasi beserta sub-pertanyaan O7a diputuskan oleh
  ADR-0136 (§7.5; penegakan mendarat di #957); ADR untuk
  bukti kehadiran geolokasi, setelah penilaian dampak perlindungan data (§4.3).
- Kanal pengiriman (O10, O11): pemilik menerima adapter Telegram (opsional, mati
  secara default) dan menginginkan orkestrasi notifikasi. Keduanya tidak mengubah
  paket ini: notifikasi slip gaji tidak memuat nominal (ADR-0132) dan, menurut
  ADR-0133 §7, tidak boleh pernah sampai ke Telegram atau kanal fallback mana
  pun. Telegram diterima oleh ADR-0140 hanya untuk peringatan operasional dan staf
  (implementasi #965), sehingga pesan payroll, slip gaji, dan data pribadi
  ditolak oleh registry-nya. O11 diselesaikan oleh ADR-0139: orkestrasi notifikasi tidak diterima untuk
  saat ini, sehingga notifikasi payroll tidak bergantung pada fallback
  lintas-kanal atau mesin preferensi.

## 16. Pertanyaan terbuka (keputusan pemilik — yang terjawab ditandai, sisanya terbuka)

Dilacak di hilir pada `ahliweb/awcms-one` `docs/aw-business-platform-dor.md`. Pemilik menjawab O1–O12 pada 2026-10-10; baris di bawah mencatat jawaban yang mengikat paket ini (O4, O6, O7). O1 dan O5 dijawab pada hari yang sama tetapi tidak mengubah apa pun di sini dan belum direkonsiliasi ke paket ini. ADR-0132 sendiri tidak menutup satu pun.

| Id  | Pertanyaan                                                                                                                             | Mengapa penting di sini                                                                             | Memblokir                                                 | Sikap paket ini                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Cakupan dan urutan epik platform seperti dilacak di hilir (apakah fase terbit bersama, berurutan, atau per konsumen)                   | Ketiga fase dirancang terbit satu per satu; konsumen mungkin menginginkan payroll bersama workforce | urutan isu implementasi                                   | Dirancang terbit berurutan; payroll tak pernah terbit sebelum gerbangnya                                                                                                                                                                                |
| O4  | Profil payroll Indonesia: hanya PPh 21, atau juga BPJS, lembur, tunjangan hari raya; dan apakah data seed upstream atau milik konsumen | Isi regulasi harus berlaku-efektif dan terlacak; cakupan menentukan ukuran dan tinjauan hukum       | tidak ada (sebelumnya: gerbang fase 3)                    | **Terjawab 2026-10-10:** dimiliki masing-masing konsumen; upstream hanya mengirim mesin dan berlaku-efektif, tanpa tarif Indonesia (§7.3)                                                                                                               |
| O5  | Peran hukum operator platform per deployment: pengendali, prosesor, atau keduanya                                                      | Menentukan kepemilikan permintaan subjek, ketentuan pemrosesan, notifikasi pelanggaran              | analisis privasi, retensi                                 | Dirancang untuk isolasi per tenant apa pun hasilnya (§13.2)                                                                                                                                                                                             |
| O6  | Apakah kehadiran boleh pernah memakai bukti geolokasi, foto, atau perangkat                                                            | Data pribadi spesifik/biometrik; menentukan apakah ada di desain mana pun                           | ADR-0138                                                  | **Terjawab 2026-10-10:** geolokasi saja (tanpa foto, biometrik, atau sidik-jari perangkat), mati secara default per tenant; **diputuskan di ADR-0138 (2026-10-12)**, dibangun hanya oleh issue tindak-lanjut, DPIA per tenant sebelum diaktifkan (§4.3) |
| O7  | Pemisahan tugas payroll: siapa boleh menghitung, menyetujui, memfinalisasi, membayar                                                   | Matriks otorisasi dan skenario ABAC minimum; dampak tenant kecil                                    | gerbang fase 3 (amandemen ADR-0132, sub-pertanyaan O7a)   | **Terjawab 2026-10-10:** dapat dikonfigurasi per tenant; default hitung != setujui != bayar; boleh dilonggarkan ke siapkan != setujui, pelonggaran diaudit (§7.5)                                                                                       |
| Id  | Pertanyaan                                                                                                                             | Mengapa penting di sini                                                                             | Memblokir                                                 | Sikap paket ini                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------                                                                             |
| O1  | Cakupan dan urutan epik platform seperti dilacak di hilir (apakah fase terbit bersama, berurutan, atau per konsumen)                   | Ketiga fase dirancang terbit satu per satu; konsumen mungkin menginginkan payroll bersama workforce | urutan isu implementasi                                   | Dirancang terbit berurutan; payroll tak pernah terbit sebelum gerbangnya                                                                                                                                                                                |
| O4  | Profil payroll Indonesia: hanya PPh 21, atau juga BPJS, lembur, tunjangan hari raya; dan apakah data seed upstream atau milik konsumen | Isi regulasi harus berlaku-efektif dan terlacak; cakupan menentukan ukuran dan tinjauan hukum       | tidak ada (sebelumnya: gerbang fase 3)                    | **Terjawab 2026-10-10:** dimiliki masing-masing konsumen; upstream hanya mengirim mesin dan berlaku-efektif, tanpa tarif Indonesia (§7.3)                                                                                                               |
| O5  | Peran hukum operator platform per deployment: pengendali, prosesor, atau keduanya                                                      | Menentukan kepemilikan permintaan subjek, ketentuan pemrosesan, notifikasi pelanggaran              | analisis privasi, retensi                                 | Dirancang untuk isolasi per tenant apa pun hasilnya (§13.2)                                                                                                                                                                                             |
| O6  | Apakah kehadiran boleh pernah memakai bukti geolokasi, foto, atau perangkat                                                            | Data pribadi spesifik/biometrik; menentukan apakah ada di desain mana pun                           | ADR bukti geolokasi apa pun                               | **Terjawab 2026-10-10:** geolokasi saja (tanpa foto, biometrik, atau sidik-jari perangkat), mati secara default per tenant; tetap butuh ADR sendiri setelah DPIA (§4.3)                                                                                 |
| O7  | Pemisahan tugas payroll: siapa boleh menghitung, menyetujui, memfinalisasi, membayar                                                   | Matriks otorisasi dan skenario ABAC minimum; dampak tenant kecil                                    | tidak ada (dulu: gerbang fase 3; ADR-0136 memutuskan O7a) | **Terjawab 2026-10-10:** dapat dikonfigurasi per tenant; default hitung != setujui != bayar; boleh dilonggarkan ke siapkan != setujui, pelonggaran diaudit (§7.5, ADR-0136)                                                                             |

## 17. Catatan tinjauan fase 3 (Issue #956)

> **Status: tinjauan keamanan tercatat; tinjauan hukum BELUM dilakukan.** Bagian
> ini adalah bukti yang dituntut gerbang fase 3 (§1). Isinya **tinjauan meja atas
> desain sebagaimana tertulis** (paket ini, ADR-0132, ADR-0136, ADR-0137,
> ADR-0138) terhadap prompt tinjauan keamanan di dokumen 12 (secret, autentikasi,
> konteks tenant, ABAC default-deny, RLS, audit, idempotensi, masking, error
> aman) dan tabel ancaman §13.1. **Belum ada kode payroll (kecuali tautan kepegawaian fase 1, PS-14), jadi tidak ada satu pun hasil
> uji di sini. PS-14 adalah satu-satunya temuan yang sudah berkode: tautan fase 1 kini menolak tautan-diri ke kepegawaian orang lain, mewajibkan profil login cocok, dan memperlakukan penautan ulang sebagai `critical` dengan step-up kondisional bila ada riwayat (#979); hanya separuh slip gajinya (mencabut pemilik lama, `404` untuk slip pengguna lain) yang tersisa untuk #961.** Bagian hukum memerlukan penasihat hukum manusia dan berupa daftar
> periksa (§17.3) dengan blok tanda tangan (§17.4) yang sengaja kosong. **#957 dan
> semua issue implementasi payroll berikutnya tetap terblokir sampai (a) penasihat
> hukum menandatangani §17.4 dan (b) temuan pemblokir §17.2 ditulis ke dalam
> desain dan kriteria penerimaan issue terkait.** Issue #956 tetap terbuka sampai
> keduanya selesai. Kontrol C-24 (tinjauan regulasi atas data aturan milik
> deployment sendiri) berlaku per deployment dan tidak digantikan tinjauan ini.

### 17.1 Metode dan skala keparahan

Tiap area yang disebut issue dibaca terhadap teks paket dan ADR, serta terhadap
yang sudah ditegakkan repositori (`authorizeInTransaction`, FORCE RLS, FK
komposit, deskriptor SoD, `requireStepUp`, idempotensi, redaksi audit).
Keparahan: **Pemblokir** = desain sebagaimana tertulis tidak aman atau ambigu
dengan cara yang mengubah skema atau model SoD, sehingga kontrolnya harus
dimasukkan ke desain sebelum **#957** dimulai; **Wajib** = kontrol yang harus
diimplementasikan dan diuji issue yang disebut (ditambahkan ke kriteria
penerimaannya lewat komentar); **Rendah** = kebersihan. "OK" berarti desain,
bila diimplementasikan sebagaimana tertulis, memenuhi daftar periksa untuk area
itu; bukan klaim tentang kode.

### 17.2 Hasil per area

| Area                                                                                                                                                                                                                                                                                                                                | Putusan                                                                                                                                                                                                        | Temuan                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Matriks otorisasi, default-deny, seed tanpa diberikan ke peran apa pun (§11.1)                                                                                                                                                                                                                                                      | OK, dengan satu pemisahan                                                                                                                                                                                      | PS-06                         |
| SoD: aturan tingkat peran, CHECK per-instance di database, mode ketat dan longgar (§7.5, ADR-0136)                                                                                                                                                                                                                                  | OK untuk pasangan C/A/F/P; celah pada penerima gaji sebagai pelaku, reversal, dan asal-usul stempel                                                                                                            | PS-01, PS-02, PS-05           |
| RLS dan FK komposit (§9, §11.1)                                                                                                                                                                                                                                                                                                     | OK (FORCE, `USING` + `WITH CHECK`, semua referensi komposit, uji sebagai role runtime diwajibkan)                                                                                                              | PS-20 (cakupan uji)           |
| Immutability run yang sudah final (§7.4, §8)                                                                                                                                                                                                                                                                                        | OK (trigger per transisi dan kolom; tanpa DELETE)                                                                                                                                                              | PS-20 (cakupan uji), PS-03    |
| Immutability versi aturan yang sudah terbit (§7.3)                                                                                                                                                                                                                                                                                  | Temuan                                                                                                                                                                                                         | PS-07                         |
| Mesin aturan: tanpa eksekusi kode, evaluasi terbatas (§7.3)                                                                                                                                                                                                                                                                         | Tanpa eksekusi kode OK (jenis tertutup, tanpa mesin ekspresi); batas belum ditentukan                                                                                                                          | PS-08                         |
| Penanganan uang desimal (§9)                                                                                                                                                                                                                                                                                                        | Temuan                                                                                                                                                                                                         | PS-09                         |
| Idempotensi pada calculate, approve, finalize, reverse (§11.3)                                                                                                                                                                                                                                                                      | Kunci dan pemeriksaan state OK; pengikatan dan konkurensi belum ditentukan                                                                                                                                     | PS-03, PS-10                  |
| Audit dan redaksi: gaji, rekening pembayaran (§11.2, §11.3)                                                                                                                                                                                                                                                                         | OK untuk penulisan dan reveal; pembacaan tidak diaudit                                                                                                                                                         | PS-18                         |
| Enkripsi rekening, reveal, step-up (ADR-0137)                                                                                                                                                                                                                                                                                       | OK (AES-256-GCM v2 dengan key id dan AAD, key ring HMAC terpisah, fail-closed, step-up bersyarat, rate limit); teks issue menyimpang; celah penghapusan dan penukaran; step-up tanpa pendaftaran tidak bergigi | PS-11, PS-12, PS-13           |
| Akses dan kepemilikan slip gaji (§12 S2, #961)                                                                                                                                                                                                                                                                                      | OK pada prinsipnya; tautan kepemilikan adalah titik lemahnya                                                                                                                                                   | PS-14                         |
| Kunci periode (§7.2)                                                                                                                                                                                                                                                                                                                | Temuan (prasyarat)                                                                                                                                                                                             | PS-15                         |
| Semantik reversal (§7.4, §8)                                                                                                                                                                                                                                                                                                        | Temuan                                                                                                                                                                                                         | PS-02                         |
| Backup dan restore dengan kunci (ADR-0137 §6, §14, #968)                                                                                                                                                                                                                                                                            | OK (kunci di luar database dan backup-nya; restore dengan dan tanpa ring sama-sama digladi)                                                                                                                    | catatan untuk #968 di bawah   |
| Hak subjek dan retensi data payroll (§13.2)                                                                                                                                                                                                                                                                                         | Temuan (proses privasi dan deskriptor)                                                                                                                                                                         | PS-04, PS-17                  |
| Kebocoran proyeksi pelaporan (§10, §11)                                                                                                                                                                                                                                                                                             | Event OK (hanya id dan hitungan); proyeksi dan ekspor tanpa gerbang                                                                                                                                            | PS-18                         |
| Denial of service oleh run besar                                                                                                                                                                                                                                                                                                    | Temuan                                                                                                                                                                                                         | PS-16                         |
| Port komisi ke dalam run (#962)                                                                                                                                                                                                                                                                                                     | Temuan                                                                                                                                                                                                         | PS-19                         |
| Profil offline/LAN dan sync                                                                                                                                                                                                                                                                                                         | Temuan (rendah)                                                                                                                                                                                                | PS-20                         |
| Kebersihan dokumentasi                                                                                                                                                                                                                                                                                                              | Temuan (rendah)                                                                                                                                                                                                | PS-21                         |
| Butir daftar periksa tanpa temuan: tanpa secret di repo (kunci hanya env, `secret: true`, tanpa default); error aman (body yang menyebut state yang ditegaskan klien adalah `400` yang menyebut field; uji canary #959 mencakup nomor rekening); panggilan provider (tidak ada; outbox kemudian); AI read-only (tidak ada jalur AI) | OK                                                                                                                                                                                                             | perluas canary ke gaji: PS-18 |

#### Temuan

| Id        | Keparahan     | Temuan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Kontrol yang diwajibkan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Diimplementasikan oleh                                                                        |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **PS-01** | **Pemblokir** | **Penerima gaji bisa menjadi pelaku.** Matriks SoD memisahkan tugas tetapi tidak pernah menyatakan bahwa orang yang bertindak atas run atau versi kompensasi boleh orang yang dibayarnya. Penyetuju yang loginnya tertaut ke kepegawaian di dalam run menyetujui gajinya sendiri; hal yang sama untuk `compensation.create/approve` atas kepegawaiannya sendiri (S10 hanya mencakup K × A).                                                                                                                                                                                                                               | Tidak seorang pun boleh menghitung, menyetujui, memfinalisasi, atau membayar run yang memuat baris untuk kepegawaian yang tertaut ke `tenant_user_id`-nya sendiri, dan tidak boleh mengusulkan atau menyetujui kompensasi untuk kepegawaiannya sendiri. Ditegakkan di jalur database (trigger membandingkan stempel dengan `employment.tenant_user_id`) dan di handler; penolakannya `403`. Tambahkan uji SoD SOD23–SOD24 (baris sendiri dalam run; kompensasi sendiri).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | #957 (+ uji #960)                                                                             |
| **PS-02** | **Pemblokir** | **Reversal tanpa SoD, dan reversal run yang sudah dibayar dapat membayar dua kali.** (a) `reverse` (R) hanya dibatasi terhadap P; tidak ada yang mencegah orang yang menghitung, menyetujui, atau memfinalisasi run asli membalikkannya, dan tidak ada yang mewajibkan orang kedua menyetujui run reversal. (b) §7.4 membalik run final atau **terbayar** lalu "run reguler baru menghitung ulang"; uang yang sudah tercatat terbayar tidak pulih oleh reversal, sehingga run pengganti membayar karyawan lagi. #962 memperparah ("reversal membuka kembali" akrual).                                                     | (a) Run reversal mengikuti rantai calculate/approve yang sama; `reversed_by` dan penyetuju run reversal berbeda dari `paid_by` run asli, dan R ditambahkan ke aturan per-instance (keputusan dicatat dalam amandemen ADR: R × C, R × A). (b) Putuskan dan catat sebelum #957 menetapkan kolom: reversal run **terbayar** menghasilkan baris pemulihan (piutang/netting) atau ditolak demi baris penyesuaian di periode terbuka berikutnya. Masukan hukum §17.3 L-C3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | #957 (kolom, CHECK), #960 (alur), #962                                                        |
| **PS-03** | **Pemblokir** | **Persetujuan tidak terikat pada apa yang dilihat penyetuju.** `calculated` bisa dihitung ulang; penyetuju yang membuka layar dapat menyetujui angka yang sudah diubah penyiap (celah time-of-check/time-of-use), atau approve yang diulang bisa mendarat pada run yang sudah dihitung ulang.                                                                                                                                                                                                                                                                                                                             | Run membawa `calculation_revision` yang naik monoton dan digest total, keduanya ditulis database pada setiap calculate; `approve` dan `finalize` harus membawa revisi yang dibacanya dan ditolak (`409`) bila berbeda; baris run dikunci (`FOR UPDATE`) selama transisi apa pun.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #957 (kolom), #960                                                                            |
| **PS-04** | **Pemblokir** | **Penilaian dampak terdokumentasi belum ada.** §13.2 menyatakan fase 3 memerlukan penilaian dampak terdokumentasi sebelum implementasi. Tidak ada issue yang melacaknya.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | DPIA terdokumentasi untuk pemrosesan fase 3, ditautkan dari baris gerbang, sebelum #957. Memerlukan pemilik pelindungan data dan penasihat hukum (§17.3 L-P4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **#976** (baru)                                                                               |
| **PS-05** | Wajib         | **Asal-usul stempel dan identitas SoD.** CHECK membandingkan kolom stempel; bila handler yang menulisnya, bug atau jalur yang dibuat khusus memalsukan perbandingan. SoD juga per `tenant_user`; bila satu manusia dapat memiliki dua login dalam satu tenant, CHECK membandingkan dua id untuk satu orang.                                                                                                                                                                                                                                                                                                               | Stempel aktor diset dari sesi terautentikasi (setelan lokal-transaksi yang dibaca trigger), tidak pernah dari request atau parameter handler; uji membuktikan stempel kiriman handler diabaikan atau ditolak. Pastikan dan uji apakah dua tenant user dapat memetakan ke satu principal dalam tenant; bila ya, bandingkan id principal. Penolakan terlambat pada mode ketat (aksi kedua, bukan penetapan peran) diterima dan harus didokumentasikan di layar admin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #957                                                                                          |
| **PS-06** | Wajib         | **Satu izin baca membuka semua gaji.** `runs.read` mencakup header, total, dan baris per karyawan; pembaca keuangan yang hanya butuh total dapat melihat gaji setiap karyawan.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pisahkan `runs.read` (header, total, hitungan) dari `run_lines.read` (jumlah per karyawan, dibatasi kantor), keduanya tidak diberikan ke peran mana pun oleh migrasi; `payslips.read` untuk karyawan lain juga terpisah dari kepemilikan slip sendiri.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | #957 (katalog, seed)                                                                          |
| **PS-07** | Wajib         | **Versi aturan: tumpang tindih, tanggal pemilihan, bukti kerusakan, retire.** "Edit hanya draf" dan "maker/checker" disebut, tetapi tidak: rentang berlaku yang tidak tumpang tindih per set aturan (dua versi terbit berlaku pada satu tanggal itu ambigu); tanggal mana yang memilih versi untuk suatu periode (awal, akhir, tanggal bayar); `published_by <> authored_by` per-instance; hash isi yang membuktikan parameter terbit tidak diubah role database berhak istimewa; dan bahwa `retire` hanyalah transisi stempel, bukan edit. Versi yang terbit dengan tanggal berlaku di dalam periode final tidak diatur. | Eksklusi/keunikan sehingga paling banyak satu versi terbit per set aturan berlaku pada tiap tanggal (pertanyaan `btree_gist` di §15 dijawab di sini); tanggal pemilihan ditetapkan di desain dan dicatat pada run; CHECK `published_by <> authored_by`; `content_digest` atas parameter kanonik dihitung saat publish dan diverifikasi saat calculate; `retire` dibatasi ke kolom stempelnya oleh trigger; kutipan, tanggal berlaku, dan peninjau bernama NOT NULL dan tidak kosong saat publish.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | #958                                                                                          |
| **PS-08** | Wajib         | **Evaluasi aturan tertutup tetapi tidak terbatas.** Tanpa `eval` (baik) tetapi tanpa batas: jumlah bracket, ukuran lookup, ukuran parameter, urutan dependensi komponen atau siklus, rentang numerik, `NaN`/`Infinity` (`numeric` PostgreSQL menerima `NaN`).                                                                                                                                                                                                                                                                                                                                                             | Validasi skema ketat saat draf dan lagi saat publish (kunci tak dikenal ditolak); batas pada tier, baris lookup, byte parameter, dan aturan per set; komponen dievaluasi dalam urutan topologis yang divalidasi tanpa siklus saat publish; rentang persen dan jumlah dibatasi; hanya nilai terhingga (CHECK `amount = amount`); mode dan titik pembulatan dicatat pada versi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | #958                                                                                          |
| **PS-09** | Wajib         | **Disiplin desimal dinyatakan untuk wire dan total, bukan untuk perhitungan baris.** Persen dari basis yang dihitung dengan `Number` JavaScript kehilangan sen secara senyap; ketidakcocokan mata uang antara kompensasi dan run tidak ditangani.                                                                                                                                                                                                                                                                                                                                                                         | Kolom uang dideklarasikan `numeric(p,s)` dengan skala eksplisit; jumlah baris dihitung dalam SQL `numeric` atau aritmetika bilangan bulat berskala dengan mode pembulatan yang dicatat, tidak pernah `Number`; uji sumber melarang `Number`/`parseFloat` pada pengenal uang; satu `currency_code` per run dan ketidakcocokan apa pun ditolak.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | #957, #960                                                                                    |
| **PS-10** | Wajib         | **Pengikatan idempotensi dan konkurensi.** Kunci harus terikat pada hash payload (kunci sama, body berbeda adalah error), dan `calculate` berpacu dengan `calculate`, atau `approve` berpacu dengan penghitungan ulang, memerlukan pemenang yang terdefinisi. "Pembayaran unik per run" harus berlaku pada dua `pay` bersamaan.                                                                                                                                                                                                                                                                                           | Pengikatan hash payload pada setiap mutasi berisiko tinggi (helper idempotensi repositori); baris run `FOR UPDATE` pada setiap transisi; `(period, run_no)` unik dengan retry; indeks unik parsial untuk pembayaran dan reversal; uji konkurensi untuk calculate ganda, approve ganda, finalize ganda, pay ganda.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | #960                                                                                          |
| **PS-11** | Wajib         | **Kriteria penerimaan #959 bertentangan dengan ADR-0137.** #959 meminta audit reveal **critical** dan "reveal tanpa step-up ditolak"; ADR-0137 §4 dan §11.3 memutuskan **warning** dan step-up **bersyarat** pada faktor yang terdaftar (ADR-0141 §4: tanpa syarat adalah jebakan).                                                                                                                                                                                                                                                                                                                                       | Selaraskan #959 dengan ADR (atau amandemen ADR); step-up yang hilang bila dituntut adalah `403 STEP_UP_REQUIRED`, dan kasus belum-terdaftar dicatat di baris audit. Jendela dan jumlah rate limit per aktor dipilih dan diuji di #959.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | #959                                                                                          |
| **PS-12** | Wajib         | **Penghapusan dan penukaran rekening.** Tabel hak istimewa memberi `awcms_app` DELETE pada rekening pembayaran: orang dalam menambah rekening, dibayar, menghapusnya, dan hanya baris audit yang tersisa. Mengganti rekening sesaat sebelum pembayaran adalah penipuan payroll standar dan tidak punya kontrol selain baris `warning`.                                                                                                                                                                                                                                                                                    | Penghapusan adalah stempel `retired_at` (retire lunak), penghapusan fisik hanya lewat `data_lifecycle`; slip/baris menyimpan `payout_account_id` yang dipakai saat dihitung; `pay` dan finalize menolak (atau menandai untuk tinjauan) run yang kepegawaiannya mengganti rekening setelah penghitungan yang disetujui; mengubah rekening orang lain diusulkan/dikonfirmasi dua aktor atau memberi tahu karyawan di luar jalur (tanpa detail rekening di pemberitahuan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | #959, #960                                                                                    |
| **PS-13** | Wajib         | **Step-up bersyarat tidak bergigi tanpa pendaftaran.** Pemegang tanpa faktor MFA melakukan reveal, relax-SoD, approve, finalize, pay, reverse tanpa faktor kedua; "dapat ditegakkan lewat kebijakan MFA tenant" belum dibangun.                                                                                                                                                                                                                                                                                                                                                                                           | **Dibangun secara generik oleh #977 / [ADR-0141](../adr/0141-permissions-may-require-an-enrolled-mfa-factor.id.md)**, ditegakkan saat izin dijalankan (bukan saat grant): izin yang mendeklarasikan `requiresMfaEnrolment: true` di descriptor modulnya ditolak `403 MFA_ENROLMENT_REQUIRED` (beserta jalan untuk mendaftar) bagi pemegang tanpa faktor aktif, di chokepoint `authorizeInTransaction`; jalur bootstrap (pendaftaran tidak butuh izin) dan laporan `security:readiness`; tidak pernah step-up tanpa syarat. **`hr_payroll` wajib menyetel tanda tepat pada:** `payout_accounts.reveal`, `runs.approve`, `runs.finalise`, `runs.pay`, `runs.reverse`, `compensation.approve`, `sod_policy.configure`, `rules.publish`, tetap memanggil step-up bersyarat, dan membawa per izin satu test bahwa pemegang belum terdaftar menerima `403 MFA_ENROLMENT_REQUIRED` dan pemegang terdaftar dengan sesi basi menerima `403 STEP_UP_REQUIRED`. **Redaksi kriteria penerimaan #959 dan #960:** tambahkan "setiap izin bertanda menolak pemegang belum terdaftar dengan `MFA_ENROLMENT_REQUIRED` dan pemegang terdaftar dengan sesi basi dengan `STEP_UP_REQUIRED`"; #959 mengganti "reveal tanpa step-up ditolak" dengan "reveal tanpa faktor terdaftar ditolak; reveal oleh pemegang terdaftar tanpa step-up segar ditolak". | **#977** (ADR-0141; mekanisme generik dibangun) → #957, #959, #960 menyetel dan menguji tanda |
| **PS-14** | Wajib         | **Tautan kepemilikan adalah kunci slip gaji.** Pemegang `employments.assign` dapat menautkan loginnya sendiri ke kepegawaian rekan dan membaca slip orang itu; penautan ulang kemudian menyerahkan slip historis ke login baru. Tautan fase 1 sebagaimana sudah mendarat (#945) tidak menolak tautan-diri, tidak memeriksa kecocokan profil login, dan memperlakukan penautan ulang seperti penautan pertama.                                                                                                                                                                                                             | Tolak tautan ke login si penetap sendiri; validasi bahwa tenant user tertaut berprofil sama dengan kepegawaian; penautan ulang setelah rilis slip mana pun memerlukan step-up dan baris audit `critical` dengan id sebelum/sesudah serta mencabut pemilik lama; slip yang diminta pengguna lain mengembalikan `404` (bukan `403`: tanpa oracle keberadaan, #961).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | #961, **#979** (baru, tautan fase 1)                                                          |
| **PS-15** | Wajib         | **Prasyarat kunci periode belum ditentukan.** Apa yang terjadi pada periode terkunci dengan run `draft`/`calculated`; ke mana baris penyesuaian reversal pergi bila tidak ada periode terbuka berikutnya; siapa yang boleh mengunci.                                                                                                                                                                                                                                                                                                                                                                                      | Kunci ditolak selama ada run non-terminal di periode; perilaku terdefinisi bila tidak ada periode terbuka (periode berikutnya harus dibuat dulu, bila tidak reversal ditolak); `lock` tetap `critical`, idempoten, dan tidak pernah digabung dengan C, A, F, atau P pada satu aktor pada mode ketat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | #960                                                                                          |
| **PS-16** | Wajib         | **Run besar tidak terbatas.** Calculate atas semua karyawan dan finalize yang membuat satu slip per karyawan dalam satu transaksi request menahan kunci dan memori sebanding jumlah karyawan; pembacaan daftar tidak dinyatakan berpaginasi.                                                                                                                                                                                                                                                                                                                                                                              | Batch terbatas atau job berlease (dapat dilanjutkan, idempoten, satu penghitungan aktif per tenant) untuk calculate dan pembuatan slip, statement timeout, jumlah karyawan maksimum per run, daftar berpaginasi keyset, rate limit per aktor pada calculate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #960, #961                                                                                    |
| **PS-17** | Wajib         | **Retensi dan cakupan subject-data harus ada saat tiap tabel ada.** Dokumen data-lifecycle masih mencantumkan tabel lain (`awcms_payroll_records`) dengan retensi "belum ditetapkan"; gerbang cakupan ADR-0094 akan gagal terlambat bila tidak, dan "disimpan selama usia tenant" (§13.2) belum punya jangka yang disetujui penasihat hukum.                                                                                                                                                                                                                                                                              | Setiap tabel fase 3 dikirim dengan entri `subjectData` dan deskriptor `data_lifecycle` dalam migrasi yang sama (kelas retensi eksplisit, legal hold menimpa; nilai retensi dari penasihat hukum, §17.3); perbaiki baris usang di `data-lifecycle.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | #957 dan tiap issue tabel                                                                     |
| **PS-18** | Wajib         | **Pembacaan dan agregat tidak terlihat.** §13.2 mengklaim audit menjawab "siapa membaca apa", tetapi hanya reveal yang diaudit; tidak ada yang melarang proyeksi pelaporan atau ekspor atas tabel payroll; uji canary mencakup nomor rekening, bukan gaji.                                                                                                                                                                                                                                                                                                                                                                | Baris audit (id, jumlah, tidak pernah nominal) untuk pembacaan kompensasi, tingkat-baris, dan slip gaji karyawan lain serta untuk setiap ekspor, sadar-laju; gerbang yang melarang tabel payroll sebagai sumber proyeksi, pencarian, komentar, cache, atau ekspor; uji canary untuk nominal gaji di log dan badan error; CSV bebas-formula. **Dibangun generik oleh #978 (§13.3):** `recordSensitiveRead` + `sensitive-reads:check` (default-deny atas izin read, list, export, download `hr_payroll`), `payroll-data-boundary.ts` ditegakkan semua registry, `csv-formula.ts`. Jalan menuju laporan payroll (izin sendiri, kohort minimum, ADR sendiri) dan **kata penerimaan #957 / #961** ada di §13.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **#978** (dibangun); #957/#961 memanggilnya                                                   |
| **PS-19** | Wajib         | **Akrual harus dibayar tepat satu run, termasuk setelah reversal.** Dua run (reguler dan off-cycle) dapat memilih akrual terbayar yang sama bersamaan; reversal yang membuka kembali akrual sementara pembayaran pertama nyata membayarnya lagi.                                                                                                                                                                                                                                                                                                                                                                          | Tabel klaim atau indeks unik parsial `(accrual_id) WHERE not reversed` diambil atomik saat calculate atau finalize (`FOR UPDATE SKIP LOCKED`); pembukaan kembali dikaitkan dengan keputusan pemulihan PS-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #962                                                                                          |
| **PS-20** | Rendah        | **Cakupan uji dan sync.** Bukti immutability dan RLS harus dijalankan sebagai `awcms_app` (role pemilik melewati trigger dan policy); tabel payroll harus dikecualikan eksplisit dari registry sync agar tidak pernah direplikasi ke node offline.                                                                                                                                                                                                                                                                                                                                                                        | Uji run-beku, RLS, dan SoD sebagai role runtime; asersi registry bahwa tidak ada tabel payroll `awcms_hr_*` yang menjadi resource sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | #957                                                                                          |
| **PS-21** | Rendah        | **Teks ganda dan saling bertentangan dalam paket ini.** §16 mengulang tabel pertanyaannya, salinan kedua membawa sikap usang (O6 "masih perlu ADR sendiri"; O7 "memblokir gerbang fase 3"), dan §15 mengulang satu butir tentang tindak lanjut yang sama.                                                                                                                                                                                                                                                                                                                                                                 | Hapus duplikat usang itu dalam perubahan dokumen lanjutan (tidak dilakukan di sini agar catatan tinjauan ini atomik); tabel §16 pertama dan ADR yang berwenang.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | tindak lanjut dokumen                                                                         |

**Temuan pemblokir, dinyatakan terang:** PS-01 (penerima gaji sebagai pelaku),
PS-02 (SoD reversal dan pembayaran ganda run terbayar), PS-03 (approve tidak
terikat pada penghitungan yang ditinjau) dan PS-04 (tidak ada penilaian dampak
terdokumentasi). Tiga pertama mengubah skema atau model SoD #957 dan harus
ditulis ke §7.5, §9 dan kriteria penerimaan issue sebelum dimulai; PS-04
memerlukan orang, bukan kode.

**Catatan untuk #968 (gladi restore).** Selain cakupannya: pertahankan setiap key
id yang masih dibutuhkan backup yang dapat direstore di kedua ring (enkripsi dan
hash); gladi rekonsiliasi payroll §14 setelah merestore kehadiran, komisi, dan
payroll bersama; gladi restore **tanpa** ring (reveal dan re-enkripsi fail
closed, pembacaan bertopeng tetap jalan).

### 17.3 Daftar periksa tinjauan hukum (untuk penasihat hukum; tidak dijawab di sini)

Setiap butir adalah pertanyaan ya/tidak. "Diputuskan di" menunjuk tempat paket
atau issue menetapkan perilaku yang dimintakan konfirmasi; **jawaban "tidak" atau
"ragu" adalah temuan yang menjadi perubahan desain atau issue**, dan kontrol
terkait tetap tidak dibangun sampai terselesaikan. Paket ini tidak menegaskan
hukum, tarif, plafon, atau jangka retensi apa pun; mesin tidak membawa satu pun
(O4).

**A. Tanggal berlaku versi aturan**

| #    | Pertanyaan                                                                                                                                                                                                                                                | Diputuskan di     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| L-A1 | Apakah dapat diterima bahwa versi dipilih oleh satu tanggal per periode (tanggal yang ditetapkan menurut PS-07: awal periode, akhir periode, atau tanggal bayar), bukan per baris pembayaran, untuk setiap jenis aturan yang akan ditranskripsi konsumen? | §7.3, #958, PS-07 |
| L-A2 | Apakah `effective_from` versi (dengan versi berikutnya menggantikannya) cukup, atau versi juga harus membawa tanggal akhir eksplisit dan aturan transisi?                                                                                                 | §7.3, #958        |
| L-A3 | Bila suatu regulasi berlaku surut, apakah sah mengoreksi hanya lewat reversal run final yang terdampak dan penghitungan ulang, bukan menyunting riwayat?                                                                                                  | §7.4, §8          |
| L-A4 | Bolehkah versi diterbitkan dengan tanggal berlaku di dalam periode yang sudah final, mengingat run final tidak pernah berubah dan hanya periode terbuka yang memakainya?                                                                                  | §7.2, §7.3, #958  |
| L-A5 | Bila hukum menetapkan aturan pembulatan, apakah mencatat mode dan titik pembulatan pada versi (dan menerapkannya per baris atau per total sesuai versi) cukup untuk patuh?                                                                                | PS-08, #958       |

**B. Kutipan dan asal-usul**

| #    | Pertanyaan                                                                                                                                                                               | Diputuskan di      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| L-B1 | Apakah kutipan tersimpan (instrumen, nomor, tahun, pasal) ditambah tanggal berlaku cukup sebagai asal-usul versi aturan, atau salinan atau digest teks sumber harus disimpan pada versi? | §7.3, #958         |
| L-B2 | Apakah "peninjau bernama" yang mentranskripsi versi harus memiliki kualifikasi profesional tertentu, atau pengguna bernama dan terautentikasi dari tenant konsumen cukup sebagai bukti?  | §7.3               |
| L-B3 | Apakah menyimpan setiap versi terbit, kutipannya, dan jejak auditnya selama usia tenant dapat diterima, dan apakah diperlukan jangka lebih panjang atau lebih pendek?                    | §7.3, §13.2, PS-17 |
| L-B4 | Bolehkah slip gaji atau ekspor run menampilkan versi aturan dan kutipan di balik suatu angka kepada karyawan, dan apakah itu diwajibkan?                                                 | §7.2, #961         |

**C. Immutability dan koreksi**

| #    | Pertanyaan                                                                                                                                                                                                   | Diputuskan di    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| L-C1 | Apakah "versi terbit tidak pernah disunting; kesalahan diperbaiki dengan versi baru" cukup untuk audit dan pemeriksaan, termasuk saat run dihitung dengan versi yang kemudian terbukti salah transkripsi?    | §7.3, §7.4, #958 |
| L-C2 | Apakah slip gaji turunan yang immutable (snapshot yang tidak menulis ulang) konsisten dengan hak karyawan atas perbaikan data, mengingat koreksi mengalir lewat reversal dan slip baru?                      | §7.4, §13.2      |
| L-C3 | Bila run yang sudah **tercatat terbayar** dibalik, bolehkah pemulihan di-netting pada periode berikutnya, atau jumlahnya harus dipulihkan lewat jalur lain; dan adakah batasan memotong pemulihan dari gaji? | PS-02, §7.4      |

**D. Siapa yang boleh menerbitkan aturan**

| #    | Pertanyaan                                                                                                                                                                                                                           | Diputuskan di          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| L-D1 | Apakah penerbitan dua orang (penulis dan penerbit berbeda, tidak ada yang menyetujui run, SoD U × A) merupakan kontrol maker/checker yang cukup untuk aturan payroll, atau orang berkualifikasi bernama harus menyetujui tiap versi? | §7.3, §7.5, PS-07      |
| L-D2 | Bolehkah operator platform menulis atau menerbitkan versi aturan atas nama tenant, atau penerbitan harus selalu oleh staf tenant sendiri atau penasihat profesionalnya?                                                              | §7.3, O4               |
| L-D3 | Mengingat upstream mengirim mesin tanpa tarif (O4), apakah pernyataan bahwa isi aturan dan kebenaran hukumnya menjadi tanggung jawab konsumen diperlukan di produk dan di ketentuan, dan apakah efektif?                             | §7.3, O4, kontrol C-24 |
| L-D4 | Apakah netralitas mesin (tanpa konstanta yurisdiksi) mengubah siapa yang bertanggung jawab atas kebenaran perhitungan pemotongan atau iuran antara operator, tenant, dan penasihat mana pun?                                         | §7.3, O4, O5           |

**E. Pelindungan data pribadi (UU PDP 27/2022) dan retensi**

| #     | Pertanyaan                                                                                                                                                                                                                                                                                 | Diputuskan di      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| L-P1  | Apakah operator platform pengendali, prosesor, atau keduanya untuk data payroll, per model deployment, dan apakah itu ditetapkan di setiap perjanjian pemrosesan (O5)?                                                                                                                     | §13.2, O5          |
| L-P2  | Apakah dasar pemrosesan "hubungan kerja dan kewajiban hukum pemberi kerja" benar untuk gaji, rekening pembayaran, dan slip gaji, tanpa persetujuan terpisah untuk semuanya?                                                                                                                | §13.2              |
| L-P3  | Apakah rekening bank pembayaran adalah data keuangan pribadi yang menimbulkan kewajiban tambahan di luar data pribadi umum, dan apakah kontrol ADR-0137 (enkripsi, masking, reveal teraudit) cukup?                                                                                        | §11.2, ADR-0137    |
| L-P4  | Apakah penilaian dampak terdokumentasi (DPIA) diwajibkan untuk fase 3 sebelum implementasi, dan apakah sudah diselesaikan hingga memuaskan penasihat hukum (PS-04, #976)?                                                                                                                  | §13.2, PS-04       |
| L-P5  | Apakah jangka retensi menurut undang-undang berlaku untuk masing-masing: catatan kepegawaian, kehadiran yang dipakai untuk gaji, run dan slip payroll, data pajak dan pemotongan, serta jejak audit pembacaan dan reveal; dan sudahkah penasihat hukum menetapkan tiap jangka dalam tahun? | §13.2, PS-17       |
| L-P6  | Apakah menyimpan baris keuangan payroll "selama usia tenant" sampai ada desain arsip-lalu-purge itu sah, atau jalur purge atau arsip harus ada sebelum run payroll pertama?                                                                                                                | §13.2, §15         |
| L-P7  | Pada permintaan penghapusan, apakah sikap bahwa profil dianonimkan sementara baris HR dan payroll tetap, mengarah ke profil teranonim, dapat diterima selama masa retensi?                                                                                                                 | §3, §13.2          |
| L-P8  | Apakah backup yang masih memuat subjek yang dipurge atau dianonimkan dapat diterima sampai kedaluwarsa, dan apakah restore ke lingkungan sementara tanpa key ring (reveal fail closed) merupakan bukti perlindungan yang dapat diterima?                                                   | ADR-0137 §6, #968  |
| L-P9  | Kewajiban dan jangka notifikasi pelanggaran apa yang berlaku, siapa yang harus memberi tahu (operator atau tenant), dan apakah log audit dan keputusan memenuhi "siapa mengakses apa" (PS-18)?                                                                                             | §13.2, O5, PS-18   |
| L-P10 | Apakah menyimpan data payroll di lokasi yang dipilih deployment (termasuk transfer lintas batas oleh penyedia cloud atau backup) diizinkan, dan apakah petugas pelindungan data diwajibkan bagi tenant yang memproses payroll dalam skala besar?                                           | §13.2              |
| L-P11 | Apakah pemberitahuan kepada karyawan tentang pemrosesan ini (tujuan, kategori, retensi, hak) memadai sebagaimana dirancang, atau pemberitahuan atau pengakuan khusus harus dibangun?                                                                                                       | §13.2, §4.3 (pola) |

### 17.4 Tanda tangan (diisi penasihat hukum; sengaja dikosongkan)

| Kolom                                                                                                                         | Isian                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Nama peninjau dan kapasitas                                                                                                   |                               |
| Tanggal                                                                                                                       |                               |
| Cakupan yang ditinjau (centang): A tanggal berlaku, B kutipan, C immutability, D siapa yang menerbitkan, E UU PDP dan retensi | A [ ] B [ ] C [ ] D [ ] E [ ] |
| Dokumen dan versi yang ditinjau (paket, ADR-0132, ADR-0136, ADR-0137, ADR-0138; commit)                                       |                               |
| Hasil (disetujui / disetujui dengan syarat / tidak disetujui)                                                                 |                               |
| Syarat atau temuan pemblokir (masing-masing menjadi issue)                                                                    |                               |
| Jangka retensi yang ditetapkan (rujukan)                                                                                      |                               |
| Lokasi bukti (bukan di repositori ini bila memuat nasihat)                                                                    |                               |

Sampai blok ini diisi dan ditautkan dari baris gerbang fase 3, bagian hukum dari
gerbang **belum terpenuhi**, dan baris gerbang tetap tidak dicentang untuk
bagian itu.
