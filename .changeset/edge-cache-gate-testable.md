---
"awcms": patch
---

Buat `edge-cache:surfaces:check` bisa diuji, lalu uji dia.

Dari 21 gate di rantai `bun run check`, ini satu-satunya yang membawa logika
substansial (278 baris) **tanpa satu pun test** — dan alasannya struktural,
bukan kelalaian: berkasnya berakhir dengan `await main()` di scope modul, jadi
meng-`import`-nya akan MENJALANKAN gate-nya, dan `process.exit(1)`-nya akan
membawa serta test runner. Gate lain yang tak diuji semuanya pembungkus tipis
(35–66 baris) di atas kolektor yang diuji terpisah.

Itu penting justru di sini. Registry ini adalah **allow-list** yang memutuskan
apa yang boleh disimpan shared cache; kesalahan di dalamnya adalah pengungkapan
lintas-tenant, bukan halaman lambat. Header berkasnya sendiri menyebut daftar
probe `MUST_NEVER_MATCH` sebagai "the check that earns this file's existence" —
dan sampai sekarang tak ada apa pun yang pernah menyaksikan daftar itu menolak
sesuatu.

Perubahannya: entrypoint dijaga `import.meta.main`, tiga aturannya diekspor
sebagai fungsi murni (`validateSurfaces`, `findCacheableForbiddenPaths`,
`findOwnersWithoutPurges`), dan `process.exit(1)` diganti `process.exitCode`
sehingga gate tak lagi mematikan proses pemanggilnya. 20 test menanam
pelanggaran nyata untuk tiap aturan.

Dibuktikan dengan menghapus **traversal guard** di `matchPublicCacheSurface` —
persis cacat yang digambarkan header gate ini. Hasilnya: `/blog/../admin` dan
`/blog/%2e%2e/admin` dilaporkan cocok dengan surface `blog-post`, gate exit 1,
test merah. URL admin yang cacheable, ditangkap oleh check yang sebelumnya tak
pernah diamati bekerja.
