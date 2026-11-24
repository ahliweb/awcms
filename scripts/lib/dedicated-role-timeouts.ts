/**
 * Session timeouts of a dedicated-role job's database role (the re-audit of
 * #1483, Low-2). A dedicated role that can take a row lock (the social
 * dispatcher's definer report takes `FOR UPDATE` on an account) must not be
 * able to HOLD it: an operator's disconnect or revoke of the same row would
 * wait for as long as a compromised job liked.
 *
 * The bound is two role-level settings (`ALTER ROLE ... SET`, applied by the
 * server when a session LOGS IN as the role, which is the only way the job
 * connects): `idle_in_transaction_session_timeout` and `transaction_timeout`
 * (PostgreSQL 17+). This check pins both values exactly in the role-wide row of
 * `pg_db_role_setting`, and refuses a per-database row for the role in the
 * current database that sets either key (it would take precedence over the
 * role-wide value). A database-wide default does not override a role setting.
 */

/** The reviewed values. Changing one is a migration AND an edit here. */
export const DEDICATED_ROLE_SESSION_TIMEOUTS: Readonly<Record<string, string>> =
  {
    idle_in_transaction_session_timeout: "15s",
    transaction_timeout: "30s"
  };

type SettingRow = { scope: "role" | "database"; config: string[] | null };

/** Findings (empty when the settings hold) for `role`. A missing role yields none: its own check reports that. */
export async function findDedicatedRoleTimeoutFindings(
  sql: Bun.SQL,
  role: string,
  expected: Readonly<Record<string, string>> = DEDICATED_ROLE_SESSION_TIMEOUTS
): Promise<string[]> {
  const exists = (await sql`
    SELECT 1 FROM pg_roles WHERE rolname = ${role}
  `) as unknown[];

  if (exists.length === 0) return [];

  const rows = (await sql`
    SELECT CASE WHEN s.setdatabase = 0 THEN 'role' ELSE 'database' END AS scope,
           s.setconfig::text[] AS config
    FROM pg_db_role_setting s
    WHERE s.setrole = to_regrole(${role})
      AND (s.setdatabase = 0
           OR s.setdatabase = (SELECT oid FROM pg_database
                               WHERE datname = current_database()))
  `) as SettingRow[];

  return evaluateDedicatedRoleTimeouts(role, rows, expected);
}

/** The pure half, for unit tests. */
export function evaluateDedicatedRoleTimeouts(
  role: string,
  rows: readonly SettingRow[],
  expected: Readonly<Record<string, string>>
): string[] {
  const findings: string[] = [];
  const parse = (config: string[] | null) =>
    new Map(
      (config ?? []).map((entry) => {
        const at = entry.indexOf("=");

        return [entry.slice(0, at), entry.slice(at + 1)] as const;
      })
    );
  const roleWide = parse(
    rows.find((row) => row.scope === "role")?.config ?? null
  );

  for (const [key, value] of Object.entries(expected)) {
    const held = roleWide.get(key);

    if (held !== value) {
      findings.push(
        `${role} has ${key} ${held === undefined ? "unset" : `= ${held}`} (expected ${value} via ALTER ROLE ... SET): a session of the role could hold a transaction, and the row locks it took, without limit`
      );
    }
  }

  for (const row of rows.filter(
    (candidate) => candidate.scope === "database"
  )) {
    for (const key of parse(row.config).keys()) {
      if (Object.hasOwn(expected, key)) {
        findings.push(
          `${role} has a per-database ${key} in this database (ALTER ROLE ... IN DATABASE), which overrides the reviewed role-wide value`
        );
      }
    }
  }

  return findings;
}
