/**
 * Building blocks of the synthetic backup-restore drill (Issue #968, generic
 * half; docs/awcms/restore-drill.md).
 *
 * The drill proves ONE sentence about a dump: "restore it into a fresh cluster
 * and the data, the point in time, the row-level security and the role grants
 * all come back". Everything here is split so each claim has a comparator that
 * can be unit-tested with a deliberately broken input
 * (`tests/restore-drill-compare.test.ts`): a verification that cannot go red is
 * not a verification.
 *
 * ## Why the catalog comparison is not enough on its own
 *
 * Source and restored catalogs can agree and both be wrong (a table that lost
 * `FORCE` before the dump loses it again after). So the report carries two
 * kinds of check: a source-versus-restore COMPARISON, and BEHAVIOUR probes run
 * on the restored database as the real runtime role `awcms_app` (never as the
 * superuser, which bypasses RLS and would pass every one of them vacuously).
 *
 * ## Roles are cluster-scoped
 *
 * `pg_dump` does not carry roles. A restore into a fresh cluster whose roles do
 * not exist fails on the first `GRANT`. `provisionRoles` re-creates the
 * `awcms_*` roles from the source's attributes (never their passwords: a
 * password is a secret the operator supplies, exactly as for a new deployment),
 * and the drill times that step on its own so the RTO does not hide it.
 *
 * ## Payroll
 *
 * `PAYROLL_DEFERRED_CHECKS` is the hook for the half that waits on #957 (the
 * payroll tables are blocked by the DPIA #976): the checks are listed in every
 * report as `deferred`, never silently absent and never counted as passed.
 */

export const DRILL_DATABASE_PREFIX = "awcms_drill_";

export type DrillCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

/** Every check a passing drill must contain: dropping one from the pipeline fails the drill. */
export const REQUIRED_CHECK_IDS = [
  "table_set",
  "row_counts",
  "row_checksums",
  "sequences_not_behind",
  "extensions",
  "roles",
  "rls_force_catalog",
  "policies",
  "grants_relations",
  "grants_columns",
  "functions_and_grants",
  "triggers",
  "constraints",
  "indexes",
  "rls_force_no_new_offenders",
  "runtime_role_not_privileged",
  "rls_isolation_as_app",
  "rls_cross_tenant_write_refused",
  "append_only_grant_as_app",
  "booking_reconciliation_clean",
  "booking_point_in_time"
] as const;
export type RequiredCheckId = (typeof REQUIRED_CHECK_IDS)[number];

/**
 * The payroll half of #968, blocked until #957 creates the tables. Each entry
 * names the control it will verify and where the contract lives, so the work
 * cannot be forgotten and cannot be mistaken for done.
 */
export const PAYROLL_DEFERRED_CHECKS = [
  {
    id: "payroll_key_ring_retention",
    blockedBy: "#957",
    contract:
      "Every key id any restorable backup still needs is in BOTH the encryption and the hash key rings (ADR-0137 section 2 and 6; hr-payroll.md section 17)."
  },
  {
    id: "payroll_restore_without_key_ring",
    blockedBy: "#957",
    contract:
      "Restore WITHOUT the ring: reveal and re-encryption fail closed, masked reads work (ADR-0137 section on restore into an environment without the key ring)."
  },
  {
    id: "payroll_restore_with_key_ring",
    blockedBy: "#957",
    contract:
      "Restore WITH the ring: reveal works and the AAD-bound ciphertext authenticates."
  },
  {
    id: "payroll_reconciliation_after_restore",
    blockedBy: "#957",
    contract:
      "The payroll reconciliation (hr-payroll.md section 14) after attendance, commission and payroll are restored from the same point in time."
  }
] as const;

export type Sql = Bun.SQL;

export type TableDigest = { count: string; md5: string };
export type TableDigests = Record<string, TableDigest>;

/** Catalog facts as sorted lines, one array per category. */
export type CatalogFacts = {
  relations: string[];
  columnAcls: string[];
  policies: string[];
  functions: string[];
  triggers: string[];
  constraints: string[];
  indexes: string[];
  extensions: string[];
  roles: string[];
  /** Tables that carry `tenant_id` yet lack FORCE ROW LEVEL SECURITY. */
  tenantTablesWithoutForce: string[];
};

