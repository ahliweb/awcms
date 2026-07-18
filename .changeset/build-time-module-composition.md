---
"awcms": minor
---

Deterministic build-time module composition seam for derived ERP applications
(Issue #178, epic #177, ADR-0025 — implementing the design in ADR-0014). A
derived repository can now contribute its own domain modules by editing only
`src/modules/application-registry.ts` (default `undefined` in the base), without
ever touching `src/modules/index.ts`. The base's effective `listModules()`
registry is byte-identical (same order + object identity) to before this change.

- `src/modules/index.ts` refactored to `baseModules` + `listBaseModules()` +
  `modules = mergeModuleRegistries(baseModules, applicationModuleRegistry)`;
  `listModules()`/`getModuleByKey()` behavior unchanged and the array reference
  stays stable (`descriptor-sync.ts` identity check preserved).
- `src/modules/module-management/domain/module-composition.ts` — the pure
  validation engine (`composeModuleRegistry`/`validateComposedModuleRegistry`/
  `buildComposedModuleInventory`), reusing the existing DAG validator
  (`_shared/module-dependency-graph.ts`) and job validator
  (`module-management/domain/job-registry.ts`). Rejects: duplicate module key,
  prohibited base override, `type: base/system` from an application module,
  missing/cyclic dependency, capability provider conflict/missing,
  migration-namespace overlap (base reserves `1-899`), deployment-profile
  incompatibility, navigation path conflict, and invalid job descriptor.
- `_shared/module-contract.ts` extended additively (`MODULE_CONTRACT_VERSION`
  1.1.0 → 1.2.0): `ModuleCapabilityContract`, `ModuleDescriptor.capabilities`,
  `ModuleCompatibilityContract.deploymentProfiles`, `ModuleMigrationNamespace`,
  and `ApplicationModuleRegistry`.
- New gates wired into `bun run check` AND `.github/workflows/ci.yml`:
  `modules:compose:check`, `modules:composition:inventory:generate`/`:check`
  (deterministic `docs/awcms/module-composition-inventory.json`, no wall-clock),
  and `extension:check` (extension-seam health).

No SQL migration, no API/event change. Full derived-application compatibility
manifest validation (SemVer/checksum, ADR-0015) remains scheduled for Issue
#183; `extension:check` currently validates the composition seam only.
