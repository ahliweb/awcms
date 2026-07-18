/**
 * Issue #163 — contract tests for `sql/022_awcms_db_worker_setup_roles.sql`
 * (the opt-in least-privilege `awcms_worker`/`awcms_setup` roles — the second
 * half of the mini-045 role split; sql/021 was the first half).
 *
 * Static-text assertions, same discipline as
 * `db-role-separation-migration.test.ts` for sql/019: the behavioural
 * properties (roles are non-super/non-BYPASSRLS, hold EXACTLY their matrix and
 * nothing more) are proven against a real PostgreSQL by
 * `security-readiness-worker-setup-grants.test.ts` (and were validated by hand
 * on Postgres 18 when this shipped). What this file locks down is the ways the
 * migration can silently rot:
 *
 * 1. Ordering — a `GRANT` to a role that does not exist yet aborts the whole
 *    transaction. Both `CREATE ROLE`s must precede the first `GRANT`.
 * 2. Privilege creep — a worker/setup role that gains SUPERUSER/BYPASSRLS/
 *    ownership makes FORCE RLS inert for it, defeating the split.
 * 3. DML in this file — a migration that writes rows to a FORCE-RLS table
 *    passes on empty CI and fails on populated production (sql/018's pattern).
 * 4. The fail-closed GUC default disappearing.
 * 5. DRIFT between the migration's GRANTs and the least-privilege matrix the
 *    `security:readiness` check enforces (`WORKER_ROLE_GRANTS`/
 *    `SETUP_ROLE_GRANTS`). The two are ONE source of truth or they are worse
 *    than none — a check that asserts a matrix the migration never granted is
 *    theatre. This file parses the migration's own GRANTs and asserts they
 *    equal the exported matrices exactly, in both directions.
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SETUP_ROLE_GRANTS,
  WORKER_ROLE_GRANTS
} from "../scripts/security-readiness";

const repoRoot = path.resolve(import.meta.dir, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const MIGRATION_PATH = "sql/022_awcms_db_worker_setup_roles.sql";
const migrationSql = readRepoFile(MIGRATION_PATH);

/** Strips `--` line comments so prose about SQL is never mistaken for SQL. */
function statementsOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const migrationStatements = statementsOnly(migrationSql);

/**
 * Parses every `GRANT <verbs> ON <table> TO <role>;` for the two split roles
 * out of the migration text (ignoring `GRANT USAGE ON SCHEMA ...`), into the
 * same `{ role: { table: verbs[] } }` shape as the exported matrices. Table
 * grants in this migration are one-per-line, so a line regex is exact and
 * needs no SQL parser.
 */
type ParsedGrants = {
  awcms_worker: Record<string, string[]>;
  awcms_setup: Record<string, string[]>;
};

function parseTableGrants(): ParsedGrants {
  const result: ParsedGrants = {
    awcms_worker: {},
    awcms_setup: {}
  };
  const grantLine =
    /GRANT\s+([A-Z,\s]+?)\s+ON\s+(awcms_[a-z0-9_]+)\s+TO\s+(awcms_worker|awcms_setup)\s*;/g;

  for (const match of migrationStatements.matchAll(grantLine)) {
    const verbs = match[1]!
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .sort();
    const table = match[2]!;
    const role = match[3]! as "awcms_worker" | "awcms_setup";
    // A table granted twice would be a mistake; assert we never merge silently.
    expect(result[role][table]).toBeUndefined();
    result[role][table] = verbs;
  }

  return result;
}

function normalize(matrix: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(matrix).map(([table, verbs]) => [table, [...verbs].sort()])
  );
}

