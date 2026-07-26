---
"awcms": patch
---

Sinkronkan docs/skill dengan #251/#252, dan catat satu split-brain `navigation`
yang ditemukan lewat graph.

Lima skill mengklaim hal yang sudah tidak benar setelah #251:
`awcms-theming` masih menyebut resolusi URL asset "masih no-op" (sudah ter-wire
lewat `MediaLibraryPort`); `awcms-module-management` masih menyebut "20 dari 21
modul" mendeklarasikan `permissions` (kini 21/21, sehingga `orphaned` bukan lagi
kondisi normal dan setiap kemunculannya adalah sinyal nyata); dan
`awcms-comments`/`awcms-site-search`/`awcms-seo-distribution` masih mengiklankan
deps "Core-only" padahal ketiganya kini mendeklarasikan modul yang memang mereka
import.

`ARCHITECTURE.md` kini menyebut `tests/module-boundary.test.ts` di sebelah tiga
gate modul lainnya, dengan alasannya: ketiganya memvalidasi graf yang
DIDEKLARASIKAN dan tak satu pun membaca satu baris `import`.
`13_final_master_index_traceability.md` menyatakan "23 modul terdaftar" — angka
awcms-mini; nyatanya 21.

**Temuan graph — `navigation` punya dua sumber yang tidak pernah
direkonsiliasi.** `ModuleDescriptor.navigation` nyata dikonsumsi (disinkronkan
ke `awcms_module_navigation`, disajikan `navigation-registry.ts`, divalidasi
`module-composition.ts`) dan lima modul mendeklarasikannya — tetapi sidebar
admin merender `navSections`, array statis di `AdminLayout.astro`. Jadi
mendeklarasikan `navigation` menghasilkan baris DB dan entri API, **bukan** link
menu; sebaliknya `/admin/tenant` tampil di sidebar tanpa descriptor apa pun.
Dicatat di skill pemiliknya, tidak "diperbaiki" sepihak: sisi API sudah punya
konsumen, jadi menyatukannya adalah keputusan desain.

Graph di-refresh ke `deb43028` (7534 node, 21084 edge, 435 community, nol import
cycle level-berkas).
