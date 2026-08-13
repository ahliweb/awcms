---
"awcms": minor
---

feat(admin): editor settings modul — dan tautan yang selama ini menuju 404 (#546)

Tiga dokumen menyatakan panel settings generik `/admin/modules/{key}` sudah ada. Ia
tidak pernah ada: `/admin/modules` hanya mendaftar modul dan menyalakan/mematikannya,
tidak ada rute `[moduleKey]` sama sekali, dan `/admin/blog-settings` me-render
**tautan hidup** langsung ke 404. Salah satu dokumen memakai klaim itu untuk
membenarkan tidak membangun editor — begitulah pernyataan palsu tentang sebuah
kontrol menjadi alasan untuk tidak memilikinya.

MEMBANGUN YANG DIKLAIM DOKUMEN ADALAH KOREKSINYA. Menghapus kalimatnya akan
meninggalkan gap-nya dan kehilangan catatannya; membangun halamannya membuat ketiga
kalimat itu benar sekaligus. `/admin/modules` kini menautkan setiap barisnya ke sana —
digerbangi izin `settings` sendiri, bukan izin toggle, karena mematikan modul dan
menulis ulang konfigurasinya adalah dua otoritas berbeda.

INI KOTAK PATCH, BUKAN EDITOR DOKUMEN, dan itu bukan penyederhanaan. `updateModuleSettings`
menggabungkan secara dangkal — `{ ...before, ...patch }` — dan kontraknya tidak punya
konvensi penghapusan sama sekali: tak ada `null`-berarti-hapus, tak ada mode replace.
Textarea yang menyajikan override sebagai dokumen akan membiarkan operator menghapus
satu kunci, submit, lalu melihatnya kembali. Halaman ini meminta kunci yang mau
DISETEL dan menyatakan terus terang bahwa meninggalkan kunci tidak menghapusnya.
Memberi API jalur penghapusan adalah keputusan tersendiri tentang apa arti `null`, dan
bukan sesuatu yang boleh dikarang sebuah layar.

TIGA BLOK JSON, karena nilai efektif adalah HASIL HITUNG. Default datang dari
deskriptor modul (kode, bukan basis data), override adalah baris tenant, dan
`effective` adalah gabungan dangkal yang benar-benar dibaca sistem. Menampilkan
override saja menyembunyikan nilai yang berlaku; menampilkan `effective` saja
menyembunyikan paruh mana yang bisa diubah operator.

Kedua penolakan rahasia dimunculkan terpisah: kunci ber-nama rahasia DAN nilai
ber-bentuk kredensial di bawah nama polos adalah dua pemeriksaan berbeda di
validator, dan yang kedua satu-satunya yang menangkap token yang ditempel ke field
bernama `publicLabel`.

SATU GERBANG DIPERLUAS, dan itu bukan pelonggaran. `admin-navigation-registry`
menuntut setiap halaman admin punya entri sidebar, yang meng-encode "terjangkau"
sebagai "terjangkau dari sidebar" — proxy yang benar untuk setiap halaman statis dan
sekadar salah untuk rute ber-PARAMETER: sidebar tidak bisa memuat `[moduleKey]`.
Gerbang itu belum pernah bertemu bentuk ini. Propertinya dipertahankan dan proxy-nya
diganti: halaman dinamis wajib punya halaman INDUK (tempat orang menjangkaunya) dan
DILARANG punya entri sidebar. Dua mutasi membuktikannya menggigit — menghapus
`/admin/modules` membuat editornya yatim, dan memberi halaman dinamis entri sidebar
memerahkannya.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Lima mutasi memerahkan
test yang tepat: link digerbangi izin toggle, form mengirim `PUT`, peringatan
"tidak menghapus" dihapus, satu dari dua penolakan rahasia tak ditangani, dan satu
kunci ditinggal di ledger.

`NOT_YET_SCREENED` **menyusut 49 → 47**.
