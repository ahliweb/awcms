---
"awcms": minor
---

feat(auth): `approvals` dan `reporting` memakai entry any-of (#450, R3)

Ledger 7 → 5.

`approvals` (dua panel, delapan permission) dan `reporting` (tiga panel, tujuh
permission) — keduanya bentuk any-of yang sama: panel yang bisa dibaca
independen, penolakan halaman hanya bila semua panel ditolak.

`approvals` layak disebut: ia inbox persetujuan, jadi keputusan tentang siapa
boleh MELIHAT tugas yang menunggu keputusannya kini ikut tercatat di
`awcms_abac_decision_logs`, dan `deny` ABAC tenant berlaku pada pembacaannya —
bukan hanya pada tombol Approve. Enam afordans tulisnya, termasuk tiga jalur
`recovery` (`reassign`, `cancel`, `force_decide`), diputuskan lewat `can(...)`
pada transaksi yang sama.

`reporting` menyimpan satu detail yang mudah rusak saat dipindahkan: peta
`reconciliationsByKey` diisi dengan satu query per proyeksi, berurutan di dalam
transaksi yang sama. Ia tetap begitu — `tx` satu koneksi ter-reserve, jadi
sebuah `Promise.all` di sana akan membocorkannya.

Dua contract test-nya mengekstrak klaim hanya dari `permissionKey(...)`;
ekstraktornya kini membaca kedua ejaan.
