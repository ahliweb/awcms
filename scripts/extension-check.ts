/**
 * extension-check.ts — `bun run extension:check`.
 *
 * Issue #178 (epic #177 "Kesiapan fondasi ERP turunan", Wave 1, ADR-0025).
 * Gate that verifies the build-time EXTENSION SEAM is healthy — the single
 * point (`src/modules/application-registry.ts`) through which a derived
 * repository contributes its own modules. Runs identically in this base
 * repository AND in a derived repository that has vendored/forked it (this
 * script ships as part of that fork, unmodified).
 *
 * What it checks:
 *  1. The effective composed registry (base + `applicationModuleRegistry`)
 *     is VALID — delegates to `composeModuleRegistry`, so every composition
 *     issue class (duplicate key, prohibited base override, missing/cyclic
 *     dependency, capability conflict/missing, migration-namespace overlap,
 *     invalid module type, deployment-profile incompatibility, navigation
 *     conflict, invalid job) fails this gate with an actionable message.
 *  2. In BASE mode (no application registry) the effective registry is
 *     identical to the base registry (the "a default base build produces the
 *     same effective registry as before Issue #178" invariant) — a cheap
 *     structural double-check that the seam has not accidentally been wired
 *     to mutate the base.
 *  3. In DERIVED mode (an application registry IS present) it additionally
 *     confirms the contributed registry declares a non-empty `id` and at
 *     least one module (a well-formed contribution), and echoes the migration
 *     namespace reservation for release evidence.
 *
 * Security boundary: no network, no package download, no dynamic `import()`
 * of a runtime-supplied path, no `eval`/`Function()`. Everything is resolved
 * as ordinary compile-time TypeScript imports of reviewed source.
 *
 * SCOPE NOTE: the FULL derived-application compatibility manifest mechanism
 * (SemVer-range/module-contract/capability-version/migration-checksum
 * validation against a published `extension.manifest.json`, ADR-0015) is a
 * SEPARATE concern tracked by epic #177's Wave-1 issue #183 and is NOT
 * implemented here — this gate validates the composition SEAM only. When
 * #183 lands it can extend this same script/command without changing the
 * seam this issue establishes.
 */
import { listBaseModules } from "../src/modules";
import { applicationModuleRegistry } from "../src/modules/application-registry";
import {
  composeModuleRegistry,
  formatModuleCompositionIssue,
  mergeModuleRegistries
} from "../src/modules/module-management/domain/module-composition";

function main(): void {
  const base = listBaseModules();
  const problems: string[] = [];

  const result = composeModuleRegistry({
    base,
    application: applicationModuleRegistry
  });

  if (!result.valid) {
    for (const issue of result.issues) {
      problems.push(formatModuleCompositionIssue(issue));
    }
  }

  if (!applicationModuleRegistry) {
    // Base-mode identity invariant: merging with nothing must be a pure
    // pass-through, same length and same object references in the same order.
    const effective = mergeModuleRegistries(base, undefined);
    const identical =
      effective.length === base.length &&
      effective.every((module, index) => module === base[index]);
    if (!identical) {
      problems.push(
        "Extension seam invariant broken: with no application registry, the effective registry must be identical (same order + object identity) to the base registry."
      );
    }
  } else {
    if (applicationModuleRegistry.id.trim().length === 0) {
      problems.push(
        "Application registry declares an empty `id` — a stable, non-empty identifier is required for diagnostics and the composed inventory."
      );
    }
    if (applicationModuleRegistry.modules.length === 0) {
      problems.push(
        `Application registry "${applicationModuleRegistry.id}" contributes no modules — remove the registry (ship \`undefined\`) or add at least one module.`
      );
    }
  }

  if (problems.length > 0) {
    console.error("extension:check GAGAL —");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!applicationModuleRegistry) {
    console.log(
      `extension:check OK — base extension seam healthy: ${base.length} base modules, no application registry (default base build).`
    );
    return;
  }

  const ns = applicationModuleRegistry.migrationNamespace;
  const nsSummary = ns
    ? `, migration namespace "${ns.label}" (${ns.rangeStart}-${ns.rangeEnd})`
    : ", no migration namespace declared";
  console.log(
    `extension:check OK — application registry "${applicationModuleRegistry.id}" contributes ${applicationModuleRegistry.modules.length} module(s)${nsSummary}; composed registry valid (${result.registry.length} total).`
  );
}

if (import.meta.main) {
  main();
}
