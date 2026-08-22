#!/usr/bin/env bun
/**
 * data-lifecycle:worker-grants:check — the retention engine must be ALLOWED to
 * do what the registry says it does.
 *
 * ## The defect this closes
 *
 * `data-lifecycle:archive-purge` runs as `awcms_worker`. Its generic executor
 * issues, per descriptor, a `SELECT` to find candidates and — for
 * `deletion.mode: "hard_delete"` — a `DELETE` to remove them. Two lifecycle
 * tables had never been granted either:
 *
 *     bun run data-lifecycle:archive-purge --dry-run
 *     → permission denied for table awcms_delegated_access_grants
 *
 * ## Why every existing gate passed
 *
 * `data-lifecycle:registry:check` verifies the descriptors are well-formed.
 * `data-lifecycle:table-coverage:check` verifies every lifecycle-bearing table
 * HAS a descriptor. Both were green and both were right. What nothing compared
 * was the descriptor against the privilege needed to honour it: the registry
 * said "this table is purged on a 365-day retention", the database said "no",
 * and each statement was checked in isolation.
 *
 * That is the recurring shape in this repo — a gate that checks its own matrix
 * rather than what the code needs (the setup wizard was broken for weeks while
 * its privilege check stayed green), and a grant list that reads correctly and
 * is wrong for the statement actually issued (`sql/127`). So this gate derives
 * the requirement from the REGISTRY and checks it against the MIGRATIONS,
 * rather than restating a list that would then need its own maintenance.
 *
 * ## What it does not do
 *
 * It reads `sql/*.sql`, not a live database — `bun run check` is pure by
 * design. That means it proves the grant was WRITTEN, not that it was APPLIED;
 * an unapplied migration is `db:migrate`'s job, and a superuser `POSTGRES_USER`
 * making the point moot is `security:readiness`'s. Being explicit about the
 * boundary matters here, because "the grant exists in a migration" is exactly
 * the kind of statement that gets mistaken for "the job can run".
 */
import { listModules } from "../src/modules";
import { loadMigrations } from "./lib/migrations";
import { grantsPrivilegeToRole } from "./sql-grants";

const WORKER_ROLE = "awcms_worker";

export type RequiredGrant = {
  tableName: string;
  moduleKey: string;
  privileges: readonly string[];
  reason: string;
};

/**
 * What the generic executor needs, derived from each descriptor.
 *
 * SELECT always: candidate selection and the legal-hold read. DELETE only for
 * `hard_delete` — an `anonymize` descriptor needs UPDATE instead, and granting
 * DELETE for it would hand the worker a privilege its code never uses.
 *
 * ONLY `executionMode: "generic"` descriptors are in scope. The 11 `delegated`
 * ones are purged by their OWNING module's job (`analytics:purge`,
 * `email:queue:purge`, `push:queue:purge`, …), each with its own statements and
 * its own already-correct grants; `archive-purge` never issues SQL against them.
 * Requiring generic-engine privileges for a delegated table would be a gate that
 * is loudly red about work that is being done correctly — which is how a gate
 * teaches people to ignore it. The first draft of this check did exactly that,
 * reporting 14 findings of which 9 were noise.
 */
export function deriveRequiredGrants(
  modules: ReturnType<typeof listModules>
): RequiredGrant[] {
  const required: RequiredGrant[] = [];

  for (const module of modules) {
    for (const descriptor of module.dataLifecycle ?? []) {
      if (descriptor.executionMode !== "generic") continue;

      const privileges = ["SELECT"];
      let reason = "candidate selection";

      const mode = descriptor.deletion?.mode;
      if (mode === "hard_delete") {
        privileges.push("DELETE");
        reason += " + hard_delete";
      } else if (mode === "anonymize") {
        privileges.push("UPDATE");
        reason += " + anonymize";
      }

      required.push({
        tableName: descriptor.tableName,
        moduleKey: module.key,
        privileges,
        reason
      });
    }
  }

  return required.sort((a, b) => a.tableName.localeCompare(b.tableName));
}

/**
 * Does any migration grant `privilege` on `table` to the worker?
 *
 * The parse itself lives in `sql-grants.ts` — one scanner, because
 * `data-lifecycle:table-coverage:check` asks the same text a different question
 * ("does ANY role hold INSERT") and a second regex is a second place for the
 * comment-swallowing bug that scanner's comment records.
 */
export function grantsPrivilege(
  sql: string,
  tableName: string,
  privilege: string
): boolean {
  return grantsPrivilegeToRole(sql, tableName, privilege, WORKER_ROLE);
}

function loadMigrationText(): string {
  return loadMigrations()
    .map((migration) => migration.sql)
    .join("\n");
}

if (import.meta.main) {
  const sql = loadMigrationText();
  const required = deriveRequiredGrants(listModules());

  const missing: string[] = [];
  for (const entry of required) {
    for (const privilege of entry.privileges) {
      if (!grantsPrivilege(sql, entry.tableName, privilege)) {
        missing.push(
          `${entry.tableName} (${entry.moduleKey}) — missing ${privilege} for ${WORKER_ROLE} [${entry.reason}]`
        );
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      `data-lifecycle:worker-grants:check FAILED — ${missing.length} missing grant(s):`
    );
    for (const entry of missing) console.error(`  - ${entry}`);
    console.error(
      `\n  \`data-lifecycle:archive-purge\` runs as ${WORKER_ROLE} and will fail with\n` +
        "  `permission denied for table <name>` on each of these. A descriptor that\n" +
        "  declares a retention the engine cannot enforce is not retention — it is a\n" +
        "  claim. Add the GRANT in a new `sql/NNN` migration."
    );
    process.exit(1);
  }

  console.log(
    `data-lifecycle:worker-grants:check OK — ${required.length} lifecycle table(s), every required ${WORKER_ROLE} privilege granted in sql/.`
  );
}
