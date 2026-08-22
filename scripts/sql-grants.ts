/**
 * What `sql/` says a database role may do — parsed once, for the gates that ask.
 *
 * ## Why this file exists rather than a second regex
 *
 * Two checks need the same answer from the same text.
 * `data-lifecycle:worker-grants:check` asks "was `awcms_worker` granted DELETE
 * on this table", and `data-lifecycle:table-coverage:check` now asks "does ANY
 * role hold INSERT on it". Those are the same parse behind two questions, and
 * the parse is the part with a history of being wrong (see `grantsPrivilege`'s
 * comment on the comment-swallowing regex), so it lives in one place where a
 * fix reaches both callers.
 *
 * ## The derivation this enables, and the objection it had to answer first
 *
 * `tests/data-lifecycle-table-coverage.test.ts` recorded this idea and rejected
 * it, in the comment above the exemption-count assertion — "the request path
 * cannot write it, therefore it cannot grow with traffic" — on a counter-example
 * from this very repo: `awcms_idn_admin_regions` denies `awcms_app` every write
 * verb and holds ~91,000 rows, because the import job runs as `awcms_worker`.
 * A derivation reading only `awcms_app`'s privileges would have exempted the
 * largest table in the schema.
 *
 * That objection is fatal to the version it was aimed at and not to this one.
 * `deriveSealedTables` reads EVERY role's grants, so the worker's INSERT on
 * `awcms_idn_admin_regions` is exactly what keeps it unsealed — the recorded
 * counter-example is now the regression test that proves the rule sound rather
 * than the reason not to have it.
 *
 * The second objection was cost: "parsing GRANT statements across 109
 * cumulative migrations to answer a question five sentences answer better."
 * That was true of a five-entry list. The parser landed anyway, for
 * `data-lifecycle:worker-grants:check`, and the list reached seventeen.
 */

/**
 * A parsed `GRANT`/`REVOKE`. Names are lower-cased and privileges upper-cased
 * so a caller never has to remember which way this file normalizes.
 *
 * `tables` is whatever stood between `ON` and `TO`/`FROM`, INCLUDING forms that
 * are not tables at all (`schema public`, `all sequences in schema public`).
 * Filtering those out is the caller's job, and it happens for free: they never
 * match a real table name.
 */
export type PrivilegeStatement = {
  kind: "grant" | "revoke";
  privileges: readonly string[];
  tables: readonly string[];
  roles: readonly string[];
};

/**
 * Remove `--` line comments and block comments.
 *
 * Deliberately not comment-aware of string literals: a GRANT statement never
 * contains a quoted `--`, and erring toward removing too much would only make
 * a caller quieter, never wrongly green — a missing grant stays missing.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Every `GRANT`/`REVOKE` in a migration, in the order it is written.
 *
 * Comments are stripped FIRST. Without that the scan is worse than useless: a
 * `--` line that merely mentions GRANT has no `;`, so `GRANT[\s\S]*?;` starts
 * there and swallows everything up to the NEXT semicolon — consuming the real
 * statement that follows. That is not hypothetical; it produced four false
 * positives on grants sitting in plain sight in `sql/060`, `sql/074` and
 * `sql/091`, and it is `js/bad-tag-filter` in a different costume: a pattern
 * lazy about where a construct ENDS eats the thing after it.
 */
export function parsePrivilegeStatements(sql: string): PrivilegeStatement[] {
  const statements = stripSqlComments(sql).match(
    /\b(?:GRANT|REVOKE)[\s\S]*?;/gi
  );
  if (!statements) return [];

  const parsed: PrivilegeStatement[] = [];

  for (const statement of statements) {
    const flat = statement.replace(/\s+/g, " ").trim();
    const grant = /^GRANT (.+?) ON (?:TABLE )?(.+?) TO (.+?);$/i.exec(flat);
    const revoke = /^REVOKE (.+?) ON (?:TABLE )?(.+?) FROM (.+?);$/i.exec(flat);
    const match = grant ?? revoke;
    if (!match) continue;

    const [, privileges, tables, roles] = match;
    if (!privileges || !tables || !roles) continue;

    parsed.push({
      kind: grant ? "grant" : "revoke",
      privileges: privileges
        .split(",")
        .map((entry) => entry.trim().toUpperCase()),
      tables: tables.split(",").map((entry) => entry.trim().toLowerCase()),
      // `TO awcms_app, awcms_worker` and a trailing `WITH GRANT OPTION` both
      // land here; the latter cannot match a role name, so it is inert.
      roles: roles.split(",").map((entry) => entry.trim().toLowerCase())
    });
  }

  return parsed;
}

/**
 * Does this privilege list confer `privilege`?
 *
 * `ALL`/`ALL PRIVILEGES` confer everything. A column-scoped `INSERT (col)`
 * counts as INSERT — matching on the leading word rather than on equality,
 * because the alternative errs in the one direction that matters: a
 * column-grant read as "no INSERT" would seal a table a role can write.
 */
