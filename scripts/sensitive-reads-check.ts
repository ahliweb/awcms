/**
 * sensitive-reads-check.ts - `bun run sensitive-reads:check`.
 *
 * Issue #978, finding PS-18 (a); `docs/awcms/hr-payroll.md` section 17.
 *
 * Fails when a read of sensitive data can exist without an audit row:
 *
 * - a route builds an `authorizeInTransaction` guard for a permission that
 *   `src/modules/_shared/sensitive-reads.ts` covers and its file does not call
 *   `recordSensitiveRead` for it;
 * - a sensitive module (`hr_payroll`) declares a read, list, export or download
 *   permission with no policy and no recorded exemption;
 * - a policy or exemption names a permission its module does not declare.
 *
 * Pure: the module registry and source text, no database, no network. Today no
 * module declares a payroll permission, so the gate reports the policy set and
 * zero guards; it starts refusing on the day the first `hr_payroll` route or
 * permission lands without the call, which is the point (see the acceptance
 * wording for #957 and #961 in hr-payroll.md PS-18).
 *
 * `src/modules/_shared/sensitive-read-coverage.ts` explains what a syntactic
 * check can and cannot prove.
 */
import { existsSync, readFileSync } from "node:fs";

import { listModules } from "../src/modules";
import { evaluateSensitiveReadCoverage } from "../src/modules/_shared/sensitive-read-coverage";
import {
  PAYROLL_TABLE_SOURCE_EXEMPTIONS,
  SENSITIVE_READ_MODULE_KEYS,
  SENSITIVE_READ_POLICIES
} from "../src/modules/_shared/sensitive-reads";
import { REPO_ROOT, listFilesRecursive } from "./lib/repo-files";

function main(): void {
  const files = listFilesRecursive("src", {
    extensions: [".ts", ".astro"],
    relativeTo: REPO_ROOT
  });
  const sources = files.map((file) =>
    readFileSync(`${REPO_ROOT}/${file}`, "utf8")
  );
  const result = evaluateSensitiveReadCoverage(listModules(), sources, files);

  for (const path of Object.keys(PAYROLL_TABLE_SOURCE_EXEMPTIONS)) {
    if (!existsSync(`${REPO_ROOT}/${path}`)) {
      result.staleSourceExemptions.push(path);
      result.valid = false;
    }
  }

  if (result.valid) {
    console.log(
      `sensitive-reads:check OK - ${SENSITIVE_READ_POLICIES.length} sensitive-read polic(ies) for ${SENSITIVE_READ_MODULE_KEYS.join(", ")}, ${result.coveredGuardCount} covered guard(s) found and each calls recordSensitiveRead.`
    );
    return;
  }

  console.error("sensitive-reads:check FAILED -");

  for (const problem of result.policyProblems) {
    console.error(`  policy: ${problem}`);
  }

  for (const route of result.unauditedRoutes) {
    console.error(
      `  ${route.source} - guards "${route.permission}" but never calls recordSensitiveRead({ permission: "${route.permission}", ... }). A read of that data would leave no audit row (PS-18). Call it on the same tx, after authorisation and before returning data.`
    );
  }

  for (const entry of result.computedGuards) {
    console.error(
      `  ${entry}. The gate cannot hold a guard it cannot read to the audit rule; write the guard as a literal object or a const the gate can resolve.`
    );
  }

  for (const reader of result.unauditedTableReaders) {
    console.error(
      `  ${reader.source} - names ${reader.tables.join(", ")} but never calls recordSensitiveRead and is not in PAYROLL_TABLE_SOURCE_EXEMPTIONS (src/modules/_shared/sensitive-reads.ts) with a reason.`
    );
  }

  for (const path of result.staleSourceExemptions) {
    console.error(
      `  ${path} - stale PAYROLL_TABLE_SOURCE_EXEMPTIONS entry: the file no longer names a payroll-boundary table (or no longer exists).`
    );
  }

  for (const key of result.unclassified) {
    console.error(
      `  ${key} - a read-shaped permission of a sensitive module with no policy. Add a policy to SENSITIVE_READ_POLICIES, or an entry with a reason to NOT_SENSITIVE_READS, in src/modules/_shared/sensitive-reads.ts.`
    );
  }

  for (const entry of result.deadEntries) {
    console.error(`  dead entry: ${entry}.`);
  }

  for (const key of result.conflictingExemptions) {
    console.error(
      `  ${key} - listed in NOT_SENSITIVE_READS and also covered by a policy. Remove one.`
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