export type SequenceValues = Record<string, string | null>;

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sample(items: string[], size = 5): string {
  return items.slice(0, size).join("; ") + (items.length > size ? "; ..." : "");
}

// ---------------------------------------------------------------------------
// Pure comparators (unit-tested with broken inputs)
// ---------------------------------------------------------------------------

export function compareLineSets(
  id: string,
  label: string,
  source: string[],
  restored: string[]
): DrillCheck {
  const sourceSet = new Set(source);
  const restoredSet = new Set(restored);
  const missing = source.filter((line) => !restoredSet.has(line));
  const extra = restored.filter((line) => !sourceSet.has(line));

  if (missing.length === 0 && extra.length === 0) {
    return {
      id,
      ok: true,
      detail: `${label}: ${source.length} identical`
    };
  }

  return {
    id,
    ok: false,
    detail:
      `${label}: ${missing.length} missing after restore, ${extra.length} unexpected. ` +
      `missing: ${sample(missing)} | unexpected: ${sample(extra)}`
  };
}

export function compareTableSets(
  witness: TableDigests,
  restored: TableDigests
): DrillCheck {
  return compareLineSets(
    "table_set",
    "tables",
    Object.keys(witness).sort(),
    Object.keys(restored).sort()
  );
}

export function compareRowCounts(
  witness: TableDigests,
  restored: TableDigests
): DrillCheck {
  const differing = Object.keys(witness)
    .filter((table) => restored[table]?.count !== witness[table]!.count)
    .map(
      (table) =>
        `${table} ${witness[table]!.count} -> ${restored[table]?.count ?? "absent"}`
    );

  return differing.length === 0
    ? {
        id: "row_counts",
        ok: true,
        detail: `${Object.keys(witness).length} tables, row counts identical`
      }
    : {
        id: "row_counts",
        ok: false,
        detail: `${differing.length} tables differ: ${sample(differing)}`
      };
}

export function compareRowChecksums(
  witness: TableDigests,
  restored: TableDigests
): DrillCheck {
  const differing = Object.keys(witness).filter(
    (table) => restored[table]?.md5 !== witness[table]!.md5
  );

  return differing.length === 0
    ? {
        id: "row_checksums",
        ok: true,
        detail: `${Object.keys(witness).length} tables, row checksums identical`
      }
    : {
        id: "row_checksums",
        ok: false,
        detail: `${differing.length} tables differ in content: ${sample(differing)}`
      };
}

/**
 * Sequences are not transactional, so the dump may legitimately read a value
 * AHEAD of the snapshot witness. What must never happen is a restored sequence
 * BEHIND it: the next insert would reuse a primary key.
 */
export function compareSequences(
  witness: SequenceValues,
  restored: SequenceValues
): DrillCheck {
  const behind: string[] = [];

  for (const [name, value] of Object.entries(witness)) {
    if (value === null) {
      continue;
    }

    const after = restored[name];

    if (
      after === undefined ||
      after === null ||
      BigInt(after) < BigInt(value)
    ) {
      behind.push(`${name} ${value} -> ${after ?? "absent"}`);
    }
  }

  return behind.length === 0
    ? {
        id: "sequences_not_behind",
        ok: true,
        detail: `${Object.keys(witness).length} sequences, none behind`
      }
    : {
        id: "sequences_not_behind",
        ok: false,
        detail: `${behind.length} sequences behind or missing: ${sample(behind)}`
      };
}

/** The offenders that exist ONLY after the restore: a table that lost FORCE. */
export function compareForceOffenders(
  source: string[],
  restored: string[]
): DrillCheck {
  const sourceSet = new Set(source);
  const fresh = restored.filter((table) => !sourceSet.has(table));

  return fresh.length === 0
    ? {
        id: "rls_force_no_new_offenders",
        ok: true,
        detail: `${restored.length} tenant tables without FORCE after restore (${source.length} before; none new)`
      }
    : {
        id: "rls_force_no_new_offenders",
        ok: false,
        detail: `${fresh.length} tenant tables lost FORCE ROW LEVEL SECURITY: ${sample(fresh)}`
      };
}

