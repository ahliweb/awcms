🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0025-implement-deterministic-build-time-module-composition.id.md)

# ADR-0025 — The actual implementation of deterministic build-time module composition in awcms (addendum to ADR-0014)

- **Status:** Accepted (the derived-application composition pathway is superseded by [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md); the base registry composition implementation still stands)
- **Date:** 2026-07-19
- **Decision makers:** @ahliweb
- **Related:** Issue #178 (epic #177 "Derived ERP foundation readiness", Wave 1), ADR-0014 (design, referencing awcms-mini #740), ADR-0013 (extension boundary), ADR-0011 (capability ports), ADR-0023 (bilingual docs), `docs/awcms/derived-application-guide.md`, `src/modules/_shared/module-dependency-graph.ts`, `src/modules/module-management/domain/job-registry.ts`, `src/modules/module-management/domain/module-composition.ts`, `src/modules/application-registry.ts`, `src/modules/index.ts`

## Context

ADR-0014 (accepted, 2026-07-13) already documented the **design** of deterministic build-time module composition, but was written against the awcms-mini layout (Issue #740). Up to Issue #178, awcms had not actually implemented it: `src/modules/index.ts` was still a direct array of base modules (`modules: ModuleDescriptor[]`) with no `applicationModuleRegistry` + `mergeModuleRegistries` seam, `ModuleDescriptor` did not model `capabilities`/`compatibility.deploymentProfiles`, and the types `ApplicationModuleRegistry`/`ModuleMigrationNamespace` did not exist. Several artefacts were already "ahead-of-code": `docs/awcms/derived-application-guide.md`, `scripts/README.md`, and `src/modules/_shared/capability-contract-versions.ts` referred to this mechanism as if it were already done.

This addendum records the **actual implementation** decisions in awcms and reconciles the layout differences with ADR-0014 (which remains valid as the design document). The ADR-0013 §5/§9 guardrails and the doc admission rule remain binding: the base registry is the single source of reviewed modules; a derived repo contributes modules WITHOUT editing `src/modules/index.ts`; composition is 100% compile-time TypeScript (no runtime discovery/`eval`/file scanning).

## Decision

### 1. The awcms vs awcms-mini layout difference: the engine lives in `module-management/domain/`

ADR-0014 §"Alternatives" rejected putting the validation engine in `_shared/` because it would invert the dependency direction. awcms keeps the same decision, BUT for a layout reason specific to awcms:

- The awcms DAG validator (`validateModuleDependencyGraph`) lives in **`src/modules/_shared/module-dependency-graph.ts`** (different from mini, which puts it in `module-management/domain/`).
- The job validator (`validateJobDescriptor`) lives in **`src/modules/module-management/domain/job-registry.ts`**.

The composition engine (`module-composition.ts`) reuses BOTH. Putting it in `module-management/domain/module-composition.ts` makes every import point down the dependency arrow: importing `../../_shared/module-dependency-graph` (a module may depend on `_shared`) and importing its sibling `./job-registry` (in the same folder). Putting it in `_shared/` would instead force `_shared/` to import from `module-management/domain/` (`job-registry.ts`) — inverting the kernel-vs-module direction, because `_shared/module-contract.ts` is deliberately dependency-free and every module depends ON `_shared`, not the other way round. The `module-management/domain/` placement also matches the path already named in ADR-0014 §1 and the ghost reference in `scripts/README.md`.

Note: the Issue #178 task brief did suggest `_shared/` because the DAG lives there — but the job validator that is also reused lives in `module-management/domain/`, so that folder is the one that keeps BOTH reuses clean.

### 2. Purely additive extension of `ModuleDescriptor` (`MODULE_CONTRACT_VERSION` 1.1.0 → 1.2.0)

Added purely additively (MINOR, no old field removed or retyped):

- `ModuleCapabilityContract` (`provides`/`consumes`) + the optional field `ModuleDescriptor.capabilities` (ADR-0011). This makes the previously dangling reference in `capability-contract-versions.ts` coherent.
- `ModuleDeploymentProfile` + `ModuleCompatibilityContract.deploymentProfiles`.
- `ModuleMigrationNamespace` and `ApplicationModuleRegistry` (`{ id, modules, migrationNamespace? }`).

`ModuleType` did **not** gain a `"derived"` value (unlike mini): the DB CHECK constraint `awcms_modules_module_type_check` (`sql/008`) only allows `base/system/domain/integration`, and Issue #178 must not add a migration. Derived modules use `"domain"`/`"integration"`. `invalid_module_type` still rejects `"base"`/`"system"` coming from an application registry.

### 3. Two phases: merge (always succeeds) vs validate (can fail)

`mergeModuleRegistries(base, application)` is pure concatenation (`[...base, ...application.modules]`, order preserved) and is the only thing `src/modules/index.ts` calls — `index.ts` stays pure data and never throws at load. Because this base repo ships `applicationModuleRegistry = undefined`, `modules` is a byte-identical pass-through of `baseModules` (same order + same object identity) — proven by `tests/module-composition.test.ts` ("listModules() equals listBaseModules()"). `listModules()` still returns one stable module-level array reference (relied on by `descriptor-sync.ts`'s `descriptors === listModules()`). Validation (`validateComposedModuleRegistry`/`composeModuleRegistry`) is always a separate explicit step called by scripts/tests.

### 4. The composition failure taxonomy

Four are reused from the DAG validator (`self_dependency`, `duplicate_dependency`, `missing_dependency`, `cycle`) plus new ones: `duplicate_module_key`, `prohibited_base_override` (ANY base collision, stricter than "Core/System only" because `type` is not filled in consistently), `invalid_module_type`, `capability_provider_conflict`, `capability_provider_missing` (only for REQUIRED consumes; `optional: true` is never checked), `migration_namespace_overlap` (comparing DECLARED ranges, without reading `sql/*.sql`), `deployment_profile_incompatible`, `navigation_path_conflict`, `invalid_job_descriptor` (reusing `validateJobDescriptor`). All are reported in a single pass (it does not stop at the first finding), with actionable messages.

`BASE_MODULE_MIGRATION_NAMESPACE` reserves `1-899` for base; derived repos start at `900`.

### 5. Four new gates, wired into `bun run check` and CI

- `bun run modules:compose:check` (`scripts/validate-module-composition.ts`) — composition validation.
- `bun run modules:composition:inventory:generate` (`scripts/module-composition-inventory-generate.ts`) — generates `docs/awcms/module-composition-inventory.json` (deterministic, sorted by `key`, with no wall-clock timestamp).
- `bun run modules:composition:inventory:check` (`scripts/module-composition-inventory-check.ts`) — the regenerate-and-diff gate (mutations must not enter `check`).
- `bun run extension:check` (`scripts/extension-check.ts`) — extension seam health: the effective registry composes validly, and in base mode is identical to base.

Added to the `check` script in `package.json` AND as explicit steps in `.github/workflows/ci.yml` (parity — a repo invariant). `.github/workflows/release.yml` runs `bun run check` verbatim, so it is covered automatically.

### 6. The scope of extension:check vs the compatibility manifest (#183)

`extension:check` in Issue #178 validates the **extension seam/composition** only. The full compatibility manifest mechanism (base SemVer ranges, historical migration checksums, capability versions — ADR-0015) is a separate concern in **Issue #183** (epic #177 Wave 1) and is NOT YET implemented. When #183 lands, it can extend the same script/command without changing the seam established by #178.

## Consequences

- **Positive:** A derived repo no longer needs to edit the base `src/modules/index.ts`/`module.ts` — there is one integration point (`application-registry.ts`). The default base build is unchanged (proven by test). The migration namespace convention prevents one class of numbering collision at compose-time.
- **Neutral:** No SQL migration is added (composition is purely at the level of in-memory TypeScript descriptors), no endpoint/event is added, and no base module is reclassified or moved (10 base modules, order unchanged).
- **Negative/trade-off:** It grows the contract surface of `_shared/module-contract.ts` (capabilities/deploymentProfiles/ApplicationModuleRegistry) that derived module authors must understand. Cross-repo "no shared-table write" enforcement (ADR-0013 §6) is STILL not automated — composition validates at the descriptor level, not at real table access.
- **Reconciliation:** ADR-0014 remains valid as the design document; the path references inside it that follow the mini layout (`module-management/domain/module-dependency-graph.ts`) are corrected by this addendum for awcms (`_shared/module-dependency-graph.ts`), WITHOUT editing ADR-0014 in place.

## Alternatives considered

- **Putting the engine in `_shared/`** (the brief's initial suggestion) — rejected: it inverts the dependency direction because `job-registry` (which is reused) lives in `module-management/domain/`; see §1.
- **Adding `"derived"` to `ModuleType`** — rejected: it collides with the DB CHECK constraint in `sql/008` and Issue #178 must not add a migration; §2.
- **Implementing the full compatibility manifest at the same time** — rejected: that is the scope of Issue #183/ADR-0015; §6.
- **Editing ADR-0014 in place to correct the paths** — rejected: an ADR is an accepted historical record; correcting it through an addendum (ADR-0025) is more honest and auditable.
