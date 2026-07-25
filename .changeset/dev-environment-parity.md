---
"awcms": patch
---

Samakan environment development dengan staging/produksi, dan buang variabel env
hantu dari dokumentasi.

Development sebelumnya bukan versi kecil produksi melainkan environment yang
berbeda secara diam-diam: skema berhenti di migrasi 30 (produksi 70), nol
tenant, tanpa `.env`, dan satu-satunya role ber-LOGIN adalah superuser milik
container — sehingga `FORCE RLS` inert dan justru bug termahal (kebocoran
tenant, 403 permission) yang paling mustahil direproduksi di sana. Dev kini
cocok baris per baris: migrasi 70, 118 tabel, 197 permission, RLS `ENABLE`+`FORCE`
109/118, runtime sebagai `awcms_app`, owner `owner` 197/197 — dengan perbedaan
yang disengaja (`AUTH_COOKIE_SECURE`, `TRUSTED_PROXY_ENABLED`, `EDGE_CACHE_MODE`)
dicatat beserta alasannya.

Dokumentasi menyebut `AUTH_JWT_SECRET` sebagai variabel wajib di lima berkas.
**Variabel itu tidak ada di awcms** — tidak dibaca kode mana pun, dan tidak ada
JWT di jalur sesi (token acak buram ber-hash sha256 di `awcms_sessions`).
Klaimnya bukan sekadar usang: ia menopang pernyataan keamanan bahwa tiga
environment terisolasi sebagian karena masing-masing punya JWT secret sendiri.
Operator yang mengikutinya akan menyetel variabel yang tidak berefek apa pun.
`APP_TIMEZONE` juga tercantum wajib dan sama-sama tidak ada.

`tests/env-required-vars-doc.test.ts` mengikat daftar wajib di
`deployment-profiles.md` ke `RULES` di `scripts/validate-env.ts`, menolak
kemunculan ulang `AUTH_JWT_SECRET` sebagai variabel hidup, dan memverifikasi
kedua nama itu memang tak pernah dibaca kode — empat mutasi terbukti merah.