/**
 * `pg_dump` re-emits a CHECK and the restore re-parses it, which flattens
 * nested AND/OR groups: the same predicate comes back with different
 * parentheses (observed on 15 checks, e.g. `((a AND b) AND c)` -> `(a AND b AND c)`).
 * Only CHECK definitions are compared modulo parentheses and whitespace; a
 * changed, dropped or added condition still differs. Limitation, stated: a
 * pure regrouping of AND/OR is not detected by this check.
 */
export function normalizeConstraintLine(line: string): string {
  const at = line.indexOf("|CHECK ");

  return at === -1 ? line : line.replace(/[()\s]+/g, "");
}

export function compareCatalogFacts(
  source: CatalogFacts,
  restored: CatalogFacts
): DrillCheck[] {
  // `relations` carries rls + force + owner + ACL of every relation, so one
  // comparison answers both "FORCE intact" and "table grants intact"; they are
  // reported as two checks so a failure names which property broke.
  const rlsLines = (facts: CatalogFacts) =>
    facts.relations.map((line) => line.split("|acl=")[0]!);
  const aclLines = (facts: CatalogFacts) =>
    facts.relations.map((line) => {
      const [name, rest] = [line.split("|")[0]!, line.split("|acl=")[1] ?? ""];
      return `${name}|acl=${rest}`;
    });

  return [
    compareLineSets(
      "rls_force_catalog",
      "relation owner, ENABLE and FORCE ROW LEVEL SECURITY",
      rlsLines(source),
      rlsLines(restored)
    ),
    compareLineSets(
      "policies",
      "RLS policies",
      source.policies,
      restored.policies
    ),
    compareLineSets(
      "grants_relations",
      "relation grants",
      aclLines(source),
      aclLines(restored)
    ),
    compareLineSets(
      "grants_columns",
      "column grants",
      source.columnAcls,
      restored.columnAcls
    ),
    compareLineSets(
      "functions_and_grants",
      "functions (SECURITY DEFINER, search_path, EXECUTE grants)",
      source.functions,
      restored.functions
    ),
    compareLineSets("triggers", "triggers", source.triggers, restored.triggers),
    compareLineSets(
      "constraints",
      "constraints (CHECK compared modulo grouping parentheses)",
      source.constraints.map(normalizeConstraintLine),
      restored.constraints.map(normalizeConstraintLine)
    ),
    compareLineSets("indexes", "indexes", source.indexes, restored.indexes),
    compareLineSets(
      "extensions",
      "extensions",
      source.extensions,
      restored.extensions
    ),
    compareLineSets("roles", "roles", source.roles, restored.roles),
    compareForceOffenders(
      source.tenantTablesWithoutForce,
      restored.tenantTablesWithoutForce
    )
  ];
}

export type DrillReport = {
  ok: boolean;
  checks: DrillCheck[];
  /** Required checks that never ran: a drill missing one is failed, not passed. */
  missingRequired: string[];
  deferred: { id: string; blockedBy: string; contract: string }[];
};

/** The verdict. A drill with a missing required check fails even if every present check passed. */
export function summarize(checks: DrillCheck[]): DrillReport {
  const present = new Set(checks.map((check) => check.id));
  const missingRequired = REQUIRED_CHECK_IDS.filter((id) => !present.has(id));

  return {
    ok: missingRequired.length === 0 && checks.every((check) => check.ok),
    checks,
    missingRequired,
    deferred: PAYROLL_DEFERRED_CHECKS.map((entry) => ({ ...entry }))
  };
}

// ---------------------------------------------------------------------------
// Readers (SQL)
// ---------------------------------------------------------------------------

const ACL_SORTED = (expr: string) =>
  `coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(${expr}) a), '')`;

async function lines(sql: Sql, query: string): Promise<string[]> {
  const rows = (await sql.unsafe(query)) as { line: string }[];

  return rows.map((row) => row.line).sort();
}

