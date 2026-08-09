---
"awcms": minor
---

fix(keamanan): aset statis berhenti disajikan tanpa satu pun header keamanan

`@astrojs/node` (mode `standalone`) menyusun handler-nya sebagai
`staticHandler(req, res, () => appHandler(req, res))`. Handler statis jalan
**lebih dulu**, dan `appHandler` — satu-satunya yang menjalankan
`src/middleware.ts` — cuma jadi fallback ketika berkasnya tidak ada. Akibatnya
setiap berkas yang benar-benar ada di `dist/client/` dijawab **tanpa**
`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, COOP/CORP, dan tanpa `X-Correlation-ID`:
`public/js/news-share.js`, `public/css/public-content.css`, dan seluruh
`_astro/**`.

Terukur pada build nyata sebelum perbaikan: `curl -sI /css/public-content.css`
memberi **0** dari tiga header yang dicek, sementara `/api/v1/health` memberi
**3**. Sesudah perbaikan keduanya **3**, dengan `Content-Type` dan
`Cache-Control` milik `send` utuh.

Dua komentar di repo ini menegaskan yang sebaliknya dan dipakai sebagai
invarian — `astro.config.mjs` ("dipasang `src/middleware.ts` ke SETIAP
response") dan `src/middleware.ts` ("Routing ALL responses … guarantees no
response ever reaches Varnish unlabelled"). Keduanya benar untuk response yang
di-render dan salah untuk berkas statis; sekarang keduanya menyebut batasnya.
Satu bullet di `security-headers.ts` yang mendaftar `public/**` sebagai alasan
CORP aman juga diperbaiki — sebelum ini ia menyatakan niat, bukan fakta.

Dampak pada himpunan berkas hari ini sedang: dua aset milik sendiri plus bundel
ber-hash, semuanya ber-MIME benar. Yang membuatnya ditutup sekarang dan bukan
sekadar didokumentasikan adalah bahwa invarian itu **load-bearing** — ia alasan
tertulis mengapa tidak ada lapisan header kedua di mana pun. Menjatuhkan satu
berkas `.html` ke `public/` menyajikannya sebagai dokumen tanpa CSP dan tanpa
`X-Frame-Options`, dan service worker (#466) mendarat di jalur yang sama.

**Perbaikannya membungkus, bukan menulis ulang.** `src/lib/server/standalone-entry.ts`
mematikan autostart adapter, mengimpor `handler` yang sudah dibangunnya, dan
memasang `buildSecurityHeaders()` dengan `setHeader` sebelum mendelegasikan.
Itu berarti `send` tetap yang menangani conditional GET, range request, 304,
redirect `trailingSlash`, penolakan dotfile beserta pengecualian `.well-known`,
dan `Cache-Control` immutable untuk `assetsDir` — menulis ulang semua itu demi
empat header akan menukar bug header dengan kelas bug yang jauh lebih buruk.

Pemasangannya adalah **lantai, bukan override**: Node menggabungkan
`writeHead(status, headers)` di atas nilai `setHeader` dengan objek `writeHead`
menang saat nama bentrok, jadi response yang di-render tetap membawa persis apa
yang dihitung middleware. Klaim penggabungan itu yang diuji terhadap server
`node:http` sungguhan di `tests/standalone-entry.test.ts`, dua arah — bukan
sekadar "builder mengembalikan empat header", yang sudah hijau sepanjang bug ini
hidup.

Entrypoint produksi berpindah ke `dist/standalone-entry.mjs`: `package.json`
`start`, `Dockerfile.production` `CMD`, dan job `e2e-smoke` di `ci.yml`.
`tests/family-conformance-ci-parity.test.ts` kini meng-assert entry baru **dan**
melarang entry adapter mentah, karena kembali ke sana adalah regresinya persis
dan terlihat tak berbahaya di dalam diff.
