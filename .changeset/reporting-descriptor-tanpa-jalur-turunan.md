---
"awcms": patch
---

docs(reporting): descriptor berhenti menjanjikan "derived applications" — jalur itu dicabut ADR-0034

String `description` descriptor `reporting` berbunyi "Derived applications add
their own domain-specific reporting views (and may contribute their own
projection descriptors via `reportingProjections`) on top of this base."

[ADR-0034](../docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
**menghapus jalur aplikasi-turunan seluruhnya** — tidak ada lagi
`src/modules/application-registry.ts`, `extension:check`, namespace migrasi
`900+`, maupun manifest kompatibilitas turunan; `ModuleType` valid tinggal
`base | system | domain | integration`. `docs/PROJECT_STATE.md` §1 menyatakan
eksplisit bahwa dokumen yang masih menyebut jalur itu sebagai jalur aktif adalah
**usang**.

Ini bukan komentar: `description` adalah yang dibaca `listModules()` dan tampil
di layar Module Management, jadi operator membacanya sebagai penjelasan cara
memperluas sistem — ke arah yang tidak ada. Diganti dengan mekanisme yang
benar-benar berlaku: modul domain ditambahkan **langsung** di `src/modules/`.

**Temuan yang lebih besar dan SENGAJA tidak disapu di sini:** rujukan ke jalur
turunan yang sama masih ada di **24 berkas lain** di `src/` (~29 situs), semuanya
komentar kode — `identity-access/application/access-guard.ts`,
`workflow-approval/infrastructure/condition-action-registry.ts`,
`_shared/ports/business-scope-hierarchy-port.ts`, `sync-storage/domain/sync-conflict.ts`,
dan seterusnya. Semuanya menjelaskan **siapa yang menyediakan adapter/entri** di
sebuah seam ekstensi, jadi masing-masing butuh kalimat pengganti yang benar
menurut konteksnya, bukan `sed` seragam — dan penyapuan buta atas 25 berkas
adalah cara melahirkan 25 kalimat yang salah dengan percaya diri. Dikerjakan
sebagai unit sendiri, dengan hitungannya dicatat di sini supaya tidak hilang.
