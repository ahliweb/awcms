---
"awcms": minor
---

feat(data-lifecycle): `awcms_abac_decision_logs` mendapat retensi — dan sengketa otoritas proyeksinya diselesaikan

Tabel tanpa batas terbesar di repo: satu baris untuk **setiap** keputusan
otorisasi, ±8,6 juta baris/hari pada 100 req/s, dan **nol retensi** sejak
`sql/005`. Ia tumbuh sebanding dengan **lalu lintas**, bukan dengan data
pelanggan — sebuah tenant yang tidak menambah satu pun konten tetap menambah
baris di sini tiap kali stafnya membuka layar. Ia juga tabel yang paling
dibutuhkan saat insiden, persis ketika query terhadapnya paling lambat.

**Job purge-nya, kalau ditulis hari ini, akan menghapus nol baris.** `sql/022`
memberi `awcms_worker` hanya `SELECT`. `sql/091` memberi `DELETE`. Tanpa itu
purge-nya berjalan, melapor sukses, dan tidak menghapus apa pun — kegagalan yang
tidak berbunyi seperti kegagalan, melainkan seperti "tidak ada yang perlu
dihapus".

**Sengketa yang lahir bersama retensinya, diselesaikan di ADR-0072.** Modul
`reporting` memakai tabel ini sebagai sumber cursor dan deskripsinya berbunyi
"append-only — never updated/deleted, the ideal cursor_table source". Retensi
membatalkan klaim itu, dan akibatnya bukan kosmetik: penghitung **inkremental**
tidak terpengaruh purge, sementara **rebuild** menghitung ulang dari baris yang
masih ada. Setelah purge pertama, operator yang menekan rebuild diam-diam
**menghancurkan** hitungan historis dan menggantinya dengan yang lebih kecil,
tanpa satu pun error.

Keputusannya: keduanya diberi nama dan cakupan. Inkremental otoritatif untuk
sepanjang-masa; rebuild otoritatif untuk "sejak horizon retensi". Deskripsi
proyeksi diperbaiki di tempat implementor membacanya, dan sebuah test dua arah
menjaga keduanya jujur terhadap satu sama lain.

**Jendela 365 hari, bukan 90.** Angkanya tidak dipilih demi penyimpanan — ia
horizon di mana proyeksi itu masih bisa di-rebuild. 90 hari akan memilih angka
yang menyembunyikan koplingnya alih-alih menghadapinya.

**Satu klaim di rancangan awal ternyata salah, dan tidak jadi ditulis.** Issue
mengusulkan index `(tenant_id, created_at)` menaik karena purge memindai
`ORDER BY … ASC` sementara index yang ada menurun. Btree PostgreSQL **bisa
dipindai mundur**, jadi index yang ada sudah melayaninya tanpa sort. Index kedua
hanya akan menambah beban tulis pada tabel yang paling sering ditulis di seluruh
repo. Alasannya ditulis di header `sql/091` supaya usulan itu tidak lahir
kembali.

Retensi belum berlaku sampai `bun run data-lifecycle:archive-purge` dijadwalkan
— pelajaran yang sama sudah tercatat untuk `AUDIT_LOG_RETENTION_DAYS`.
