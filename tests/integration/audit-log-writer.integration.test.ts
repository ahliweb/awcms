/**
 * What the audit writer actually PUTS IN THE TABLE — against a real database.
 *
 * ## Why this exists
 *
 * `tests/two-sided-attribution.test.ts` guards the two ADR-0091 columns by
 * reading `audit-log.ts` as TEXT and looking for the interpolation that writes
 * them. That test caught a real class of bug — a parameter accepted and then
 * ignored — and it is the only thing standing behind those columns. It is also
 * the shape this repository keeps rediscovering the limits of: a test over
 * source text proves a spelling, and a spelling is not a row. Change how the
 * INSERT is written and the test fails while the behaviour is intact; change
 * what the INSERT MEANS while keeping the spelling and it passes.
 *
 * So the columns are now asserted where they are decided: in the table. The
 * source-text test stays — it is cheap, it runs without a database, and it
 * still catches a dropped field faster than this does — but it is no longer
 * the only witness.
 *
 * ## And the batch writer, which is new
 *
 * `recordAuditEvents` writes N rows in ONE statement, built from a single
 * `jsonb` parameter rather than one array per column (Bun's array binding
 * cannot carry a NULL — it writes the string `null` silently, so a per-column
 * `unnest` over eight nullable columns would have eight chances to be wrong).
 * Every claim in that reasoning is checked here: nulls stay null, `attributes`
 * stays a jsonb OBJECT rather than a jsonb string, redaction still happens, and
 * the singular form — now a batch of one — writes exactly what it wrote before.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  recordAuditEvent,
  recordAuditEvents
} from "../../src/modules/logging/application/audit-log";

const TENANT = "f9999999-9999-4999-8999-999999999999";
const PARTNER_TENANT = "f9999999-9999-4999-8999-999999999aaa";
const ACTOR = "f9000000-0000-4000-8000-000000000001";

type AuditRow = {
  actor_tenant_user_id: string | null;
  actor_tenant_id: string | null;
  delegated_grant_id: string | null;
  module_key: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  severity: string;
  message: string;
  attributes: Record<string, unknown> | null;
  attributes_type: string | null;
  correlation_id: string | null;
};

async function seedFixtures(): Promise<{ grantId: string }> {
  const admin = getAdminSql();

  for (const [id, code] of [
    [TENANT, "audit-writer"],
    [PARTNER_TENANT, "audit-writer-partner"]
  ] as const) {
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Actor')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'audit-writer@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${ACTOR}, ${TENANT}, ${identity[0]!.id})
  `;

  // The delegated-grant column is FK-bound to a real grant, which is FK-bound
  // to a real engagement and a real registered partner. Seeding the whole chain
  // is the only way to write the column at all — which is itself the point:
  // a row cannot claim a grant that does not exist.
  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${TENANT}, 'audit-writer-role', 'Audit Writer Role')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_partners
      (tenant_id, partner_tenant_id, partner_code, display_name)
    VALUES (${TENANT}, ${PARTNER_TENANT}, 'partner-1', 'Partner One')
  `;
  await admin`
    INSERT INTO awcms_partner_managed_tenants
      (tenant_id, partner_tenant_id, engaged_by_tenant_user_id)
    VALUES (${TENANT}, ${PARTNER_TENANT}, ${ACTOR})
  `;
  const grant = (await admin`
    INSERT INTO awcms_delegated_access_grants
      (tenant_id, partner_tenant_id, role_id, approved_by_tenant_user_id,
       purpose, access_code_hash, expires_at)
    VALUES (${TENANT}, ${PARTNER_TENANT}, ${role[0]!.id}, ${ACTOR},
            'support', 'hash-1', now() + interval '7 days')
    RETURNING id
  `) as { id: string }[];

  return { grantId: grant[0]!.id };
}

async function auditRows(): Promise<AuditRow[]> {
  return (await getAdminSql()`
    SELECT actor_tenant_user_id, actor_tenant_id, delegated_grant_id,
           module_key, action, resource_type, resource_id, severity, message,
           attributes, jsonb_typeof(attributes) AS attributes_type,
           correlation_id
    FROM awcms_audit_events
    WHERE tenant_id = ${TENANT}
    ORDER BY message
  `) as AuditRow[];
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the audit writer writes every column it accepts", () => {
  let grantId = "";

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    ({ grantId } = await seedFixtures());
  });

  test("a single event lands with every field, ADR-0091 attribution included", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      recordAuditEvent(tx, {
        tenantId: TENANT,
        actorTenantUserId: ACTOR,
        actorTenantId: PARTNER_TENANT,
        delegatedGrantId: grantId,
        moduleKey: "logging",
        action: "test.single",
        resourceType: "thing",
        resourceId: "res-1",
        severity: "critical",
        message: "a",
        attributes: { kept: "value", nested: { n: 1 } },
        correlationId: "corr-1"
      })
    );

    const rows = await auditRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_tenant_user_id: ACTOR,
      // The two columns the source-text test can only see spelled. A writer
      // that accepted them and dropped them would pass that test on any day it
      // kept the spelling in a comment.
      actor_tenant_id: PARTNER_TENANT,
      delegated_grant_id: grantId,
      module_key: "logging",
      action: "test.single",
      resource_type: "thing",
      resource_id: "res-1",
      severity: "critical",
      message: "a",
      correlation_id: "corr-1"
    });
    // A jsonb OBJECT, not the jsonb scalar string a `JSON.stringify(...)::jsonb`
    // binding would have stored — the trap `db:jsonb-binding:check` refuses.
    expect(rows[0]!.attributes_type).toBe("object");
    expect(rows[0]!.attributes).toEqual({ kept: "value", nested: { n: 1 } });
  });

  test('the optional fields become real NULLs, not the string "null"', async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      recordAuditEvents(tx, [
        {
          tenantId: TENANT,
          moduleKey: "logging",
          action: "test.sparse",
          resourceType: "thing",
          message: "a"
        }
      ])
    );

    const rows = await auditRows();

    expect(rows[0]).toMatchObject({
      actor_tenant_user_id: null,
      actor_tenant_id: null,
      delegated_grant_id: null,
      resource_id: null,
      attributes: null,
      correlation_id: null,
      // The column default, applied because the writer sends the default
      // itself rather than a NULL the NOT NULL column would reject.
      severity: "info"
    });
    expect(rows[0]!.attributes_type).toBeNull();
  });

  test("three events cost ONE query, and all three land intact", async () => {
    const { queries } = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      countQueries(tx, (counting) =>
        recordAuditEvents(counting, [
          {
            tenantId: TENANT,
            moduleKey: "logging",
            action: "test.batch",
            resourceType: "thing",
            resourceId: "res-a",
            message: "a",
            attributes: { i: 1 }
          },
          {
            tenantId: TENANT,
            actorTenantUserId: ACTOR,
            moduleKey: "logging",
            action: "test.batch",
            resourceType: "thing",
            severity: "warning",
            message: "b"
          },
          {
            tenantId: TENANT,
            moduleKey: "logging",
            action: "test.batch",
            resourceType: "thing",
            message: "c",
            correlationId: "corr-c"
          }
        ])
      )
    );

    // One statement, whatever the count. Three rows through the old singular
    // writer would be three.
    expect(queries).toBe(1);

    const rows = await auditRows();

    expect(rows.map((row) => row.message)).toEqual(["a", "b", "c"]);
    // Per-row values must not bleed across rows — the failure mode a
    // column-wise binding makes easy and this shape makes impossible.
    expect(rows[0]!.attributes).toEqual({ i: 1 });
    expect(rows[1]!.attributes).toBeNull();
    expect(rows[0]!.actor_tenant_user_id).toBeNull();
    expect(rows[1]!.actor_tenant_user_id).toBe(ACTOR);
    expect(rows[1]!.severity).toBe("warning");
    expect(rows[2]!.correlation_id).toBe("corr-c");
  });

  test("an empty batch writes nothing and issues no statement", async () => {
    const { queries } = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      countQueries(tx, (counting) => recordAuditEvents(counting, []))
    );

    // A legal `jsonb_to_recordset('[]')` INSERT is a wasted round trip, and
    // every sweep with nothing to report would pay it.
    expect(queries).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  test("redaction applies to every row of a batch, not just the first", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      recordAuditEvents(tx, [
        {
          tenantId: TENANT,
          moduleKey: "logging",
          action: "test.redact",
          resourceType: "thing",
          message: "a",
          attributes: { password: "hunter2" }
        },
        {
          tenantId: TENANT,
          moduleKey: "logging",
          action: "test.redact",
          resourceType: "thing",
          message: "b",
          attributes: { token: "abcdef", harmless: "kept" }
        }
      ])
    );

    const rows = await auditRows();

    expect(rows[0]!.attributes).toEqual({ password: "[REDACTED]" });
    expect(rows[1]!.attributes).toEqual({
      token: "[REDACTED]",
      harmless: "kept"
    });
  });

  test("a batch may not smuggle a row for another tenant", async () => {
    // RLS is the boundary, and it is the SAME boundary the singular writer
    // has always been behind — the batch does not re-implement it in JS, so
    // this proves the batch did not quietly escape it either.
    const error = await assertRejected(
      withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
        recordAuditEvents(tx, [
          {
            tenantId: TENANT,
            moduleKey: "logging",
            action: "test.mixed",
            resourceType: "thing",
            message: "mine"
          },
          {
            tenantId: PARTNER_TENANT,
            moduleKey: "logging",
            action: "test.mixed",
            resourceType: "thing",
            message: "theirs"
          }
        ])
      ),
      "a batch carrying a foreign tenant's row"
    );

    expect(error.message).toMatch(/row-level security/i);

    // And the statement is atomic: the permitted row did not land either.
    expect(await auditRows()).toHaveLength(0);
  });
});
