---
"awcms": minor
---

`bun run identity-access:permissions:backfill` — tutup celah yang dibuka SETIAP
migrasi seed permission, tanpa menghidupkan kembali grant yang sengaja dicabut.

Role `owner` sebuah tenant menerima izinnya **sekali**, saat tenant itu dibuat
(`platform-bootstrap.ts`: `INSERT … SELECT id FROM awcms_permissions`). Migrasi
seed berikutnya hanya memperluas katalog global. Jadi setiap tenant yang lebih
tua dari sebuah modul akan menerima `403 ACCESS_DENIED` pada permukaan admin
modul itu, dan tidak ada satu pun yang mengatakannya. Ini sudah terjadi di
produksi (2026-07-26: owner kehilangan 18 permission setelah migrasi 062–070) dan
akan terjadi lagi pada `sql/083`.

**Kenapa "grant semua yang hilang" ditolak.** Bentuk itulah yang dianjurkan
`environments.md` sebelumnya (`LEFT JOIN … WHERE rp.permission_id IS NULL`), dan
ia tidak bisa membedakan "belum pernah ada saat tenant dibuat" dari "dicabut
admin dengan sengaja" — surface role admin memang menyediakan penghapusan itu.
Ia akan mengembalikan persis grant yang seseorang putuskan untuk dihapus, di
seluruh tenant sekaligus, tanpa jejak. Arah kegagalannya juga yang paling buruk:
melewatkan sebuah permission terlihat sebagai 403 yang bisa dilaporkan; memberi
permission yang tak seharusnya tidak terlihat sama sekali.

**Aturannya**: hanya permission yang **baris katalognya lebih baru** dari role
owner yang di-grant. Yang lebih tua tidak mungkin merupakan tambahan yang
terlewat — ia ada saat seed pertama, jadi ketidakhadirannya adalah keputusan.
Perbandingannya `>` bukan `>=`: bootstrap menulis role dan grant-nya dalam satu
transaksi, sehingga permission ber-stempel sama dengan role-nya JUSTRU bagian
dari seed asli.

Dry-run **default** (`--commit` untuk menulis, `--tenant <kode>` untuk rollout
bertahap), idempoten (`ON CONFLICT DO NOTHING`), satu entri audit per tenant yang
benar-benar berubah — dan tidak ada entri saat tak ada perubahan, karena log
pemeliharaan yang berbunyi di setiap no-op melatih pembacanya untuk
mengabaikannya. Role kustom tidak pernah disentuh.

Diverifikasi terhadap PostgreSQL nyata (6 test integrasi) termasuk hal yang
paling penting: 403 yang jadi alasan tool ini ada benar-benar hilang setelah
backfill, sementara permission yang sengaja dicabut **tetap** ditolak sesudahnya.
Aturannya mutation-proven: mengganti seleksinya jadi "semua yang hilang"
memerahkan 3 test unit dan 4 test integrasi.
