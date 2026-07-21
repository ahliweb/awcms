# Fixture: contoh modul domain (example-domain-modules)

Kumpulan **test-support** in-repo berisi contoh modul _domain_ ilustratif yang
dipakai HANYA oleh test untuk menguji mesin penegakan (enforcement) base
terhadap metadata modul realistis yang sengaja **tidak** di-ship oleh registry
base sendiri. **Bukan** modul ERP nyata, dan **tidak pernah** terdaftar di
registry base (`src/modules/index.ts`) — hanya di-import oleh test yang
membutuhkan contoh metadata modul domain.

## Isi

- `index.ts` — mengekspor `exampleDomainModules` (`readonly ModuleDescriptor[]`),
  daftar contoh modul domain yang di-compose sebuah test dengan
  `listBaseModules()`.
- `modules/example-crm/module.ts` — satu modul domain contoh (`example_crm`)
  yang bergantung pada dua modul base (`tenant_admin`, `identity_access`),
  menyediakan capability `example_crm_directory` + `business_scope_hierarchy`
  (Issue #180), membawa lima-plus contoh rule SoD ilustratif (Issue #181),
  sebuah fragment OpenAPI (Issue #182), serta permission/navigation/job —
  cukup untuk membuktikan setiap check komposisi (Issue #178) berjalan pada
  modul domain. Base sendiri men-ship NOL rule SoD.
- `modules/example-crm/business-scope-hierarchy-adapter.ts` — resolver
  `BusinessScopeHierarchyPort` **dummy** in-memory (Issue #180, ADR-0030):
  base men-ship resolver no-op (fail-closed), fixture ini menyediakan resolver
  konkret untuk uji. Menyelesaikan resolusi exact/descendant/ancestor atas
  graph in-memory, dengan tenant-isolation + batas depth + deteksi cycle —
  tanpa modul domain atau tabel DB nyata. Dipakai unit test
  (`tests/business-scope-hierarchy-resolver.test.ts`) dan integration test
  (`tests/integration/business-scope.integration.test.ts`).
- `openapi/modules/example-crm.openapi.yaml` — fragment OpenAPI contoh; test
  `tests/openapi-extra-fragment.test.ts` membuktikan fragment tambahan
  ter-merge ke bundle lewat seam `extraFragmentFiles` `buildBundledDocument`
  tanpa mengedit fragment base, dan fragment yang menabrak path/schema base
  ditolak (`BundleConflictError`).

## Cara pakai

Test menyusun daftar modul untuk di-feed ke fungsi enforcement base:
`[...listBaseModules(), ...exampleDomainModules]` untuk komposisi/SoD,
`createDummyBusinessScopeHierarchyResolver(...)` untuk business-scope, dan
`exampleCrmModule.api.openApiPath` untuk kontribusi fragment OpenAPI. Lihat
`docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md`
untuk keputusan menghapus jalur aplikasi-turunan.
