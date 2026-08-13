---
"awcms": major
---

feat(privacy): ledger subjek data mencapai NOL, dan empat jawaban yang ternyata belum punya kosakata (ADR-0094 gelombang 2, #557)

#542 mendaratkan fondasinya dan menyisakan **139 tabel di ledger utang**. #557 menulis
prasyaratnya sendiri dengan jujur: endpoint ekspor yang mendarat di atas ledger itu akan
menjawab dengan 3 tabel dan **diam untuk 139 sisanya** — laporan yang ditandatangani dan
tidak lengkap, yang lebih buruk daripada tidak ada laporan. PR ini membayar utang itu
sampai habis: **139 → 0**, 139 deskriptor + 7 penolakan beralasan menutup 146 tabel.

Kelengkapan kini sifat yang DIPAKSA skema, bukan yang diklaim sebuah PR.

**EMPAT KALI menuliskan deskriptor menemukan bahwa jawabannya tidak bisa dinyatakan.**
Ini bagian yang paling berharga, dan tak satu pun terlihat sebelum mencoba menjawab
seluruh 139:

1. **`severed_with_subject_row`** — jawaban jujur ~90 tabel. Mereka hanya membawa id
   subjek sebagai STEMPEL (`created_by`, `deleted_by`, `actor_tenant_user_id`), dan
   menganonimkan `awcms_identities` sudah membuat semuanya tak teresolusi. Tanpa anggota
   union ini, satu-satunya jawaban yang tersedia adalah `anonymize` — dan eksekutor yang
   patuh akan **menulis ulang stempelnya**, menghancurkan catatan tenant tentang siapa
   menghapus sebuah halaman demi memutus tautan yang sudah putus. Penghapusan akan
   merusak sesuatu di sembilan puluh tempat dan menyebutnya kepatuhan.

2. **`references: "profile"`** — `awcms_profiles` adalah tabel PERTAMA yang issue-nya
   sebut, dan **tidak satu pun** dari dua id yang ada muncul padanya: tautannya berjalan
   ke arah sebaliknya, dari `awcms_identities.profile_id`. Dengan dua id, nama dan detail
   kontak orangnya benar-benar tak terjangkau.

3. **`unreachableBySubject`** — `awcms_comments_reports` menyimpan HASH alamat pelapor
   dan tidak lebih, dengan sengaja, supaya moderator tidak bisa melihat siapa melaporkan
   siapa. `NO_SUBJECT_DATA` untuknya adalah dusta; sebuah kolom subjek adalah fiksi.
   Satu-satunya jawaban tersisa adalah array kosong — yang **dijatuhkan perencana
   diam-diam**, sehingga tabelnya hilang dari setiap ekspor tanpa apa pun mencatat bahwa
   ia pernah dipertimbangkan.

4. **`tenantColumn: null` yang eksplisit** — sebelumnya "absen" berarti DUA hal sekaligus,
   "pakai `tenant_id`" DAN "tabel global", kontradiksi yang perencana selesaikan dengan
   diam-diam mengikat `tenant_id`. Kini global dinyatakan sengaja, dan tabel global
   (`awcms_principals` dan satelit MFA-nya, ADR-0087) **DINAMAI** di
   `SubjectPlan.unansweredEntries` alih-alih hilang: laporan yang sekadar menghilangkan
   `awcms_principals` tak bisa dibedakan dari laporan yang ditulis sebelum tabel itu ada.

**GERBANG BARU: `subject-data:registry:check`.** `subject-data:coverage:check` bertanya
apakah tiap tabel MENJAWAB; yang ini bertanya apakah jawabannya BENAR — dan ia menemukan
**tujuh cacat pada deskriptor PR ini sendiri** sebelum satu pun di-review. Semuanya satu
string yang tampak masuk akal, semuanya gagal DIAM-DIAM: lima kolom redaksi salah nama
(redaksi yang salah nama tidak meredaksi apa pun dan tampak persis seperti yang bekerja),
dan dua `references` yang mengaku `identity` padahal foreign key-nya menunjuk
`awcms_principals`. Gerbangnya meresolusi tiap deskriptor terhadap `sql/`: kolom subjek
ada, kolom redaksi ada, `references` cocok dengan foreign key NYATA di mana ada,
`tenantColumn: null` dibuktikan (tabelnya benar-benar tanpa `tenant_id`), dan
`severed_with_subject_row` DITOLAK bila tak ada deskriptor yang meng-`anonymize`
`awcms_identities` — rantai yang, kalau putus, membuat sembilan puluh deskriptor
diam-diam berarti tidak melakukan apa-apa tanpa satu pun suntingan di dekat tabel yang
rusak.

**Satu ketegangan antar-gerbang diselesaikan SEMPIT, bukan dengan pelonggaran.**
`awcms_access_assignments` DIPENSIUNKAN ADR-0079, dan `access:grant-readers:check`
melarang berkas mana pun menyebutnya — "seluruh proteksinya", kata dokumennya. Tetapi
barisnya masih ada dan masih menyatakan peran apa yang pernah dipegang seseorang, jadi
dengan ledger di nol ia WAJIB menjawab. Menambahkan `module.ts` ke `GRANT_READERS` akan
membuat gerbang berhenti mengawasi seluruh berkas itu — persis proteksi yang dimaksud.
Jadi izinnya dikunci pada BENTUK penyebutan: namanya hanya boleh muncul sebagai nilai
`tableName:` sebuah deskriptor. Pembaca yang menyimpang menulis
`FROM awcms_access_assignments` di dalam template literal dan tidak bisa memenuhinya —
diuji dengan menanam justru pembacaan itu, termasuk kasus di mana satu deskriptor sah dan
satu pembacaan hidup berdampingan di berkas yang sama.

**MAJOR** — `MODULE_CONTRACT_VERSION` 3.2.0 → 4.0.0. Union `SubjectDataErasure` melebar
(konsumen yang penting adalah `switch` exhaustive, dan justru itu maksudnya: masing-masing
harus MEMUTUSKAN artinya, bukan jatuh ke `default`) dan `tenantColumn` berganti tipe. Tak
ada field `ModuleDescriptor` yang dihapus; seluruh deskriptor gelombang 1 tetap sah tanpa
perubahan.

Ledger `TABLES_PREDATING_THE_SUBJECT_RULE` DIPERTAHANKAN sebagai array kosong, bukan
dihapus: bentuk gerbangnyalah yang menegakkan jaminannya, dan menghapus ekspornya akan
menghilangkan tempat di mana regresi harus dituliskan.
