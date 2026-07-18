/**
 * Issue #141 / #155 — contract tests for `sql/019_awcms_db_role_separation.sql`
 * (the least-privilege `awcms_app` runtime role) and for the accuracy of the
 * role documentation that surrounds it.
 *
 * These are static-text assertions on purpose. The behavioural properties
 * (role is non-superuser/non-BYPASSRLS, RLS actually hides other tenants' rows,
 * an unset GUC yields zero rows rather than an error) can only be proven
 * against a real PostgreSQL connected AS `awcms_app`, which was done manually
 * against Postgres 18 when this shipped and belongs in `tests/integration/`,
 * not here. What this file locks down instead are the ways this migration can
 * silently rot or be regressed by an edit that "looks fine":
 *
 * 1. Ordering — `GRANT` to a role that does not exist yet aborts the whole
 *    migration transaction.
 * 2. Privilege creep — an `awcms_app` that gains SUPERUSER/BYPASSRLS/ownership
 *    makes every `FORCE ROW LEVEL SECURITY` in `sql/017` inert again, i.e. it
 *    silently undoes the entire point of this migration AND of #139.
 * 3. DML in this file — a migration that writes rows to a FORCE-RLS table
 *    passes on an empty CI database and fails on a populated production one
 *    (see `sql/018`'s NO FORCE -> DML -> FORCE pattern).
 * 4. The fail-closed GUC default disappearing — without it, a query outside
 *    `withTenant()` throws instead of returning zero rows.
 * 5. The #155 class of bug: docs/comments asserting a security property or a
 *    file that does not exist.
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const MIGRATION_PATH = "sql/019_awcms_db_role_separation.sql";
const migrationSql = readRepoFile(MIGRATION_PATH);

/** Strips `--` line comments so prose about SQL is never mistaken for SQL. */
function statementsOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const migrationStatements = statementsOnly(migrationSql);

describe("sql/019 — awcms_app role creation", () => {
  test("creates the role idempotently (re-applying must not fail on an existing role)", () => {
    expect(migrationStatements).toMatch(/CREATE ROLE awcms_app\b/);
    expect(migrationStatements).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'awcms_app'\)/
    );
  });

  test("creates the role BEFORE granting to it", () => {
    const createIndex = migrationStatements.indexOf("CREATE ROLE awcms_app");
    const firstGrantIndex = migrationStatements.search(/GRANT\b/);

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(firstGrantIndex).toBeGreaterThanOrEqual(0);
    // A GRANT to a not-yet-created role aborts the migration transaction.
    expect(createIndex).toBeLessThan(firstGrantIndex);
  });

  test("creates the role NOLOGIN and without a password", () => {
    expect(migrationStatements).toMatch(/CREATE ROLE awcms_app NOLOGIN/);
    // A password is a secret; deployment sets it via ALTER ROLE, never the repo.
    expect(migrationStatements).not.toMatch(/PASSWORD/i);
  });

  test("never grants the role attributes that would bypass RLS entirely", () => {
    // Any of these makes sql/017's FORCE ROW LEVEL SECURITY inert for this role,
    // silently reverting tenant isolation to "the app's WHERE clauses only".
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
});

