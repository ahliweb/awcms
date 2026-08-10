# ADR-0078 — Sebuah grant membawa scope-nya sendiri

- **Status:** Diterima (2026-08-10). Tabelnya sudah ada dan sudah dibaca jalur
  otorisasi; penulis produksinya mendarat di PR berikutnya (Gelombang 3 PR 3.2).
- **Konteks:** Issue #423 Gelombang 3 PR 3.1.
- **Menggantikan/menyempurnakan:** tidak ada. Melebarkan bentuk grant yang
  digerbangi [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md)
  dan berdampingan dengan lapisan business-scope
  [ADR-0060](0060-business-scope-hierarchy-provided-by-tenant-admin.md).

## Keputusan

Sebuah grant peran boleh membawa **scope**-nya sendiri. Tabel baru
`awcms_access_policies` (`sql/102`) menyimpan `subject → role → (scope_type,
scope_id)` berikut penanggalan efektif, status, dan pencabutan.
`fetchGrantedPermissionKeys` membaca **kedua** bentuk grant lewat `UNION ALL`.

Dengan tabel barunya kosong, hasil fungsi itu **identik** dengan sebelumnya.
Itulah properti yang menyangga seluruh PR ini.

## Kenapa tabel BARU, bukan kolom pada `awcms_access_assignments`

Tiga alasan, dan yang pertama yang menyelesaikannya.

**1. Indeks unik lamalah yang justru harus mati.**
`awcms_access_assignments_key UNIQUE (tenant_id, tenant_user_id, role_id)`
menyatakan "satu orang memegang satu peran paling banyak sekali". Satu peran di
tiga scope adalah **tiga baris**, jadi indeks itu harus dicabut. Mencabut indeks
unik dari tabel otorisasi yang hidup, di migrasi yang sama dengan yang melebarkan
makna tabelnya, adalah perubahan dengan mode kegagalan terburuk yang tersedia di
sini: kalau salah, ia salah dalam arah **membolehkan**, dan tak ada yang
memerah.

**2. Memperluas `awcms_business_scope_assignments` di tempat menulis ulang dua
pembaca SoD di PR yang sama.** `business-scope-facts.ts` membaca tabel itu dua
kali untuk fakta SoD. Menggabungkan perubahan bentuk-scope dengan perubahan
presisi-SoD berarti tak satu pun dari keduanya bisa dibalik sendirian.

**3. Tabel ketiga memungkinkan expand/migrate/contract TANPA dual-write.** Tabel
ini mendarat kosong, readernya membaca keduanya, dan PR 3.3 memindahkan baris
satu per satu. Tak pernah ada jendela di mana satu tulis harus mengenai dua
tabel dan bisa gagal separuh.

## Kenapa `subject_type` hanya menerima satu nilai

Rencana program menulis `CHECK (subject_type IN ('tenant_user', 'user_group'))`
plus XOR dua kolom subjek. Grup pengguna **belum ada** (Gelombang 3 PR 3.5), jadi:

- CHECK yang memuat `'user_group'` menyatakan kapabilitas yang tak bisa
  diproduksi apa pun, dan
- kolom `user_group_id` tanpa tabel tujuan adalah FK yang tak bisa ditulis.

Disiplin yang sama dipakai `sql/100` untuk `origin_auth`: nilai keempat berjarak
satu `DROP CONSTRAINT` / `ADD CONSTRAINT` dari migrasi yang membuatnya bisa
diproduksi. Kolom **diskriminatornya** ada sejak sekarang justru supaya
penambahan nilai nanti bukan backfill.

## Kenapa tipe kembalian `fetchGrantedPermissionKeys` BELUM berubah

Rencana menjadikannya `{ keys, scopes }`, karena evaluasi ber-scope (PR 3.4)
butuh peta itu. Ia tetap `Set<string>` di sini.

Mengirimkan field `scopes` yang tak dibaca apa pun adalah bau
kapabilitas-tak-terpakai yang persis dihapus [ADR-0077](0077-one-outbox-sync-pull-reads-domain-events.md)
dari `awcms_sync_outbox` — dan ia akan mengaduk **sebelas** call site di PR yang
paling tak mampu menanggung diff tak berkaitan. Tipenya berubah di PR yang
mengonsumsinya.

**Namanya tidak boleh berubah.** `scripts/access-chokepoint-check.ts` mengunci
sinyal "handler ini memutuskan permission" pada literal
`fetchGrantedPermissionKeys(`; sebuah rename meninggalkan gerbang itu **hijau
sambil melaporkan nol handler yang memutuskan**. Itulah sebabnya gerbang yang
sama juga meng-assert hitungannya bukan nol.

## Apa yang disaring tiap cabang, dan kenapa keduanya berbeda

Keduanya membuang peran yang di-soft-delete. Hanya cabang policy yang menyaring
`status` dan penanggalan efektif: baris assignment tak punya siklus hidup untuk
disaring — ia ada atau tidak — sedangkan sebuah policy bisa dijadwalkan,
kedaluwarsa, atau dicabut.

`effective_to > now()` dievaluasi **di basis data**, bukan terhadap jam yang
dikirim pemanggil: grant yang kedaluwarsa menurut gagasan aplikasi tentang waktu
adalah grant yang bisa diperpanjang oleh bug aplikasi. (Perhatikan `now()` di
Postgres adalah instan **mulai transaksi**, yang justru yang diinginkan di sini —
satu keputusan otorisasi tidak boleh melihat dua waktu berbeda.)

## Isolasi lintas-tenant

Setiap rujukan subjek/peran/aktor adalah FK **komposit** `(tenant_id, <col>)`,
karena PostgreSQL menjalankan pemeriksaan integritas referensial sebagai
**pemilik tabel** dan **melewati** row-level security saat melakukannya — jadi
`REFERENCES awcms_tenant_users (id)` polos tetap bisa menunjuk baris tenant lain
bahkan di bawah FORCE ROW LEVEL SECURITY. Pola dan alasannya tercatat penuh di
header `sql/027`.

## Konsekuensi

- `awcms_access_policies` masuk `GRANT_TABLES` gerbang
  `access:grant-readers:check` **di PR yang sama dengan yang menciptakannya**,
  jadi tak pernah ada berkas yang merakit join atasnya tanpa tercatat.
- Sampai PR 3.2, satu-satunya penulis tabel ini adalah test integrasi. Itu
  **bukan** keadaan yang boleh dibiarkan menetap: tabel tanpa penulis adalah
  cacat yang ADR-0077 hapus, dan `docs/PROJECT_STATE.md` §4 mencatat 3.1 dan 3.2
  sebagai satu unit komitmen justru karena itu.
- `scope_type = 'tenant'` adalah satu-satunya bentuk yang ditulis sampai PR 3.4
  mengualifikasi scope saat evaluasi. Sebelum itu, sebuah Policy dan sebuah
  assignment memberi jawaban yang sama persis — yang membuat PR 3.3 bisa
  memindahkan baris tanpa mengubah satu pun keputusan.
