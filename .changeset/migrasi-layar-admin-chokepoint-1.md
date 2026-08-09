---
"awcms": patch
---

Tiga layar admin pertama melewati chokepoint (#450, R3): `audit-trail`,
`profiles`, `email-templates`.

Ketiganya kini memutuskan lewat `authorizeInTransaction` dan membaca di dalam
transaksi yang sama, jadi policy `deny` ABAC tenant, ketersediaan modul, fakta
business-scope, SoD, dan `recordDecisionLog` berlaku pada jalur BACA-nya. Pada
`audit-trail` itu punya bentuk yang enak disebut: **pembacaan jejak audit kini
ikut teraudit.**

`canCreate` di `profiles` dan `email-templates` juga diputuskan chokepoint lewat
`can()` alih-alih diambil dari set grant mentah — jadi `deny` tenant
menyembunyikan formulirnya, bukan sekadar menggagalkan POST di baliknya.

Dua cabang mati ikut hilang: `profiles` dan `email-templates` memeriksa
`result instanceof Response` terhadap `withTenantOrThrow`, yang tidak pernah
mengembalikan `Response` — ia melempar.

Ledger `access:chokepoint:check` 31 → **28**, dan ledger `api:tenant-route:check`
ikut menyusut tiga baris; dua gerbang menghitung utang yang sama dari dua sudut
dan bergerak bersama.

Satu test yang saya tulis di PR fondasi ikut diperbaiki: ia mematok "31 layar
memutuskan, 1 memakai chokepoint" — dua angka yang berubah tiap PR migrasi dan
melatih penulis berikutnya untuk mengedit angka alih-alih membacanya. Diganti
identitas yang berlaku di SETIAP titik migrasi: ledger memuat semua-dan-hanya
layar yang masih bypass.
