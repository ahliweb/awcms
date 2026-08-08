---
"awcms": patch
---

fix(gerbang): `api:tenant-route:check` berhenti buta terhadap 32 layar admin

Ke-32 layar `src/pages/admin/**/*.astro` membuka `withTenantOrThrow` sendiri dan
memutuskan akses dengan `ssr.permissions.has()` saja — PROJECT_STATE §4 **R3**.
Mereka tak terlihat oleh `access:chokepoint:check` (root-nya `src/pages/api/v1`)
**dan** tak terlihat di sini, karena root gerbang ini berhenti di `src/pages/api`.

Gerbang ini sudah mencocokkan `withTenantOrThrow(` sejak awal. Ia hanya tidak
pernah diarahkan ke direktori tempat ke-32 layar itu tinggal.

`ROUTES_ROOT` tunggal menjadi `SCAN_ROOTS`, tiap root membawa ekstensinya sendiri
(`.ts` untuk API, `.astro` untuk admin) dan kalimat perbaikannya sendiri — karena
jawabannya berbeda: rute API harus memakai `defineTenantRoute`, sedangkan layar
admin **belum punya** factory untuk dipakai. Ke-32 layar masuk `NOT_YET_MIGRATED`
(236 entri, dari 204).

**Ratchet, bukan migrasi.** `defineAdminScreen` belum ada — ia Gelombang 1 dari
\#423. Nilainya adalah sejak commit ini sebuah layar admin BARU tidak bisa lagi
menambah utang R3, berbulan-bulan sebelum utangnya sendiri dilunasi.

Penjaga nol-berkas kini **per-root**. Total gabungan akan membiarkan satu root
sehat menutupi root kedua yang memindai nol berkas — persis "OK yang ceria dan
tak bermakna" yang diperingatkan header berkas ini, satu direktori kemudian.
Diverifikasi dengan mutasi: mengarahkan root admin ke direktori yang tidak ada
**merah**, dan mempertahankan root sambil mengganti ekstensinya juga **merah**.

Angka di issue #424 tertulis 31; yang benar **32**. Glob `src/pages/admin/*.astro`
melewatkan `src/pages/admin/tenant/domains.astro`, satu-satunya layar di
subdirektori. `find -name "*.astro"` menemukannya, dan 32 cocok dengan hitungan
R3 yang sudah tercatat.

Nol perubahan runtime. Nol migrasi. Nol permission.
