/**
 * comments-resources-check.ts — `bun run comments:resources:check`.
 *
 * ADR-0041 §3 (ported from awcms-micro Issue #271). Commentable-resource
 * registry validation gate — same shape as
 * `scripts/site-search-sources-check.ts`,
 * `scripts/data-lifecycle-registry-check.ts`, and
 * `scripts/reporting-projection-registry-check.ts`: pure code-registry
 * (`listModules()`) validation, no I/O, no network, no database, safe to run on
 * every CI build.
 *
 * This gate is load-bearing beyond tidiness. `comments`'s resolution engine
 * interpolates a descriptor's table and column NAMES into the publication-check
 * SQL, so an invalid identifier must be caught HERE, before any SQL is built.
 * It also enforces that a descriptor's `publicationFilter` is present — a
 * descriptor with no filter would make every row of the source table look
 * public, which is precisely the draft-leakage the filter exists to prevent.
 */
import { listModules } from "../src/modules";
import {
  formatCommentableResourceRegistryIssue,
  validateCommentableResourceRegistry
} from "../src/modules/comments/domain/commentable-resource-registry";

function main(): void {
  const result = validateCommentableResourceRegistry(listModules());

  if (result.valid) {
    console.log(
      `comments:resources:check OK — ${result.descriptors.length} registered commentable-resource descriptor(s) are valid.`
    );
    return;
  }

  console.error("comments:resources:check FAILED —");
  for (const issue of result.issues) {
    console.error(`  ${formatCommentableResourceRegistryIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
