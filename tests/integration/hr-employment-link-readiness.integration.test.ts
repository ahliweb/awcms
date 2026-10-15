/**
 * `checkHrEmploymentLinksMatchProfile` against a real PostgreSQL (WORLD 2 — the
 * check calls `getDatabaseClient()` itself; see harness.ts). Issue #979, finding
 * PS-14: a link made before the fix is never re-checked by the application or
 * the `awcms_hr_employments_link_guard` trigger, so the readiness check is the
 * only thing that finds it.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { checkHrEmploymentLinksMatchProfile } from "../../scripts/security-readiness";
import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "ce000000-0000-4000-8000-00000000000a";
const TENANT_B = "ce000000-0000-4000-8000-00000000000b";

let handlerReady = false;
let counter = 0;

async function seedTenant(id: string, code: string): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

/** A login whose identity belongs to `profileId`. */
async function seedLogin(tenantId: string, profileId: string): Promise<string> {
  const admin = getHandlerAdminSql();
  counter += 1;
  const identity = (await admin`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profileId}, ${`link-${counter}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function seedProfile(tenantId: string): Promise<string> {
  counter += 1;
  const rows = (await getHandlerAdminSql()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${counter}`}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** An employment of `profileId` linked to `loginId`. */
async function seedEmployment(
  tenantId: string,
  profileId: string,
  loginId: string
): Promise<string> {
  counter += 1;
  const admin = getHandlerAdminSql();
  // A pre-fix row: the link guard is taken out of the way to create it.
  await admin`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard_insert`;

  try {
    const rows = (await admin`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
      VALUES (${tenantId}, ${profileId}, ${`R-${counter}`}, '2026-01-01', ${loginId})
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  } finally {
    await admin`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  }
}

suite("employment link readiness check (Issue #979, PS-14)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  }, 120000);

  afterAll(async () => {
    if (handlerReady) {
      await resetHandlerDatabase();
      await teardownHandlerDatabase();
    }
  }, 60000);

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    await seedTenant(TENANT_A, "link-ready-a");
    await seedTenant(TENANT_B, "link-ready-b");
  }, 30000);

  test("passes, and says how many tenants it looked at, when every link matches", async () => {
    if (!handlerReady) return;
    const profile = await seedProfile(TENANT_A);
    await seedEmployment(TENANT_A, profile, await seedLogin(TENANT_A, profile));

    const result = await checkHrEmploymentLinksMatchProfile();

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain("2 active tenant(s) scanned");
  }, 60000);

  test("names the employment linked to another person's login, in its own tenant only, ids only", async () => {
    if (!handlerReady) return;
    const okProfile = await seedProfile(TENANT_A);
    await seedEmployment(
      TENANT_A,
      okProfile,
      await seedLogin(TENANT_A, okProfile)
    );

    const victim = await seedProfile(TENANT_B);
    const stranger = await seedLogin(TENANT_B, await seedProfile(TENANT_B));
    const bad = await seedEmployment(TENANT_B, victim, stranger);

    const result = await checkHrEmploymentLinksMatchProfile();

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain(bad);
    expect(result.evidence).toContain(TENANT_B);
    expect(result.evidence).not.toContain(TENANT_A);
    // Ids only: no login identifier or name reaches an operator log.
    expect(result.evidence).not.toContain("@example.test");
    expect(result.evidence).not.toContain("Person");
  }, 60000);

  test("turns green once the bad link is removed", async () => {
    if (!handlerReady) return;
    const victim = await seedProfile(TENANT_A);
    const stranger = await seedLogin(TENANT_A, await seedProfile(TENANT_A));
    const bad = await seedEmployment(TENANT_A, victim, stranger);

    expect((await checkHrEmploymentLinksMatchProfile()).status).toBe("fail");

    await getHandlerAdminSql()`
      UPDATE awcms_hr_employments SET tenant_user_id = NULL WHERE id = ${bad}
    `;

    expect((await checkHrEmploymentLinksMatchProfile()).status).toBe("pass");
  }, 60000);
});
