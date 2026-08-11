---
"awcms": minor
---

feat(access): sebuah entitlement MENOLAK, ia tidak pernah memberi (ADR-0084, #423)

Gelombang 5 PR 5.1. Lima tabel (`sql/109`) plus satu cabang penolakan di
`authorizeInTransaction`: `403 ENTITLEMENT_REQUIRED`, `matchedPolicy:
"entitlement_required"`, diputuskan **setelah** `module_disabled` dan **di atas**
`fetchGrantedPermissionKeys`.

Lapisan entitlement hanya bisa mengatakan TIDAK — setiap fungsi keputusan yang
diekspor bertipe `EntitlementDenial | null`, dan properti itu diperiksa mesin
oleh gerbang baru `access:entitlement:deny-only:check` (rantai 39 → 40) yang
lahir dengan **empat probe SINTETIS**, bukan dengan sebuah ledger yang alarmnya
mati begitu ledgernya kosong.

**Mendarat INERT, dan itu dibuktikan bukan diklaim.** Nol modul mendeklarasikan
`requiresEntitlement`, dan `resolveModuleAvailability` pada jalur null
mengeluarkan pernyataan SQL yang SAMA — dibandingkan sebagai teks di test.

Tiga pengecualian keras: tenant platform (sengaja TIDAK fail-closed), modul
`isCore` (deklarasinya tidak dihormati DAN memerahkan `modules:compose:check`),
dan deskriptor yang tidak mendeklarasikan apa pun.

Katalog plan GLOBAL dan tak bisa ditulis saat request: tak ada `tenant_id` di
sana untuk dipolisikan policy, jadi INSERT pada `awcms_plan_entitlements` akan
menjadi eskalasi yang tak satu pun policy RLS keberatan. Membuat/mengubah harga
plan adalah MIGRASI.

`MODULE_CONTRACT_VERSION` 3.0.0 → 3.1.0 (aditif murni), dipasangkan bump
`awcms-family-compatibility.yaml`. Urutan kelima gerbang struktural kini
ditegakkan pada level SOURCE oleh `tests/guard-structural-gate-order.test.ts`.
