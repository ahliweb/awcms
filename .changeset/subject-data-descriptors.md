---
"awcms": minor
---

feat(privacy): tiap tabel menjawab pertanyaan subjek data, dan gerbangnya menolak diam (ADR-0094, #542)

`privacy-analysis.md` §4 menempatkan ekspor per-subjek dan penghapusan per-subjek di kolom
**celah**, bukan pengurangan cakupan. Celahnya bukan "belum ada yang menulis endpoint" —
melainkan bahwa **tidak ada yang tahu tabel mana** yang harus dijangkau sebuah jawaban.
Seorang subjek menyebar ke sembilan modul dengan pemilik tabel berbeda, dan daftar tabel
tulis-tangan di satu modul akan menyimpang DIAM-DIAM pada modul berikutnya yang mendarat:
kelas cacat yang persis melahirkan `data-lifecycle:table-coverage:check` (#437).

Jadi bentuknya sama dengan yang sudah terbukti: **tiap tabel menjawab pertanyaannya
sendiri, dan sebuah gerbang membuat "tidak menjawab" mustahil.**

**SUBJEKNYA TENANT USER, DIJAWAB PER TENANT** — bukan `awcms_principals` yang global. Ini
pertanyaan pertama Definition of Ready, dan repo sudah membayarnya **dua kali**: ADR-0087
dan ADR-0088 sama-sama merencanakan pembacaan lintas-tenant yang FORCE RLS larang, dan
keduanya baru ketahuan saat implementasi. Ekspor satu principal di seluruh tenant adalah
rencana yang sama untuk ketiga kalinya. Dan RLS di sini bukan hambatan yang harus
disiasati — ia memodelkan hal yang benar: tiap tenant adalah **pengendali data terpisah**,
dan satu pengendali tidak boleh menyerahkan data yang dipegang pengendali lain.
Konsekuensinya dinyatakan terus terang di dokumen privasi: tidak ada satu tombol
"lupakan saya di mana-mana", dan tidak boleh ada yang berpura-pura ada.

**PENGHAPUSAN MENGANONIMKAN SECARA DEFAULT.** Baris audit yang merujuk seorang aktor
adalah foreign key, dan menghapusnya menghapus bukti bahwa sesuatu pernah terjadi —
termasuk bukti bahwa penghapusannya sendiri terjadi. Kosakatanya dipakai ulang dari
`LifecycleDeletionMode`, ditambah `retain_under_obligation`: "hapus segalanya" bukan yang
dikatakan hukum, dan deskriptor yang berpura-pura begitu berbohong pada operator yang
memercayainya. Arah kesalahannya asimetris, dan defaultnya mengikuti arah itu.

**DUA IDENTIFIER, dan itu bukan detail.** Sebuah baris menjangkau orangnya lewat
`tenant_user_id` ATAU lewat `identity_id` — `awcms_sessions` yang kedua,
`awcms_audit_events` yang pertama. Perencana yang mengandaikan satu jenis akan mengikat
nilai yang salah ke separuh skema dan mengembalikan **nol baris, diam-diam** — kegagalan
terburuk yang mungkin untuk fitur ini. Deskriptor menyatakan yang mana.

**GERBANGNYA MENDARAT SEBELUM ENDPOINT-NYA, dan urutannya bukan kenyamanan.** Endpoint
yang mendarat lebih dulu akan mengekspor tabel yang kebetulan diingat penulisnya dan diam
untuk sisanya — laporan lengkap yang tidak lengkap lebih buruk daripada tidak ada
laporan, karena ia **ditandatangani**. `subject-data:coverage:check` menuntut tiap tabel
`awcms_*` menjawab lewat salah satu dari tiga: deskriptor `subjectData` milik modulnya,
penolakan beralasan di `NO_SUBJECT_DATA`, atau ledger hanya-menyusut untuk tabel yang
mendahului aturannya. Hari ini: **146 tabel — 3 berdeskriptor, 4 ditolak beralasan, 139
masih berutang**, dan angka terakhir itu dicetak setiap run supaya utangnya tetap
terlihat alih-alih menjadi latar.

Yang **TIDAK** mendarat, dan dinyatakan di ADR-nya: endpoint ekspor, endpoint
penghapusan, layar admin, izin + migrasi seed, dan eksekutornya.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau (43 segmen). Gerbang barunya
dibuktikan MEMERAH pada tiga mutasi: tabel baru yang tidak menjawab apa pun, tabel
berdeskriptor yang ditinggal di ledger (utang yang berbohong), dan tabel hantu di ledger.
Tujuh belas test menahan perencananya, termasuk yang membuktikan `awcms_principals` tidak
muncul di rencana mana pun.
