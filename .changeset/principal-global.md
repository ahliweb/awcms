---
"awcms": minor
---

feat(auth): satu manusia, satu kredensial, banyak tenant (ADR-0085, #423)

Gelombang 7 PR 7.1. `awcms_principals` — GLOBAL, tanpa RLS, satu baris per
manusia. `awcms_identities` mempertahankan setiap baris, setiap `id`, dan
kedelapan foreign key masuknya persis di tempatnya; ia hanya mendapat satu kolom
`principal_id` nullable. Penurunan MAKNA, bukan pemindahan data.

**Principal adalah fakta AUTENTIKASI, tidak pernah fakta OTORISASI.** Memegangnya
tidak memberi apa pun; setiap permission tetap di-resolve lewat
`awcms_tenant_users` di bawah FORCE RLS. Empat kontrol menggantikan RLS, dan
keempatnya ditegakkan: hak dipersempit (tidak pernah DELETE), invarian bentuk-baca
lewat gerbang baru `identity:principal-access:check` (rantai 40 → 41),
`password_hash` yang dijaga TIPE agar tak meninggalkan modul store, dan batas
otorisasi yang di-assert tidak bergerak.

Backfill-nya tidak memindahkan satu rahasia pun: `password_hash` dibiarkan NULL
dan kredensial dipromosikan saat login sukses pertama (PR 7.2). Sampai itu
terjadi, principal adalah cangkang kosong — sehingga backfill yang salah tidak
bisa mengunci siapa pun.

`sql/112` MENOLAK berjalan bila ada tabrakan identifier dalam satu tenant.

**#430 belum ditutup PR ini** — penghitung lockout masih per-`(tenant, email)`.
