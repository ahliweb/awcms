---
"awcms": patch
---

fix(test,gerbang): asersi anti-regresi chokepoint berhenti lolos secara hampa saat rename

Dua asersi di `tests/access-chokepoint.test.ts` menjaga invarian utama ADR-0063
— `ownershipGrant` **melebarkan** himpunan kunci, tidak pernah men-*short-circuit*
ke `allowed: true` — dengan `expect(source).not.toMatch(/ownershipGrant…/)`.

Regex-nya berlabuh pada literal nama variabel. `not.toMatch` terhadap pola yang
**tidak akan pernah cocok** selalu hijau, jadi sebuah rename membuat keduanya
lolos tanpa menguji apa pun.

Diverifikasi, bukan diduga. Dengan `ownershipGrant`/`ownershipApplied` di-rename
habis di `access-guard.ts` (0 kemunculan nama lama, 7 nama baru), asersi lama
tetap **HIJAU**; asersi baru **MERAH**.

Penggantinya menamai kedua variabel itu nol kali: ambil badan
`authorizeInTransaction` saja (bukan seluruh berkas — deklarasi tipe
`AuthorizeResult` di atasnya sah menulis `allowed: true;`), lalu tuntut **tepat
satu** `allowed: true` dan indeksnya **setelah** `evaluateAccess(`. Sebuah early
allow adalah kecocokan kedua, apa pun nama variabelnya.

Dipasangkan test kedua yang **menuntut identifier itu ADA**. Aturan yang
diadopsi: asersi berbasis sumber wajib rename-proof, **atau** dipasangkan asersi
keberadaan — kalau tidak, ia menjaga mekanisme yang mungkin sudah tidak ada.

Dua asersi hampa lain ikut ditutup di jalan: `expect(evaluate).toBeGreaterThan(-1)`
sebelum perbandingan indeks (tanpanya perbandingannya berbunyi `> -1` dan lolos
untuk penempatan apa pun), dan `expect(start).toBeGreaterThan(-1)` di pengekstrak
badan fungsi (tanpanya seluruh asersi menjangkau string kosong — cacat #425 lahir
kembali di dalam perbaikannya sendiri).

**Sisi gerbang.** `scripts/access-chokepoint-check.ts` mengklasifikasi handler
lewat literal `fetchGrantedPermissionKeys(`. Rename fungsi itu membuat setiap
`decidesPermissions` bernilai false, `findChokepointBypasses` mengembalikan
kosong, dan gerbang mencetak **"0 handler memutuskan permission"** lalu keluar
dengan **sukses**. Nama itu justru akan berubah bentuk di #423 (tipe kembalinya
diubah) — momen ketika orang paling tergoda menggantinya.

Sekarang `deciding.length === 0` adalah kegagalan dengan pesan yang menyebut
sinyalnya. Diverifikasi: sinyal yang tak lagi cocok apa pun → **MERAH** (dulu
hijau).

Nol perubahan runtime.
