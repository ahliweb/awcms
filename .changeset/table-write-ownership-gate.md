---
"awcms": minor
---

Tegakkan ADR-0013 §6 ("no shared-table write") sebagai gate, dan hentikan satu
pelanggaran nyata yang sudah menyimpang.

`_shared/module-contract.ts` menyebut aturan itu **empat kali** — di dokumentasi
`dataLifecycle`, `searchSources`, `commentableResources`, dan
`reportingProjections` — sebagai alasan tiap seam mengoper metadata deklaratif ke
engine pusat alih-alih menjangkau skema modul lain. Keempat seam itu menaatinya.
SQL tulis-tangan di luar seam tak pernah diperiksa siapa pun, dan **enam tabel
ditulis lebih dari satu modul**.

Biayanya sudah terlihat dalam bentuk terkecil: `identity_access` punya DUA
`INSERT INTO awcms_profiles` independen (JIT provisioning #185 dan approval
self-registration #276) yang sudah menyimpang pada `verification_status` — dua
akun yang dibuat berselang menit mendapat postur verifikasi berbeda tanpa ada
yang pernah memutuskannya. Keduanya kini lewat
`profile_identity`'s `createPersonProfileForIdentity`, dengan argumen
`emailVerified` yang eksplisit.

`bun run modules:table-writes:check` (baru, di rantai `check`) menegakkan
"paling banyak satu penulis per tabel". Kepemilikan **diturunkan, bukan
dideklarasikan**: aturannya adalah properti kode apa adanya, jadi tabel baru
ikut tercakup tanpa perlu didaftarkan — gate tak bisa basi ke arah berbahaya.
Rute `src/pages` diatribusikan lewat `api.routes`, jadi `INSERT` di rute milik
sebuah modul bukan penulis kedua. Tulis dinamis (`${tableName}` milik engine
`data_lifecycle`/`reporting`) sengaja di luar cakupan dan dinyatakan di header —
itu justru mekanisme yang diresepkan §6.

Satu pengecualian ber-alasan: `tenant_admin/application/platform-bootstrap.ts`,
wizard sekali-jalan yang membuat tenant/office/profil/identity/tenant-user/role
dalam satu transaksi sebelum modul mana pun bisa dipanggil lewat permukaan
normalnya. Bentuk pengecualiannya `excusedOwner` (memaafkan SATU penulis
tambahan), bukan daftar owner yang boleh — versi pertama memakai daftar owner
dan diam-diam mengizinkan kembali tulis `identity_access` yang baru saja
dihapus; test pertama gate ini yang menangkapnya.
