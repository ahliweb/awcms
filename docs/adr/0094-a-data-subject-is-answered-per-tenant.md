# ADR-0094 — Seorang subjek data dijawab PER TENANT, dan tiap tabel menjawab sendiri

- **Status:** Diterima (2026-08-13).
- **Konteks:** Issue #542, dari
  [`privacy-analysis.md`](../awcms/privacy-analysis.md) §4 yang menempatkan
  ekspor per-subjek dan penghapusan per-subjek di kolom **celah**, bukan
  pengurangan cakupan.
- **Membangun di atas:**
  [ADR-0037](0037-data-lifecycle-module-admission.md) (deskriptor retensi
  per-tabel, dideklarasikan pemiliknya, dibaca satu mesin),
  [ADR-0076](0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)
  (tabel milik `src/lib/` mendapat registry KEDUA),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) (principal itu GLOBAL, dan
  menjangkau keluar tenant adalah tindakan platform), dan
  [ADR-0003](0003-postgresql-rls-multi-tenant.md) (FORCE RLS).

## Kenapa ADR, dan kenapa bukan satu endpoint

Seorang subjek data menyebar ke identitas, profil, sesi, audit, decision log,
komentar, draft form, media, dan analytics — sembilan modul dengan pemilik tabel
berbeda dan aturan retensi berbeda. Menuliskan daftar tabel dengan tangan di satu
modul akan menyimpang **diam-diam** pada modul berikutnya yang mendarat: kelas
cacat yang persis melahirkan gerbang `data-lifecycle:table-coverage:check`
(#437).

Jadi bentuknya sama dengan yang sudah terbukti: **tiap tabel menjawab
pertanyaannya sendiri, dan sebuah gerbang membuat "tidak menjawab" mustahil.**
Pertanyaan barunya satu kalimat — _bagaimana tabel ini menjawab tentang seorang
subjek_ — dan satu-satunya jawaban yang tidak diterima adalah diam.

## Keputusan 1 — Subjeknya adalah TENANT USER, dan permintaannya dijawab PER TENANT

Bukan `awcms_principals` yang global.

Ini pertanyaan pertama Definition of Ready, dan repo ini sudah membayarnya dua
kali: **ADR-0087 dan ADR-0088 sama-sama merencanakan pembacaan lintas-tenant yang
FORCE RLS larang**, dan keduanya baru ketahuan saat implementasi. Ekspor untuk
satu principal di seluruh tenant adalah rencana yang sama untuk ketiga kalinya.

Dan RLS di sini bukan sekadar hambatan teknis yang harus disiasati — ia
**memodelkan hal yang benar**. Tiap tenant adalah pengendali data yang terpisah.
Satu pengendali tidak boleh menyerahkan data yang dipegang pengendali lain, dan
seorang manusia yang menjadi anggota tiga tenant memang punya tiga hubungan yang
berbeda. Menjawab per tenant bukan kompromi; ia jawaban yang benar, yang
kebetulan juga satu-satunya yang bisa ditulis.

Konsekuensinya dinyatakan terus terang: **tidak ada satu tombol yang menjawab
"lupakan saya di mana-mana"**, dan tidak boleh ada yang berpura-pura ada.

## Keputusan 2 — Penghapusan MENGANONIMKAN secara default, dan tabel yang menyatakan lain wajib beralasan

Baris audit yang merujuk seorang aktor adalah foreign key, dan menghapusnya
menghapus bukti bahwa sesuatu pernah terjadi — termasuk bukti bahwa
penghapusannya sendiri terjadi.

Kosakatanya sudah ada di `LifecycleDeletionMode` dan dipakai ulang, bukan
ditemukan lagi: `hard_delete`, `anonymize`, `status_transition_then_purge`,
ditambah satu yang khas pertanyaan ini — `retain_under_obligation`, untuk baris
yang memang tidak boleh dihapus (kewajiban statutori, legal hold aktif).
"Hapus segalanya" bukan yang dikatakan hukum, dan deskriptor yang berpura-pura
begitu akan berbohong pada operator yang memercayainya.

Defaultnya `anonymize` karena arah kesalahannya asimetris: menganonimkan baris
yang sebenarnya boleh dihapus meninggalkan baris tanpa orang di dalamnya,
sementara menghapus baris yang seharusnya dianonimkan menghancurkan jejak audit
yang tak bisa dipulihkan.

## Keputusan 3 — Ekspor dan penghapusan adalah DUA otoritas, dan penghapusan maker/checker

Ekspor adalah pengungkapan: siapa pun yang bisa mengekspor subjek mana pun bisa
mengeksfiltrasi seluruh basis pengguna satu permintaan pada satu waktu. Ia
digerbangi izinnya sendiri, dan setiap ekspor **diaudit sebagai pengungkapan**,
bukan sebagai pembacaan.

Penghapusan tak bisa dibalik. Ia high-risk, menuntut alasan, diaudit `critical`,
dan menjadi pasangan **maker/checker** lewat registry SoD yang sudah ada — mesin
yang persis baru mendapat inbox-nya di #545, sehingga checker-nya punya tempat
melihat apa yang menunggu alih-alih diberi tahu lewat jalur di luar sistem.

## Yang mendarat di PR ini, dan yang TIDAK

Issue #542 menulis sendiri bahwa ini bukan satu PR. Yang mendarat adalah
FONDASINYA — bentuk yang membuat sisanya mekanis, dan gerbang yang membuat modul
berikutnya tidak bisa lupa:

| Mendarat                                                            | Belum                |
| ------------------------------------------------------------------- | -------------------- |
| `SubjectDataDescriptor` di kontrak modul                            | endpoint ekspor      |
| `subject-data:coverage:check` — tiap tabel `awcms_*` wajib MENJAWAB | endpoint penghapusan |
| ledger hanya-menyusut untuk tabel yang mendahului aturannya         | layar admin          |
| deskriptor gelombang pertama                                        | izin + migrasi seed  |
| perencana murni yang merakit daftar tabel seorang subjek            | eksekutor            |

Alasan urutannya bukan kenyamanan. Endpoint yang mendarat lebih dulu akan
mengekspor **tabel yang kebetulan diingat penulisnya**, dan diam untuk sisanya —
laporan lengkap yang tidak lengkap adalah kegagalan yang lebih buruk daripada
tidak punya laporan, karena ia ditandatangani. Gerbangnya mendarat lebih dulu
supaya kelengkapan menjadi sifat yang dipaksa, bukan sifat yang diklaim.

## Ditolak

- **Satu endpoint yang tahu segalanya.** Daftar tabel tulis-tangan yang
  menyimpang diam-diam pada modul berikutnya — cacat yang sama yang melahirkan
  `#437`.
- **Subjek = `awcms_principals`, dijawab lintas tenant.** FORCE RLS melarangnya,
  DUA ADR sudah tergelincir di situ, dan ia juga salah secara substansi: satu
  pengendali menyerahkan data pengendali lain.
- **`hard_delete` sebagai default.** Menghapus baris audit menghapus bukti bahwa
  penghapusan itu terjadi.
- **Satu izin untuk ekspor dan penghapusan.** Pengungkapan dan penghancuran
  adalah dua hal yang berbeda, dan yang satu tidak menyiratkan yang lain.
- **Menunggu sampai semuanya siap.** Gerbang tanpa endpoint tetap menutup celah
  yang paling mahal — modul berikutnya yang mendarat dengan tabel ber-data
  pribadi dan tak seorang pun tahu.
