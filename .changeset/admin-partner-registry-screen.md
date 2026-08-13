---
"awcms": minor
---

feat(admin): layar Partner registry — PLATFORM, dan sengaja bukan di /admin/partners (#540)

Registri mendapat penulis di #538 dan tidak punya halaman. Ini halamannya, dan hal
terpenting tentangnya adalah di mana ia TIDAK berada.

`/admin/partners` adalah pandangan PELANGGAN atas siapa yang menjangkau tenant-nya
sendiri. Menaruh registri di sana menaruh daftar setiap kemitraan platform di depan
setiap pelanggan — direktori lintas-tenant yang ADR-0089 tolak sebagai tabel,
dibangun ulang sebagai layar. Test kontraknya menegakkan pemisahan itu dari KEDUA
arah: halaman pelanggan tidak boleh menyebut `partner_registry`, dan halaman registri
tidak boleh menyebut `partner_access`.

DUA MEKANISME MENJAGANYA TETAP PLATFORM-ONLY, dan keduanya menanggung beban. FORCE
RLS menaruh setiap baris di tenant platform, jadi sesi pelanggan mana pun tak bisa
membacanya bahkan sambil memegang grant. Chokepoint menolak izin ber-scope platform
kecuali tenant yang bertindak MEMANG tenant platform. Tak satu pun cadangan bagi yang
lain, dan link nav-nya digerbangi izin platform itu sendiri dengan alasan yang
`/admin/tenants` catat: tidak ada paruh screen ini yang bisa dibaca tenant biasa, jadi
link ber-gerbang kunci pelanggan hanya akan menaruh entri sidebar yang selalu 403.

TIDAK ADA PICKER TENANT, dan halamannya mengatakan kenapa: daftar tenant yang bisa
dipilih adalah direktori yang desain ini menolak menyerahkannya. `/admin/tenants` ada
untuk operator platform yang perlu mencarinya — dan itulah batas izin yang seharusnya
memutuskan, bukan sebuah `<select>`.

TIDAK ADA DELETE, dan itu keputusan. Barisnya target FK dari keterlibatan dan dari
grant terdelegasi yang `sql/120` sengaja buat hidup lebih lama darinya. `status` juga
tidak pernah dikirim form ini: ia dipatok `sql/116` sampai ada yang MEMBACA suspensi
(#543).

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Lima mutasi memerahkan
test yang tepat: registri diselipkan ke layar pelanggan, izinnya dijadikan
tenant-scoped, link nav digerbangi kunci pelanggan, form ikut mengirim `status`, dan
satu kunci ditinggal di ledger.

`NOT_YET_SCREENED` **menyusut 51 → 49**.
