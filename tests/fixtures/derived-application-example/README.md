# Fixture: contoh aplikasi turunan (derived-application-example)

Fixture in-repo untuk **Issue #178** (epic #177, ADR-0025) — mensimulasikan
sebuah repository aplikasi turunan yang menambahkan modul domainnya sendiri
lewat _build-time module composition_ **tanpa mengedit registry base**
(`src/modules/index.ts`).

Dipakai HANYA oleh test (`tests/module-composition-fixture.test.ts`) — tidak
pernah di-import oleh `src/modules/application-registry.ts` maupun
`src/modules/index.ts`, karena build base ini wajib tetap mengirim
`applicationModuleRegistry = undefined` (registry efektif default identik
dengan sebelum Issue #178).

## Isi

- `application-registry.ts` — `ApplicationModuleRegistry` contoh
  (`id: "derived-application-example-fixture"`, `migrationNamespace` 900-999),
  bentuk yang sama persis dengan yang akan diekspor sebuah repo turunan nyata
  dari `src/modules/application-registry.ts` miliknya.
- `modules/example-crm/module.ts` — satu modul domain dummy (`example_crm`)
  yang bergantung pada dua modul base (`tenant_admin`, `identity_access`),
  menyediakan capability `example_crm_directory` + `business_scope_hierarchy`
  (Issue #180), dan mendeklarasikan permission/navigation/job — cukup untuk
  membuktikan setiap check komposisi berjalan pada modul turunan. **Bukan**
  modul ERP nyata.
- `modules/example-crm/business-scope-hierarchy-adapter.ts` — resolver
  `BusinessScopeHierarchyPort` **dummy** in-memory (Issue #180, ADR-0030):
  contoh apa yang disediakan aplikasi turunan lewat capability
  `business_scope_hierarchy`. Menyelesaikan resolusi exact/descendant/ancestor
  atas graph in-memory, dengan tenant-isolation + batas depth + deteksi cycle —
  tanpa modul domain atau tabel DB nyata. Dipakai unit test
  (`tests/business-scope-hierarchy-resolver.test.ts`) dan integration test
  (`tests/integration/business-scope.integration.test.ts`).

## Cara pakai (bagi repo turunan nyata)

Repo turunan mengganti nilai `undefined` di `src/modules/application-registry.ts`
miliknya dengan `ApplicationModuleRegistry` sendiri, lalu menomori migration
`sql/` dari `900` ke atas. `bun run modules:compose:check`,
`bun run extension:check`, dan `bun run modules:composition:inventory:check`
(semuanya bagian dari `bun run check`) memvalidasi hasilnya. Lihat
`docs/awcms/derived-application-guide.md` dan
`docs/adr/0025-*.md` untuk detail.
