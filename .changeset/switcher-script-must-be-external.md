---
"awcms": patch
---

fix(i18n): script pengalih bahasa DI-INLINE, jadi CSP menolaknya — cacat KEDUA di kontrol yang sama

v9.1.1 memperbaiki 403-nya dan pengalih bahasa **tetap mati**. Ada dua cacat
independen di kontrol ini, dan yang kedua ini bahkan tak pernah sampai ke
jaringan: script-nya tak pernah dieksekusi.

Astro me-render script komponen **INLINE** bila setelah bundling ia tak lagi
punya import LINTAS-CHUNK. CSP repo ini `script-src 'self' 'sha256-…'` dengan
TEPAT SATU hash — script theme-init. Script inline yang hash-nya tak dikenal
tidak pernah jalan.

Versi lama menahan import-nya dengan
`if (typeof LOCALE_COOKIE_NAME !== "string") throw …`. Konstanta itu string,
jadi minifier membuktikan tesnya salah, menghapus cabangnya, menemukan import-nya
tak terpakai, lalu meng-elide-nya. Script jadi bebas-import dan di-inline —
persis yang dicegah oleh penjaga itu, sementara komentarnya terus menyatakan hal
itu mustahil.

**"Punya import" adalah cara yang SALAH untuk menyatakan aturannya**, dan
menyatakannya keliru memakan satu rilis. `admin-form-client` selamat karena
dipakai banyak layar sehingga menjadi chunk tersendiri; modul privat
satu-pemanggil dilipat ke dalam script pemanggilnya, dan script itu lalu
di-inline. Perbaikan pertama saya — `import "…"` telanjang ke modul baru —
gagal karena alasan yang sama, dan build MEMBUKTIKANNYA sebelum apa pun dikirim.

Perilakunya kini dimuat dari script `AdminLayout`, satu-satunya script yang sudah
terbukti eksternal (ia mengimpor chunk bersama itu), dan `AdminLayout` memang
satu-satunya yang me-render komponen ini. Komponennya sendiri tak lagi punya
`<script>`.

**Dibuktikan pada artefak build, bukan pada niat:** `dist/client/_astro/
AdminLayout.astro_astro_type_script_index_0_lang.*.js` memuat logika pengalih,
dan `dist/server/entry.mjs` memuatnya **NOL kali** — sebelum perbaikan ini
kebalikannya yang benar.

Digerbangi `tests/form-post-origin-check.test.ts`: komponennya tak boleh punya
`<script>` sendiri lagi, dan `AdminLayout` wajib tetap mengimpor keduanya —
modul pengalih DAN chunk bersama yang membuat script itu eksternal.
