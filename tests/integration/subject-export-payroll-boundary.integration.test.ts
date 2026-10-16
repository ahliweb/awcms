/**
 * The subject-access export route and the payroll data boundary (Issue #1018),
 * driven through the REAL handler against a real PostgreSQL.
 *
 * `hr_commission.accruals` is a person's earnings and is exportable to the
 * person (ADR-0142 join through the employment). The route may not hand it out
 * on `data_lifecycle.subject_request.export` alone, so this proves:
 *
 *   1. a caller with ONLY the export permission gets the report WITHOUT the
 *      accruals, the response names the table under `withheld` with the reason,
 *      and no sensitive-read row is written (nothing was read);
 *   2. a caller with BOTH permissions gets the subject's own accruals, nothing
 *      of a colleague's, and one `sensitive_read.commission_accrual` audit row
 *      naming the ids and carrying no amount;
 *   3. the stored Idempotency-Key replay is a READ too: it records again, and
 *      once the second permission is revoked it withholds instead of replaying
 *      the earnings;
 *   4. holding ONLY accruals.read is still a 403 on the export.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as exportSubject } from "../../src/pages/api/v1/data-lifecycle/subject-requests/export";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const READ_KIND = "sensitive_read.commission_accrual";
const EXPORT = "data_lifecycle.subject_request.export";
const ACCRUALS_READ = "hr_commission.accruals.read";

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};
type ExportData = {
  tables: { tableName: string; rows: Record<string, unknown>[] }[];
  withheld: { key: string; reason: string }[];
};

let tenantId = "";
let keyCounter = 0;
let userCounter = 0;
let handlerReady = false;
let subjectUserId = "";
let subjectEmployment = "";
let colleagueEmployment = "";

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "pb-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "PB Co",
      tenantCode: "pb-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });
  expect(setup.status).toBe(200);
  tenantId = setup.body.data.tenantId;
  const login = await invoke(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });
  expect(login.status).toBe(200);
}

async function seedPerson(
  label: string
): Promise<{ profileId: string; tenantUserId: string; identityId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return {
    profileId: profile[0]!.id,
    identityId: identity[0]!.id,
    tenantUserId: tenantUser[0]!.id
  };
}

/** A caller holding exactly `permissionKeys`. */
async function seedCaller(
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string; roleId: string }> {
  const person = await seedPerson(label);
  const sql = admin();
  const token = `pb-${label}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${person.identityId}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${`role-${label}-${userCounter}`}, ${`Role ${label}`})
    RETURNING id
  `) as { id: string }[];

  for (const key of permissionKeys) {
    const [moduleKey, activityCode, action] = key.split(".");
    const permission = (await sql`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
        AND action = ${action!}
    `) as { id: string }[];

    if (!permission[0]) {
      throw new Error(`fixture: permission ${key} is not in the catalogue`);
    }

    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
    `;
  }

  await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
    grantRolePolicy(tx, tenantId, {
      tenantUserId: person.tenantUserId,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "payroll-boundary fixture"
    })
  );

  return {
    token,
    tenantUserId: person.tenantUserId,
    roleId: role[0]!.id
  };
}

async function seedEmployment(profileId: string, no: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
    VALUES (${tenantId}, ${profileId}, ${no}, '2026-01-01')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** Two accruals per employment; written with triggers off (fixtures for a READ). */
async function seedAccruals(employmentId: string, tag: string): Promise<void> {
  await admin().begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`
      INSERT INTO awcms_hr_commission_accruals
        (tenant_id, employment_id, rule_id, rule_key, rule_version, source_type,
         source_ref, calculation, base_amount, rate, amount, currency_code,
         occurred_at, occurred_on, request_digest)
      VALUES
        (${tenantId}, ${employmentId}, ${crypto.randomUUID()}, 'upsell', 1,
         'sale_line', ${`${tag}-1`}, 'percent', 100, 2.5, 2.5, 'XTS',
         '2026-07-01T01:00:00Z', '2026-07-01', ${"a".repeat(64)}),
        (${tenantId}, ${employmentId}, ${crypto.randomUUID()}, 'upsell', 1,
         'sale_line', ${`${tag}-2`}, 'percent', 777, 2.5, 19.425, 'XTS',
         '2026-07-02T01:00:00Z', '2026-07-02', ${"b".repeat(64)})
    `;
  });
}

function nextKey(): string {
  keyCounter += 1;

  return `pb-idem-${keyCounter}-${crypto.randomUUID()}`;
}

function exportAs(token: string, key: string = nextKey()) {
  return invoke<Envelope<ExportData>>(exportSubject, {
    method: "POST",
    path: "/api/v1/data-lifecycle/subject-requests/export",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`,
      "idempotency-key": key
    },
    body: {
      tenantUserId: subjectUserId,
      reason: "subject access request #1018"
    },
    locals: { correlationId: "corr-1018" }
  });
}

async function readAudits(): Promise<
  { attributes: string; actor: string; resource: string }[]
> {
  return (await admin()`
    SELECT attributes::text AS attributes,
           actor_tenant_user_id AS actor,
           resource_type AS resource
    FROM awcms_audit_events
    WHERE tenant_id = ${tenantId} AND action = ${READ_KIND}
  `) as { attributes: string; actor: string; resource: string }[];
}

