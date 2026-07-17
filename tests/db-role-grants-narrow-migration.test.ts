/**
 * Issue #160 — contract tests for `sql/021_awcms_db_role_grants_narrow.sql`,
 * the migration that narrows `awcms_app`'s blanket DML on the GLOBAL, RLS-free
 * tables (the residual `sql/019` documented and left for a follow-up).
 *
 * Static-text assertions, same rationale as
 * `db-role-separation-migration.test.ts`: the behavioural property (an
 * `awcms_app` LOGIN can no longer DELETE a tenant but can still INSERT one
 * through the setup path) can only be proven against a real PostgreSQL
 * connected AS `awcms_app`, which was done manually against Postgres 18 when
 * this shipped. What this file locks down is the ways this migration can
 * silently rot or be regressed by an edit that "looks fine":
 *
 * 1. It must REVOKE exactly the confirmed-residual privileges and no more.
 * 2. It must NOT revoke the grants real code paths depend on (INSERT/UPDATE on
 *    awcms_tenants/awcms_setup_state — the setup fallback + tenant-settings).
 * 3. It must contain no DML (a write to a FORCE-RLS table is green on empty CI,
 *    red on a populated production DB).
 * 4. It must NOT create the deferred awcms_worker/awcms_setup roles (that split
 *    is explicitly out of scope for #160 as implemented).
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const MIGRATION_PATH = "sql/021_awcms_db_role_grants_narrow.sql";
const migrationSql = readRepoFile(MIGRATION_PATH);

/** Strips `--` line comments so prose about SQL is never mistaken for SQL. */
function statementsOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const migrationStatements = statementsOnly(migrationSql);

describe("sql/021 — revokes the confirmed residual, nothing more", () => {
  test("revokes all writes on the read-only global catalogs", () => {
    expect(migrationStatements).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON awcms_permissions FROM awcms_app/
    );
    expect(migrationStatements).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON awcms_schema_migrations FROM awcms_app/
    );
  });

  test("revokes DELETE (only) on the tenant root and setup singleton", () => {
    expect(migrationStatements).toMatch(
      /REVOKE DELETE ON awcms_tenants FROM awcms_app/
    );
    expect(migrationStatements).toMatch(
      /REVOKE DELETE ON awcms_setup_state FROM awcms_app/
    );
  });

  test("does NOT revoke INSERT/UPDATE on awcms_tenants/awcms_setup_state", () => {
    // The setup-wizard fallback path and the tenant-settings screen run those
    // statements AS awcms_app; revoking them would break both. Only DELETE goes.
    for (const table of ["awcms_tenants", "awcms_setup_state"]) {
      expect(migrationStatements).not.toMatch(
        new RegExp(`REVOKE[^;]*\\b(INSERT|UPDATE)\\b[^;]*ON ${table}\\b`)
      );
    }
  });

  test("does not touch the module-registry tables' grants", () => {
    // Full DML is legitimately kept there (descriptor-sync/health-registry
    // write them at request time). No REVOKE against any of them.
    for (const table of [
      "awcms_modules",
      "awcms_module_dependencies",
      "awcms_module_navigation",
      "awcms_module_jobs",
      "awcms_module_health_checks"
    ]) {
      expect(migrationStatements).not.toMatch(
        new RegExp(`REVOKE[^;]*ON ${table}\\b`)
      );
    }
  });
});

describe("sql/021 — safety invariants", () => {
  test("contains no DML — it would break on a populated production database", () => {
    for (const dml of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+awcms_/i,
      /\bDELETE\s+FROM\b/i
    ]) {
      expect(migrationStatements).not.toMatch(dml);
    }
  });

  test("does not create the deferred awcms_worker/awcms_setup roles", () => {
    // The worker/setup split (mini migration 045) is explicitly out of scope
    // for #160 as implemented — narrowing awcms_app closes the residual on its
    // own. Creating those roles here without the client.ts fallback change
    // would ship dead roles.
    expect(migrationStatements).not.toMatch(
      /\bCREATE ROLE (awcms_worker|awcms_setup)\b/
    );
  });

  test("never grants awcms_app an RLS-bypassing attribute", () => {
    for (const attribute of [
      "SUPERUSER",
      "BYPASSRLS",
      "CREATEDB",
      "CREATEROLE"
    ]) {
      expect(migrationStatements).not.toMatch(new RegExp(`\\b${attribute}\\b`));
    }
  });

  test("only REVOKE/GRANT statements act on the role (pure DDL, idempotent)", () => {
    // Every non-comment statement that names awcms_app must be a REVOKE (this
    // migration only removes privileges). Guards against someone slipping an
    // ALTER ROLE / GRANT / DML in later.
    const roleStatements = migrationStatements
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /\bawcms_app\b/.test(statement));

    expect(roleStatements.length).toBeGreaterThan(0);
    for (const statement of roleStatements) {
      expect(statement).toMatch(/^REVOKE\b/);
    }
  });
});
