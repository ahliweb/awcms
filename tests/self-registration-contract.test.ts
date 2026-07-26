/**
 * Cross-file contracts for self-registration (Wave 2 delta auth) — the
 * invariants where a change on one side is only wrong because of what another
 * side says.
 *
 * The load-bearing one is the public endpoint's shape. Everything about this
 * feature's safety rests on "the public path creates no account and grants no
 * privilege", and that is a property of what the route and validator DO NOT
 * contain, which no type or runtime test observes.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PUBLIC_ROUTE = "src/pages/api/v1/auth/register.ts";
const ADMIN_ROUTES = [
  "src/pages/api/v1/registration-requests/index.ts",
  "src/pages/api/v1/registration-requests/[id]/approve.ts",
  "src/pages/api/v1/registration-requests/[id]/reject.ts"
];
const SCHEMA = "sql/074_awcms_identity_self_registration_schema.sql";
const PERMISSIONS = "sql/075_awcms_identity_self_registration_permissions.sql";
const TABLE = "awcms_registration_requests";

function identityAccess() {
  const module = listModules().find((entry) => entry.key === "identity_access");
  expect(module).toBeDefined();
  return module!;
}

describe("the public registration endpoint", () => {
  test("is gated off by default and answers 404 when disabled", async () => {
    const source = await readFile(PUBLIC_ROUTE, "utf8");

    // 404, not 403: a distinct code would make the deployment switch
    // discoverable by probing, which is the one thing the gate should not leak.
    expect(source).toContain("isSelfRegistrationEnabled()");
    expect(source).toMatch(/isSelfRegistrationEnabled\(\)[\s\S]{0,120}404/);
  });

  test("creates no account and touches no auth table", async () => {
    const source = await readFile(PUBLIC_ROUTE, "utf8");

    for (const forbidden of [
      "awcms_identities",
      "awcms_tenant_users",
      "awcms_access_assignments",
      "hashPassword"
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("the validator returns exactly two fields, so no privilege input can reach the row", async () => {
    const source = await readFile(
      "src/modules/identity-access/domain/self-registration-validation.ts",
      "utf8"
    );

    // Whitelist by construction: the returned object literal is the only thing
    // the service sees, and it names its keys explicitly.
    expect(source).toContain("loginIdentifier: (record.loginIdentifier");
    expect(source).toContain("displayName: (record.displayName");

    // Asserted as "never READ off the untrusted body", not as "the string does
    // not appear": the file's doc comment names the fields it refuses, and its
    // import path contains `password-reset-policy`, so a plain grep fails on
    // the documentation instead of on the code — a gate that goes red for the
    // wrong reason teaches people to weaken it.
    //
    // `record` IS the untrusted body. Every field that reaches the returned
    // value comes from a `record.<name>` read, so enumerating the reads is
    // exactly enumerating what a public caller can influence.
    // (`tests/self-registration-domain.test.ts` proves the same property at
    // runtime by asserting the returned key set; this is the structural
    // backstop.)
    const reads = new Set(
      [...source.matchAll(/record\.([A-Za-z_$][\w$]*)/g)].map(
        (match) => match[1]!
      )
    );

    expect([...reads].sort()).toEqual(["displayName", "loginIdentifier"]);
  });

  test("rate-limits before touching the database, with its own Turnstile action", async () => {
    const source = await readFile(PUBLIC_ROUTE, "utf8");
    const rateLimitCall = source.indexOf("checkRateLimit(");
    const clientCall = source.indexOf("getDatabaseClient()");

    expect(rateLimitCall).toBeGreaterThan(-1);
    expect(clientCall).toBeGreaterThan(-1);
    expect(rateLimitCall).toBeLessThan(clientCall);

    expect(source).toContain("REGISTER_TURNSTILE_ACTION");
    expect(source).not.toContain("LOGIN_TURNSTILE_ACTION");
  });

  test("is a reviewed entry on the public-operation allowlist", async () => {
    const source = await readFile("scripts/api-spec-check.ts", "utf8");
    expect(source).toContain('"postAuthRegister"');
  });
});

describe("the admin routes", () => {
  test.each(ADMIN_ROUTES)(
    "%s goes through defineTenantRoute",
    async (route) => {
      const source = await readFile(route, "utf8");

      expect(source).toContain("defineTenantRoute");
      expect(source).not.toMatch(/\bwithTenant\s*\(/);
      expect(source).toMatch(/workClass:\s*"[a-z_]+"/);
    }
  );

  test("approve and reject gate on DIFFERENT actions", async () => {
    const approve = await readFile(
      "src/pages/api/v1/registration-requests/[id]/approve.ts",
      "utf8"
    );
    const reject = await readFile(
      "src/pages/api/v1/registration-requests/[id]/reject.ts",
      "utf8"
    );

    // The whole point of the split: admitting a person and clearing spam are
    // different authorities, and default-deny belongs on the consequential one.
    expect(approve).toMatch(/activityCode:\s*"registration_requests"/);
    expect(approve).toMatch(/action:\s*"approve"/);
    expect(reject).toMatch(/activityCode:\s*"registration_requests"/);
    expect(reject).toMatch(/action:\s*"reject"/);
    expect(approve).not.toMatch(/action:\s*"reject"/);
  });

  test("rejection notifies nobody", async () => {
    const reject = await readFile(
      "src/pages/api/v1/registration-requests/[id]/reject.ts",
      "utf8"
    );

    // A rejection email confirms to an anonymous submitter that this tenant
    // exists and reviewed them — the disclosure the submit endpoint refuses.
    expect(reject).not.toContain("AuthNotification");
    expect(reject).not.toContain("notifications");
  });
});

describe("permissions", () => {
  test("the three actions are declared AND seeded", async () => {
    const declared = identityAccess()
      .permissions!.filter(
        (entry) => entry.activityCode === "registration_requests"
      )
      .map((entry) => entry.action)
      .sort();

    expect(declared).toEqual(["approve", "read", "reject"]);

    // A descriptor entry with no seed row is a permission nobody can ever hold.
    const seed = await readFile(PERMISSIONS, "utf8");
    for (const action of declared) {
      expect(seed).toContain(`'registration_requests', '${action}'`);
    }
  });

  test("the admin queue link gates on the read action", () => {
    const nav = identityAccess().navigation?.find(
      (entry) => entry.path === "/admin/registrations"
    );

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe(
      "identity_access.registration_requests.read"
    );
  });

  test("the routes are claimed by identity_access", () => {
    const claimed = identityAccess().api?.routes ?? [];

    expect(claimed).toContain("/api/v1/registration-requests");
    expect(claimed).toContain("/register");
  });
});

describe("the schema", () => {
  test("forces RLS and isolates by tenant", async () => {
    const sql = await readFile(SCHEMA, "utf8");

    expect(sql).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    expect(sql).toContain(
      "tenant_id = current_setting('app.current_tenant_id')::uuid"
    );
  });

  test("stores no credential at all", async () => {
    const sql = await readFile(SCHEMA, "utf8");

    // The departure from awcms-micro, pinned: an anonymous submitter's secret
    // is never held for an account that may never exist.
    expect(sql).not.toMatch(/^\s*password_hash/m);
    expect(sql).not.toMatch(/^\s*password/m);
  });

  test("allows only one PENDING request per identifier, so a rejected applicant can reapply", async () => {
    const sql = await readFile(SCHEMA, "utf8");

    expect(sql).toContain(
      `ON ${TABLE} (tenant_id, login_identifier)\n  WHERE status = 'pending'`
    );
  });

  test("grants the worker only what the purge engine needs", async () => {
    const sql = await readFile(SCHEMA, "utf8");
    const grants = sql
      .split("\n")
      .filter((line) => line.startsWith("GRANT") && line.includes(TABLE));

    // No INSERT, no UPDATE: a worker able to write here could manufacture an
    // approved registration, i.e. an account.
    expect(grants).toEqual([
      `GRANT SELECT, DELETE ON ${TABLE} TO awcms_worker;`
    ]);
  });

  test("the lifecycle descriptor and the migration agree on the cursor index", async () => {
    const sql = await readFile(SCHEMA, "utf8");
    const descriptor = identityAccess().dataLifecycle?.find(
      (entry) => entry.tableName === TABLE
    );

    expect(descriptor).toBeDefined();
    expect(descriptor!.executionMode).toBe("generic");
    expect(descriptor!.cursorColumn).toBe("created_at");
    expect(sql).toContain(`ON ${TABLE} (tenant_id, created_at)`);
  });
});