/** Reads recorded in the actor's current sensitive-read window for the accrual kind. */
async function readWindowCount(actor: string): Promise<number> {
  const rows = (await admin()`
    SELECT read_count FROM awcms_sensitive_read_windows
    WHERE tenant_id = ${tenantId} AND actor_tenant_user_id = ${actor}
      AND kind = ${READ_KIND}
  `) as { read_count: number }[];

  return rows[0] ? Number(rows[0].read_count) : 0;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("subject export vs the payroll boundary (Issue #1018)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    keyCounter = 0;
    await bootstrap();

    const subject = await seedPerson("subject");
    const colleague = await seedPerson("colleague");
    subjectUserId = subject.tenantUserId;
    subjectEmployment = await seedEmployment(subject.profileId, "S-1");
    colleagueEmployment = await seedEmployment(colleague.profileId, "C-1");
    await seedAccruals(subjectEmployment, "subj");
    await seedAccruals(colleagueEmployment, "col");
  });

  test("export permission alone: the earnings are WITHHELD, said so, and no read is recorded", async () => {
    if (!handlerReady) return;
    const caller = await seedCaller("export-only", [EXPORT]);
    const result = await exportAs(caller.token);

    expect(result.status).toBe(200);
    const tables = result.body.data!.tables.map((table) => table.tableName);
    expect(tables).not.toContain("awcms_hr_commission_accruals");
    expect(result.body.data!.withheld).toEqual([
      {
        key: "hr_commission.accruals",
        reason:
          "payroll_boundary: the caller does not hold hr_commission.accruals.read"
      }
    ]);
    expect(await readAudits()).toHaveLength(0);
    // The disclosure itself is still audited, with the withheld table named.
    const disclosed = (await admin()`
      SELECT attributes::text AS attributes FROM awcms_audit_events
      WHERE tenant_id = ${tenantId} AND action = 'subject_data.disclosed'
    `) as { attributes: string }[];
    expect(disclosed[0]!.attributes).toContain("hr_commission.accruals");
  });

  test("both permissions: the subject's own accruals, never a colleague's, with ONE read audit that carries ids and no amount", async () => {
    if (!handlerReady) return;
    const caller = await seedCaller("both", [EXPORT, ACCRUALS_READ]);
    const result = await exportAs(caller.token);

    expect(result.status).toBe(200);
    expect(result.body.data!.withheld).toEqual([]);
    const accruals = result.body.data!.tables.find(
      (table) => table.tableName === "awcms_hr_commission_accruals"
    )!;
    expect(accruals.rows).toHaveLength(2);
    // The SoD snapshot is internal and, after a corrected mislink, may be
    // somebody else's login: never handed out.
    for (const row of accruals.rows) {
      expect(Object.keys(row)).not.toContain("beneficiary_tenant_user_id");
    }
    expect(new Set(accruals.rows.map((row) => row.employment_id))).toEqual(
      new Set([subjectEmployment])
    );
    expect(accruals.rows.map((row) => row.employment_id)).not.toContain(
      colleagueEmployment
    );

    const audits = await readAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor).toBe(caller.tenantUserId);
    expect(audits[0]!.resource).toBe("commission_accrual");
    for (const row of accruals.rows) {
      expect(audits[0]!.attributes).toContain(String(row.id));
    }
    expect(audits[0]!.attributes).not.toContain("19.425");
    expect(audits[0]!.attributes).not.toContain("subj-1");
  });

  test("the stored replay is a read: it is recorded again, and withholds once the permission is revoked", async () => {
    if (!handlerReady) return;
    const caller = await seedCaller("replay", [EXPORT, ACCRUALS_READ]);
    const key = nextKey();

    expect((await exportAs(caller.token, key)).status).toBe(200);
    expect(await readAudits()).toHaveLength(1);

    const replay = await exportAs(caller.token, key);
    expect(replay.status).toBe(200);
    expect(
      replay.body.data!.tables.some(
        (table) => table.tableName === "awcms_hr_commission_accruals"
      )
    ).toBe(true);
    // The replay re-read the earnings, with their amounts (L2/M2): a different
    // mechanism from replaying a stored body.
    const replayed = replay.body.data!.tables.find(
      (table) => table.tableName === "awcms_hr_commission_accruals"
    )!;
    expect(replayed.rows.map((row) => String(row.amount)).sort()).toEqual([
      "19.425000",
      "2.500000"
    ]);
    expect(new Set(replayed.rows.map((row) => row.employment_id))).toEqual(
      new Set([subjectEmployment])
    );
    // And it is its own READ: the window counter, which every recorded read
    // increments (even when the audit row itself is coalesced), went 1 -> 2.
    expect(await readWindowCount(caller.tenantUserId)).toBe(2);

    // M2: the 30-day idempotency record holds the ids and a marker, never an
    // amount.
    const storedBody = (await admin()`
      SELECT response_body::text AS body FROM awcms_idempotency_keys
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}
    `) as { body: string }[];
    expect(storedBody).toHaveLength(1);
    expect(storedBody[0]!.body).not.toContain("19.425");
    expect(storedBody[0]!.body).not.toContain("subj-1");
    expect(storedBody[0]!.body).toContain("payrollRowsStripped");

    // Revoke accruals.read: the same key must no longer replay the earnings.
    await admin()`
      DELETE FROM awcms_role_permissions
      WHERE tenant_id = ${tenantId} AND role_id = ${caller.roleId}
        AND permission_id = (
          SELECT id FROM awcms_permissions
          WHERE module_key = 'hr_commission' AND activity_code = 'accruals'
            AND action = 'read')
    `;
    const after = await exportAs(caller.token, key);
    expect(after.status).toBe(200);
    expect(
      after.body.data!.tables.some(
        (table) => table.tableName === "awcms_hr_commission_accruals"
      )
    ).toBe(false);
    expect(after.body.data!.withheld.map((entry) => entry.key)).toContain(
      "hr_commission.accruals"
    );
    expect(JSON.stringify(after.body)).not.toContain("19.425");
  });

  test("accruals.read alone does not open the export", async () => {
    if (!handlerReady) return;
    const caller = await seedCaller("read-only", [ACCRUALS_READ]);
    const result = await exportAs(caller.token);

    expect(result.status).toBe(403);
  });
});
