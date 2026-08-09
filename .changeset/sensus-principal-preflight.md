---
"awcms": patch
---

feat(identity): `identity:principals:preflight` — sensus read-only menjelang principal global

Prasyarat Gelombang 7 dari program model keanggotaan, dan sengaja mendarat
**berbulan-bulan** sebelum migrasinya.

`awcms_identities` UNIQUE pada `(tenant_id, login_identifier)`; sebuah principal
UNIQUE pada alamat ternormalisasi. Dua baris di **satu** tenant yang hanya beda
huruf besar-kecil atau spasi adalah **legal hari ini** dan **mustahil** sesudahnya
— dan perbaikannya tidak pernah berupa patch. Ia percakapan dengan pelanggan
tentang akun mana yang orangnya dan mana yang duplikat.

Percakapan itu tidak bisa terjadi di dalam jendela migrasi. Menjalankan sensus
ini lebih awal mengubah migrasi-yang-batal menjadi dukungan-pelanggan-terjadwal.

Normalisasinya **sengaja konservatif**: huruf kecil + trim, tidak lebih. Bukan
normalisasi yang diterapkan penyedia email — tanpa buang titik, tanpa buang
`+tag`, tanpa lipat Unicode. Masing-masing menggabungkan alamat yang di sebagian
penyedia adalah **orang yang berbeda**, dan penggabungan tak bisa dipulihkan
sementara laporan tabrakan bisa. Tugas sensus adalah menemukan apa yang akan
ditolak migrasinya, jadi ia menerapkan persis aturan itu dan tidak lebih.

Dua kelas temuan, dan hanya satu memblokir. **Tabrakan dalam satu tenant** →
memblokir. **Identifier bukan email** → advisory: ia tetap menjadi principal,
hanya tidak akan pernah bisa menerima undangan atau reset password.

Yang **tidak** dilaporkan sebagai masalah: alamat yang sama di **dua** tenant.
Itu justru yang dimungkinkan migrasinya — menandainya berarti melaporkan
fiturnya sebagai cacat.

Read-only, per-tenant, di role `awcms_app` biasa (`withTenantOrThrow`) — jadi
tanpa kredensial owner. Sound secara konstruksi untuk temuan yang memblokir:
tabrakan dalam-satu-tenant menurut definisinya ada di dalam satu tenant.

Keluar dengan kode 0 **meskipun tidak bersih**: ini sensus, bukan gerbang. Ia
melaporkan keadaan DATA, yang bukan regresi siapa pun dan bukan milik pipeline
mana pun; exit non-nol akan menyangkut sesuatu yang bukan tempatnya, atau
mengajari orang mengabaikannya. Migrasi Gelombang 7 yang menolak, dengan keras,
di titik ketika menolak adalah jawaban yang benar.
