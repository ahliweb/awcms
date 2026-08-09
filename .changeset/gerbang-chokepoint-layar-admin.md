---
"awcms": patch
---

`access:chokepoint:check` mendapat root kedua — layar admin — plus
`loadAdminScreen` dan ledger migrasi satu-arah (#450, PROJECT_STATE §4 R3).

Ke-32 layar `src/pages/admin/**/*.astro` memutuskan apa yang dirender dari
`ssr.permissions.has(...)`, yaitu `fetchGrantedPermissionKeys` — **RBAC mentah**.
Jalur itu melewati `authorizeInTransaction`, jadi ia melewati semua yang hanya
ada di sana: policy `deny` ABAC yang ditulis tenant (ditegakkan di API, **inert
di layar**), `resolveModuleAvailability` (tenant yang mematikan modulnya tetap
melihat layarnya berisi data), fakta business-scope, SoD action-time, dan
`recordDecisionLog` — sehingga sebuah pembacaan yang terjadi tidak meninggalkan
satu baris pun yang mengatakannya. Yang **tidak** hilang, supaya temuannya tidak
dibesar-besarkan: RBAC dasar tetap ditegakkan dan tidak pernah ada kebocoran
lintas-tenant — `withTenantOrThrow` + FORCE RLS selalu ada di jalur itu.

`loadAdminScreen` membuka SATU transaksi, memanggil chokepoint, lalu menjalankan
`load` **di dalam transaksi yang sama**. Deny me-render state ditolak, bukan
redirect. Refusal pool/circuit-breaker adalah state KETIGA — sebuah penolakan
yang dirender sebagai "Anda tidak boleh melihat ini" adalah kebohongan ke arah
yang diselidiki sebagai bug perizinan.

Gerbangnya tetap SATU skrip: dua skrip berarti dua daftar pengecualian yang
menyimpang, dan yang kedua selalu jadi yang longgar. Kedua root hanya berbeda di
dua tempat — cara berkas diiris (`.astro` per-BERKAS: satu berkas = satu jalur
render) dan apa yang dihitung sebagai memutuskan (`.permissions.has(`).

`form-drafts.astro` ikut dimigrasikan supaya mekanismenya **dibuktikan**, bukan
sekadar disediakan; ledger mendarat berisi 31, bukan 32.

Dua koreksi yang muncul saat membangunnya: `stripComments` ditambahkan setelah
sinyalnya cocok dengan komentar layar yang baru dimigrasikan yang menjelaskan
bahwa ia TIDAK lagi memakai `ssr.permissions.has()`; dan `extractScreenClaims`
menemukan bahwa `visitor_analytics.raw_detail.read` sudah lama diklaim layar
`analytics.astro` lewat evaluator ABAC — satu baris `NOT_YET_SCREENED` yang basi
sejak sebelum PR ini.
