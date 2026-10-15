🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0142-subject-data-reaches-a-table-through-its-parent-row.md)

<!-- i18n-source-hash: sha256:70d214e2263cbdea80fdb94bae482de92eea247ab25da76b5405f11a3853168c -->

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
