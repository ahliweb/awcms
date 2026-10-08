🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](hr-payroll.md)

<!-- i18n-source-hash: sha256:01f021467f3ead4859f58702c1f8749df8dabc49ea412d13c29fb09739be243a -->

# HR dan payroll — workforce, komisi, payroll (paket desain)

> **Status:** diterima oleh [ADR-0132](../adr/0132-hr-payroll-module-family-admission.id.md)
> (Issue #916). **Hanya desain: belum ada modul, tabel, route, atau migrasi.**
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

| Fase | Kunci modul     | Cakupan                                                                               | Bergantung pada                         | Dapat dibangun ketika                                                                                                                                      |
| ---- | --------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `hr_workforce`  | konteks kepegawaian, kehadiran, koreksi, shift, **port ketersediaan staf**            | `tenant_admin`, `profile_identity`      | sekarang (DoD biasa, tinjauan keamanan port baru dan jalur kepemilikan)                                                                                    |
| 2    | `hr_commission` | aturan komisi dan ledger akrual                                                       | `hr_workforce`                          | fase 1 mendarat                                                                                                                                            |
| 3    | `hr_payroll`    | kompensasi, rekening pembayaran, periode, run, baris, slip gaji, versi aturan payroll | `hr_workforce`, `hr_commission` (lunak) | **O4 dan O7 terjawab; enkripsi-saat-diam rekening pembayaran diputuskan; tinjauan keamanan; tinjauan hukum atas profil yurisdiksi apa pun; gladi restore** |

**Di luar cakupan untuk seluruh keluarga:** buku besar dan entri akuntansi apa
pun; dokumen fiskal (SPT tahunan, bukti potong); pembuatan berkas bank dan
panggilan penyedia pembayaran apa pun (isu berikutnya, lewat outbox, tidak
pernah di dalam transaksi database); saldo dan akrual cuti; pinjaman dan
tunjangan; pelacakan pelamar; penilaian kinerja; **komisi afiliasi** (penerima
berbeda, bukan pegawai); bukti kehadiran geolokasi/foto/perangkat (§4.3).

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

| Kriteria penerimaan (dari isu)                                                                                | Di mana                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Kepegawaian menyimpan referensi `profile_identity` dan tidak pernah menyalin nama, kontak, identitas nasional | §3, `profile_id` FK komposit; tak ada kolom pribadi di tabel HR mana pun |
| Unit organisasi, atasan, status berlaku-efektif                                                               | §4.1 `employment_terms`                                                  |
| Event kehadiran, koreksi, persetujuan lewat `workflow_approval`                                               | §4.2                                                                     |
| Bukti geolokasi/foto/perangkat adalah fitur terpisah, mati secara default                                     | §4.3 (tidak ada di fase 1; O6)                                           |
| Template dan penugasan shift dengan deteksi konflik                                                           | §4.4                                                                     |
| Port ketersediaan staf untuk Booking                                                                          | §5                                                                       |

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

| Kriteria penerimaan                                                | Di mana            |
| ------------------------------------------------------------------ | ------------------ |
| Periode, run, baris, slip gaji                                     | §7                 |
| SoD: hitung vs setujui vs bayar                                    | §7.5, O7 (terbuka) |
| Kunci periode; run finalized immutable; koreksi dengan reversal    | §7.2, §7.4         |
| Aturan berlaku-efektif, netral yurisdiksi                          | §7.3               |
| Profil Indonesia adalah data aturan, kepemilikan keputusan pemilik | §7.3, O4 (terbuka) |

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
persetujuan-diri yang sudah ada mencegah pegawai menyetujui koreksinya sendiri.
Teks alasan adalah data pribadi dan tidak pernah ikut dalam baris audit atau
event.

### 4.3 Bukti geolokasi, foto, dan perangkat

**Bukan bagian penerimaan ini dan tidak ada di fase 1 secara konstruksi:** tanpa
tabel, kolom, pengaturan, atau route (keputusan pemilik **O6** terbuka). Bila O6
pernah dijawab ya, batas minimumnya adalah ADR sendiri, penilaian dampak
perlindungan data, tabel terpisah dengan izin dan catatan persetujuan sendiri,
mati secara default per tenant, bukti **kasar** lebih disukai daripada presisi
(misalnya "di dalam geofence kantor: ya/tidak" alih-alih koordinat), foto disimpan
lewat `media_library` di tier rahasia, dan retensi singkat yang ditegakkan
`data_lifecycle`.

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
lalu menulis, ditambah **constraint trigger tertunda sebagai cadangan** agar
sesi pemeliharaan tidak bisa membuat tumpang tindih. Constraint eksklusi GiST pada
`tstzrange(starts_at, ends_at, '[)')` lebih rapat tetapi membutuhkan `btree_gist`,
yang tak pernah dipakai di migrasi repo ini; PR fase 1 memutuskan, bersama pemilik
provisioning. Hanya penugasan `published` yang terlihat oleh port ketersediaan.
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
  grade, tarif, atau atribut HR apa pun. SQL adapter hanya menyebut dua tabel
  jadwal; tes gagal bila pernah menyebut tabel kompensasi, payroll, atau komisi.
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

`awcms_hr_commission_accruals` adalah ledger. Fakta moneter —
`employment_id`, snapshot `rule_id` dan `rule_version`, `source_type`,
`source_ref`, `source_line`, `operation` (`accrue`, `reversal`), `base_amount`,
snapshot `rate`, `amount` bertanda, `currency_code`, `occurred_at` — **immutable**.
Hanya `status` dan capnya yang maju, oleh trigger transisi.
`awcms_hr_commission_transitions` adalah log append-only siapa memindahkan apa
kapan.

### 6.2 Akrual tepat-sekali

Kunci unik `(tenant_id, source_type, source_ref, source_line, employment_id,
operation)`. Adapter hilir memanggil port (bentuk ditunda ke PR fase 2) dengan
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
klasifikasi `sensitive`, `normalized_value`, hash **tanpa kunci**, mask (pola
identifier procurement); **enkripsi-saat-diam nilai adalah gerbang fase 3**, dan
hashing berkunci adalah tindak lanjut yang sama yang dicatat ADR-0128 untuk
identifier pemasok.

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
suntingan. Apakah profil ini dikirim upstream sebagai data seed atau dimiliki
masing-masing konsumen adalah **keputusan pemilik O4** (§16). Sampai dijawab, mesin
dikirim kosong dari isi Indonesia. Usulan, bukan keputusan: mesin upstream tanpa isi
regulasi; profil Indonesia **paket data terpisah** berversi dengan provenans, dimiliki
konsumen sampai peninjau hukum ditunjuk.

### 7.4 Finalisasi, imutabilitas, dan koreksi

Run finalized immutable **di database**: trigger hanya mengizinkan transisi di §8
dan, per transisi, hanya kolom cap; `awcms_app` tidak memegang DELETE dan tabel
baris dibekukan sejak `approved`. **Koreksi adalah reversal:** run `reversal`
memposting baris yang meniadakan yang asli (merujuknya), yang asli diberi cap
`reversed`, dan run reguler baru menghitung ulang. Tidak ada yang disunting. Angka
run finalized dapat direproduksi dari snapshot-nya (versi aturan, versi kompensasi,
input kehadiran dan komisi), dan pembacaan rekonsiliasi (§14) membuktikan baris
berjumlah total run dan slip berjumlah baris.

### 7.5 Pemisahan tugas (keputusan pemilik O7 — usulan)

Tugas adalah izin terpisah: **C** hitung (`runs.calculate`), **A** setujui
(`runs.approve`), **F** finalisasi (`runs.finalize`), **P** bayar (`runs.pay`),
**R** reverse (`runs.reverse`), ditambah **K** tulis kompensasi
(`compensation.update`) dan **U** terbitkan aturan (`rules.publish`).

| Pasangan dipegang satu orang             | Default usulan | Mekanisme tingkat peran                                                                                               |
| ---------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| C × A (hitung dan setujui)               | dilarang       | aturan SoD, `global_within_tenant`, `critical`, tanpa pengecualian                                                    |
| A × P (setujui dan bayar)                | dilarang       | aturan SoD, `critical`, tanpa pengecualian                                                                            |
| C × P (hitung dan bayar)                 | dilarang       | aturan SoD, `high`; pengecualian boleh, berbatas waktu (≤ 30 hari), disetujui orang ketiga yang memegang izin berbeda |
| C × F, F × P                             | dilarang       | aturan SoD, `high`                                                                                                    |
| A × F (setujui dan finalisasi)           | **boleh**      | tingkat tugas sama, F membekukan apa yang disetujui A                                                                 |
| K × A (ubah gaji dan setujui run)        | dilarang       | aturan SoD, `critical`, tanpa pengecualian                                                                            |
| U × A (terbitkan aturan dan setujui run) | dilarang       | aturan SoD, `high`                                                                                                    |
| R × P (reverse dan bayar)                | dilarang       | aturan SoD, `high`                                                                                                    |

Apa pun yang dikonfigurasi tenant, **aturan per-instance ada di database** dan tidak
bisa dikonfigurasi hilang: `approved_by <> calculated_by`; `finalized_by <>
calculated_by`; `paid_by` berbeda dari `calculated_by`, `approved_by`, dan
`finalized_by`. Guard persetujuan-diri yang sudah ada juga berlaku pada `approve`.
Konsekuensi bagi tenant sangat kecil dinyatakan, tidak disembunyikan: menjalankan
payroll reguler membutuhkan **setidaknya tiga orang berbeda**, atau pengecualian C ×
P berbatas waktu di atas. Apakah itu default yang tepat adalah O7.

Finalize, pay, dan reverse sebaiknya mensyaratkan step-up principal bila terdaftar,
diterapkan **secara bersyarat** sebagaimana diresepkan ADR-0058 §E (step-up tanpa
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

| Event                          | Fase | Kapan                                                             | Payload (hanya id, jenis, hitungan)                                              |
| ------------------------------ | ---- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `awcms.hr.attendance.recorded` | 1    | event kehadiran baru (bukan replay) disimpan                      | `eventId`, `employmentId`, `kind`, `occurredAt`, `source`, `officeId`            |
| `awcms.hr.shift.assigned`      | 1    | penugasan menjadi `published` (dan saat batal, `cancelled: true`) | `assignmentId`, `employmentId`, `kind`, `startsAt`, `endsAt`, `cancelled`        |
| `awcms.hr.commission.accrued`  | 2    | akrual baru diposting (bukan replay)                              | `accrualId`, `employmentId`, `sourceType`, `ruleKey`, `ruleVersion`, `operation` |
| `awcms.hr.commission.approved` | 2    | akrual disetujui                                                  | `accrualId`, `employmentId`                                                      |
| `awcms.hr.payroll.finalized`   | 3    | run difinalisasi                                                  | `runId`, `periodKey`, `kind`, `employeeCount`, `currencyCode`                    |
| `awcms.hr.payroll.reversed`    | 3    | run di-reverse                                                    | `runId`, `reversalRunId`, `periodKey`, `employeeCount`                           |

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

`normalized_value`, hash, dan mask rekening pembayaran adalah `redactedColumns` dan
tidak pernah ikut ekspor. Uang dalam respons adalah string desimal; di log tidak ada.

### 11.3 Audit dan idempotensi

| Aksi                                     | `Idempotency-Key`       | Level audit                                                    | Replay                                                                  |
| ---------------------------------------- | ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| buat kepegawaian / ubah terms            | ya                      | info                                                           | `employee_no` unik                                                      |
| tautkan atau ubah `tenant_user_id`       | ya                      | warning                                                        | pemeriksaan status                                                      |
| event kehadiran                          | ya + `client_event_key` | tidak ada (volume tinggi; event ITU catatannya)                | mengembalikan yang asli                                                 |
| permintaan / keputusan koreksi           | ya                      | info                                                           | pemeriksaan status; keputusan workflow diaudit oleh `workflow_approval` |
| terbitkan / batalkan shift               | ya                      | info                                                           | pemeriksaan status                                                      |
| akru komisi (adapter)                    | ya                      | info                                                           | identitas sumber mengembalikan yang asli                                |
| setujui / rilis / bayar / reverse akrual | ya                      | warning (reverse: critical)                                    | pemeriksaan status + reversal unik                                      |
| usul / setujui kompensasi                | ya                      | warning                                                        | pemeriksaan status                                                      |
| tambah / hapus rekening pembayaran       | ya                      | warning                                                        | acknowledgement seragam (tanpa oracle)                                  |
| **reveal** rekening pembayaran           | tidak (pembacaan)       | warning, mencatat BAHWA pengungkapan terjadi, tidak pernah apa | —                                                                       |
| kunci periode                            | ya                      | critical                                                       | pemeriksaan status                                                      |
| buat / **hitung** run                    | ya                      | info / warning                                                 | `(period, run_no)` unik; pemeriksaan status                             |
| **setujui** run                          | ya                      | warning                                                        | pemeriksaan status                                                      |
| **finalisasi** run                       | ya                      | warning                                                        | pemeriksaan status; finalisasi kedua mengembalikan yang pertama         |
| **bayar** run                            | ya                      | warning                                                        | pemeriksaan status; pembayaran unik per run                             |
| **reverse** run                          | ya                      | critical                                                       | sekali per run (unique index parsial)                                   |
| terbitkan / pensiunkan aturan            | ya                      | warning                                                        | pemeriksaan status                                                      |

Tidak ada baris audit yang membawa jumlah, nama, identifier, catatan, atau teks
alasan; correlation id menggabungkan baris audit, event outbox, dan baris ledger
apa pun. Replay tidak mengaudit apa pun.

## 12. Skenario penerimaan RBAC/ABAC (pernyataan yang dapat diuji)

Setiap pernyataan adalah tes integrasi yang harus ditulis isu implementasi terhadap
database nyata sebagai role runtime, lulus dua arah (aktor yang disebut dapat;
setiap aktor lain tidak). "Mekanisme" adalah apa yang sudah ada di repositori ini.

| #   | Pernyataan                                                                                                                                                                                                                                                                                                                                                        | Mekanisme                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Pegawai dengan peran dasar saja membaca event kehadiran **miliknya sendiri** dan **tidak dapat** membaca milik pegawai lain (keduanya `403`).                                                                                                                                                                                                                     | `ownershipGrant` untuk `attendance.read`, dihitung server dari `employment.tenant_user_id === ctx.tenantUserId`; hanya melebarkan, ABAC/tenant/SoD tetap menolak; decision log mencatat `ownership_grant:<reason>`.                              |
| S2  | Pegawai membaca **slip gaji miliknya yang sudah dirilis** dan tidak dapat membacanya sebelum rilis, maupun milik orang lain.                                                                                                                                                                                                                                      | `ownershipGrant` pada `payslips.read` ditambah predikat status (`released_at IS NOT NULL`) pada kueri handler; tanpa atribut baru.                                                                                                               |
| S3  | Pegawai clock-in untuk dirinya sendiri; pegawai yang sama tidak dapat mencatat kehadiran rekan kerja.                                                                                                                                                                                                                                                             | `ownershipGrant` pada `attendance.create` terbatas pada kepegawaian sendiri; mencatat untuk orang lain membutuhkan kunci `attendance.create` yang tidak dimodifikasi.                                                                            |
| S4  | Supervisor yang ditugaskan ke kantor O membaca kehadiran dan koreksi untuk kepegawaian **di O dan turunannya**, bukan kantor lain.                                                                                                                                                                                                                                | business scope `office` dengan `requiredScopeType=office`, `requiredScopeId=<kantor kepegawaian>`, `requiredScopeRelations=["exact","descendant"]` dan adapter hierarki yang ada (ADR-0060); scope tak ter-resolve menolak aksi berisiko tinggi. |
| S5  | Supervisor dapat menyetujui koreksi bawahan tetapi **tidak dapat menyetujui** koreksinya sendiri.                                                                                                                                                                                                                                                                 | keputusan `workflow_approval` + guard persetujuan-diri yang ada (`approve` dengan `requestedByTenantUserId`).                                                                                                                                    |
| S6  | Manajer melihat bawahan langsungnya meski tidak memegang scope pada kantor bawahan.                                                                                                                                                                                                                                                                               | alasan `ownershipGrant` yang dihitung server (`manager_of`) dari rantai atasan tersimpan; **bukan** atribut ABAC (`resource.managerTenantUserId` membutuhkan penerimaan sendiri dan tidak diasumsikan).                                          |
| S7  | Penjadwal pemegang `shifts.*` membuat dan menerbitkan penugasan dan **menerima `403` pada setiap route `compensation.*`, `payout_accounts.*`, `runs.*`, dan `payslips.*`.**                                                                                                                                                                                       | RBAC default-deny: izin terpisah, tak satu pun diberikan peran penjadwal; tabel terpisah.                                                                                                                                                        |
| S8  | Adapter ketersediaan, dijalankan dengan `tx` ber-scope tenant, mengembalikan interval kerja dan **tidak ada yang lain**; SQL-nya tidak pernah menyebut tabel kompensasi atau payroll.                                                                                                                                                                             | DTO allow-list `StaffAvailabilityPort`; tes teks-sumber atas adapter (gaya sama dengan `access:chokepoint:check`).                                                                                                                               |
| S9  | Pengguna yang menghitung sebuah run **tidak dapat menyetujuinya**; penyetuju **tidak dapat membayarnya**; pengguna yang memegang kedua izin ditolak saat penugasan peran dan, bila jalur pengecualian dipakai, saat waktu-aksi.                                                                                                                                   | CHECK DB pada baris run (`approved_by <> calculated_by`, `paid_by` berbeda) **dan** `sodRules` atas kunci izin (`global_within_tenant`, `critical`); guard persetujuan-diri pada `approve`.                                                      |
| S10 | Pengguna yang mengubah kompensasi pegawai tidak dapat menyetujui run payroll yang memuatnya; kompensasi yang diusulkan A tidak dapat disetujui A.                                                                                                                                                                                                                 | aturan SoD K × A; CHECK `approved_by <> proposed_by`; guard persetujuan-diri.                                                                                                                                                                    |
| S11 | Marketer CRM (memegang `crm.*` dan `profile_identity.profile_management.read`) dan resepsionis (memegang booking dan baca-shift saja) menerima `403` pada setiap route `compensation`, `payout_accounts`, `runs`, `payslips`, dan `commission.accruals` dan **tidak melihat gaji atau identitas nasional** lewat daftar profil (hanya nama; identifier ter-mask). | RBAC default-deny: tanpa izin payroll `hr_*`; masking `profile_identity` tidak berubah; tabel payroll tak terjangkau tanpa kuncinya sendiri.                                                                                                     |
| S12 | Mengungkap rekening pembayaran tanpa `payout_accounts.reveal` adalah `403`; dengannya respons `no-store`, baris audit pada `warning` mencatat bahwa itu terjadi dan oleh siapa tetapi tidak pernah nilainya.                                                                                                                                                      | aksi berisiko tinggi `reveal`; pola reveal procurement.                                                                                                                                                                                          |
| S13 | Dengan modul dinonaktifkan untuk tenant T, setiap route modul itu ditolak untuk T dan tabel T tidak tersentuh; payroll T2 tidak terpengaruh.                                                                                                                                                                                                                      | enable/disable modul (`awcms_tenant_modules`); FORCE RLS.                                                                                                                                                                                        |
| S14 | Kredensial mesin (token API) tidak dapat menjalankan `ownershipGrant`.                                                                                                                                                                                                                                                                                            | ADR-0063 §A mengecualikan kredensial mesin.                                                                                                                                                                                                      |
| S15 | Permintaan yang menyuplai `employment_id`, `profile_id`, atau `office_id` tenant lain ditolak, meski id itu ada.                                                                                                                                                                                                                                                  | FK komposit `(tenant_id, id)` ditambah FORCE RLS; handler membaca ulang di dalam `withTenant`.                                                                                                                                                   |

**Apa yang membutuhkan penerimaan baru, dinyatakan terus terang.** Pembatasan
per-bawahan lewat _kebijakan_ ABAC (alih-alih alasan kepemilikan yang dihitung
server), scope grade-payroll atau pusat-biaya, dan pohon unit organisasi HR
(tindak lanjut §4.1) masing-masing membutuhkan atribut allow-list ABAC baru atau
tipe business-scope baru dengan perluasan adapter. Tak satu pun diasumsikan;
skenario di atas dapat dipenuhi tanpa itu.

## 13. Analisis ancaman dan privasi

### 13.1 Ancaman

| Ancaman                                                                   | Kontrol                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Baca atau tulis lintas tenant data kepegawaian atau gaji                  | FORCE RLS + FK komposit + `defineTenantRoute`; RLS diuji sebagai `awcms_app`                                                |
| Penjadwal atau marketer membaca gaji (horizontal dalam-tenant)            | izin dan tabel terpisah; S7, S11; port ketersediaan adalah allow-list                                                       |
| Penyalahgunaan layanan mandiri: pegawai membaca slip/kehadiran orang lain | `ownershipGrant` dihitung dari tautan tersimpan, tidak pernah dari permintaan; kredensial mesin dikecualikan                |
| Pembajakan tautan akun: menautkan login saya ke kepegawaian rekan         | `assign` berisiko tinggi, diaudit, dapat di-SoD; mengubahnya adalah event                                                   |
| Penipuan payroll: orang dalam mengubah gaji, menjalankan, dan membayar    | usul/setujui kompensasi; CHECK DB per-instance C/A/P; run finalized immutable; kunci periode; koreksi hanya dengan reversal |
| Pembayaran ganda (klik ganda, retry, replay)                              | pemeriksaan status + `Idempotency-Key` + slip unik per periode/pegawai + pembayaran unik per run                            |
| Pemalsuan kehadiran (mundur-tanggal, clock-in hantu)                      | event append-only, `recorded_at` server, supersesi oleh koreksi disetujui, batas selisih; tanpa penyuntingan                |
| Pencurian waktu oleh rekan yang clock-in untuk orang lain                 | mencatat untuk orang lain membutuhkan kunci tak-dimodifikasi, diaudit lewat `source` dan aktor; bukti adalah O6             |
| Inflasi ledger oleh sumber komisi palsu                                   | identitas sumber unik; kewajiban adapter memverifikasi (terdokumentasi); `approve` oleh pihak ketiga                        |
| Kebocoran lewat event, log, ekspor, notifikasi                            | hanya id/hitungan; uang tidak ada di log; `redactedColumns`; pemberitahuan slip tanpa jumlah                                |
| Rekening pembayaran polos saat diam                                       | **gerbang fase 3**: enkripsi-saat-diam dan hashing berkunci diputuskan sebelum tabel ada                                    |
| Oracle keberadaan (apakah X pegawai? apakah X dijadwalkan?)               | `unknown` tak dapat dibedakan; acknowledgement seragam untuk penambahan identifier                                          |
| Penyalahgunaan aturan (tarif pajak diubah agar under-withhold)            | versi aturan immutable setelah terbit, diterbitkan maker/checker, kutipan wajib, audit pada `warning`                       |
| Perubahan gaji mundur-tanggal setelah periode ditutup                     | kunci periode; `backdate` berisiko tinggi; tanpa unlock                                                                     |
| Panggilan penyedia di dalam transaksi                                     | tidak ada; integrasi bank/penyedia apa pun lewat outbox di isu berikutnya                                                   |
| Replay kehadiran offline memalsukan waktu                                 | keunikan `client_event_key`; flag `late` untuk ditinjau; koreksi membutuhkan persetujuan                                    |

### 13.2 Privasi (UU PDP 27/2022)

Ini analisis desain, bukan nasihat hukum; penerapannya adalah penilaian per
deployment.

- **Subjek data dan kategori.** Pegawai dan pekerja. Data pribadi umum: identitas
  (lewat `profile_identity`), kepegawaian, kehadiran, dan jadwal. Keuangan: gaji,
  rekening bank, pemotongan. **Data pribadi bersifat spesifik** menurut undang-undang
  harus diperlakukan lebih hati-hati: kesehatan (alasan cuti sakit: karena itu tidak
  ada alasan time-off yang disimpan), dan berpotensi data biometrik atau geolokasi
  (karena itu bukti dikecualikan, O6).
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
  dienkripsi saat diam sebelum fase 3; audit atas reveal; penanganan backup
  mengikuti runbook yang ada, dan restore membutuhkan rekonsiliasi di §14.
- **Kesiapan pelanggaran.** Audit dan decision log menjawab "siapa membaca apa";
  kewajiban notifikasi mengikuti hasil O5.
- **Penilaian dampak.** Fase 1 (tanpa bukti) adalah pemrosesan data kepegawaian
  rutin; fase 3 dan fitur bukti apa pun membutuhkan penilaian dampak terdokumentasi
  sebelum implementasi.

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
- Reveal rekening pembayaran: step-up dan rate limit diputuskan secara bersyarat di
  fase 3 (tidak tanpa syarat, ADR-0058 §E).
- Pengaman merge antara dua profil berpegawai-aktif, pertanyaan `btree_gist`, dan
  tambahan `AccessAction` (`calculate`, `pay`) adalah keputusan saat implementasi.
- Arsip-lalu-purge untuk baris keuangan, layar admin, dan keluaran berkas bank
  adalah isu berikutnya.
- `awcms_profile_entity_links` boleh ditulis tambahan untuk penemuan ("modul mana
  menautkan profil ini"); opsional, tindak lanjut.

## 16. Pertanyaan terbuka (keputusan pemilik — terbuka, belum diputuskan)

Dilacak di hilir pada `ahliweb/awcms-one` `docs/aw-business-platform-dor.md`. Tak
satu pun ditutup oleh ADR-0132.

| Id  | Pertanyaan                                                                                                                             | Mengapa penting di sini                                                                             | Memblokir                 | Sikap paket ini                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| O1  | Cakupan dan urutan epik platform seperti dilacak di hilir (apakah fase terbit bersama, berurutan, atau per konsumen)                   | Ketiga fase dirancang terbit satu per satu; konsumen mungkin menginginkan payroll bersama workforce | urutan isu implementasi   | Dirancang terbit berurutan; payroll tak pernah terbit sebelum gerbangnya                                |
| O4  | Profil payroll Indonesia: hanya PPh 21, atau juga BPJS, lembur, tunjangan hari raya; dan apakah data seed upstream atau milik konsumen | Isi regulasi harus berlaku-efektif dan terlacak; cakupan menentukan ukuran dan tinjauan hukum       | gerbang fase 3            | Mesin netral yurisdiksi dan kosong dari isi Indonesia; profil sebagai paket berversi terpisah (§7.3)    |
| O5  | Peran hukum operator platform per deployment: pengendali, prosesor, atau keduanya                                                      | Menentukan kepemilikan permintaan subjek, ketentuan pemrosesan, notifikasi pelanggaran              | analisis privasi, retensi | Dirancang untuk isolasi per tenant apa pun hasilnya (§13.2)                                             |
| O6  | Apakah kehadiran boleh pernah memakai bukti geolokasi, foto, atau perangkat                                                            | Data pribadi spesifik/biometrik; menentukan apakah ada di desain mana pun                           | ADR bukti apa pun         | Dikecualikan dari fase 1 secara konstruksi; batas minimum dinyatakan (§4.3)                             |
| O7  | Pemisahan tugas payroll: siapa boleh menghitung, menyetujui, memfinalisasi, membayar                                                   | Matriks otorisasi dan skenario ABAC minimum; dampak tenant kecil                                    | gerbang fase 3            | Matriks default diusulkan (§7.5); CHECK DB per-instance apa pun hasilnya; minimum tiga orang dinyatakan |
