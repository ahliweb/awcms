---
"awcms": minor
---

feat(auth): lima layar admin berikutnya melewati chokepoint (#450, R3)

Gelombang 1 batch 2. `registrations`, `modules`, `abac-policies`,
`blog-settings`, dan `comments` berhenti memutuskan akses dari
`ssr.permissions.has(...)` — himpunan RBAC mentah — dan berpindah ke
`loadAdminScreen`, yang menjalankan `authorizeInTransaction` dan pembacaan
datanya di dalam SATU transaksi.

Yang dipulihkan pada kelima layar itu: evaluasi kebijakan ABAC (sebuah `deny`
yang ditulis tenant lewat `/api/v1/abac/policies` ditegakkan di API dan **inert**
di layar), `resolveModuleAvailability` (tenant yang mematikan modulnya sendiri
tetap melihat layarnya penuh data), fakta business-scope, SoD saat-aksi, dan
`recordDecisionLog` — sebuah pembacaan yang terjadi tidak meninggalkan baris yang
menyatakan bahwa ia terjadi.

`abac-policies.astro` adalah kasus yang paling tajam: ia layar tempat tenant
**mengarang** kebijakannya, dan sampai sekarang kebijakan yang ditulisnya tidak
berlaku pada halaman yang mendaftarkannya.

Tiap afordans tulis (`approve`/`reject` registrasi, `enable`/`disable` modul,
`configure` policy dan setelan blog, empat verb moderasi komentar) kini
diputuskan lewat `can(...)` pada transaksi yang sama, bukan dari himpunan grant
mentah — jadi `deny` menyembunyikan tombolnya alih-alih baru menolak saat
ditekan. Endpoint tetap otoritasnya.

Dua ledger menyusut bersama: `ADMIN_SCREEN_CHOKEPOINT_MIGRATION`
(`access:chokepoint:check`) dan `NOT_YET_MIGRATED` (`api:tenant-route:check`),
28 → 23. Keduanya menghitung utang yang sama dari sudut berbeda — "siapa
memutuskan permission di luar chokepoint" versus "siapa membuka transaksinya
sendiri" — dan catatan itu kini tertulis di header keduanya supaya PR migrasi
berikutnya tidak menemukannya lewat gerbang merah.

Teks remediasi `api:tenant-route:check` diperbaiki: ia masih berkata helper-nya
"belum ada" dan menyuruh penulis layar baru **menunggu**. Banner "belum ada"
menua ke arah sebaliknya dari koreksi biasa — ia menyuruh orang berhenti
mengerjakan hal yang sudah bisa dikerjakan.

Dua cabang mati ikut hilang: `registrations`, `modules`, dan `abac-policies`
memeriksa `result instanceof Response` terhadap `withTenantOrThrow`, yang
melempar dan tidak pernah mengembalikan `Response`. Ketiganya juga menelan
kegagalan baca dengan `catch {}` kosong; kini kegagalan itu tercatat lewat
`logAdminPageError` dengan `correlationId`, dan `error` tetap state ketiga yang
tidak pernah dibaca sebagai penolakan.
