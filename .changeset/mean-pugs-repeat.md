---
"awcms": patch
---

fix(typecheck): kode mati berhenti lolos ke `main` — `tsc` menolak local & parameter tak terpakai

CodeQL alert #147 (`js/unused-local-variable`) melaporkan impor mati
`MEDIA_PERMISSIONS` di `src/pages/api/v1/media/objects/index.ts` — di `main`,
seminggu setelah ia merge. Tidak ada satu pun dari 34 gerbang rantai `check`
yang bersuara: `lint` adalah `prettier --check` yang memformat dan tidak pernah
menganalisis, dan repo ini tidak memakai ESLint/oxlint. `tsc` sudah berjalan di
setiap PR dan akan menangkapnya dalam hitungan detik, tetapi `tsconfig.json`
meng-`extends` `astro/tsconfigs/strict`, sementara `noUnusedLocals` dan
`noUnusedParameters` berada satu tingkat di atas di `strictest`. Repo sudah
memetik `noUncheckedIndexedAccess` dan `noImplicitOverride` dari `strictest`;
dua ini sekadar tidak ikut terbawa.

Menyalakan keduanya memunculkan temuan kedua yang TIDAK dilaporkan CodeQL:
flag `timedOut` di `src/lib/jobs/job-runner.ts`, ditulis oleh timer timeout job
dan tidak pernah dibaca, bersebelahan dengan klasifikasi status yang justru
menyimpulkan `"timeout"` lewat eliminasi (`terminatedBy ? "terminated" :
"timeout"`). Flag itu dihapus, dan invarian yang membuat eliminasi tersebut
sahih kini ditulis eksplisit di tempatnya: `controller` tidak pernah keluar dari
fungsi kecuali sebagai `signal` read-only, jadi hanya ada dua pemanggil
`abort()`. Sumber abort ketiga wajib mengembalikan klasifikasi menjadi positif —
kalau tidak, abort-nya akan tercatat di log job sebagai timeout yang tak pernah
terjadi.

Perubahan perilaku: tidak ada. `timedOut` tidak pernah dibaca, sehingga
menghapusnya tidak dapat mengubah status job mana pun; dua parameter di
`seo-distribution/application/redirect-resolution-service.ts` hanya diberi
awalan garis bawah karena kedua strategi redirect sengaja berbagi satu
signature (`resolveLegacyBlogRedirect` mengenali tenant dari PATH, bukan dari
HOST). Yang berubah adalah kelas cacat ini sekarang gagal secara lokal dan di
PR, bukan muncul sebagai alert keamanan mingguan setelah mendarat.

`tests/typecheck-unused-code-gate.test.ts` menjaga keduanya — setelan compiler
dapat dihapus dalam commit yang sama dengan galat yang mengganggu seseorang,
tanpa sinyal apa pun. Kedua sisi diuji karena masing-masing inert sendirian:
flag tak berarti bila tidak ada perintah yang menjalankan `tsc`, dan
menjalankan `tsc` tak membuktikan apa pun bila flag-nya hilang.
