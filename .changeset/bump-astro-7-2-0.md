---
"awcms": patch
---

chore(deps): astro 7.1.6 → 7.2.0 dan @astrojs/node 11.0.3 → 11.1.0

Menggantikan dua PR dependabot (#488, #489) dengan satu.

**Digabung karena keduanya tak bisa hijau sendirian.** `family:conformance:check`
membandingkan `awcms-family-compatibility.yaml` dengan `package.json` field demi
field, jadi menaikkan satu dependensi tanpa memperbarui manifesnya membuat
gerbang itu **merah** — dan itulah yang terjadi pada kedua PR dependabot. Manifes
diperbarui di sini untuk keduanya sekaligus; memperbaikinya dua kali berarti dua
PR yang masing-masing merah sampai yang lain mendarat.

Adapter node dan astro juga berpasangan: `@astrojs/node@11.1.0` menyatakan
`peerDependencies: { astro: "^7.0.0" }`, dan `bun install` **tidak menolak**
peer mismatch — ia memasang dan diam. Jadi bukti bahwa pasangan ini benar bukan
lockfile-nya melainkan `bun run build` yang hijau, yang dijalankan rantai `check`.

**Satu koreksi yang ikut mendarat.** Divergensi `astro-files-not-type-checked`
menyatakan "42 berkas `.astro` (22.328 baris)"; angka sesungguhnya **44 berkas
(24.359 baris)**. Divergensi itu ada untuk mencatat BESARNYA paparan yang tidak
diperiksa `tsc`, jadi ringkasan yang mengecilkannya adalah satu-satunya jenis
kesalahan yang benar-benar merugikan di entri itu. Diukur ulang
(`find src -name '*.astro'`), bukan ditaksir.