export async function listTables(sql: Sql): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `)) as { name: string }[];

  return rows.map((row) => row.name);
}

/**
 * Row count and an order-independent content checksum of every table. Run as a
 * superuser so RLS does not hide rows; `timezone` is pinned so timestamp text
 * cannot differ between two sessions.
 */
export async function collectTableDigests(sql: Sql): Promise<TableDigests> {
  const digests: TableDigests = {};

  await sql.unsafe("SET TIME ZONE 'UTC'");

  for (const table of await listTables(sql)) {
    const rows = (await sql.unsafe(
      `SELECT count(*)::text AS count,
              md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS md5
       FROM public.${quoteIdent(table)} t`
    )) as TableDigest[];

    digests[table] = { count: rows[0]!.count, md5: rows[0]!.md5 };
  }

  return digests;
}

export async function collectSequences(sql: Sql): Promise<SequenceValues> {
  const rows = (await sql.unsafe(`
    SELECT sequencename AS name, last_value::text AS value
    FROM pg_sequences WHERE schemaname = 'public'
  `)) as { name: string; value: string | null }[];

  return Object.fromEntries(rows.map((row) => [row.name, row.value]));
}

export async function collectCatalogFacts(sql: Sql): Promise<CatalogFacts> {
  return {
    relations: await lines(
      sql,
      `SELECT c.relname || '|owner=' || pg_get_userbyid(c.relowner) ||
              '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity ||
              '|acl=' || ${ACL_SORTED("c.relacl")} AS line
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')`
    ),
    columnAcls: await lines(
      sql,
      `SELECT c.relname || '.' || a.attname || '|' || ${ACL_SORTED("a.attacl")} AS line
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped`
    ),
    policies: await lines(
      sql,
      `SELECT c.relname || '|' || p.polname || '|cmd=' || p.polcmd::text ||
              '|permissive=' || p.polpermissive || '|roles=' ||
              coalesce((SELECT string_agg(CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END, ',' ORDER BY CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END)
                        FROM unnest(p.polroles) r), '') ||
              '|using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') ||
              '|check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS line
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'`
    ),
    functions: await lines(
      sql,
      `SELECT p.oid::regprocedure::text || '|owner=' || pg_get_userbyid(p.proowner) ||
              '|secdef=' || p.prosecdef || '|config=' ||
              coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proconfig) x), '') ||
              '|acl=' || ${ACL_SORTED("p.proacl")} AS line
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`
    ),
    triggers: await lines(
      sql,
      `SELECT t.tgrelid::regclass::text || '|' || t.tgname || '|enabled=' || t.tgenabled::text AS line
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname = 'public'`
    ),
    constraints: await lines(
      sql,
      `SELECT c.relname || '|' || k.conname || '|' || pg_get_constraintdef(k.oid) AS line
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'`
    ),
    indexes: await lines(
      sql,
      `SELECT tablename || '|' || indexdef AS line FROM pg_indexes WHERE schemaname = 'public'`
    ),
    extensions: await lines(
      sql,
      `SELECT extname || '@' || extversion AS line FROM pg_extension`
    ),
    roles: await lines(
      sql,
      `SELECT r.rolname || '|login=' || r.rolcanlogin || '|super=' || r.rolsuper ||
              '|bypassrls=' || r.rolbypassrls || '|createdb=' || r.rolcreatedb ||
              '|createrole=' || r.rolcreaterole || '|inherit=' || r.rolinherit ||
              '|config=' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(r.rolconfig) x), '') ||
              '|member_of=' || coalesce((
                SELECT string_agg(pg_get_userbyid(m.roleid), ',' ORDER BY pg_get_userbyid(m.roleid))
                FROM pg_auth_members m WHERE m.member = r.oid), '') AS line
       FROM pg_roles r WHERE r.rolname LIKE 'awcms\\_%'`
    ),
    tenantTablesWithoutForce: await lines(
      sql,
      `SELECT c.relname AS line
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relforcerowsecurity`
    )
  };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

