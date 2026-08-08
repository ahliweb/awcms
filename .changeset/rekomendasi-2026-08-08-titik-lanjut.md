---
"awcms": patch
---

docs(state): putaran rekomendasi 8 Agustus 2026 dicatat sebagai titik-lanjut, bukan sebagai pesan commit

Putaran ini dimulai dengan **menurunkan ulang** daftar rekomendasi putaran
sebelumnya, karena daftar itu tidak pernah ditulis ke repo: lima PR yang mendarat
darinya (#411–#415) hanya bisa dibaca ulang dari pesan commit-nya, dan
scratchpad sesi yang memuat peringkatnya sudah hilang.

Menuliskan daftarnya di §4 adalah harga satu paragraf; menurunkannya ulang adalah
harga satu audit penuh (enam sumbu, verifikator skeptis, 24 temuan bertahan).

Dicatat: enam yang mendarat (R1 eskalasi `owner`, R2 36 test DB-gated
hijau-palsu, R4 `/news/**` di dokumen + surface cache inert, R5 aturan 5
`skills:check`, R6 gerbang cakupan layar admin) dengan nomor PR dan angka
hasilnya, empat yang tersisa (R3 layar admin melewati ABAC saat MEMBACA, R7
permukaan tanpa layar, R8 permission platform lewat editor role, R9 lima gerbang
buta, R10 status C7/RUM) dengan bukti ringkas masing-masing, dan **empat usulan
yang DITOLAK beserta alasannya** — karena penolakan yang tidak tertulis akan
diusulkan lagi enam bulan kemudian, aturan yang §9 dokumen standar sudah pakai
untuk barisnya sendiri.
