/**
 * Pins `sql/261` (#1004, H2): `awcms_principal_has_other_tenant_identity`, the
 * narrow SECURITY DEFINER boolean that lets TOTP enrolment refuse the fresh-SSO
 * exemption for a person who works in more than one tenant.
 *
 * Proven under the non-superuser runtime role `awcms_app`, because a superuser
 * bypasses both the function boundary and RLS and would pass for the wrong
 * reason.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  appRoleActivated,
  assertRejected,
  getAdminSql,
  getAppRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function seedIdentity(
  tenantId: string,
  loginIdentifier: string
): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'Reach Test') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, 'not-a-real-hash')
    RETURNING id
  `) as { id: string }[];

  return (await linkIdentityToPrincipal(
    admin,
    identity[0]!.id,
    loginIdentifier
  )) as string;
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "awcms_principal_has_other_tenant_identity (integration, sql/261)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });
    afterAll(async () => {
      await teardownIntegrationDatabase();
    });
    beforeEach(async () => {
      await resetDatabase();
      await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'tenant-a', 'Tenant A'), (${TENANT_B}, 'tenant-b', 'Tenant B')
      ON CONFLICT (id) DO NOTHING
    `;
    });

    test("awcms_app can execute it and gets a plain boolean from inside its own tenant", async () => {
      if (!appRoleActivated) return;
      const app = getAppRoleSql();
      const both = await seedIdentity(TENANT_A, "both@example.com");
      await seedIdentity(TENANT_B, "both@example.com");
      const onlyA = await seedIdentity(TENANT_A, "only-a@example.com");

      const shared = (await withTenantOrThrow(
        app,
        TENANT_A,
        (tx) =>
          tx`SELECT awcms_principal_has_other_tenant_identity(${both}, ${TENANT_A}) AS other`
      )) as { other: boolean }[];
      expect(shared[0]!.other).toBe(true);

      const single = (await withTenantOrThrow(
        app,
        TENANT_A,
        (tx) =>
          tx`SELECT awcms_principal_has_other_tenant_identity(${onlyA}, ${TENANT_A}) AS other`
      )) as { other: boolean }[];
      expect(single[0]!.other).toBe(false);
    });

    test("awcms_app cannot become the function's owner role", async () => {
      if (!appRoleActivated) return;
      const app = getAppRoleSql();

      await assertRejected(
        app.begin(async (tx) => {
          await tx`SET LOCAL ROLE awcms_principal_reach`;
        }),
        "SET ROLE awcms_principal_reach by awcms_app"
      );
    });

    test("the owner role reads only (tenant_id, principal_id) - never the hash or login identifier", async () => {
      const admin = getAdminSql();
      const rows = (await admin`
      SELECT
        has_column_privilege('awcms_principal_reach', 'awcms_identities', 'principal_id', 'SELECT') AS principal_id,
        has_column_privilege('awcms_principal_reach', 'awcms_identities', 'tenant_id', 'SELECT') AS tenant_id,
        has_column_privilege('awcms_principal_reach', 'awcms_identities', 'password_hash', 'SELECT') AS password_hash,
        has_column_privilege('awcms_principal_reach', 'awcms_identities', 'login_identifier', 'SELECT') AS login_identifier,
        (SELECT rolcanlogin OR rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'awcms_principal_reach') AS powerful
    `) as Record<string, boolean>[];

      expect(rows[0]).toEqual({
        principal_id: true,
        tenant_id: true,
        password_hash: false,
        login_identifier: false,
        powerful: false
      });
    });

    test("the function is SECURITY DEFINER, owned by the reach role, with a pinned search_path", async () => {
      const rows = (await getAdminSql()`
      SELECT p.prosecdef, p.proconfig, r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'awcms_principal_has_other_tenant_identity'
    `) as { prosecdef: boolean; proconfig: string[] | null; owner: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.prosecdef).toBe(true);
      expect(rows[0]!.owner).toBe("awcms_principal_reach");
      expect(rows[0]!.proconfig).toContain("search_path=public, pg_temp");
    });

    test("EXECUTE is not public, and the runtime role still sees only its own tenant's identities", async () => {
      if (!appRoleActivated) return;
      const admin = getAdminSql();
      const pub = (await admin`
      SELECT has_function_privilege('public', 'awcms_principal_has_other_tenant_identity(uuid, uuid)', 'EXECUTE') AS p
    `) as { p: boolean }[];
      expect(pub[0]!.p).toBe(false);

      await seedIdentity(TENANT_A, "a-only@example.com");
      await seedIdentity(TENANT_B, "b-only@example.com");
      const app = getAppRoleSql();
      const visible = (await withTenantOrThrow(
        app,
        TENANT_A,
        (tx) => tx`SELECT login_identifier FROM awcms_identities`
      )) as { login_identifier: string }[];
      expect(visible.map((row) => row.login_identifier)).toEqual([
        "a-only@example.com"
      ]);
    });
  }
);