type RoleRow = {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolbypassrls: boolean;
  rolconfig: string[] | null;
};

/**
 * Re-creates the source's `awcms_*` roles in a fresh cluster: attributes,
 * per-role settings (`ALTER ROLE ... SET app.current_tenant_id`, which is what
 * makes the unset-tenant default fail closed) and memberships. NEVER a
 * password: that is the operator's secret, set after (see `setRolePassword`).
 * Roles that already exist keep their identity and have their attributes
 * re-asserted, so the step is safe to repeat. Returns the role names handled.
 */
export async function provisionRoles(
  source: Sql,
  target: Sql
): Promise<string[]> {
  const roles = (await source.unsafe(`
    SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole,
           rolcreatedb, rolbypassrls, rolconfig
    FROM pg_roles WHERE rolname LIKE 'awcms\\_%' ORDER BY rolname
  `)) as RoleRow[];

  for (const role of roles) {
    const exists = (await target.unsafe(
      `SELECT 1 AS one FROM pg_roles WHERE rolname = ${quoteLiteral(role.rolname)}`
    )) as unknown[];

    if (exists.length === 0) {
      await target.unsafe(`CREATE ROLE ${quoteIdent(role.rolname)} NOLOGIN`);
    }

    // A restored runtime role must never be a superuser or bypass RLS, whatever
    // the source says: the attribute is copied only when it is the safe value.
    await target.unsafe(
      `ALTER ROLE ${quoteIdent(role.rolname)} ` +
        `${role.rolcanlogin ? "LOGIN" : "NOLOGIN"} ` +
        `${role.rolsuper ? "SUPERUSER" : "NOSUPERUSER"} ` +
        `${role.rolinherit ? "INHERIT" : "NOINHERIT"} ` +
        `${role.rolcreaterole ? "CREATEROLE" : "NOCREATEROLE"} ` +
        `${role.rolcreatedb ? "CREATEDB" : "NOCREATEDB"} ` +
        `${role.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS"}`
    );

    for (const entry of role.rolconfig ?? []) {
      const at = entry.indexOf("=");

      const key = entry.slice(0, at);

      if (!/^[a-z_][a-z0-9_.]*$/.test(key)) {
        throw new Error(`role setting "${key}" is not a plain GUC name.`);
      }

      await target.unsafe(
        `ALTER ROLE ${quoteIdent(role.rolname)} SET ${key} = ${quoteLiteral(entry.slice(at + 1))}`
      );
    }
  }

  const memberships = (await source.unsafe(`
    SELECT pg_get_userbyid(m.roleid) AS role, pg_get_userbyid(m.member) AS member
    FROM pg_auth_members m
    WHERE pg_get_userbyid(m.member) LIKE 'awcms\\_%'
      AND pg_get_userbyid(m.roleid) LIKE 'awcms\\_%'
  `)) as { role: string; member: string }[];

  for (const { role, member } of memberships) {
    await target.unsafe(`GRANT ${quoteIdent(role)} TO ${quoteIdent(member)}`);
  }

  return roles.map((role) => role.rolname);
}

/** What a deployment does with a real secret (sql/019 header); the drill passes a throwaway one. */
export async function setRolePassword(
  admin: Sql,
  role: string,
  password: string
): Promise<void> {
  await admin.unsafe(
    `ALTER ROLE ${quoteIdent(role)} LOGIN PASSWORD ${quoteLiteral(password)}`
  );
}

// ---------------------------------------------------------------------------
// Behaviour probes, as the runtime role
// ---------------------------------------------------------------------------

export type TenantWitness = {
  tenantId: string;
  reservations: number;
  attendanceEvents: number;
};

export function tenantTx<T>(
  sql: Sql,
  tenantId: string | null,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    if (tenantId !== null) {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    }

    return fn(tx);
  }) as Promise<T>;
}

async function count(tx: Bun.TransactionSQL, table: string): Promise<number> {
  const rows = (await tx.unsafe(
    `SELECT count(*)::int AS n FROM ${quoteIdent(table)}`
  )) as { n: number }[];

  return rows[0]!.n;
}