export function confers(
  privileges: readonly string[],
  privilege: string
): boolean {
  const wanted = privilege.toUpperCase();
  return privileges.some(
    (entry) => entry.startsWith("ALL") || entry.split(/[\s(]/)[0] === wanted
  );
}

/**
 * Does any migration in `sql` grant `privilege` on `tableName` to `role`?
 *
 * Lives here rather than in a caller because two gates now ask it —
 * `data-lifecycle:worker-grants:check` for the retention engine and
 * `site-search:sources:check` for the reconcile job (Issue #625) — and a second
 * copy of this predicate is a second place for the comment-swallowing bug
 * `stripSqlComments` exists to prevent.
 *
 * Answers about what a migration WROTE, never about what a database has
 * applied. That boundary matters, because "the grant exists in a migration" is
 * exactly the sentence that gets read as "the job can run".
 */
export function grantsPrivilegeToRole(
  sql: string,
  tableName: string,
  privilege: string,
  role: string
): boolean {
  const wanted = tableName.toLowerCase();

  return parsePrivilegeStatements(sql).some(
    (statement) =>
      statement.kind === "grant" &&
      statement.roles.includes(role) &&
      statement.tables.includes(wanted) &&
      confers(statement.privileges, privilege)
  );
}

export type SealedTablesInput = {
  /** Migrations in APPLY order — privileges are a running total, not a set. */
  migrations: readonly { name: string; sql: string }[];
  tables: readonly string[];
};

export type SealedTablesResult = {
  /** Tables no role may INSERT into, sorted. */
  sealed: readonly string[];
  /** Roles holding INSERT on everything by blanket/default grant. */
  baselineRoles: readonly string[];
  /** Non-null when the derivation refused to run; `sealed` is then empty. */
  refusal: string | null;
};

const BASELINE_ALL_TABLES =
  /GRANT\s+([\s\S]+?)\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+\w+\s+TO\s+([\s\S]+?);/gi;
const BASELINE_DEFAULT_PRIVILEGES =
  /ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]*?\bGRANT\s+([\s\S]+?)\s+ON\s+TABLES\s+TO\s+([\s\S]+?);/gi;

/**
 * The roles that hold INSERT on a table without any per-table grant naming it.
 *
 * `sql/019` gives `awcms_app` both forms — a blanket
 * `GRANT … ON ALL TABLES IN SCHEMA public` for the tables that existed, and an
 * `ALTER DEFAULT PRIVILEGES … ON TABLES` for every table created since — so
 * every table starts writable and a REVOKE is what changes that.
 *
 * Read rather than hard-coded, because hard-coding it is how this derivation
 * would go silently wrong: if that blanket grant is ever narrowed, a
 * hard-coded baseline keeps insisting `awcms_app` can write everything, which
 * errs toward NOT sealing (safe) — but if it is ever WIDENED to another role, a
 * hard-coded baseline would seal tables that role can write, which is a false
 * green. Both directions are answered by reading the migrations.
 */
export function deriveBaselineInsertRoles(
  migrations: readonly { name: string; sql: string }[]
): string[] {
  const roles = new Set<string>();

  for (const migration of migrations) {
    const sql = stripSqlComments(migration.sql);

    for (const pattern of [BASELINE_ALL_TABLES, BASELINE_DEFAULT_PRIVILEGES]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sql)) !== null) {
        const privileges = match[1]!
          .split(",")
          .map((entry) => entry.trim().toUpperCase());
        if (!confers(privileges, "INSERT")) continue;
        for (const role of match[2]!.split(",")) {
          roles.add(role.trim().toLowerCase());
        }
      }
    }
  }

  return [...roles].sort();
}

/**
 * Tables whose row count cannot grow at runtime, because no role may INSERT.
 *
 * A bound the DATABASE enforces rather than one a sentence asserts — and it is
 * checkable by a reviewer running one query, which is a stronger form of
 * "disputable" than prose.
 *
 * Two different tables end up here, and the mechanism covers both honestly:
 *
 * - a CATALOGUE whose rows a migration writes and the runtime only reads
 *   (`awcms_plans`, `awcms_permissions`), and
 * - a RETIRED table whose writer moved somewhere else and whose INSERT was
 *   revoked behind it (`awcms_access_assignments` after ADR-0079,
 *   `awcms_identity_mfa_factors` after ADR-0087). Its rows are frozen at
 *   whatever they were the day the door closed.
 *
 * Note what is NOT claimed: nothing here says the table is SMALL, or that its
 * rows are still wanted. A sealed table can be large and dead — which is a
 * question about whether to DROP it, not about retention, and `sql/` is not
 * where that gets decided.
 *
 * ## Fail-closed
 *
 * If no baseline role can be found, every table would look sealed and the whole
 * schema would be exempted in one silent step. So the derivation REFUSES: it
 * returns nothing sealed and says why. The gate then reports the affected
 * tables as unanswered, which is loud, wrong in the safe direction, and
 * self-correcting.
 */
export function deriveSealedTables(
  input: SealedTablesInput
): SealedTablesResult {
  const baselineRoles = deriveBaselineInsertRoles(input.migrations);

  if (baselineRoles.length === 0) {
    return {
      sealed: [],
      baselineRoles,
      refusal:
        "no blanket or default-privileges INSERT grant found in `sql/` — without a " +
        "baseline every table reads as sealed, so nothing is sealed. Check that " +
        "`sql/019`'s `GRANT … ON ALL TABLES IN SCHEMA public` and its " +
        "`ALTER DEFAULT PRIVILEGES … ON TABLES` are still there and still parse."
    };
  }

  const tables = new Set(input.tables);
  const holders = new Map<string, Set<string>>(
    baselineRoles.map((role) => [role, new Set(tables)])
  );

  for (const migration of input.migrations) {
    for (const statement of parsePrivilegeStatements(migration.sql)) {
      if (!confers(statement.privileges, "INSERT")) continue;

      const named = statement.tables.filter((table) => tables.has(table));
      if (named.length === 0) continue;

      for (const role of statement.roles) {
        const held = holders.get(role) ?? new Set<string>();
        holders.set(role, held);
        for (const table of named) {
          if (statement.kind === "grant") held.add(table);
          else held.delete(table);
        }
      }
    }
  }

  const sealed = input.tables
    .filter((table) => [...holders.values()].every((held) => !held.has(table)))
    .sort((a, b) => a.localeCompare(b));

  return { sealed, baselineRoles, refusal: null };
}
