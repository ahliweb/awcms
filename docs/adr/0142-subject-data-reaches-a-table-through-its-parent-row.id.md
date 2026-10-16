🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0142-subject-data-reaches-a-table-through-its-parent-row.md)

<!-- i18n-source-hash: sha256:8db56c76cbc596e36dbf7c34849e83eae68e5a848ab70f03393563ca2b46f647 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0142 — Deskriptor data-subjek boleh menjangkau orangnya lewat SATU baris induk

- **Status:** Diterima
- **Tanggal:** 2026-10-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #985 (ADR ini dan implementasinya; tindak lanjut #945 dan #946); [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md) (model data-subjek yang diperluas); [ADR-0108](0108-what-an-export-withholds-and-what-an-erasure-destroys-are-different-questions.id.md) (semantik penghapusan yang tidak boleh dilemahkan); [ADR-0132](0132-hr-payroll-module-family-admission.id.md) §13.2 (kewajiban retensi pemberi kerja atas baris HR)

## Konteks

`SubjectDataDescriptor` menamai **kolom pada tabelnya sendiri** yang memuat id orang (`tenant_user`, `identity`, `profile`). Dua tabel `hr_workforce` tidak punya satu pun:

- `awcms_hr_employment_terms` (#945) dan `awcms_hr_shift_assignments` (#946) membawa `employment_id`, dan hanya employment yang menamai orangnya (`awcms_hr_employments.profile_id` / `tenant_user_id`).

Maka kedua deskriptor hanya bisa menamai **cap pelakunya** (`created_by`, `published_by`, `cancelled_by`) dan harus menjawab `exportable: false`. Ekspor permintaan akses subjek karenanya tidak memuat riwayat ketentuan kerja, shift terjadwal, dan cuti milik karyawan itu sendiri. Itulah kegagalan yang hendak dicegah ADR-0094: laporan yang lengkap bentuknya tetapi bungkam tentang tabel yang memuat data orangnya.

## Keputusan

### 1. Deskriptor boleh menamai SATU lompatan induk

`SubjectDataDescriptor.subjectVia?: SubjectDataJoin` (`MODULE_CONTRACT_VERSION` **4.6.0**, MINOR: penambahan murni, dan menghilangkannya berarti apa yang selalu dimaknai setiap deskriptor):

```ts
subjectVia: {
  column: "employment_id",                       // kolom FK pada tabel INI
  parentKey: "hr_workforce.employments",         // kunci deskriptor lain
  parentColumns: ["profile_id", "tenant_user_id"] // kolom subjek INDUK mana yang berarti "tentang orang itu"
}
```

Perencana menerjemahkannya menjadi `column IN (SELECT id FROM <induk> WHERE tenant_id = $1 AND (<kolom induk> = <id subjek> OR ...))`. Predikat tenant ditulis di dalam subkueri maupun di luar (aturan repo: jangan bersandar pada RLS saja). Induk yang di-soft-delete tidak disaring: employment yang telah berakhir tetap riwayat orang itu.

Hanya **satu lompatan**, bukan graf: lompatan kedua berarti perencana join di jalur privasi, dan tak ada tabel di skema ini yang memerlukannya. Gerbang menolak induk yang sendiri memakai `subjectVia`.

### 2. `parentColumns` eksplisit, dan `subjectColumns` milik anak harus kosong

Kolom subjek induk mencampur kolom identitas (`profile_id`) dengan cap pelaku (`created_by`). Mengikuti semuanya, atau meng-OR `created_by` milik anak dengan join, akan memasukkan **baris orang lain ke ekspor siapa pun yang mencatatnya**: permintaan seorang administrator HR akan mengembalikan seluruh riwayat ketentuan dan roster semua karyawan yang ia input. Itu bug pengungkapan di arah yang paling penting bagi fitur ini. Maka:

- deskriptor menamai persis kolom induk mana yang berarti "baris ini tentang orang itu";
- `subjectVia` dan `subjectColumns` **saling eksklusif** (ditegakkan gerbang). Cap milik anak tetap diuraikan di `rationale`, dan dijawab seperti cap lain: ia tak lagi mengarah ke siapa pun setelah `awcms_identities` dianonimkan.

### 3. Penghapusan TIDAK mengikuti join

Deskriptor `subjectVia` wajib menjawab `retain_under_obligation` (ditegakkan gerbang), `erasureTargets` milik perencana mengecualikannya, dan eksekutor melempar galat bila sampai diberi satu.

| Opsi                                                                 | Putusan                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Ekspor mengikuti join; penghapusan tidak (dipilih)**            | Pengungkapan bersifat baca-saja dan join tak bisa menghilangkan data. Kedua tabel HR append-only atau immutable lewat trigger dan dipertahankan di bawah kewajiban ketenagakerjaan dan penggajian pemberi kerja (ADR-0132 §13.2); profil yang dianonimkan sudah membuat riwayatnya tak mengarah ke siapa pun.           |
| B. Penghapusan juga mengikuti join (anonimkan atau hapus lewat join) | Ditolak untuk sekarang. Operasi yang berbeda dan lebih berbahaya: `UPDATE`/`DELETE` yang dipilih lewat tabel lain. Kedua tabel HR tak punya kolom untuk dianonimkan (tanpa teks bebas), barisnya bukti, dan kesalahan menghancurkan riwayat yang relevan bagi penggajian. Tabel yang memerlukannya membuat ADR sendiri. |
| C. Biarkan kedua tabel tidak dapat diekspor                          | Ditolak: data karyawan itu sendiri adalah pokok permintaan, dan celahnya menghalangi `hr_workforce` keluar dari `experimental`.                                                                                                                                                                                         |

### 4. Gerbang membuktikan join itu nyata

`subject-data:registry:check` menolak: kolom join yang tidak dimiliki tabel; yang bukan foreign key ke tabel induk (join atas uuid tak berhubungan membaca nol baris atau baris yang salah dan tetap "berhasil"); induk yang tak dikenal, global, tak terjangkau, atau sendiri memakai join; `parentColumns` yang kosong atau yang tidak dideklarasikan induk sebagai kolom subjek; `subjectVia` bersama `subjectColumns`; dan penghapusan selain `retain_under_obligation`.

## Konsekuensi

- **Positif:** kedua tabel `exportable: true`; ekspor karyawan memuat riwayat ketentuan dan shift miliknya dan tidak ada milik orang lain (uji integrasi pada database nyata, RLS berlaku: baris sendiri, rekan kerja tidak, pencatat tidak, tenant lain tidak, penghapusan membiarkan barisnya).
- **Negatif:** model mendapat bentuk pencocokan kedua yang harus dijaga konsisten oleh perencana, eksekutor, dan gerbang, dan tabel dengan `subjectVia` tak dapat ikut penghapusan. Kedua biaya disengaja dan dibatasi satu lompatan.
- **Netral:** `MODULE_CONTRACT_VERSION` 4.5.0 -> 4.6.0 dan manifest keluarga mengikutinya. Tanpa migrasi. Tabel kehadiran `hr_workforce` (`awcms_hr_attendance_events`, `awcms_hr_attendance_corrections`) berbentuk sama dan tetap `exportable: false`: koreksi memuat alasan teks bebas yang sensitif, dan membukanya adalah keputusan tersendiri, kini hanya satu suntingan deskriptor.
- **Tidak diubah:** perilaku kolom langsung semua deskriptor yang ada, termasuk `awcms_hr_employments`, yang cap pelakunya (`created_by` ...) masih mencocokkan pengguna HR yang membuat sebuah employment. Itu perilaku cap langsung yang sudah ada di registry ini dan dicatat sebagai pertanyaan terbuka, tidak diubah di sini.

## Alternatif yang dipertimbangkan

- **Bahasa join generik (beberapa lompatan, predikat bebas)** - ditolak (§1): perencana kueri di jalur privasi.
- **Menaruh `employment_id` pada anggota `references` baru** (`"employment"`) - ditolak: menanam tabel satu modul ke kontrak bersama dan `REFERENCE_TARGET_TABLE` registry.
- **Menyalin `profile_id` ke tabel anak** - ditolak: migrasi yang mendenormalisasi tautan orang ke bukti append-only, dijaga konsisten oleh trigger, demi menghindari subkueri satu lompatan.

## Adendum (Issue #1018, 2026-10-15): kehadiran, penghasilan komisi, dan stempel aktor

Tiga pertanyaan yang dibiarkan terbuka oleh §Konsekuensi. Diputuskan sebagai berikut; dua yang pertama dibangun, bagian hukum dari yang kedua dan yang ketiga ditandai untuk maintainer.

1. **Event dan koreksi kehadiran diekspor lewat employment.** Kedua deskriptor memakai `subjectVia` (`employment_id` -> `hr_workforce.employments`, `profile_id` / `tenant_user_id` / `last_tenant_user_id`), melepas stempel aktornya (`recorded_by`, `requested_by`, `decided_by`) dan tetap `retain_under_obligation`. **`reason` teks bebas pada koreksi adalah entri `redactedColumns`**, sehingga laporan menyebutnya ditahan: ia diketik pemohon (belum tentu karyawan), dapat menggambarkan kondisi kesehatan atau keluarga pihak ketiga, dan sensitif di tempat lain pada modul. Karyawan tetap membacanya lewat GET ber-ownership-grant. Merilisnya lewat ekspor berarti menghapus satu entri.
2. **Akrual komisi diekspor lewat employment, di balik batas penggajian.** `hr_commission.accruals` memakai `subjectVia`; `hr_commission.transitions` tetap `exportable: false` (butuh lompatan kedua, dan akrual sudah membawa status, cap waktu, dan kode alasan void). Rute ekspor mewajibkan pemanggil JUGA lolos `hr_commission.accruals.read` untuk setiap tabel batas-penggajian yang dapat diekspor (tabel tanpa guard terdaftar ditahan: default deny), menyebut apa yang ditahan di `withheld` pada respons, dan mencatat tiap pembacaan lewat `recordSensitiveRead` (id dan jumlah). Replay ekspor tersimpan memeriksa ulang izin dan mencatat lagi. Batasnya sendiri tidak berubah: `subjectData` tetap satu dari dua registri yang HARUS menamai tabel payroll (`payroll-data-boundary.ts`).
3. **Stempel aktor bukan lagi kolom subjek pada `awcms_hr_employments`.** Header itu tentang karyawan; `created_by` / `updated_by` / `deleted_by` / `restored_by` menamai pengguna HR, dan mencocokkannya memasukkan setiap header yang dimasukkan pengguna HR ke ekspornya sendiri. Ketiga kolom identitas tetap. Penghapusan tidak terpengaruh (`retain_under_obligation`). Aturan registri ke depan: stempel menjadi kolom subjek hanya bila baris itu tidak terutama tentang orang lain.

**Perbaikan lanjutan dari audit keamanan (issue yang sama).**

- **`parentColumns` adalah `["profile_id"]` pada setiap deskriptor `subjectVia`** (terms, shifts, event dan koreksi kehadiran, akrual). Sejak `sql/228` profil menemukan setiap employment yang benar-benar milik subjek; kedua kolom login hanya menambah baris ketika profil login berbeda, yaitu persis login yang salah tertaut (login yang diganti disimpan di `last_tenant_user_id`). Bila dibiarkan, mislink yang sudah dikoreksi memasukkan penghasilan dan kehadiran rekan kerja ke ekspor login itu. `awcms_hr_employments` sendiri masih mencocokkan kolom login, sehingga login yang salah tertaut masih melihat satu HEADER itu (nomor pegawai, tanggal): registri tidak punya pencocokan bersyarat, dicatat sebagai tindak lanjut.
- **Penyimpanan idempotensi tidak memuat baris payroll.** `awcms_idempotency_keys.response_body` hidup 30 hari di luar batas penggajian, sehingga ekspor yang tersimpan hanya menyimpan tabel payroll sebagai id dan penanda. Replay memeriksa ulang izin, membaca ulang baris menurut id, dan mencatat sensitive read lagi; tabel yang ditahan saat replay tidak juga dicantumkan di `truncatedTables`.
- **Sebuah tabel masuk batas penggajian menurut nama ATAU modul pemilik** (`isPayrollBoundaryTable`), sehingga tabel yang diganti nama dan tabel non-gaji milik `hr_commission`/`hr_payroll` tertangkap dan, tanpa guard terdaftar, ditahan.
- **`beneficiary_tenant_user_id`** (snapshot segregation-of-duties `sql/236`) adalah kolom yang disamarkan pada ekspor akrual. Komentar `sql/236` "tidak diekspos API apa pun" hanya benar karena itu; migrasi yang sudah diterapkan tidak disunting.

**Pertanyaan terbuka untuk maintainer / penasihat hukum** (tidak diputuskan di sini): (a) apakah penghasilan komisi seseorang boleh diserahkan kepada orangnya lewat ekspor yang dijalankan operator (perubahan ini hanya memungkinkannya bagi pemanggil yang juga memegang `accruals.read`; alternatifnya tabel tetap `exportable: false`); (b) apakah `reason` koreksi boleh dirilis kepada karyawan dalam ekspor.