/** The refusal's SQLSTATE lives on `errno` in Bun.SQL, not `code`. */
function sqlState(error: unknown): string {
  const value = error as { errno?: unknown; code?: unknown };

  return String(value.errno ?? value.code ?? "");
}

class RolledBackProbe extends Error {}

/**
 * Runs a write that MUST be refused. When the database accepts it, the
 * transaction is rolled back (a probe must never leave a row behind, least of
 * all when the very control it tests has failed) and the failure is reported.
 */
async function refused(
  sql: Sql,
  tenantId: string,
  statement: string,
  states: string[]
): Promise<string | null> {
  try {
    await tenantTx(sql, tenantId, async (tx) => {
      await tx.unsafe(statement);

      throw new RolledBackProbe();
    });
  } catch (error) {
    if (error instanceof RolledBackProbe) {
      return "was NOT refused";
    }

    return states.includes(sqlState(error))
      ? null
      : `wrong error ${sqlState(error)}`;
  }

  return "was NOT refused";
}

/**
 * Probes run through a connection logged in AS `awcms_app`. `appSql` must be
 * that real login: `SET ROLE` from a superuser would not exercise the
 * restored password, `ALTER ROLE ... SET` defaults or the role's own grants.
 */
export async function runBehaviourProbes(
  appSql: Sql,
  tenants: TenantWitness[]
): Promise<DrillCheck[]> {
  const checks: DrillCheck[] = [];

  const identity = (await appSql.unsafe(`
    SELECT current_user AS user, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user
  `)) as { user: string; rolsuper: boolean; rolbypassrls: boolean }[];
  const privileged =
    identity[0]!.user !== "awcms_app" ||
    identity[0]!.rolsuper ||
    identity[0]!.rolbypassrls;

  checks.push({
    id: "runtime_role_not_privileged",
    ok: !privileged,
    detail: `connected as ${identity[0]!.user}, superuser=${identity[0]!.rolsuper}, bypassrls=${identity[0]!.rolbypassrls}`
  });

  // Isolation: no context sees nothing, each tenant sees exactly its own rows
  // (the witness counts), a foreign uuid sees nothing. A read that THROWS (a
  // revoked grant) is a red check, not an aborted drill.
  try {
    const problems: string[] = [];
    const noContext = await tenantTx(appSql, null, async (tx) => ({
      reservations: await count(tx, "awcms_booking_reservations"),
      attendance: await count(tx, "awcms_hr_attendance_events")
    }));

    if (noContext.reservations !== 0 || noContext.attendance !== 0) {
      problems.push(
        `no tenant context saw ${noContext.reservations} reservations and ${noContext.attendance} attendance events`
      );
    }

    for (const tenant of tenants) {
      const seen = await tenantTx(appSql, tenant.tenantId, async (tx) => ({
        reservations: await count(tx, "awcms_booking_reservations"),
        attendance: await count(tx, "awcms_hr_attendance_events")
      }));

      if (
        seen.reservations !== tenant.reservations ||
        seen.attendance !== tenant.attendanceEvents
      ) {
        problems.push(
          `tenant ${tenant.tenantId.slice(0, 8)} saw ${seen.reservations}/${seen.attendance}, expected ${tenant.reservations}/${tenant.attendanceEvents}`
        );
      }
    }

    const foreign = await tenantTx(
      appSql,
      "00000000-0000-4000-8000-0000000000ff",
      async (tx) => count(tx, "awcms_booking_reservations")
    );

    if (foreign !== 0) {
      problems.push(`an unknown tenant saw ${foreign} reservations`);
    }

    if (tenants.every((tenant) => tenant.reservations === 0)) {
      problems.push("vacuous: the witness has no reservations to isolate");
    }

    checks.push({
      id: "rls_isolation_as_app",
      ok: problems.length === 0,
      detail:
        problems.length === 0
          ? `${tenants.length} tenants isolated; no-context and foreign-tenant reads return 0`
          : problems.join("; ")
    });
  } catch (error) {
    checks.push({
      id: "rls_isolation_as_app",
      ok: false,
      detail: `the runtime role could not read: ${(error as Error).message}`
    });
  }

  // A write that names another tenant is refused by WITH CHECK (42501).
  const [first, second] = tenants;
  const writeFailure =
    first && second
      ? await refused(
          appSql,
          first.tenantId,
          `INSERT INTO awcms_booking_resources (tenant_id, code, name, kind, capacity, timezone)
           VALUES ('${second.tenantId}', 'drill-cross-tenant', 'x', 'room', 1, 'UTC')`,
          ["42501"]
        )
      : "needs two tenants";

  checks.push({
    id: "rls_cross_tenant_write_refused",
    ok: writeFailure === null,
    detail:
      writeFailure === null
        ? "an INSERT naming another tenant is refused (42501)"
        : `cross-tenant INSERT ${writeFailure}`
  });

  // The attendance log is append-only by ABSENT privilege for the app role.
  const updateFailure = first
    ? await refused(
        appSql,
        first.tenantId,
        "UPDATE awcms_hr_attendance_events SET source = source",
        ["42501"]
      )
    : "needs a tenant";

  checks.push({
    id: "append_only_grant_as_app",
    ok: updateFailure === null,
    detail:
      updateFailure === null
        ? "UPDATE on attendance events is refused for the runtime role (42501)"
        : `UPDATE on attendance events ${updateFailure}`
  });

  return checks;
}

