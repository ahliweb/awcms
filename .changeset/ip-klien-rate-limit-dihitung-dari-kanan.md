---
"awcms": patch
---

IP klien untuk rate limit dihitung dari **kanan** `X-Forwarded-For`, bukan dari
kiri (#438).

`resolveClientIp` membaca entri paling KIRI, dengan prasyarat yang ditulis
sebagai prosa: sah "hanya bila proxy itu MENIMPA (bukan menambah)" header.
Prasyarat yang tidak bisa diverifikasi operator dari dalam kode bukan kontrol,
dan kegagalan yang diizinkannya total, bukan sebagian: di belakang proxy yang
MENAMBAH — perilaku RFC 7239, dan yang dilakukan
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` milik nginx —
penyerang mengirim `X-Forwarded-For: <acak>`, proxy menambahkan peer aslinya di
kanan, entri paling kiri tetap apa pun yang diketik penyerang, dan tiap request
mendarat di bucket baru. Itu persis bypass yang `TRUSTED_PROXY_ENABLED`
diperkenalkan untuk menutup, dibuka kembali oleh topologi yang ia layani.

Gradien kepercayaan header itu berjalan kanan-ke-kiri. Jadi klien adalah entri
sejauh `TRUSTED_PROXY_HOP_COUNT` (baru, default `1`) dari kanan, dan tidak ada
posisi yang bisa dijangkau penyerang yang pernah dibaca. Default `1` **identik
byte** dengan perilaku lama untuk satu-satunya topologi yang pernah sah: proxy
yang menimpa mengirim satu nilai, dan di sana paling-kiri = paling-kanan.

Header yang lebih pendek dari rantai yang dideklarasikan jatuh ke
`clientAddress` — merosot ke over-limit (semua berbagi bucket proxy), bukan ke
no-limit. Nilai hop yang malformed jatuh ke `1`, tidak pernah ke `0`: nol akan
mengindeks lewat tepi kanan dan diam-diam mematikan kepercayaan header pada
deployment yang mengira sudah menyetelnya. `config:validate` menolak
`TRUSTED_PROXY_HOP_COUNT` yang diset tanpa `TRUSTED_PROXY_ENABLED=true`.

Ini **tidak** mengadopsi aturan `resolveAnalyticsClientIp`, yang menolak header
multi-nilai dan mengembalikan `null`. Itu benar di sana — IP analitik yang
hilang berharga satu baris presisi. Di sini tidak ada `null` untuk
dikembalikan, dan menolak multi-nilai akan meruntuhkan setiap klien di belakang
rantai 2-hop yang sah menjadi satu bucket: seluruh pengguna tenant terkunci
oleh dua puluh password salah. Prinsip sama, fallback berbeda.

Dibuktikan dengan mutasi: mengembalikan `parts[0]` memerahkan 7 test.
