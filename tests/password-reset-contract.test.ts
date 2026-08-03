/**
 * Contract tests for password recovery (Wave 2 delta auth) — the invariants
 * that live across files, where a change on one side is only wrong because of
 * what the other side says.
 *
 * Two of these cover ground no other gate can reach:
 *
 * - `tests/module-boundary.test.ts` reads IMPORT statements, so it can prove
 *   `identity_access` does not import `email`'s code. It cannot see a raw
 *   `INSERT INTO awcms_email_messages`, which crosses the same boundary in SQL.
 *   That is exactly what the awcms-micro original did, and what the
 *   `auth_notification` port replaced.
 * - `bun run api:tenant-route:check` proves the reset routes do not hand-roll
 *   `withTenant`. It cannot prove they still declare a work class, because they
 *   cannot use `defineTenantRoute` (no session to authorize).
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";
import { listModules } from "../src/modules";

const MIGRATION = "sql/073_awcms_identity_password_reset_schema.sql";
const TABLE = "awcms_password_reset_tokens";

function moduleByKey(key: string) {
  const found = listModules().find((module) => module.key === key);
  expect(found).toBeDefined();
  return found!;
}

describe("the auth_notification capability seam", () => {
  test("email provides it and identity_access consumes it, non-optionally", () => {
    expect(moduleByKey("email").capabilities?.provides).toContain(
      "auth_notification"
    );

    const consumed = moduleByKey(
      "identity_access"
    ).capabilities?.consumes?.find(
      (entry) => entry.capability === "auth_notification"
    );

    expect(consumed).toBeDefined();
    expect(consumed!.providedBy).toBe("email");
    // NOT optional: `forgot.ts` hard-imports the adapter, so a registry without
    // a provider is a build error, and `modules:compose:check` should say so
    // rather than skipping the check.
    expect(consumed!.optional ?? false).toBe(false);
  });

  test("it is versioned in the capability registry", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.auth_notification).toMatch(
      /^\d+\.\d+\.\d+$/
    );
  });

  test("it is a capability and NOT a dependency, because the reverse edge already exists", () => {
    // `email` depends on `identity_access`. Declaring `identity_access → email`
    // as a dependency would close a cycle and turn `modules:dag:check` red —
    // which is the whole reason this relationship is modelled as a capability.
    expect(moduleByKey("email").dependencies).toContain("identity_access");
    expect(moduleByKey("identity_access").dependencies).not.toContain("email");
  });

  test("identity_access never writes into email's table", async () => {
    const offenders: string[] = [];

    for await (const file of new Bun.Glob(
      "src/modules/identity-access/**/*.ts"
    ).scan({ cwd: process.cwd() })) {
      const source = await readFile(file, "utf8");

      if (
        /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+awcms_email_/i.test(source)
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("the reset routes", () => {
  const routes = [
    "src/pages/api/v1/auth/password/forgot.ts",
    "src/pages/api/v1/auth/password/reset.ts"
  ];

  test.each(routes)("%s declares an explicit work class", async (route) => {
    const source = await readFile(route, "utf8");

    // The literal has to be in the ROUTE file, not buried in the helper:
    // `bun run db:work-class:generate` reads route sources, and a class set out
    // of sight would be recorded as an unexamined `"interactive"` default.
    expect(source).toMatch(/workClass:\s*"[a-z_]+"/);
    expect(source).toContain("withPublicAuthTenant");
    expect(source).not.toMatch(/\bwithTenant\s*\(/);
  });

  test.each(routes)(
    "%s rate-limits before touching the database",
    async (route) => {
      const source = await readFile(route, "utf8");

      // Call sites, not the import block at the top of the file.
      const rateLimitCall = source.indexOf("checkSharedRateLimit(");
      const clientCall = source.indexOf("getDatabaseClient()");

      expect(rateLimitCall).toBeGreaterThan(-1);
      expect(clientCall).toBeGreaterThan(-1);
      expect(rateLimitCall).toBeLessThan(clientCall);
    }
  );

  test.each(routes)(
    "%s verifies Turnstile with the password_reset action",
    async (route) => {
      const source = await readFile(route, "utf8");

      // Its own action, never LOGIN_TURNSTILE_ACTION: a token solved on the login
      // form must not be replayable against an unauthenticated endpoint that
      // writes a row and queues an email.
      expect(source).toContain("PASSWORD_RESET_TURNSTILE_ACTION");
      expect(source).not.toContain("LOGIN_TURNSTILE_ACTION");
    }
  );

  test("the recovery pages are claimed by identity_access", () => {
    const claimed = moduleByKey("identity_access").api?.routes ?? [];

    expect(claimed).toContain("/forgot-password");
    expect(claimed).toContain("/reset-password");
  });
});

describe("the reset-token migration", () => {
  test("forces RLS and isolates by tenant", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    // ENABLE alone is inert for the table owner — the pairing is the point.
    expect(sql).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    expect(sql).toContain(
      "tenant_id = current_setting('app.current_tenant_id')::uuid"
    );
  });

  test("grants the worker only what the purge engine needs", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const grants = sql
      .split("\n")
      .filter((line) => line.startsWith("GRANT") && line.includes(TABLE));

    // The worker runs the data_lifecycle GENERIC purge and nothing else here:
    // it never issues a token (no INSERT) and never redeems one (no UPDATE).
    expect(grants).toEqual([
      `GRANT SELECT, DELETE ON ${TABLE} TO awcms_worker;`
    ]);
  });

  test("indexes the cursor path the lifecycle descriptor claims to require", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const descriptor = moduleByKey("identity_access").dataLifecycle?.find(
      (entry) => entry.tableName === TABLE
    );

    expect(descriptor).toBeDefined();
    expect(descriptor!.executionMode).toBe("generic");
    expect(descriptor!.cursorColumn).toBe("created_at");
    // A descriptor may declare an index it needs; only the migration can make
    // it exist. This is the pair that keeps the claim honest.
    expect(sql).toContain(`ON ${TABLE} (tenant_id, created_at)`);
    expect(descriptor!.requiredIndexes[0]!.columns).toEqual([
      "tenant_id",
      "created_at"
    ]);
  });

  test("stores only a hash, never the raw token", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    expect(sql).toContain("token_hash text NOT NULL");
    expect(sql).not.toMatch(/^\s*token text/m);
  });
});

describe("the public API contract", () => {
  test("both operations are reviewed entries on the public-operation allowlist", async () => {
    const source = await readFile("scripts/api-spec-check.ts", "utf8");

    // `security: []` on an operation is only legitimate when it is on this
    // list — the list is the review record for every unauthenticated surface.
    expect(source).toContain('"postAuthPasswordForgot"');
    expect(source).toContain('"postAuthPasswordReset"');
  });

  test("the fragment declares both as unauthenticated and tenant-bound", async () => {
    const fragment = await readFile(
      "openapi/modules/identity-access.openapi.yaml",
      "utf8"
    );

    for (const path of [
      "/api/v1/auth/password/forgot:",
      "/api/v1/auth/password/reset:"
    ]) {
      const start = fragment.indexOf(path);
      expect(start).toBeGreaterThan(-1);

      const block = fragment.slice(start, start + 1200);
      expect(block).toContain("security: []");
      expect(block).toContain("X-AWCMS-Tenant-ID");
    }
  });
});