describe("sql/022 — worker/setup role creation", () => {
  test("creates BOTH roles idempotently (re-applying must not fail)", () => {
    for (const role of ["awcms_worker", "awcms_setup"]) {
      expect(migrationStatements).toMatch(new RegExp(`CREATE ROLE ${role}\\b`));
      expect(migrationStatements).toMatch(
        new RegExp(
          `IF NOT EXISTS \\(SELECT 1 FROM pg_roles WHERE rolname = '${role}'\\)`
        )
      );
    }
  });

  test("creates the roles BEFORE the first GRANT", () => {
    const lastCreate = Math.max(
      migrationStatements.indexOf("CREATE ROLE awcms_worker"),
      migrationStatements.indexOf("CREATE ROLE awcms_setup")
    );
    const firstGrant = migrationStatements.search(/GRANT\b/);

    expect(lastCreate).toBeGreaterThanOrEqual(0);
    expect(firstGrant).toBeGreaterThanOrEqual(0);
    expect(lastCreate).toBeLessThan(firstGrant);
  });

  test("creates the roles NOLOGIN and without a password", () => {
    expect(migrationStatements).toMatch(/CREATE ROLE awcms_worker NOLOGIN/);
    expect(migrationStatements).toMatch(/CREATE ROLE awcms_setup NOLOGIN/);
    expect(migrationStatements).not.toMatch(/PASSWORD/i);
  });

  test("never grants role attributes that would bypass RLS entirely", () => {
    for (const attribute of [
      "SUPERUSER",
      "BYPASSRLS",
      "CREATEDB",
      "CREATEROLE",
      "REPLICATION"
    ]) {
      expect(migrationStatements).not.toMatch(new RegExp(`\\b${attribute}\\b`));
    }
  });

  test("sets the all-zero fail-closed tenant GUC on BOTH roles", () => {
    for (const role of ["awcms_worker", "awcms_setup"]) {
      expect(migrationStatements).toMatch(
        new RegExp(
          `ALTER ROLE ${role}\\s+SET app\\.current_tenant_id = '00000000-0000-0000-0000-000000000000'`
        )
      );
    }
  });

  test("grants schema USAGE but never CREATE on the schema", () => {
    expect(migrationStatements).toMatch(
      /GRANT USAGE ON SCHEMA public TO awcms_worker/
    );
    expect(migrationStatements).toMatch(
      /GRANT USAGE ON SCHEMA public TO awcms_setup/
    );
    // CREATE on schema public would let the role define+own tables → RLS bypass.
    expect(migrationStatements).not.toMatch(
      /GRANT[^;]*\bCREATE\b[^;]*ON SCHEMA/
    );
  });

  test("contains no DML — it would break on a populated production database", () => {
    for (const dml of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+awcms_/i,
      /\bDELETE\s+FROM\b/i
    ]) {
      expect(migrationStatements).not.toMatch(dml);
    }
  });
});

describe("sql/022 — GRANTs match the least-privilege matrix exactly (no drift)", () => {
  const granted = parseTableGrants();

  test("awcms_worker's migration GRANTs equal WORKER_ROLE_GRANTS", () => {
    expect(granted.awcms_worker).toEqual(normalize(WORKER_ROLE_GRANTS));
  });

  test("awcms_setup's migration GRANTs equal SETUP_ROLE_GRANTS", () => {
    expect(granted.awcms_setup).toEqual(normalize(SETUP_ROLE_GRANTS));
  });

  test("the crown-jewel global catalogs are granted to NEITHER split role", () => {
    // The whole point of the split: these must never appear in a worker/setup
    // GRANT. (awcms_setup legitimately reads awcms_permissions and writes
    // awcms_setup_state, so those two are asserted per-matrix above, not here.)
    for (const table of [
      "awcms_schema_migrations",
      "awcms_modules",
      "awcms_module_dependencies",
      "awcms_module_navigation",
      "awcms_module_jobs",
      "awcms_module_health_checks"
    ]) {
      expect(granted.awcms_worker[table]).toBeUndefined();
      expect(granted.awcms_setup[table]).toBeUndefined();
    }
    // awcms_worker never touches the permission catalog or the setup lock.
    expect(granted.awcms_worker.awcms_permissions).toBeUndefined();
    expect(granted.awcms_worker.awcms_setup_state).toBeUndefined();
  });
});
