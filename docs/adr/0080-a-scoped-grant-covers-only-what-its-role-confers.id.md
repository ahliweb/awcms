🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0080-a-scoped-grant-covers-only-what-its-role-confers.md)

<!-- i18n-source-hash: sha256:bbb07a4e24800b73a34e54c94b64a9a6dc3d4a4ccf32830fb010a85e37fba7d0 -->

# ADR-0080 — Sebuah grant ber-scope hanya mencakup apa yang diberikan perannya

- **Status:** Diterima (2026-08-10).
- **Konteks:** Issue #423 Gelombang 3 PR 3.4. Tanpa migrasi.
- **Membangun di atas:** [ADR-0078](0078-a-grant-carries-its-own-scope.md) (grant
  membawa scope-nya) dan [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md)
  (satu sumber grant). Melebarkan lapisan business-scope
  [ADR-0060](0060-business-scope-hierarchy-provided-by-tenant-admin.md) tanpa
  mengubah kontrak #180.

## Keputusan

`BusinessScopeFact` mendapat satu field opsional, `permissionKeys`, dan predikat
cakupan `evaluateAccess` mendapat satu klausa:

```ts
if (!scopeFactQualifies(fact, requiredKey)) return false;
```

Sebuah baris `awcms_access_policies` yang `scope_type`-nya BUKAN tenant-wide kini
melahirkan sebuah fakta ber-scope, membawa persis permission key yang diberikan
perannya. Fakta yang berasal dari `awcms_business_scope_assignments` membawa
`permissionKeys: undefined` dan berperilaku persis seperti sebelumnya.

## Seluruh argumen keamanannya muat di empat baris

`scopeFactQualifies` tidak punya cabang yang menghasilkan cakupan. Satu-satunya
nilai yang bisa disumbangkannya adalah `false`. Karena itu **tidak ada input,
dalam urutan apa pun, yang bisa mengubah deny menjadi allow lewat field ini** —
dan itu bisa diperiksa dengan membaca, bukan dengan mempercayai.

Sisanya dibuktikan sebagai properti, bukan contoh: `tests/scope-narrowing.test.ts`
menjalankan korpus (6 bentuk fakta × 5 himpunan relasi × 2 aksi × 4 himpunan
kunci) dan meng-assert bahwa jawaban ber-kualifikasi tak pernah `true` di mana
jawaban tanpa-kualifikasi `false` — plus satu assertion bahwa korpusnya **tidak
hampa**, karena klausa yang tak melakukan apa-apa memuaskan properti pertama
dengan sempurna.

## Klausanya PERTAMA, sebelum `tenantWide`

Sebuah fakta tenant-wide mencakup setiap scope yang diminta. Kalau klausanya
diletakkan sesudahnya, fakta tenant-wide yang membawa kunci akan mencakup
permission yang tidak diberikan perannya — hanya karena ia mencakup semua scope.
Urutan, bukan penyaringan, yang membuat itu benar, jadi ia di-assert dan tidak
diserahkan ke pembaca.

## Grant tenant-wide TIDAK melahirkan fakta

Ini arah yang akan menjadi pelebaran menyeluruh kalau salah. Grant tenant-wide
adalah **ketiadaan** pengurungan scope, bukan pengurungan ke scope bernama
"tenant". Melahirkan fakta `tenantWide` darinya berarti memberikan jawaban
gerbang #180 kepada setiap orang yang memegang peran apa pun.

Yang dilakukan grant tenant-wide terhadap pemeriksaan required-scope tetap sama
dengan hari ini: tidak ada. `tests/integration/scope-qualification` meng-assert
itu sebagai test pertamanya.

## Kill switch build-time, bukan env var

Dua instance dari satu deployment yang membaca env var yang sama tetap bisa
berbeda pendapat — restart bergulir, container basi, `--env-file` yang terlupa —
dan aturan otorisasi yang menyala di satu pod dan mati di pod lain adalah aturan
yang jawabannya bergantung pada socket mana yang menerima request. Cache policy
sudah per-proses justru karena alasan ini.

