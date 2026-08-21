/**
 * site-search-sources-check.ts — `bun run site-search:sources:check`.
 *
 * ADR-0040 §3 (ported from awcms-micro Issue #270). Search-source registry
 * validation gate — same shape as `scripts/data-lifecycle-registry-check.ts` and
 * `scripts/reporting-projection-registry-check.ts`: pure code-registry
 * (`listModules()`) validation, no network, no database, safe to run on every CI
 * build.
 *
 * This gate is load-bearing beyond tidiness: `site_search`'s generic extraction
 * engine interpolates a descriptor's table/column NAMES into SQL, so an invalid
 * identifier must be caught here — before any SQL is ever built.
 *
 * ## Second phase: the reconcile job must be ALLOWED to read what it names
 *
 * Issue #625. `bun run site-search:reconcile` runs as `awcms_worker` and issues
 * one `SELECT` per descriptor against that descriptor's table. Phase one above
 * validates the descriptor's SHAPE and cannot see privileges at all, so a
 * perfectly-formed descriptor for a table the worker cannot read passes every
 * gate in this repository and then fails at 03:00 with `permission denied for
 * table <name>`, in a job nobody is watching.
 *
 * That is exactly the failure `data-lifecycle:worker-grants:check` was written
 * for on the retention side, so this reuses its scanner rather than restating a
 * list of tables that would need its own maintenance: the requirement is DERIVED
 * from the registry and checked against `sql/`.
 *
 * It reads migration TEXT, not a live database. So it proves the grant was
 * WRITTEN, not that it was APPLIED — an unapplied migration is `db:migrate`'s
 * job, and a superuser `POSTGRES_USER` making the point moot is
 * `security:readiness`'s.
 */
import path from "node:path";

import { listModules } from "../src/modules";
import {
  formatSearchSourceRegistryIssue,
  validateSearchSourceRegistry
} from "../src/modules/site-search/domain/search-source-registry";
import { grantsPrivilegeToRole, loadMigrations } from "./sql-grants";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKER_ROLE = "awcms_worker";

export type MissingSourceGrant = {
  descriptorKey: string;
  tableName: string;
};

/**
 * Descriptors whose table the worker cannot `SELECT` according to `sql/`.
 *
 * SELECT is the only privilege derived, and that is not an under-check: the
 * index engine reads sources and writes exclusively to its own
 * `awcms_site_search_*` tables. Requiring more would be a gate loudly red about
 * work being done correctly, which is how a gate teaches people to ignore it.
 */
export function findMissingSourceGrants(
  descriptors: readonly { key: string; tableName: string }[],
  migrationSql: string
): MissingSourceGrant[] {
  return descriptors
    .filter(
      (descriptor) =>
        !grantsPrivilegeToRole(
          migrationSql,
          descriptor.tableName,
          "SELECT",
          WORKER_ROLE
        )
    )
    .map((descriptor) => ({
      descriptorKey: descriptor.key,
      tableName: descriptor.tableName
    }))
    .sort((a, b) => a.tableName.localeCompare(b.tableName));
}

function loadMigrationText(): string {
  return loadMigrations(path.join(ROOT, "sql"))
    .map((migration) => migration.sql)
    .join("\n");
}

function main(): void {
  const result = validateSearchSourceRegistry(listModules());

  if (!result.valid) {
    console.error("site-search:sources:check FAILED —");
    for (const issue of result.issues) {
      console.error(`  ${formatSearchSourceRegistryIssue(issue)}`);
    }
    process.exitCode = 1;
    return;
  }

  const missing = findMissingSourceGrants(
    result.descriptors,
    loadMigrationText()
  );

  if (missing.length > 0) {
    console.error(
      `site-search:sources:check FAILED — ${missing.length} descriptor(s) name a table ${WORKER_ROLE} cannot read:`
    );
    for (const entry of missing) {
      console.error(
        `  - ${entry.descriptorKey} — no GRANT SELECT ON ${entry.tableName} TO ${WORKER_ROLE} in sql/`
      );
    }
    console.error(
      "\n  `site-search:reconcile` runs as that role and will fail with\n" +
        "  `permission denied for table <name>`. A descriptor the indexer cannot\n" +
        "  read is not a search source — it is a claim. Add the GRANT in a new\n" +
        "  `sql/NNN` migration."
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `site-search:sources:check OK — ${result.descriptors.length} registered search-source descriptor(s) are valid, and ${WORKER_ROLE} can SELECT every table they name.`
  );
}

if (import.meta.main) {
  main();
}