describe("sql/019 — fail-closed tenant GUC", () => {
  test("sets the all-zero UUID default on the role", () => {
    // Policies are USING (tenant_id = current_setting('app.current_tenant_id')::uuid).
    // current_setting/1 THROWS on an unset GUC, so without this default a query
    // outside withTenant() 500s; with it, it matches no real tenant -> zero rows.
    expect(migrationStatements).toMatch(
      /ALTER ROLE awcms_app SET app\.current_tenant_id = '00000000-0000-0000-0000-000000000000'/
    );
  });

  test("the default is a UUID that no tenant row can plausibly hold", () => {
    const match = migrationStatements.match(
      /ALTER ROLE awcms_app SET app\.current_tenant_id = '([^']+)'/
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("sql/019 — grants", () => {
  test("grants DML + schema usage, and default privileges for future tables", () => {
    expect(migrationStatements).toMatch(
      /GRANT USAGE ON SCHEMA public TO awcms_app/
    );
    expect(migrationStatements).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO awcms_app/
    );
    expect(migrationStatements).toMatch(
      /GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO awcms_app/
    );
    expect(migrationStatements).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awcms_app/
    );
  });

  test("never grants DDL-ish rights on the schema", () => {
    // CREATE on schema public would let the runtime role define its own tables
    // (and own them -> owner bypass of RLS on anything it creates).
    expect(migrationStatements).not.toMatch(
      /GRANT[^;]*\bCREATE\b[^;]*ON SCHEMA/
    );
  });

  test("contains no DML — it would break on a populated production database", () => {
    // A migration that writes to a FORCE-RLS table throws
    // `unrecognized configuration parameter "app.current_tenant_id"` under the
    // migration owner, but ONLY when the table has rows: green on empty CI,
    // red in production. sql/019 has no reason to write rows at all.
    for (const dml of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+awcms_/i,
      /\bDELETE\s+FROM\b/i
    ]) {
      expect(migrationStatements).not.toMatch(dml);
    }
  });
});

describe("Issue #155 — role documentation must not assert what does not exist", () => {
  test("client.ts cites a migration file that really exists", () => {
    const clientSource = readRepoFile("src/lib/database/client.ts");

    // The original bug: client.ts documented the role mapping against
    // `sql/045_awcms_db_role_separation.sql`, which never existed here (that is
    // awcms-mini's numbering).
    expect(clientSource).not.toMatch(/sql\/045/);

    const citedMigrations =
      clientSource.match(/sql\/\d{3}_awcms_[a-z0-9_]+\.sql/g) ?? [];
    expect(citedMigrations.length).toBeGreaterThan(0);

    for (const cited of citedMigrations) {
      expect(() => readRepoFile(cited)).not.toThrow();
    }
  });

  test("the awcms_worker/awcms_setup split lives in sql/022, NOT in this awcms_app migration (atomic migrations)", () => {
    // The worker/setup roles are real now (Issue #163) — but they belong in
    // their OWN migration (sql/022), not retrofitted into sql/019. sql/019 must
    // stay exactly the awcms_app role it always was, so its contract tests above
    // keep meaning what they say.
    const splitRoles = /\bCREATE ROLE (awcms_worker|awcms_setup)\b/;
    expect(migrationStatements).not.toMatch(splitRoles);

    const splitMigration = readRepoFile(
      "sql/022_awcms_db_worker_setup_roles.sql"
    );
    expect(splitMigration).toMatch(/CREATE ROLE awcms_worker\b/);
    expect(splitMigration).toMatch(/CREATE ROLE awcms_setup\b/);
  });

  test(".env.example documents the opt-in role mapping AND the fallback", () => {
    const envExample = readRepoFile(".env.example");

    expect(envExample).toMatch(/^WORKER_DATABASE_URL=$/m);
    expect(envExample).toMatch(/^SETUP_DATABASE_URL=$/m);
    // Opt-in mapping to the real roles is now advertised…
    expect(envExample).toMatch(/awcms_worker/);
    expect(envExample).toMatch(/awcms_setup/);
    // …but the supported default is still the DATABASE_URL fallback (non-breaking).
    expect(envExample).toMatch(/fallback ke `?DATABASE_URL`?/i);
  });

  test("reporting README documents this repo's tenant header, not mini's", () => {
    const reportingReadme = readRepoFile("src/modules/reporting/README.md");

    expect(reportingReadme).not.toMatch(/X-AWCMS-Mini-Tenant-ID/);
    expect(reportingReadme).toMatch(/X-AWCMS-Tenant-ID/);
  });

  test("the idempotency store cites the migration that actually defines it", () => {
    const idempotencySource = readRepoFile(
      "src/modules/_shared/idempotency.ts"
    );
    const definingMigration = readRepoFile(
      "sql/009_awcms_domain_event_runtime_schema.sql"
    );

    // Ground truth: the table is created in 009 here (012 is mini's number).
    expect(definingMigration).toMatch(
      /CREATE TABLE IF NOT EXISTS awcms_idempotency_keys/
    );
    expect(idempotencySource).toMatch(/migration 009/);
  });
});
