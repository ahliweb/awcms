/**
 * site-search-sources-check.ts — `bun run site-search:sources:check`.
 *
 * ADR-0040 §3 (ported from awcms-micro Issue #270). Search-source registry
 * validation gate — same shape as `scripts/data-lifecycle-registry-check.ts` and
 * `scripts/reporting-projection-registry-check.ts`: pure code-registry
 * (`listModules()`) validation, no I/O, no network, no database, safe to run on
 * every CI build.
 *
 * This gate is load-bearing beyond tidiness: `site_search`'s generic extraction
 * engine interpolates a descriptor's table/column NAMES into SQL, so an invalid
 * identifier must be caught here — before any SQL is ever built.
 */
import { listModules } from "../src/modules";
import {
  formatSearchSourceRegistryIssue,
  validateSearchSourceRegistry
} from "../src/modules/site-search/domain/search-source-registry";

function main(): void {
  const result = validateSearchSourceRegistry(listModules());

  if (result.valid) {
    console.log(
      `site-search:sources:check OK — ${result.descriptors.length} registered search-source descriptor(s) are valid.`
    );
    return;
  }

  console.error("site-search:sources:check FAILED —");
  for (const issue of result.issues) {
    console.error(`  ${formatSearchSourceRegistryIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
