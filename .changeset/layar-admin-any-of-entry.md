---
"awcms": minor
---

feat(auth): `loadAdminScreen` mendapat entry ANY-OF, dan dua konsol pertama memakainya (#450, R3)

Delapan konsol admin sisa punya bentuk yang sama: beberapa panel yang bisa
dibaca secara independen, dan penolakan halaman hanya bila **semua** panel
ditolak (`canSeeAnything = canReadNodes || canReadConflicts || canReadQueue`).

Memaksa satu permission menjadi ENTRY untuk layar-layar itu akan menolak
operator yang sah memegang baca satu panel dan bukan panel lain — **penyempitan
akses nyata yang menyamar sebagai refactor**. Jadi helper-nya yang belajar
bentuk itu, bukan layarnya yang dibengkokkan.

`authorize` kini menerima array: diizinkan bila **setidaknya satu** diizinkan.
Array KOSONG menolak — "tidak ada request yang mengotorisasi halaman ini" tidak
boleh terbaca sebagai "request apa pun mengotorisasinya", penalaran fail-closed
yang sama dengan tenant platform yang tak terselesaikan di `access-guard.ts`.

Setiap request entry dievaluasi — daftarnya TIDAK di-short-circuit pada izin
pertama — dan hasilnya dikembalikan lewat `entry: readonly boolean[]` mengikuti
urutan deklarasi. Itu justru intinya: panel membaca jawabannya sendiri dari
sana alih-alih bertanya lagi lewat `can()`, yang akan menulis baris
`awcms_abac_decision_logs` KEDUA untuk keputusan identik dalam satu render —
derau di jejak audit, bukan bukti.

## Aturannya diuji sebagai fungsi murni

`selectEntryOutcome` diekstrak supaya setiap cabangnya bisa diuji tanpa
database, dan `tests/admin-screen-entry.test.ts` baru menguji delapan hal —
termasuk mutasi yang paling berbahaya: menulis aturannya sebagai "tidak SEMUA
request ditolak" meloloskan `[]`, karena `[].every(...)` bernilai **true**.
Sebuah layar yang kehilangan request entry-nya dalam sebuah suntingan akan
terbuka untuk setiap pengguna terautentikasi tenant itu, tanpa satu gerbang pun
merah.

Sampai PR ini helper-nya belum punya test perilaku sama sekali — hanya gerbang
struktural yang membuktikan layar meruteinya.

## Dua konsol pertama

`sync` (tiga panel, enam permission) dan `domain-events` (tiga panel, lima
permission). Ledger 9 → 7.

Dua contract test-nya mengekstrak klaim hanya dari `permissionKey(...)`;
ekstraktornya kini membaca kedua ejaan, sekelas dengan koreksi di batch 1, 4, 5
dan platform-scope.
