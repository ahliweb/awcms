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

import type { SearchSourceTermFacet } from "../src/modules/_shared/module-contract";
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
  descriptors: readonly {
    key: string;
    tableName: string;
    termFacets?: readonly SearchSourceTermFacet[];
  }[],
  migrationSql: string
): MissingSourceGrant[] {
  const missing: MissingSourceGrant[] = [];

  for (const descriptor of descriptors) {
    for (const tableName of collectDescriptorTables(descriptor)) {
      if (
        !grantsPrivilegeToRole(migrationSql, tableName, "SELECT", WORKER_ROLE)
      ) {
        missing.push({ descriptorKey: descriptor.key, tableName });
      }
    }
  }

  return missing.sort((a, b) => a.tableName.localeCompare(b.tableName));
}

/**
 * Every table the indexer will actually READ for one descriptor (Issue #633).
 *
 * The source table was the whole answer while a descriptor could only name one
 * table. A `kind: "join"` term facet names two more, and the indexer reads them
 * in the same statement — so a descriptor whose facet joins a table the worker
 * cannot SELECT is the #625 failure again, one layer deeper: green here, red at
 * 03:00.
 *
 * This is why the gate grows in the SAME change as the contract. A join added
 * later would otherwise be checked by nothing, and the person adding it would
 * have no reason to suspect there was a grant to add.
 */
export function collectDescriptorTables(descriptor: {
  tableName: string;
  termFacets?: readonly SearchSourceTermFacet[];
}): string[] {
  const tables = new Set<string>([descriptor.tableName]);

  for (const facet of descriptor.termFacets ?? []) {
    if (facet.kind === "join") {
      tables.add(facet.linkTable);
      tables.add(facet.valueTable);
    }
  }

  return [...tables].sort();
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
