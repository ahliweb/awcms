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
  PAYROLL_READ_FUNCTION_IMPORTS,
  PAYROLL_TABLE_SOURCE_EXEMPTIONS,
  SENSITIVE_READ_MODULE_KEYS,
  SENSITIVE_READ_POLICIES
} from "../src/modules/_shared/sensitive-reads";
import { REPO_ROOT, listFilesRecursive } from "./lib/repo-files";

/**
 * Roots the gate reads (Issue #1077, M7). `scripts/` is in: an operator script
 * that reads a payroll table is as much a read path as a route, and was
 * invisible while only `src/` was scanned. `tests/` is out on purpose (probes
 * and fixtures name payroll tables by design and run no production code).
 */
export const SENSITIVE_READ_SCAN_ROOTS: readonly string[] = ["src", "scripts"];

export function collectSensitiveReadSources(): {
  files: string[];
  sources: string[];
} {
  const files = SENSITIVE_READ_SCAN_ROOTS.flatMap((root) =>
    listFilesRecursive(root, {
      extensions: [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".astro"
      ],
      relativeTo: REPO_ROOT
    })
  );

  return {
    files,
    sources: files.map((file) => readFileSync(`${REPO_ROOT}/${file}`, "utf8"))
  };
}

function main(): void {
  const { files, sources } = collectSensitiveReadSources();
  const result = evaluateSensitiveReadCoverage(listModules(), sources, files);

  for (const path of Object.keys(PAYROLL_TABLE_SOURCE_EXEMPTIONS)) {
    if (!existsSync(`${REPO_ROOT}/${path}`)) {
      result.staleSourceExemptions.push(path);
      result.valid = false;
    }
  }

  for (const path of PAYROLL_READ_FUNCTION_IMPORTS.flatMap(
    (entry) => entry.allowedImporters
  )) {
    if (!existsSync(`${REPO_ROOT}/${path}`)) {
      result.staleImportAllowances.push(path);
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

  for (const reader of result.uncoveredTableReaders) {
    for (const table of reader.tables) {
      const needs = reader.needs[table] ?? [];

      console.error(
        `  ${reader.source} - names ${table} and audits, but no recordSensitiveRead in it covers that table (Issue #1015: attribution is per table). ${
          needs.length > 0
            ? `Call recordSensitiveRead for ${needs.join(" or ")} (or an export/download audit of the same module).`
            : "No audit call can stand for this table: add it to PAYROLL_TABLE_READ_PERMISSIONS with the permission that covers it, or list the file in PAYROLL_TABLE_SOURCE_EXEMPTIONS with the reason."
        }`
      );
    }
  }

  for (const entry of result.forbiddenReadImports) {
    console.error(`  ${entry.source} - ${entry.problem} (Issue #1015).`);
  }

  for (const path of result.staleImportAllowances) {
    console.error(
      `  ${path} - stale PAYROLL_READ_FUNCTION_IMPORTS allowedImporters entry: the file no longer imports the guarded read functions.`
    );
  }

  for (const path of result.staleSourceExemptions) {
    console.error(
      `  ${path} - stale PAYROLL_TABLE_SOURCE_EXEMPTIONS entry: the file no longer names a payroll-boundary table (or no longer exists).`
    );
  }

  for (const entry of result.swallowedAudits) {
    console.error(
      `  ${entry.source} - ${entry.problem} (Issue #1014 L6). The audit call must abort the transaction: await or return it, no .catch, and no try/catch that does not rethrow.`
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
