/**
 * data-lifecycle-registry-check.ts — `bun run data-lifecycle:registry:check`.
 *
 * ADR-0037 (ported from awcms-micro Issue #745). High-volume table registry
 * validation gate — same shape as `scripts/validate-module-graph.ts` (`bun run
 * modules:dag:check`) and `scripts/identity-access-sod-registry-check.ts`: pure
 * code-registry (`listModules()`) validation, no I/O, no network, no database,
 * safe to run on every CI build.
 */
import { listModules } from "../src/modules";
import {
  formatLifecycleRegistryIssue,
  validateLifecycleRegistry
} from "../src/modules/data-lifecycle/domain/lifecycle-registry";

function main(): void {
  const result = validateLifecycleRegistry(listModules());

  if (result.valid) {
    console.log(
      `data-lifecycle:registry:check OK — ${result.descriptors.length} registered high-volume table descriptor(s) are valid.`
    );
    return;
  }

  console.error("data-lifecycle:registry:check FAILED —");
  for (const issue of result.issues) {
    console.error(`  ${formatLifecycleRegistryIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
