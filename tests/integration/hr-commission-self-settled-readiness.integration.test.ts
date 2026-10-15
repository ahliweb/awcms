/**
 * `checkCommissionAccrualsNotSelfSettled` against a real PostgreSQL (WORLD 2:
 * the check calls `getDatabaseClient()` itself; see harness.ts). Issue #1019:
 * an accrual whose beneficiary snapshot equals a stamped approver, releaser or
 * payer escaped separation of duties before the fix, and only this check finds
 * it.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { checkCommissionAccrualsNotSelfSettled } from "../../scripts/security-readiness";
import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "cf000000-0000-4000-8000-00000000000a";
const TENANT_B = "cf000000-0000-4000-8000-00000000000b";

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

async function seedUser(tenantId: string): Promise<string> {
  counter += 1;
  const admin = getHandlerAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${counter}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`self-${counter}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

/**
 * An APPROVED accrual of `beneficiary`, approved by `approver`, written with
 * triggers and foreign keys off (a pre-fix row): this file is about the check,
 * not about how an accrual is born.
 */
async function seedApproved(
  tenantId: string,
  beneficiary: string,
  approver: string
): Promise<string> {
  counter += 1;
  const id = crypto.randomUUID();

  await getHandlerAdminSql().begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");
    await tx`
      INSERT INTO awcms_hr_commission_accruals
        (id, tenant_id, employment_id, rule_id, rule_key, rule_version,
         source_type, source_ref, calculation, base_amount, rate, amount,
         currency_code, occurred_at, occurred_on, request_digest, status,
         approved_at, approved_by, beneficiary_tenant_user_id)
      VALUES (${id}, ${tenantId}, gen_random_uuid(), gen_random_uuid(), 'upsell', 1,
              'sale_line', ${`SS-${counter}`}, 'percent', 1, 2.5, 0.03, 'XTS',
              '2026-03-10T10:00:00Z', '2026-03-10', ${"a".repeat(64)}, 'approved',
              now(), ${approver}, ${beneficiary})
    `;
  });

  return id;
}

suite("commission self-settled readiness check (Issue #1019)", () => {
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
    await seedTenant(TENANT_A, "self-ready-a");
    await seedTenant(TENANT_B, "self-ready-b");
  }, 30000);

  test("passes, and says how many tenants it looked at, when two people settled every accrual", async () => {
    if (!handlerReady) return;
    await seedApproved(
      TENANT_A,
      await seedUser(TENANT_A),
      await seedUser(TENANT_A)
    );

    const result = await checkCommissionAccrualsNotSelfSettled();

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain("2 active tenant(s) scanned");
  }, 60000);

  test("names the accrual its beneficiary approved, in its own tenant only, ids only", async () => {
    if (!handlerReady) return;
    await seedApproved(
      TENANT_A,
      await seedUser(TENANT_A),
      await seedUser(TENANT_A)
    );
    const self = await seedUser(TENANT_B);
    const bad = await seedApproved(TENANT_B, self, self);

    const result = await checkCommissionAccrualsNotSelfSettled();

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain(bad);
    expect(result.evidence).toContain(TENANT_B);
    expect(result.evidence).not.toContain(TENANT_A);
    expect(result.evidence).not.toContain("@example.test");
    expect(result.evidence).not.toContain(self);
  }, 60000);
});
