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
  menyediakan capability `example_crm_directory`, dan mendeklarasikan
  permission/navigation/job — cukup untuk membuktikan setiap check komposisi
  berjalan pada modul turunan. **Bukan** modul ERP nyata.

## Cara pakai (bagi repo turunan nyata)

Repo turunan mengganti nilai `undefined` di `src/modules/application-registry.ts`
miliknya dengan `ApplicationModuleRegistry` sendiri, lalu menomori migration
`sql/` dari `900` ke atas. `bun run modules:compose:check`,
`bun run extension:check`, dan `bun run modules:composition:inventory:check`
(semuanya bagian dari `bun run check`) memvalidasi hasilnya. Lihat
`docs/awcms/derived-application-guide.md` dan
`docs/adr/0025-*.md` untuk detail.
