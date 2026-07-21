/**
 * validate-module-composition.ts — `bun run modules:compose:check`.
 *
 * Validates the reviewed base module registry (`listBaseModules()`) and fails
 * loud with actionable diagnostics if it is invalid: duplicate module keys, a
 * broken lifecycle dependency DAG (self-dependency/duplicate/missing/cycle —
 * the same whole-registry check `bun run modules:dag:check` runs, a strict
 * subset of what this script validates), missing/conflicting capability
 * provider bindings, an incompatible deployment-profile claim, a navigation
 * path conflict, or an invalid job descriptor.
 *
 * No I/O, no network, no database — pure code-registry validation, same shape
 * as `scripts/validate-module-graph.ts`, safe to run on every CI build.
 * (ADR-0034 §3 removed the derived-application composition surface; this gate
 * now validates the base registry alone.)
 */
import { listBaseModules } from "../src/modules";
import {
  composeModuleRegistry,
  formatModuleCompositionIssue
} from "../src/modules/module-management/domain/module-composition";

function main(): void {
  const result = composeModuleRegistry(listBaseModules());

  if (result.valid) {
    console.log(
      `modules:compose:check OK — ${result.registry.length} modules validated.`
    );
    return;
  }

  console.error("modules:compose:check GAGAL —");
  for (const issue of result.issues) {
    console.error(`  ${formatModuleCompositionIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
