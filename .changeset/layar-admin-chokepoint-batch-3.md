---
"awcms": minor
---

feat(auth): lima layar admin berikutnya melewati chokepoint (#450, R3)

Gelombang 1 batch 3. `users`, `roles`, `offices`, `sidebar-menu`, dan
`tenant/domains` berpindah dari `ssr.permissions.has(...)` ke `loadAdminScreen`:
`authorizeInTransaction` dan pembacaan datanya kini di dalam SATU transaksi.

`users.astro` dan `roles.astro` adalah pasangan yang paling berarti di batch
ini: keduanya **mendaftarkan siapa memegang apa**. Sampai sekarang membaca
roster akses sebuah tenant tidak melewati evaluasi ABAC dan tidak meninggalkan
satu baris pun di `awcms_abac_decision_logs` — sebuah `deny` yang ditulis tenant
tentang `access_control` berlaku saat MENGUBAH keanggotaan dan tidak berlaku saat
MEMBACANYA.

`tenant/domains.astro` adalah satu-satunya layar yang tidak tertangkap glob
`src/pages/admin/*.astro` tingkat-atas — blind spot yang sama yang membuat #424
menyebut 31 padahal jumlah sebenarnya 32. Ia ikut di batch ini justru supaya
tidak menjadi sisa terakhir yang terlupa.

Enam afordans tulisnya (`create`, `update`, `delete`, `verify`, `set_primary`)
kini diputuskan lewat `can(...)` pada transaksi yang sama.

`roles.astro` mempertahankan logika R8-nya utuh — katalog permission masih
disaring `includePlatformScoped` terhadap `resolvePlatformTenant(tx)`, dan
pemuatan katalog itu tetap hanya terjadi bila `configure` diizinkan; bedanya
sekarang izin itu jawaban chokepoint, bukan pembacaan himpunan grant mentah.

Dua ledger menyusut bersama, 23 → 18: `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` dan
`NOT_YET_MIGRATED`.

Kebersihan: cabang mati `result instanceof Response` terhadap
`withTenantOrThrow` dihapus di empat layar, dan pemeriksaan bentuk di
`sidebar-menu.astro` (`"entries" in result`) — yang ada persis karena
`Response` itu truthy — tidak lagi diperlukan sebab tipe `AdminScreenOutcome`
membedakan `allowed`/`denied`/`error` secara langsung. `catch {}` kosong diganti
`logAdminPageError` ber-`correlationId`.
