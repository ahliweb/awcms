---
"awcms": minor
---

feat(admin): layar Business scope — dan izin checker yang selama ini dideklarasikan tanpa pernah dibaca (#545)

Sembilan izin punya endpoint dan tidak punya halaman. Ledger menamai celahnya dengan
tepat: "penugasan plus alur maker/checker untuk pengecualian **tanpa inbox bagi
checker-nya**". Alur maker/checker tanpa tempat bagi checker melihat apa yang menunggu
bukan alur; ia dua endpoint yang kebetulan berpasangan, dan sampai hari ini siapa pun
yang harus menyetujui pengecualian SoD harus diberi tahu lewat jalur di luar sistem.

**INBOX-NYA DI SINI, BUKAN DI `/admin/approvals`, dan itulah keputusannya.**
`/admin/approvals` adalah permukaan keputusan MILIK `workflow_approval`, dan
pengecualian SoD sama sekali tidak berjalan di mesin itu: tabelnya sendiri, mesin
statusnya sendiri (`pending/approved/rejected/expired/revoked`), izinnya sendiri,
nama field alasannya sendiri. Merender keduanya di sana akan menaruh sumber data kedua
yang tak berhubungan pada halaman yang seluruh kosakatanya — task, instance, quorum,
delegation — tidak menggambarkan satu pun darinya, dan menggerbangi dua keluarga izin
yang tak berkaitan pada satu layar. Alternatif yang MEMANG membenarkan penyatuan adalah
mem-port pengecualian SoD ke mesin workflow: itu perubahan fondasi dengan ADR-nya
sendiri, dan akan membuat `identity_access` bergantung pada `workflow` — sisi yang tidak
dimiliki DAG modul hari ini. Sementara itu baris pending adalah baris yang layar ini
sudah daftarkan: inbox-nya adalah partisi dari daftar itu plus dua tombol.

**IZIN CHECKER YANG DIDEKLARASIKAN DAN TIDAK PERNAH DIBACA.**
`SoDRuleDescriptor.exceptionPolicy.requiresApprovalPermission` disebut kontrak modul
sebagai "kunci izin yang harus dipegang tenant user BERBEDA untuk menyetujui pengecualian
atas aturan INI". Gerbang registry menolak aturan yang tidak menyertakannya.
`sod-exception-service.ts` menulis dalam prosa bahwa ia "digerbangi di route".

Tidak ada kode yang membacanya. Route approve menanyakan chokepoint untuk
`identity_access.business_scope_exceptions.approve` yang tetap, lalu berhenti — dan satu
aturan yang dikirim base ini kebetulan menamai persis kunci itu, sehingga keduanya
berimpit dan celahnya tak terlihat. Modul pertama yang mendeklarasikan aturan yang hanya
boleh disetujui, katakanlah, seorang controller keuangan akan mendapati syarat itu
diabaikan diam-diam sementara TIGA artefak menyatakan sebaliknya. Route kini
menegakkannya lewat `resolveSoDApprovalAuthority` yang murni, dengan urutan yang satu-
satunya aman: gerbang tetap DULU (penelepon tanpa hak tidak boleh belajar aturan mana
yang dimiliki sebuah id), baru rule dibaca dan kunci miliknya ditanyakan bila berbeda.
Aturan yang tidak dikenal registry **MENOLAK** — pengecualian yang tak bisa dijelaskan
tak bisa direview, dan ia toh sudah inert karena evaluator mencari pengecualian lewat
rule key. Menolak dan mencabut tetap tersedia. Nol perubahan perilaku hari ini: satu
aturan yang ada menamai kunci yang sama.

**APPROVE DISEMBUNYIKAN DI DUA SUMBU, BUKAN SATU.** `approveSoDConflictException` menolak
saat approver adalah requester DAN saat approver adalah SUBJEK. Layar yang memeriksa satu
sumbu akan merender tombol Approve yang selalu menjawab 403 bagi orang yang paling
termotivasi menekannya.

**PICKER ATURAN DITURUNKAN dari registry hidup**, dan hanya dari aturan yang
`exceptionPolicy.allowed`-nya true — daftar tulis-tangan akan terlihat lengkap di base
dengan satu aturan lalu diam-diam melewatkan apa pun yang disumbang modul domain. Plafon
`maxDurationDays` per-aturan menyempitkan field tanggal saat aturan dipilih, pola yang
sama dengan plafon aksi tulis di `/admin/machine-credentials`.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Empat mutasi memerahkan
test yang tepat: mengembalikan cacat aslinya (gerbang kedua dihapus) memerahkan 3 test,
aturan tak dikenal yang jatuh ke `base_only` memerahkan 1, layar yang hanya memeriksa
sumbu requester memerahkan 1, dan rule key yang ditulis tangan di picker memerahkan 2.

`NOT_YET_SCREENED` **menyusut 47 → 38**. Aset klien 154,0 → 157,5 kB dari plafon 180 kB —
layar terbesar sejauh ini, dan ia muat karena #552 mendarat lebih dulu.
