---
"awcms": patch
---

docs(src): 23 rujukan ke jalur aplikasi-turunan yang ADR-0034 hapus, ditulis ulang per konteks

[ADR-0034](../docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
menghapus jalur aplikasi-turunan seluruhnya — tidak ada lagi
`src/modules/application-registry.ts`, `extension:check`, namespace migrasi
`900+`, maupun manifest kompatibilitas turunan. `docs/PROJECT_STATE.md` §1
menyatakan eksplisit bahwa dokumen yang masih menyebutnya sebagai jalur aktif
adalah **usang**. Toh 29 situs di `src/` masih menyebutnya, dan hampir semuanya
menjawab pertanyaan yang paling sering ditanyakan pembaca sebuah seam: **siapa
yang menyediakan adapter/entri di sini?** — dengan jawaban yang tidak ada.

23 ditulis ulang menjadi mekanisme yang benar-benar berlaku: **modul domain yang
ditambahkan langsung di `src/modules/`**. Beberapa butuh kata yang berbeda karena
konteksnya memang berbeda, dan itulah alasan ini tidak dikerjakan dengan `sed`:

- `metrics-port.ts` / `prometheus-text-adapter.ts` — yang memasang adapter
  observability adalah **deployment** lewat composition root, bukan modul.
- `family-contract.ts` — yang bisa dirusak perubahan MAJOR adalah **konsumen**
  kontrak keluarga (mis. `ahliweb/awcms-astro`), bukan "aplikasi turunan".
- `logger.ts` baris kedua — "A derived app's sink" → "A registered sink":
  kalimatnya tentang sink mana pun yang terdaftar, bukan tentang siapa
  mendaftarkannya.
- `email-template-categories.ts` — namespace `derived.*` dan fungsi
  `registerDerivedEmailTemplateCategory` adalah **identifier nyata di kode** dan
  TIDAK diubah; hanya prosa di sekitarnya.

**Enam situs sengaja DIBIARKAN karena benar secara historis**, dan menghapusnya
justru akan menghilangkan catatan kenapa jalur itu tidak ada:

- `module-contract.ts` changelog `2.0.0` — ia menamai pencabutannya.
- `business-scope-hierarchy-port.ts` (3 situs) — mengutip judul issue #180 dan
  menjelaskan bahwa resolver itu "permanently unfillable once ADR-0034 deleted
  that pathway". Prosa itu sudah tepat.
- `email-template-categories.ts` — kutipan teks issue.
- Satu catatan penanda yang ditambahkan perubahan ini sendiri.

Nol perubahan perilaku: seluruhnya komentar dan satu baris JSDoc. Menyusul PR
sebelumnya yang memperbaiki string `description` descriptor `reporting` — satu
situs yang BUKAN komentar, karena `listModules()` membacanya dan ia tampil di
layar Module Management.
