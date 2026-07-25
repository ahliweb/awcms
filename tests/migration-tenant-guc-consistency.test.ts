/**
 * Every tenant-isolation policy must read the GUC the application actually sets.
 *
 * `withTenant()` issues `SET LOCAL app.current_tenant_id = ...`
 * (`src/lib/database/tenant-context.ts`). A policy that reads any other name
 * gets NULL from `current_setting(..., true)`, so its predicate is NULL — never
 * true — and the table becomes unusable rather than merely unfiltered.
 *
 * ## Why this file exists
 *
 * `sql/068` shipped a policy against `awcms.tenant_id`, a name nothing in this
 * codebase sets. Two failures followed, in opposite directions and both quiet:
 *
 * - **USING** matched no rows, so the purge worker drained nothing and reported
 *   `sent=0` — indistinguishable from an empty queue.
 * - **WITH CHECK** rejected every INSERT. Because `enqueueModuleContentPurge` is
 *   awaited inside the content transaction, that rejection aborted the publish.
 *   With `EDGE_CACHE_MODE` enabled, every blog write returned 500.
 *
 * Neither surfaced in CI. The edge cache defaults to `off`, so the enqueue
 * returns before touching the database and no suite had ever written to the
 * table. It appeared the first time the feature was switched on.
 *
 * A pure text gate is the right shape here. It needs no database, so it runs in
 * the `quality` job on every PR, and it fails at authoring time — when the
 * migration is being written — rather than on the day someone enables a flag in
 * production.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

/** The one GUC `withTenant()` sets. Anything else in a policy is a typo with teeth. */
const TENANT_GUC = "app.current_tenant_id";

/**
 * `current_setting('<name>'` inside any policy body. Deliberately matches the
 * whole migration text rather than parsing `CREATE POLICY` blocks: a GUC read
 * anywhere in a migration should use the same name, and a loose match cannot
 * miss one by failing to model SQL syntax.
 */
const CURRENT_SETTING = /current_setting\(\s*'([^']+)'/g;

/**
 * Names that are legitimately not the tenant GUC. Empty today, and an addition
 * here should be rare enough to argue for in review.
 */
const ALLOWED_OTHER_GUCS = new Set<string>([]);

/**
 * Strip `--` line comments and `/* *\/` block comments.
 *
 * Load-bearing, not tidiness: a migration that *repairs* a wrong GUC has to name
 * the wrong GUC in its own header to explain itself. Scanning raw text would
 * make the fix trip the gate that exists to catch the bug — so the gate would
 * punish documenting it.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const dir = path.resolve(process.cwd(), "sql");
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: stripSqlComments(await readFile(path.join(dir, name), "utf8"))
    }))
  );
}

describe("migrations read the tenant GUC the application sets", () => {
  test("no migration reads a GUC other than app.current_tenant_id", async () => {
    const migrations = await readMigrations();
    const offenders: string[] = [];

    for (const migration of migrations) {
      for (const match of migration.sql.matchAll(CURRENT_SETTING)) {
        const guc = match[1];

        if (!guc || guc === TENANT_GUC || ALLOWED_OTHER_GUCS.has(guc)) {
          continue;
        }

        offenders.push(`${migration.name}: current_setting('${guc}')`);
      }
    }

    // `sql/068` is expected to appear nowhere: `sql/070` replaces its policy,
    // but 068 itself is applied and immutable, so its text still contains the
    // wrong name. The assertion below therefore tolerates 068 by name only.
    const unexpected = offenders.filter(
      (entry) => !entry.startsWith("068_awcms_edge_cache_purge_queue.sql:")
    );

    expect(unexpected).toEqual([]);
  });

  test("the last policy on the purge queue uses the right GUC", async () => {
    // Ordering matters: `sql/070` must come after `sql/068` and must be the
    // definition that wins. Asserting on the final occurrence across the sorted
    // migration set is what "the policy in effect" actually means.
    const migrations = await readMigrations();
    const policyDefinitions = migrations
      .filter((migration) =>
        migration.sql.includes("awcms_edge_cache_purges_tenant_isolation")
      )
      .filter((migration) => /CREATE\s+POLICY/i.test(migration.sql));

    expect(policyDefinitions.length).toBeGreaterThanOrEqual(2);

    const winning = policyDefinitions.at(-1);

    expect(winning?.name).toBe(
      "070_awcms_edge_cache_purges_tenant_guc_fix.sql"
    );
    expect(winning?.sql).toContain(`current_setting('${TENANT_GUC}'`);
    expect(winning?.sql).not.toContain("current_setting('awcms.tenant_id'");
  });
});
