/**
 * The permission CATALOGUE and the module DESCRIPTORS must describe the same
 * set — checked against a database that has run every migration.
 *
 * ## The gap this closes, and how it hid
 *
 * `awcms_permissions` is what `authorizeInTransaction` actually reads: a row
 * there is what a role can be granted, and a permission with no row can be
 * granted to nobody. The module descriptors are a SECOND register of the same
 * facts, and they are the one every static gate trusts —
 * `access:permissions:enforcement:check` asks "does each DECLARED permission
 * have an enforcer?" and `admin:screen-coverage:check` asks "does each DECLARED
 * permission have a screen?". Both iterate what modules declare.
 *
 * So a permission seeded straight into SQL and never declared is not merely
 * undocumented: it is INVISIBLE to every gate that would otherwise interrogate
 * it. Nothing asks whether it is enforced. Nothing asks whether it has a
 * screen. It is exempt from the repository's checks by omission rather than by
 * decision, and no register anywhere says so.
 *
 * That is not hypothetical. `identity_access.abac_policies.{read,configure,
 * analyze}` were seeded by `sql/032` and declared nowhere, on the reasoning
 * written into that migration — "rather than via a module descriptor
 * `permissions` array which this module does not use" — which was true when
 * written and stopped being true afterwards.
 *
 * What that concealed: the DSL policy surface those three guard
 * (`/api/v1/access/policies/*` — the ONLY surface producing policies the
 * evaluator consumes) had NO ADMIN SCREEN AT ALL, for the whole of its life.
 * ADR-0033 anticipated one. `admin:screen-coverage:check` exists to say exactly
 * that — "this declared permission has no screen" — and could not, because it
 * iterates DECLARED permissions and these were not among them. The gate was not
 * wrong; it was never given the question.
 *
 * Six description drifts came out with them, and those were not merely cosmetic:
 * `comparePermissions` reports `mismatched_description`, the module health
 * signal counts it as a failure, and four modules had therefore been reporting
 * `permission_catalog_synced = fail` on every migrated deployment — measured on
 * one, not inferred — while CI stayed green.
 *
 * ## Why this is a test and not a `scripts/*-check.ts`
 *
 * The obvious pure gate parses `sql/*.sql`. It would have to understand
 * `INSERT … VALUES` in two column shapes AND the deletions — five migrations
 * remove catalogue rows, in at least two different predicate shapes
 * (`(activity_code = … AND action = …) OR …`, and `activity_code IN (…)` with
 * no action at all) — and apply them cumulatively in migration order. A regex
 * that silently mis-parses one of those produces a gate that is confidently
 * wrong, which this repository has recorded happening more than once.
 *
 * The migrated database has already applied all of it, exactly. So the check
 * reads the answer instead of re-deriving it.
 *
 * ## It reuses `comparePermissions` rather than restating the rule
 *
 * `module-management/domain/permission-sync.ts` already defines what `synced`,
 * `missing`, `orphaned` and `mismatched_description` mean, and the runtime
 * health signal is built on it. Re-implementing the comparison here would let
 * CI and the health endpoint drift into disagreeing about the same two
 * registers.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  getAdminSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { listModules } from "../../src/modules";
import { fetchModulePermissionSyncReport } from "../../src/modules/module-management/application/permission-sync";

type Problem = { key: string; status: string; moduleKey: string };

async function catalogueModuleKeys(): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT DISTINCT module_key FROM awcms_permissions ORDER BY module_key
  `) as { module_key: string }[];

  return rows.map((row) => row.module_key);
}

/** Every non-`synced` entry, across every module either register mentions. */
async function findUnsynced(): Promise<Problem[]> {
  const keys = new Set([
    ...listModules().map((module) => module.key),
    ...(await catalogueModuleKeys())
  ]);

  const problems: Problem[] = [];

  for (const moduleKey of [...keys].sort()) {
    const report = await fetchModulePermissionSyncReport(
      getAdminSql(),
      moduleKey
    );

    for (const entry of report?.entries ?? []) {
      if (entry.status === "synced") continue;

      problems.push({
        moduleKey,
        key: `${moduleKey}.${entry.activityCode}.${entry.action}`,
        status: entry.status
      });
    }
  }

  return problems;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the permission catalogue and the module descriptors agree", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  test("no permission is seeded without being declared, or declared without being seeded", async () => {
    const problems = await findUnsynced();

    // Named, not counted. "3 problems" sends the next person to diff two
    // registers by eye; the keys and their status say what to do:
    //   orphaned              -> declare it in the module descriptor
    //   missing               -> the seed migration has not run, or was never written
    //   mismatched_description-> the descriptor and `sql/NNN` disagree on the text
    expect(problems.map((p) => `${p.status}: ${p.key}`).sort()).toEqual([]);
  });

  test("the corpus is not empty, so the check cannot pass vacuously", async () => {
    // A registry that resolved to nothing, or a catalogue truncated by the
    // harness, would make the assertion above green while proving nothing.
    // `awcms_permissions` is deliberately exempt from `resetDatabase`'s
    // TRUNCATE for this reason; if that ever changes, this fails first and
    // says so, rather than the other test passing for free.
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS count FROM awcms_permissions
    `) as { count: number }[];

    expect(rows[0]!.count).toBeGreaterThan(100);
    expect(listModules().length).toBeGreaterThan(10);
  });
});
