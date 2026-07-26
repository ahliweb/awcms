---
"awcms": minor
---

Tambah `checkSsoBreakGlassReady` ke `bun run security:readiness` (critical) —
menutup sisi kedua jaminan break-glass yang selama ini tak ditegakkan apa pun.

`saveTenantAuthPolicy` menolak (`409 BREAK_GLASS_REQUIRED`) menyimpan
`sso_required=true` atau `password_login_enabled=false` tanpa minimal satu
identity break-glass yang eligible **saat itu**. Tapi eligibility bukan properti
policy — ia properti `awcms_identities` dan `awcms_tenant_users`. Menonaktifkan
identity itu, atau mencabut membership tenant-nya, membuat policy yang tersimpan
menjadi salah **tanpa policy-nya pernah ditulis ulang**; keduanya aksi
administrasi user biasa yang tak seorang pun mengaitkannya dengan lockout SSO.
Setelah itu tenant hanya berjarak satu outage IdP dari tidak punya jalan masuk
sama sekali, dan seluruh check lama tetap hijau.

Check baru menurunkan ULANG eligibility dari database untuk setiap tenant aktif
memakai `fetchEligibleBreakGlassIdentityIds` + `evaluateBreakGlassRequirement`
yang **sama persis** dengan jalur simpan — bukan salinan aturan kedua yang bebas
melenceng. Satu `withTenant` per tenant (tabel policy FORCE RLS; check berjalan
di bawah isolasi yang sama dengan aplikasi), tanpa cap/LIMIT — sebuah batas akan
membuat tenant terkunci di luar batas tak terlaporkan sementara check mencetak
PASS. Evidence menyebut tiap tenant bermasalah beserta pemicunya:
`password_login_enabled=false` (login lokal MATI sekarang) atau `sso_required`
saja (advisory, login password masih jalan), dan tak pernah mencetak
`login_identifier`.

Terbukti lewat mutasi, bukan diasumsikan: mengganti hitungan eligible dengan
`breakGlassIdentityIds.length` — persis bug yang check ini cari — memerahkan 4
test integrasi; membuang separuh `password_login_enabled` dari pemicu memerahkan
1. Test kontrak menegakkan pemanggilan di CALL SITE, karena mutasi pertama itu
tak menyentuh baris import sama sekali.
