---
"awcms": patch
---

Dua celah standar ditutup dengan pemeriksanya: kompresi yang diwarisi kini
dinyatakan, dan CodeQL berhenti mengklaim `.astro`.

**C3 — kompresi diwarisi dari lapisan yang repo ini tak miliki.**
`security:readiness` memuat `checkResponseCompressionOwnership`: ia memindai
lima lapisan yang repo ini KIRIM (`src/middleware.ts`, `astro.config.mjs`,
`infra/varnish/default.vcl`, `infra/varnish/docker-compose.varnish.yml`,
`Dockerfile.production`) dan, karena tak satu pun mengompresi, menuntut blok
bertanda `kompresi-tepi` di `docs/awcms/environments.md` menyebut tier
pengompresi (Cloudflare) beserta akibatnya: deployment di luar CDN pengompresi
menyajikan seluruh teks tanpa kompresi. Cabang pertama resep C3 (memindahkan
kompresi ke sini) sudah **dicabut** asesmen §9.3 — kompresor kedua adalah dua
tempat yang memutuskan hal yang sama. Yang ditutup adalah ketidakterlihatannya;
repo ini tetap tidak mengompresi apa pun, dan tidak ada gerbang yang melihat
lapisan luarnya. Dua arah dibuktikan `tests/security-readiness-compression.test.ts`:
blok dihapus/dikosongkan/penanda separuh → MERAH; kompresi menyala di lapisan
yang dikirim → pemeriksa menyebut `berkas:baris` dan menuntut blok ditulis
ulang; komentar `do_gzip` dan `Vary: Accept-Encoding` tidak dihitung sebagai
kompresi.

**C16 — `codeql.yml` mengklaim memindai "TypeScript/Astro source".** CodeQL
tidak punya ekstraktor Astro, jadi 42 berkas `.astro` (22.328 baris — permukaan
yang sama yang C4 sebut) berada di luar setiap pemindaian sementara komentar
repo menyatakan sebaliknya. Langkah `State coverage` kini menulis ke ringkasan
run berapa berkas dianalisis dan berapa `.astro` TIDAK, dihitung `git ls-files`
saat run; komentar matriksnya berhenti mengklaim Astro. Dijaga
`tests/codeql-coverage-statement.test.ts`: langkah hilang, angka ditulis
tangan, atau klaim Astro kembali → MERAH. Postur keluarga kini satu kalimat —
`.astro` tidak teranalisis statik di repo mana pun, dan kedua repo
mengatakannya sendiri.

Tidak ada perubahan perilaku runtime: `security:readiness` bertambah satu
pemeriksa `warning` (tidak pernah memblokir go-live), dan `codeql.yml`
bertambah satu langkah ringkasan.
