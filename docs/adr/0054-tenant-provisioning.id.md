🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0054-tenant-provisioning.md)

<!-- i18n-source-hash: sha256:d7e066b2d1892c5b2089894bb625ae4f5fc8fdcd73e735548b5e46c1271404ce -->

# ADR-0054 — Provisioning tenant: satu jalur pembuatan, ber-gerbang platform

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Pengambil keputusan:** @ahliweb
- **Membangun di atas:** [ADR-0053](0053-platform-scoped-permissions.md) (permission ber-scope platform) — provisioning adalah konsumen kedua primitif itu, dan yang pertama membuat mode `multi` benar-benar bisa dicapai
- **Terkait:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) §Keputusan butir 3 (gerbang navigasi), [ADR-0046](0046-idn-admin-regions-module-admission.md)

## Konteks

Sampai ADR ini, **tenant kedua tidak bisa dibuat sama sekali.**

`POST /api/v1/setup/initialize` meng-klaim singleton `awcms_setup_state`, jadi ia sukses **tepat sekali**. Tidak ada jalur lain yang menyentuh `awcms_tenants`. Konsekuensinya lebih dalam dari "fitur belum ada":

- Setiap deployment permanen single-tenant, dan cabang `multi` pada `resolveTenancyMode` (ADR-0053) **tak terjangkau**.
- Gerbang platform ADR-0053 **belum pernah bertemu tenant kedua yang nyata** — ia benar secara konstruksi, tetapi kondisi yang ia jaga belum pernah ada.
- Klaim "siap SaaS" pada [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) berdiri di atas kemampuan yang belum ditulis.

## Keputusan

### 1. Satu jalur pembuatan tenant, dipakai bersama

`createTenantWithOwner` diekstrak dari `bootstrapPlatformTenant` dan dipakai **keduanya**. Ini bukan kerapian — ini kontrol keamanan.

Satu-satunya hal yang tidak boleh berbeda antara wizard setup dan provisioning adalah `WHERE scope = 'tenant'` pada grant owner. Rutin provisioning yang ditulis mandiri — cara paling wajar membangunnya — akan membawa **salinan** `INSERT` yang, sepanjang hampir seluruh umur repo ini, **tidak punya filter itu**. Hasilnya: setiap pelanggan memegang wewenang atas data yang dilayani ke pelanggan lain, dan diff-nya lolos review.

`grantPlatformScope` adalah **parameter**, bukan cabang atas "apakah ini tenant pertama?", supaya jawabannya **dinyatakan di call site** alih-alih disimpulkan.

### 2. Direktori dan provisioning sama-sama `scope: "platform"`

`create` jelas: menambah tenant menambah **pihak** ke deployment.

`read` juga — dan ini yang mudah terlewat. Endpoint direktori mendaftar **SETIAP** tenant. Versi tenant-scoped-nya berarti owner pelanggan mana pun bisa meng-enumerasi daftar pelanggan platform, dan **tidak ada policy RLS yang akan keberatan**, karena `awcms_tenants` memang tabel akar tanpa RLS.

Karena keduanya `platform`, `createTenantWithOwner` tidak akan pernah memberikannya ke tenant yang di-provision — **termasuk yang dibuat lewat endpoint ini sendiri**. Platform tidak bisa tanpa sengaja melahirkan pesaing wewenangnya.

### 3. Duplikat `tenant_code`: pre-check DAN savepoint

Keduanya perlu, dan alasannya bukan kehati-hatian berlebih. Di PostgreSQL `23505` **membatalkan transaksi**: menangkap error lalu melanjutkan tidak bekerja, dan commit yang `withTenant` lakukan pada 4xx yang di-`return` ikut gagal.

Jadi: `SELECT` menjawab kasus biasa tanpa pernah memancing error, dan `SAVEPOINT` membuat kasus **balapan** bisa dipulihkan — dua pemanggil dengan kode sama sama-sama lolos `SELECT`, satu kena unique index, dan `ROLLBACK TO SAVEPOINT` mengembalikan transaksi ke keadaan terpakai alih-alih mengubah kesalahan pengguna menjadi 500.

### 4. Konteks tenant dikembalikan sebelum audit ditulis

`createTenantWithOwner` menyetel `app.current_tenant_id` ke tenant yang **sedang dibuat** (tabelnya FORCE RLS), lalu mengembalikannya. Tanpa itu, baris audit dan catatan idempotency milik route akan mendarat di partisi tenant yang baru lahir — terlihat oleh pihak yang salah, tak terlihat oleh operator yang bertindak.

### 5. Password owner tidak pernah masuk hash idempotency

`computeRequestHash` keluarannya **disimpan**. Meng-hash password berarti menaruh kredensial at-rest di tabel yang tak seorang pun anggap penyimpanan kredensial. Hash-nya dibangun dari `tenantCode`/`tenantName`/`officeCode`/`ownerLoginIdentifier` saja — sudah cukup mengidentifikasi permintaan.

## Konsekuensi

- **Positif:**
  - Mode `multi` menjadi keadaan nyata, bukan konstanta. Gerbang ADR-0053 kini punya kondisi yang benar-benar bisa terjadi.
  - Prasyarat SaaS berikutnya berdiri di fondasi yang benar: jalur provisioning **mewarisi** filter `scope` alih-alih mengulang cacatnya.
  - Wizard setup dan provisioning tidak bisa lagi menyimpang dalam hal yang paling berbahaya.
- **Negatif / trade-off yang diterima:**
  - Belum ada lifecycle tenant lain — suspend, rename, hapus. Provisioning saja. Menambahkannya tanpa memutuskan apa arti "hapus tenant" bagi data yang tersimpan akan menjadi tombol yang tak seorang pun bisa jelaskan akibatnya.
  - Belum ada kuota/paket/penagihan. Ini bukan control plane SaaS; ini kemampuan yang harus ada **sebelum** control plane bisa dibangun.
  - Audit operator lintas-tenant masih menjadi follow-up terbuka ADR-0052: baris audit provisioning mendarat di log tenant platform, yang benar, tetapi tenant yang dibuat tidak melihat catatan kelahirannya sendiri.
- **Netral:**
  - Nol perubahan untuk deployment yang tidak pernah mem-provision tenant kedua.

## Alternatif yang dipertimbangkan

- **Job operator (CLI) alih-alih endpoint** — ditolak. Preseden `idn-regions:activate` berlaku ketika **tidak ada subjek untuk dievaluasi**; di sini ada: tenant platform. Provisioning juga adalah pekerjaan yang wajar dilakukan lewat layar, berulang, oleh orang yang bukan operator shell.
- **Melonggarkan singleton `awcms_setup_state`** — ditolak. Wizard setup itu bootstrap tanpa autentikasi; membuatnya bisa dipanggil berulang berarti membuka pembuatan tenant tanpa autentikasi. Singleton-nya justru penjagaannya.
- **Menyalin logika pembuatan ke modul provisioning** — ditolak; lihat §Keputusan butir 1. Itu persis bentuk regresinya.