`SCOPE_NARROWING_ENABLED` karenanya adalah konstanta build-time. Membaliknya
berarti perubahan kode dan redeploy — itulah maksudnya: ia bukan tombol
operasional, ia rollback yang meninggalkan commit.

Kedua keadaannya DIUJI (`scopeFactQualifies` menerima flag-nya sebagai
parameter), sehingga keadaan yang mati bukan keadaan yang belum pernah dijalankan.

## Batas yang HARUS dibaca sebelum permukaan penulisnya dibangun

Kualifikasi scope hanya sekuat rute yang **menyatakan** required scope.

`fetchGrantedPermissionKeys` mengembalikan kunci dari SEMUA grant, termasuk yang
ber-scope, dan memang harus begitu: gerbang RBAC berjalan lebih dulu, jadi kunci
yang tidak ada di sana membuat jalur ber-scope tak pernah terjangkau. Akibatnya,
pada rute yang tidak menyatakan scope, sebuah grant ber-scope memberi permission
itu di seluruh tenant.

Hari ini itu inert — tak ada yang menulis grant ber-scope. Tetapi PR yang
membangun permukaan admin untuk menulisnya **tidak boleh mendarat tanpa
menjawab** pertanyaan itu, karena seorang admin yang membuat "editor satu
kantor" akan mengira ia sudah mengurung orangnya, dan pada setiap rute yang tak
menyatakan scope ia belum. Itulah sebabnya rencana program menempatkan resolver
SEBELUM penulisnya, dan sebabnya urutan itu dipertahankan di sini.

## Yang DITOLAK

1. **Mengubah tipe kembalian `fetchGrantedPermissionKeys` menjadi
   `{ keys, scopes }`** seperti rencana program. Peta itu akan menduplikasi apa
   yang sudah dijawab `resolveBusinessScopeFacts` dari sumber yang sama, dan dua
   turunan satu nilai adalah cara keduanya mulai berbeda pendapat (persis
   pelajaran ADR-0079). Ia juga akan mengaduk sebelas call site untuk field yang
   hanya dibaca satu.
2. **Menyaring grant ber-scope keluar dari `fetchGrantedPermissionKeys`** supaya
   ia "hanya berlaku di scope-nya". Gerbang RBAC berjalan lebih dulu, jadi ini
   membuat jalur ber-scope mustahil dijangkau — grant ber-scope akan menolak
   segalanya, termasuk di scope-nya sendiri.
3. **Membiarkan fakta ber-scope dan fakta assignment saling menimpa** pada scope
   yang sama. Keduanya dilahirkan; `evaluateAccess` memakai `.some()`, jadi
   jawaban yang lebih luas menang — dan jawaban yang lebih luas itu **jawaban
   hari ini**, sehingga menambahkan grant tidak mengambil apa pun dari siapa pun.
4. **Env var untuk kill switch** — lihat di atas.
5. **Menunda klausanya sampai ada penulis grant ber-scope.** Mekanisme yang
   mendarat bersama produsen pertamanya adalah mekanisme yang tak pernah
   dijalankan sendirian; memisahkannya membuat "inert hari ini" menjadi sesuatu
   yang bisa DI-ASSERT terhadap basis data, bukan sesuatu yang diargumentasikan.

## Konsekuensi

- Satu query tambahan di `resolveBusinessScopeFacts`, dan hanya pada rute yang
  menyatakan required scope (guard baru memanggil resolver ketika sebuah rute
  ikut serta). Nol query saat kill switch mati — flag dibaca sebelum query.
- Jumlah query tetap terbatas: satu, apa pun banyaknya scope atau permission
  yang dipegang subjek.
- `activeRoleGrants` kini memproyeksikan `scope_type`/`scope_id`. Pembaca lain
  mengabaikannya, dan itu justru alasan kolomnya ada di sana dan bukan di
  fragmen kedua yang nyaris identik yang bisa berbeda pendapat soal arti "sedang
  berlaku".
