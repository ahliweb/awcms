---
"awcms": minor
---

feat(access): sebuah grant ber-scope hanya mencakup apa yang diberikan perannya

[ADR-0080](../docs/adr/0080-a-scoped-grant-covers-only-what-its-role-confers.md),
Gelombang 3 PR 3.4. Tanpa migrasi.

`BusinessScopeFact` mendapat `permissionKeys?`, dan predikat cakupan
`evaluateAccess` mendapat satu klausa. Sebuah baris `awcms_access_policies` yang
`scope_type`-nya bukan tenant-wide kini melahirkan fakta ber-scope yang membawa
persis permission key yang diberikan perannya; fakta dari
`awcms_business_scope_assignments` membawa `undefined` dan berperilaku persis
seperti sebelumnya.

**Seluruh argumen keamanannya bisa dibaca, bukan dipercaya.**
`scopeFactQualifies` tidak punya cabang yang menghasilkan cakupan — satu-satunya
nilai yang bisa disumbangkannya adalah `false`. Sisanya dibuktikan sebagai
properti atas korpus (6 bentuk fakta × 5 himpunan relasi × 2 aksi × 4 himpunan
kunci): jawaban ber-kualifikasi tak pernah `true` di mana jawaban
tanpa-kualifikasi `false`. Ditambah satu assertion bahwa korpusnya **tidak
hampa** — klausa yang tak melakukan apa-apa memuaskan properti pertama dengan
sempurna, dan itulah cara test semacam ini biasanya berbohong.

**Klausanya PERTAMA, sebelum `tenantWide`.** Fakta tenant-wide mencakup setiap
scope yang diminta; kalau klausanya sesudahnya, fakta tenant-wide yang membawa
kunci akan mencakup permission yang tidak diberikan perannya hanya karena ia
mencakup semua scope. Urutan, bukan penyaringan, yang membuatnya benar — jadi
di-assert.

**Grant tenant-wide tidak melahirkan fakta sama sekali.** Ini arah yang akan
menjadi pelebaran menyeluruh kalau salah: grant tenant-wide adalah *ketiadaan*
pengurungan scope, bukan pengurungan ke scope bernama `tenant`, dan melahirkan
fakta `tenantWide` darinya berarti memberikan jawaban gerbang #180 kepada setiap
orang yang memegang peran apa pun. Test integrasi pertamanya adalah itu.

**Kill switch build-time.** `SCOPE_NARROWING_ENABLED` bukan env var: dua instance
dari satu deployment bisa berbeda pendapat tentang env var — restart bergulir,
container basi, `--env-file` yang terlupa — dan aturan otorisasi yang jawabannya
bergantung pada socket mana yang menerima request bukanlah aturan. Membaliknya
berarti perubahan kode dan redeploy, dan itu memang maksudnya. Kedua keadaannya
diuji (flag-nya parameter), jadi keadaan mati bukan keadaan yang belum pernah
dijalankan.

**Batas yang WAJIB dibaca sebelum permukaan penulisnya dibangun.** Kualifikasi
scope hanya sekuat rute yang **menyatakan** required scope.
`fetchGrantedPermissionKeys` tetap mengembalikan kunci dari semua grant — ia
harus, karena gerbang RBAC berjalan lebih dulu dan kunci yang absen di sana
membuat jalur ber-scope tak pernah terjangkau — sehingga pada rute yang tak
menyatakan scope, sebuah grant ber-scope memberi permission itu di seluruh
tenant. Hari ini inert (nol penulis, dan itu di-assert terhadap basis data
sungguhan, bukan diargumentasikan), tetapi PR yang membangun permukaan admin
untuk menulisnya tidak boleh mendarat tanpa menjawabnya.

Satu test yang ADA memang berubah, dan alasannya layak disebut karena catatan
reviewer rencana berbunyi "setiap test business-scope yang ada harus lulus tanpa
diubah". Yang berubah bukan assertion-nya — `toHaveLength(1)` tetap
`toHaveLength(1)` — melainkan **stub `tx`-nya**, yang dulu menjawab setiap
statement dengan baris yang sama. Resolver kini mengeluarkan dua query, dan stub
yang tak bisa membedakan keduanya akan menjawab pembacaan grant dengan baris
assignment, melahirkan fakta yang tak diproduksi grant mana pun. Semantik domain
memang tidak berubah: `business-scope-access-control.test.ts` lulus apa adanya.
