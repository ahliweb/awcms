---
"awcms": minor
---

feat(access): sebuah grant membawa scope-nya sendiri — dan dengan tabelnya kosong, jawabannya identik dengan hari ini

Gelombang 3 PR 3.1 dari #423, [ADR-0078](../docs/adr/0078-a-grant-carries-its-own-scope.md).
`sql/102` menurunkan `awcms_access_policies` (+ riwayat append-only-nya), dan
`fetchGrantedPermissionKeys` membaca **kedua** bentuk grant lewat `UNION ALL`.

Hari ini sebuah grant adalah `awcms_access_assignments (tenant_user_id, role_id)`
dan menjawab satu pertanyaan: apakah orang ini memegang peran itu **di mana pun**
dalam tenant. Sebuah Policy menjawab yang lebih sempit — peran ini **pada scope
ini** — yaitu bentuk yang membuat "editor satu kantor" bisa dinyatakan tanpa
menciptakan sumbu otorisasi kedua.

**Dengan tabel barunya kosong, hasilnya identik dengan sebelumnya.** Itu seluruh
argumen keamanan PR ini, dan ia tentang `UNION ALL` di dalam sebuah string SQL —
membacanya tidak membuktikan apa pun. Satu `JOIN` yang pindah ke subquery, satu
predikat `tenant_id` yang hilang di satu sisi, satu `DISTINCT` yang berhenti
mencakup satu kolom: semuanya terbaca baik-baik saja dan semuanya mengubah
jawaban. Jadi oracle-nya menjalankan query sungguhan terhadap baris sungguhan,
berdampingan dengan **transkripsi tangan** query pra-migrasi. Oracle yang berbagi
sumber dengan benda yang ia adili tidak mengadili apa pun.

Oracle itu punya **dua** paruh, dan keduanya perlu: ekuivalensi (tabel kosong →
jawaban sama) **dan** efek (baris policy benar-benar memberi grant, dan kolom
siklus hidupnya benar-benar menyaring). Tanpa paruh kedua, cabang `UNION ALL`
yang diam-diam tidak mencocoki apa pun akan lulus paruh pertama dengan sempurna.

**Tabel BARU, bukan kolom tambahan**, tiga alasan dan yang pertama menyelesaikan:
`UNIQUE (tenant_id, tenant_user_id, role_id)` justru yang harus **mati** (satu
peran di tiga scope = tiga baris), dan mencabut indeks unik dari tabel otorisasi
yang hidup **di migrasi yang sama** dengan yang melebarkan makna tabelnya adalah
perubahan dengan mode kegagalan terburuk yang tersedia: kalau salah, ia salah ke
arah **membolehkan**, tanpa satu pun gerbang memerah. Dua alasan lainnya di ADR.

**Dua tempat rencana program tidak diikuti, keduanya ke arah "jangan kirim yang
belum bisa dipakai":**

1. `subject_type` hanya menerima `'tenant_user'`. Rencana menulis
   `('tenant_user', 'user_group')` plus XOR dua kolom subjek, tetapi grup
   pengguna belum ada — CHECK yang memuat nilai yang tak bisa diproduksi apa pun
   terbaca sebagai kapabilitas yang sudah ada, dan `user_group_id` tanpa tabel
   tujuan adalah FK yang tak bisa ditulis. Disiplin yang sama dipakai `sql/100`
   untuk `origin_auth`. Kolom **diskriminatornya** ada sejak sekarang justru
   supaya penambahan nilai nanti bukan backfill.
2. Tipe kembalian `fetchGrantedPermissionKeys` **belum** menjadi
   `{ keys, scopes }`. Field yang tak dibaca apa pun adalah bau
   kapabilitas-tak-terpakai yang persis dihapus ADR-0077, dan ia akan mengaduk
   **sebelas** call site di PR yang paling tak mampu menanggung diff tak
   berkaitan. Tipenya berubah di PR yang mengonsumsinya (3.4).

**Namanya tidak boleh berubah**, dan ada test yang menjaganya:
`access-chokepoint-check.ts` mengunci sinyal "handler ini memutuskan permission"
pada literal `fetchGrantedPermissionKeys(`, sehingga rename meninggalkan gerbang
itu **hijau sambil melaporkan nol handler yang memutuskan**.

Penanggalan efektif dievaluasi **di basis data**: grant yang kedaluwarsa menurut
gagasan aplikasi tentang waktu adalah grant yang bisa diperpanjang oleh bug
aplikasi.

`awcms_access_policies` masuk `GRANT_TABLES` gerbang `access:grant-readers:check`
**di PR yang sama dengan yang menciptakannya**, jadi tak pernah ada berkas yang
merakit join atasnya tanpa tercatat.
