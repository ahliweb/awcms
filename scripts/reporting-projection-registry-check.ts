/**
 * reporting-projection-registry-check.ts — `bun run
 * reporting:projections:registry:check`.
 *
 * Issue #753 (epic #738 platform-evolution, Wave 3). Module-contributed
 * projection registry validation gate — same shape as `scripts/data-
 * lifecycle-registry-check.ts` (`bun run data-lifecycle:registry:check`,
 * Issue #745): pure code-registry (`listModules()`) validation, no I/O, no
 * network, no database, safe to run on every CI build.
 */
import { listModules } from "../src/modules";
import {
  formatProjectionRegistryIssue,
  validateProjectionRegistry
} from "../src/modules/reporting/domain/projection-registry";

function main(): void {
  const result = validateProjectionRegistry(listModules());

  if (result.valid) {
    console.log(
      `reporting:projections:registry:check OK — ${result.descriptors.length} registered projection descriptor(s) are valid.`
    );
    return;
  }

  console.error("reporting:projections:registry:check FAILED —");
  for (const issue of result.issues) {
    console.error(`  ${formatProjectionRegistryIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