// ---------------------------------------------------------------------------
// pg_dump / pg_restore
// ---------------------------------------------------------------------------

export type ConnectionParts = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

export function parseConnection(
  url: string,
  database?: string
): ConnectionParts {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: database ?? decodeURIComponent(parsed.pathname.slice(1))
  };
}

export function connectionUrl(parts: ConnectionParts): string {
  return `postgres://${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}@${parts.host}:${parts.port}/${parts.database}`;
}

/** The environment of a libpq tool: credentials never appear in argv (and so never in `ps`). */
function libpqEnv(parts: ConnectionParts): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PGHOST: parts.host,
    PGPORT: parts.port,
    PGUSER: parts.user,
    PGPASSWORD: parts.password,
    PGDATABASE: parts.database
  };
}

async function run(
  command: string[],
  env: Record<string, string>
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `${command[0]} exited ${exitCode}: ${stderr.trim().slice(0, 600)}`
    );
  }

  return { stdout, stderr };
}

export async function dumpMajorVersion(): Promise<number> {
  const { stdout } = await run(
    ["pg_dump", "--version"],
    process.env as Record<string, string>
  );
  const match = /(\d+)(?:\.\d+)?/.exec(stdout);

  return match ? Number(match[1]) : 0;
}

/**
 * A custom-format dump pinned to an exported snapshot, so the dump is the
 * database as of that instant however much is written while it runs.
 */
export async function dumpDatabase(
  source: ConnectionParts,
  file: string,
  snapshot: string
): Promise<void> {
  await run(
    [
      "pg_dump",
      "--format=custom",
      "--no-password",
      `--snapshot=${snapshot}`,
      `--file=${file}`
    ],
    libpqEnv(source)
  );
}

export async function restoreDatabase(
  target: ConnectionParts,
  file: string
): Promise<void> {
  // `--exit-on-error`: an error during restore must fail the drill, never scroll by.
  await run(
    [
      "pg_restore",
      "--no-password",
      "--exit-on-error",
      `--dbname=${target.database}`,
      file
    ],
    libpqEnv(target)
  );
}

/** Loopback only: a drill creates and drops databases, so it must never reach a shared host. */
export function assertLocalHost(host: string): void {
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `restore drill refuses host "${host}": it creates and drops databases and only runs against a loopback, disposable cluster.`
    );
  }
}

export function assertDrillDatabaseName(name: string): void {
  if (!/^awcms_drill_[a-z0-9_]{1,40}$/.test(name)) {
    throw new Error(
      `restore drill only creates or drops databases named ${DRILL_DATABASE_PREFIX}*, got "${name}".`
    );
  }
}

export { quoteIdent, quoteLiteral };
