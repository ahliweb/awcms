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
import {
  COUNT_FUNCTION_PATTERN,
  DELEGATED_COUNT_FUNCTIONS,
  KNOWN_UNREADABLE_DELEGATED_TABLES
} from "../src/modules/data-lifecycle/domain/known-unreadable-delegated";
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

// The baseline lives with the engine that consumes it
// (`known-unreadable-delegated.ts`), because the job must know which snapshot
// failures are expected and `src/` cannot import from `scripts/`. Re-exported so
// the gate and its tests keep one import path.
export { KNOWN_UNREADABLE_DELEGATED_TABLES };

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Does `sql/` give the worker a count-only function that covers `tableName`
 * (Issue #1042)? Judged on the comment-stripped migrations, and on the LAST
 * definition of the one function the table is mapped to, never on a substring
 * anywhere in `sql/` (a commented-out branch, or a branch in another function,
 * would otherwise turn the gate green):
 *
 * - the table is mapped in `DELEGATED_COUNT_FUNCTIONS` to a valid name;
 * - that function is `SECURITY DEFINER` with `SET search_path` whose last
 *   element is `pg_temp`;
 * - ITS body has a `p_table = '<table>'` branch that reads FROM the table
 *   filtering `<tenantColumn> = p_tenant_id AND <cursorColumn> < p_cutoff`
 *   (the descriptor's own columns, so a drifted cursor goes red);
 * - `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO awcms_worker`;
 * - `ALTER FUNCTION ... OWNER TO <owner>` and that owner holds column-level
 *   `SELECT` on both columns of the table.
 */
export function hasWorkerCountFunction(
  migrationSql: string,
  tableName: string,
  cursorColumn = "created_at",
  tenantColumn = "tenant_id"
): boolean {
  const fn = DELEGATED_COUNT_FUNCTIONS[tableName];

  if (fn === undefined || !COUNT_FUNCTION_PATTERN.test(fn)) return false;
  if (
    !/^[a-z][a-z0-9_]*$/.test(cursorColumn) ||
    !/^[a-z][a-z0-9_]*$/.test(tenantColumn)
  ) {
    return false;
  }

  const sql = stripSqlComments(migrationSql);
  const args = String.raw`\s*\([^)]*\)`;

  const definitions = [
    ...sql.matchAll(
      new RegExp(
        String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+${fn}${args}([\s\S]*?)\bAS\s+\$function\$([\s\S]*?)\$function\$\s*;`,
        "gi"
      )
    )
  ];
  const definition = definitions[definitions.length - 1];

  if (definition === undefined) return false;

  const header = definition[1]!;
  const body = definition[2]!;

  if (!/\bSECURITY\s+DEFINER\b/i.test(header)) return false;

  const pin = /\bSET\s+search_path\s*(?:=|TO)\s*([\w\s,"]+?)\s*$/i.exec(header);
  const pinned = pin?.[1]?.split(",").map((part) => part.trim().toLowerCase());

  if (pinned === undefined || pinned[pinned.length - 1] !== "pg_temp") {
    return false;
  }

  const branch = new RegExp(
    String.raw`p_table\s*=\s*'${tableName}'\s*THEN([\s\S]*?)(?=\bELSIF\b|\bELSE\b|\bEND\s+IF\b)`,
    "i"
  ).exec(body)?.[1];

  if (
    branch === undefined ||
    !new RegExp(String.raw`\bFROM\s+${tableName}\b`, "i").test(branch) ||
    !new RegExp(
      String.raw`\b${tenantColumn}\s*=\s*p_tenant_id\b[\s\S]*?\b${cursorColumn}\s*<\s*p_cutoff\b`,
      "i"
    ).test(branch)
  ) {
    return false;
  }

  const revoked = new RegExp(
    String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+${fn}${args}\s+FROM\s+PUBLIC\s*;`,
    "i"
  ).test(sql);
  const granted = new RegExp(
    String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+${fn}${args}\s+TO\s+${WORKER_ROLE}\s*;`,
    "i"
  ).test(sql);

  if (!revoked || !granted) return false;

  const owners = [
    ...sql.matchAll(
      new RegExp(
        String.raw`ALTER\s+FUNCTION\s+${fn}${args}\s+OWNER\s+TO\s+(\w+)\s*;`,
        "gi"
      )
    )
  ];
  const owner = owners[owners.length - 1]?.[1];

  if (owner === undefined || owner === WORKER_ROLE) return false;

  return [
    ...sql.matchAll(
      new RegExp(
        String.raw`GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+${tableName}\s+TO\s+${owner}\s*;`,
        "gi"
      )
    )
  ].some((grant) => {
    const columns = grant[1]!.split(",").map((c) => c.trim().toLowerCase());

    return columns.includes(tenantColumn) && columns.includes(cursorColumn);
  });
}

/** Delegated, tenant-scoped descriptor tables the worker holds no SELECT on. */
export function findUnreadableDelegatedTables(
  modules: ReturnType<typeof listModules>,
  migrationSql: string
): string[] {
  const unreadable = new Set<string>();

  for (const module of modules) {
    for (const descriptor of module.dataLifecycle ?? []) {
      if (descriptor.executionMode !== "delegated") continue;
      if (descriptor.scope !== "tenant") continue;
      if (
        hasWorkerCountFunction(
          migrationSql,
          descriptor.tableName,
          descriptor.cursorColumn,
          descriptor.tenantColumn ?? "tenant_id"
        )
      ) {
        continue;
      }
      if (!grantsPrivilege(migrationSql, descriptor.tableName, "SELECT")) {
        unreadable.add(descriptor.tableName);
      }
    }
  }

  return [...unreadable].sort();
}

/** Compare the live set with the baseline. Pure, so a fixture can drive it. */
export function compareDelegatedBaseline(
  unreadable: readonly string[],
  baseline: readonly string[]
): { added: string[]; stale: string[] } {
  const live = new Set(unreadable);
  const known = new Set(baseline);

  return {
    added: [...live].filter((table) => !known.has(table)).sort(),
    stale: [...known].filter((table) => !live.has(table)).sort()
  };
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

  const delegated = compareDelegatedBaseline(
    findUnreadableDelegatedTables(listModules(), sql),
    KNOWN_UNREADABLE_DELEGATED_TABLES
  );

  if (delegated.added.length > 0 || delegated.stale.length > 0) {
    console.error(
      "data-lifecycle:worker-grants:check FAILED — the delegated-snapshot baseline moved (Issue #1040):"
    );
    for (const table of delegated.added) {
      console.error(
        `  - NEW unreadable delegated descriptor: ${table} — ${WORKER_ROLE} has no SELECT, so its dry-run snapshot fails every run. Grant SELECT (only if the worker may read that data) or add a count-only SECURITY DEFINER function and declare it in DELEGATED_COUNT_FUNCTIONS (sql/303 is the pattern); do not add it to the baseline to silence this.`
      );
    }
    for (const table of delegated.stale) {
      console.error(
        `  - STALE baseline entry: ${table} — now readable or no longer delegated. Remove it from KNOWN_UNREADABLE_DELEGATED_TABLES.`
      );
    }
    process.exit(1);
  }

  console.log(
    `data-lifecycle:worker-grants:check OK — ${required.length} lifecycle table(s), every required ${WORKER_ROLE} privilege granted in sql/; ${KNOWN_UNREADABLE_DELEGATED_TABLES.length} known unreadable delegated snapshot(s) (baseline, shrink-only); delegated tables with a worker count function are counted, not skipped.`
  );
}
