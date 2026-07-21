---
"awcms": major
---

refactor(module-composition)!: hapus penuh jalur aplikasi-turunan (ADR-0034 §3, Fase 2)

Menghapus permukaan yang khusus jalur aplikasi-turunan sesuai keputusan ADR-0034 §3 (awcms = template dipakai-langsung, tidak ada repo derivatif): seam `src/modules/application-registry.ts`, gerbang `bun run extension:check` (`scripts/extension-check.ts`, dari script `check` + ci.yml), konsep migration namespace turunan 900-999, dan tipe komposisi `ApplicationModuleRegistry`/`ModuleMigrationNamespace`.

`src/modules/module-management/domain/module-composition.ts` kini memvalidasi satu registry base (`validateComposedModuleRegistry(registry)`/`composeModuleRegistry(registry)`/`buildComposedModuleInventory(registry)` menerima `readonly ModuleDescriptor[]`, bukan `{ base, application }`); check turunan-only (`prohibited_base_override`, `invalid_module_type`, `migration_namespace_overlap`) dan `mergeModuleRegistries` dihapus. Check base-load-bearing (DAG, duplicate module key, capability binding, deployment profile, navigation, job descriptor) dipertahankan. `MODULE_CONTRACT_VERSION` naik `1.3.0` → `2.0.0` (MAJOR: tipe diekspor dihapus); manifest keluarga disesuaikan.

Fixture `tests/fixtures/derived-application-example/` direlokasi jadi test-support non-derived `tests/fixtures/example-domain-modules/` (mengekspor `exampleDomainModules`) — cakupan test #178/#180/#181/#182 dipertahankan setara. Gate `modules:compose:check` + `modules:composition:inventory:check` tetap ada (validasi registry base); `docs/awcms/module-composition-inventory.json` diregenerasi. Tanpa migration.
