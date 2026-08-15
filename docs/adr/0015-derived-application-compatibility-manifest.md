🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0015-derived-application-compatibility-manifest.id.md)

# ADR-0015 — Derived-application compatibility manifest, test kit, and semantic-version gates

- **Status:** Superseded by [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (the derived compatibility manifest + `extension:check` were removed)
- **Date:** 2026-07-13
- **Decision makers:** @ahliweb
- **Related:** Issue #741 (epic #738 `platform-evolution`, Wave 1), Issue #739/ADR-0013, Issue #740/ADR-0014, ADR-0008, ADR-0011, ADR-0012, `docs/awcms/derived-application-guide.md`, `src/modules/_shared/module-contract.ts`, `src/modules/_shared/extension-manifest-contract.ts`, `src/modules/module-management/domain/extension-compatibility.ts`, `scripts/extension-check.ts`

## Context

ADR-0014 (Issue #740) settled HOW a derived repo composes its own application modules into a final registry without editing the base `src/modules/index.ts` — but it did not answer a different question: does that derived application STAY compatible once this base ships a new version. Without an explicit contract, a derived repo can silently drift on the module contract version, capability versions, migrations, the OpenAPI/AsyncAPI schema, and permission keys — only discovered when a real build/deploy fails, or worse, when it builds successfully but behaves wrongly in production.

Issue #741 explicitly builds ON TOP of the #740 mechanism (the real `module-composition.ts`/`application-registry.ts` code was read before this ADR was designed), not as a replacement. `composeModuleRegistry()` remains the only engine that validates that the modules a derived repo contributes form a valid TypeScript registry (key/DAG/capability-binding/migration-namespace/deployment-profile) — this ADR adds a DIFFERENT, complementary layer: whether the COMPATIBILITY manifest a derived repo publishes itself (a static JSON/YAML document, not TypeScript) is internally consistent AND still compatible with the base release that is actually being run.

**The mandatory lesson from PR #769/#770 (the same wave) that explicitly shaped this ADR's design**: PR #769 (Issue #740) at one point shipped a validator that was correct and passed unit tests (`validateComposedModuleRegistry`) but was NEVER CALLED on the real database write path — it was only called by a standalone CI script (fixed within the same PR, visible today in `descriptor-sync.ts` and `production-preflight.ts`). PR #770 (Issue #743) shipped a new `bun run X:check` that was correctly added to `package.json`'s `check` composite BUT was NEVER added to `.github/workflows/ci.yml`'s `quality` job (a manual list of steps, not simply `bun run check`) — so that check silently never ran in CI even though it looked "wired up". Issue #741 is explicitly flagged as the class of work MOST likely to repeat this bug (adding yet another NEW validation command) — see §6 below for concrete proof that this ADR does NOT repeat it.

## Decision

### 1. The manifest schema — six independent versioning schemes, not one

Extending the ADR-0008 precedent (three independent versioning schemes: package release, REST/event contract, module descriptor) — Issue #741 adds THREE new schemes, each with its own bump rules (MAJOR breaking / MINOR additive-backward-compatible / PATCH documentation):

1. **`MODULE_CONTRACT_VERSION`** (`_shared/module-contract.ts`, `"1.0.0"`) — the version of the `ModuleDescriptor`/`ApplicationModuleRegistry` shape itself.
2. **`CAPABILITY_CONTRACT_VERSIONS`** (`_shared/capability-contract-versions.ts`) — one SemVer PER capability key (`news_media`, `public_content`, `social_publishing`, all `"1.0.0"` today), bumped only when that capability's port interface shape (`_shared/ports/*.ts`) changes.
3. **`EXTENSION_MANIFEST_SCHEMA_VERSION`** (`_shared/extension-manifest-contract.ts`, `"1.0.0"`) — the version of the compatibility manifest schema shape itself.

Mandatory manifest fields (`ExtensionCompatibilityManifest`, `_shared/extension-manifest-contract.ts` = the canonical source of truth, this block is a summary): `manifestVersion`, `application.{key,version,name?}`, `compatibleAwcmsRange` (a SemVer range against the base `package.json`), `moduleContractVersion`, `contributedModules[].{key,minVersion?,deploymentProfiles?}`, `migrations.{namespace,historicalChecksums[]}`, `capabilities?.{provides?,requires?}`, `deployment.requiredProfiles`, `consumes?.{openApiContractVersion?,asyncApiContractVersion?}`.

### 2. SemVer ranges without a new dependency

`src/lib/semver/compare.ts` — a hand-written SemVer subset (parse/compare/AND-composed ranges: `>=`,`<=`,`>`,`<`,`^`,`~`,exact), NOT a full SemVer 2.0.0 implementation (no pre-release tags, no `||` OR, no `x`/`*` wildcards). There is no `semver` package (or anything like it) in any `package.json` — adding one for a small number of comparisons is a new third-party dependency for logic that is genuinely small; a narrow, explicitly documented hand-written subset is cheaper and sufficient for the real need here.

### 3. Two layers COMBINED into a single report, not duplicated

`evaluateExtensionCompatibility()` (`module-management/domain/extension-compatibility.ts`) calls TWO separate things and then merges the results:

- **`composeModuleRegistry()`** (Issue #740, reused AS IS, not duplicated) — against the REAL TypeScript registry (base + the derived repo's `application-registry.ts`). It always runs, with or without a manifest — it is meaningful on its own (the same as standalone `bun run modules:compose:check`).
- **`evaluateExtensionManifest()`** (new, Issue #741) — against the JSON/YAML manifest document. It only runs when a manifest is found.

The manifest does NOT repeat the checks `composeModuleRegistry` already performs (duplicate module key/prohibited base override/capability provider conflict at the real TypeScript level) — the manifest purely validates a DIFFERENT layer: whether that declarative document is itself consistent and compatible with the facts of the current base release (versions/contracts/checksums), not recomposing the registry.

### 4. Two-path capability version resolution

`capabilities.requires[].key` is resolved through TWO sequential paths, not one single global registry:

1. **Base-provided** — checked against the global `CAPABILITY_CONTRACT_VERSIONS` (capabilities the BASE provides).
2. **Self-provided** — if not found in (1), checked against the manifest's OWN `capabilities.provides` list (a derived repo module that consumes a capability of ANOTHER module of its own).
3. Found in neither → `capability_unknown`.

This deliberately does NOT re-inject the derived repo's actual TypeScript registry (which would require a dynamic import from a CLI-flag-configurable path — a pattern that is dangerous/ambiguous with respect to the runtime-loading prohibition of doc 21 §7) — the manifest is self-contained enough to check on its own, WITHOUT needing to compile any TypeScript. The consequence: the manifest does NOT verify that its own `capabilities.provides` CORRECTLY reflects the derived repo's actual `ModuleCapabilityContract.provides` TypeScript — that is the manifest author's manual review responsibility (recorded explicitly as a limit, §7).

**The version check still runs for `optional: true` entries** — deliberately different from `composeModuleRegistry`'s own `capability_provider_missing` (which skips `optional` entirely, per the ADR-0011 "the consumer degrades safely" philosophy). The reason: `capability_provider_missing` is about STRUCTURAL ABSENCE (no provider registered for this tenant — a per-tenant runtime condition); a VERSION mismatch is a different risk — the consumer's code is already compiled against the port shape it assumes, and a breaking change to that shape can still throw for the tenants where the capability DOES resolve, regardless of whether the feature is optional. See the `checkCapabilities` code comment (`extension-compatibility.ts`) for the full explanation.

### 5. Migration immutability — reuse the hashing primitive, NOT the naming convention

`scripts/extension-check.ts`'s `discoverMigrationChecksums` reuses exactly `computeMigrationChecksum`/`stripOptionalTransactionWrapper` from `scripts/db-migrate.ts` (a checksum byte-identical to what `bun run db:migrate` computes for the same file contents) — BUT DELIBERATELY DOES NOT reuse its `discoverMigrationFiles`, whose `MIGRATION_FILE_PATTERN` hardcodes the `_awcms_` infix (correct for this base's `sql/`, wrong for a derived repo's migrations named otherwise, e.g. `900_awpos_sales_schema.sql`). The file pattern used here is only `/^\d+_.*\.sql$/` — permissive enough for both repos.

Two concrete "ordering" rules (`checkMigrations`, `extension-compatibility.ts`): (1) every `historicalChecksums` entry must be numbered within the declared `migrations.namespace`; (2) a NEW file (absent from `historicalChecksums`) found on disk must not be numbered ≤ the highest historical migration number — preventing a new migration from being "inserted before" one that has already shipped. A changed checksum for a file that IS ALREADY in `historicalChecksums` (`migration_checksum_changed`) is this issue's headline check: a derived repo cannot silently redefine a migration that has already shipped.

### 6. Wiring — the PR #769/#770 lesson applied explicitly (not repeated)

Three real places, not one standalone script:

1. **`package.json`'s `check` composite** — `extension:check` added.
2. **`.github/workflows/ci.yml`'s `quality` job** — a step explicitly named `Extension compatibility manifest check` added DIRECTLY in this file (not assumed to follow automatically from `bun run check`) — that file itself already carries a comment that its step list is a manual mirror of `package.json`'s `check`, prone to exactly the drift that happened in PR #770/Issue #743.
3. **`scripts/production-preflight.ts`'s `REMAINING_CHILD_PROCESS_STAGES`** — added right after `modules:compose:check`, for the EXACT SAME reason PR #769 already documented there for `modules:compose:check` itself: a derived repo's production deployment is the most real scenario in which a compatibility manifest can be invalid, and a preflight that never checks it would go live having never verified it.

`release.yml`'s `validate` job runs `bun run check` verbatim (not a manual step list) — so it is covered automatically through (1), no separate edit needed there.

An explicit adversarial test (`tests/unit/extension-check-fixtures.test.ts`) spawns `bun run scripts/extension-check.ts` as a REAL child process against nine fixtures (one compatible + eight incompatible), verifying the exit code + messages — NOT merely calling the validator function directly (`tests/unit/extension-compatibility.test.ts` already does that exhaustively per issue type) — exactly the process that should have been followed for PR #769/#770 and was not.

### 7. Limits this mechanism DELIBERATELY does not answer

- **It does not verify that the manifest reflects the derived repo's actual TypeScript** (§4) — purely self-consistency + base release facts, not a dynamic-import cross-check.
- **It does not forbid a "direct base-registry edit" at the file byte-diff level** — the realistic mechanism that is enforced is `prohibited_base_override` (`composeModuleRegistry`, at the KEY collision level), not hashing the entire base source file against a release baseline (not requested by the acceptance criteria, and it would become a separate source-integrity system far larger than this issue's scope).
- **It does not read a derived repo's `sql/*.sql` ACROSS processes/repos** — `scripts/extension-check.ts` only reads the directory given by `--migrations-dir` on the LOCAL checkout being run (the ADR-0013/0014 fork/vendor model — there is no cross-repo network mechanism here).
- **The manifest is entirely optional for this base repo itself** — `bun run extension:check` without a manifest committed at the root always passes trivially (the same as `applicationModuleRegistry === undefined`), so the default base build is never affected.

## Consequences

- **Positive:** a derived repo gets one command (`bun run extension:check`) that runs identically in this base repo and in any derived repo (the same fork/vendor carries the script + every file it imports) — no SaaS, no network, no separate package to install.
- **Positive:** eight incompatible fixtures (exceeding the acceptance criteria's minimum of five) each fail for a genuinely different reason, proven mechanically (`tests/unit/extension-check-fixtures.test.ts`'s "eight distinct issue-type sets" test) — not claimed manually.
- **Positive:** the CI/preflight wiring mirrors EXACTLY the pattern already proven correct for `modules:compose:check` (Issue #740/PR #769's own follow-up), not a new untested pattern.
- **Negative/trade-off:** six independent versioning schemes (three from ADR-0008 + three from this ADR) is a policy surface a new module author must understand — documented explicitly in the doc comments of `module-contract.ts`/`capability-contract-versions.ts`/`extension-manifest-contract.ts` respectively to reduce that risk.
- **Negative/trade-off:** `src/lib/semver/compare.ts` is a NARROW SemVer subset (with explicit documentation of what is NOT supported: pre-release tags, `||`, wildcards) — enough for this repo's needs today, but manifest authors must know this limit rather than assuming full `node-semver` compatibility.
- **Neutral:** it does not change the existing `ModuleDescriptor`/`ApplicationModuleRegistry` shape (`MODULE_CONTRACT_VERSION` is purely a new constant added), and does not change `composeModuleRegistry`/`validateComposedModuleRegistry` (Issue #740) at all — purely a new layer that CALLS both, rather than editing them.

## Alternatives considered

- **Add `semver` (or a similar package) as a dependency** — rejected: one new third-party package for a comparison need that is genuinely small and already well served by a documented hand-written subset; AGENTS.md rule 14/ADR-0002 also assert the Bun-only minimal-dependency preference.
- **Have the manifest validate itself against the real TypeScript registry via a dynamic import path from a CLI flag** — explicitly rejected: even though it is technically not tenant-controlled input, the "resolve a path then `import()`" pattern is too close in shape to what doc 21 §7/ADR-0012 §3 forbid, and adds a disproportionate surface for a small benefit (§4 documents why a self-consistency check is enough).
- **A single flat global capability version registry WITHOUT the self-provided path** — rejected: it would force EVERY capability contributed by a derived application's modules (which the base knows nothing about) to be registered in the base registry, contradicting the "a derived repo edits nothing owned by the base" principle that ADR-0014 guards in exactly the same way.
- **Skip the version check for `capabilities.requires` entries that are `optional: true`** (copying the `capability_provider_missing` pattern as is) — rejected: explained in §4/the code — structural absence (per-tenant runtime) and a version mismatch (a compile-time/shape risk) are two different risk classes; copying that pattern would hide a real version risk.
- **Run `extension:check` only as a standalone CI script, without wiring it into `production-preflight.ts`** — explicitly rejected: this is EXACTLY the PR #769/#770 failure class this issue's instructions ask to avoid; production deployment is the most real place where an invalid manifest must be blocked.
