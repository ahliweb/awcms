/**
 * `CommissionAccrualPort.void` against a real PostgreSQL, as the least-privilege
 * runtime role, with FORCE RLS in force (Issue #1109, ADR-0132).
 *
 * Proves: a void by SOURCE identity reverses a `pending` / `approved` accrual
 * without editing its monetary facts, the ledger reconciles to its transition
 * log afterwards, a replay is `already_voided` and writes nothing, `not_found`,
 * the explicit closed-period policy (`payable` / `paid` are refused, nothing
 * written), tenant isolation, the audit row and the `awcms.hr.commission.voided`
 * event (ids and codes only), atomicity with the caller's transaction, and
 * serialisation of racing voids.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type {
  CommissionAccrualRequest,
  CommissionVoidRequest
} from "../../src/modules/_shared/ports/commission-accrual-port";
import {
  accrueCommission,
  reconcileAccruals,
  transitionAccrual
} from "../../src/modules/hr-commission/application/hr-commission-accrual-ledger";
import { createCommissionAccrualPort } from "../../src/modules/hr-commission/application/hr-commission-accrual-port-adapter";

const TENANT_A = "a1090000-0000-4000-8000-00000000000a";
const TENANT_B = "a1090000-0000-4000-8000-00000000000b";

const port = createCommissionAccrualPort();

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

let counter = 0;

async function seedTenantUser(tenantId: string): Promise<string> {
  counter += 1;
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${counter}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`v${counter}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function seedEmployment(
  tenantId: string,
  tenantUserId: string | null = null
): Promise<string> {
  counter += 1;
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Employee ${counter}`}) RETURNING id
  `) as { id: string }[];
  // The PS-14 link guard (#979, tested in the hr_workforce suite) is taken out
  // of the way to link an arbitrary login as the beneficiary, which approve /
  // release / pay need (segregation of duties fails closed without one).
  await admin`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  let employment: { id: string }[];

  try {
    employment = (await admin`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`E-${counter}`},
              '2026-01-01'::date, ${tenantUserId})
      RETURNING id
    `) as { id: string }[];
  } finally {
    await admin`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  }

  return employment[0]!.id;
}

async function publishedRule(tenantId: string): Promise<void> {
  const id = await inTenant(
    tenantId,
    async (tx) =>
      (
        (await tx`
          INSERT INTO awcms_hr_commission_rules
            (tenant_id, rule_key, version_no, name, source_type, calculation,
             rate, currency_code, rounding_mode, rounding_scale, effective_from)
          VALUES (${tenantId}, 'upsell', 1, 'Rule', 'sale_line', 'percent',
                  2.5, 'XTS', 'half_up', 2::smallint, '2026-01-01'::date)
          RETURNING id
        `) as { id: string }[]
      )[0]!.id
  );

  await inTenant(
    tenantId,
    (tx) => tx`
      UPDATE awcms_hr_commission_rules
      SET status = 'published', published_at = now(), backdated_reason = 'fixture'
      WHERE id = ${id}
    `
  );
}

function sale(
  employmentId: string,
  ref = "ORD-1",
  line = "1"
): CommissionAccrualRequest {
  return {
    employmentId,
    ruleKey: "upsell",
    source: { type: "sale_line", ref, line },
    baseAmount: "1000.10",
    currencyCode: "XTS",
    occurredAt: new Date("2026-03-10T10:00:00Z"),
    occurredOn: "2026-03-10"
  };
}

function voidRequest(
  employmentId: string,
  ref = "ORD-1",
  line = "1",
  extra: Partial<CommissionVoidRequest> = {}
): CommissionVoidRequest {
  return {
    employmentId,
    source: { type: "sale_line", ref, line },
    reason: "sale_voided",
    ...extra
  };
}

function doVoid(
  tenantId: string,
  actor: string | null,
  request: CommissionVoidRequest
) {
  return inTenant(tenantId, (tx) => port.void(tx, tenantId, actor, request));
}

async function accrued(
  tenantId: string,
  request: CommissionAccrualRequest
): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    accrueCommission(tx, tenantId, null, request)
  );

  if (result.outcome !== "accrued") {
    throw new Error(`fixture: expected accrued, got ${result.outcome}`);
  }

  return result.accrual.id;
}

function transition(
  tenantId: string,
  id: string,
  action: "approve" | "release" | "pay",
  userId: string
) {
  return inTenant(tenantId, (tx) =>
    transitionAccrual(tx, tenantId, id, action, {
      actorTenantUserId: userId,
      correlationId: undefined
    })
  );
}

async function count(sql: string, tenantId: string): Promise<number> {
  const found = (await getAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${sql} AND tenant_id = '${tenantId}'`
  )) as { n: number }[];

  return found[0]!.n;
}

const audits = (tenantId: string) =>
  count(
    "awcms_audit_events WHERE action = 'hr_commission.accrual.voided'",
    tenantId
  );
const events = (tenantId: string) =>
  count(
    "awcms_domain_events WHERE event_type = 'awcms.hr.commission.voided'",
    tenantId
  );
const transitions = (tenantId: string) =>
  count("awcms_hr_commission_transitions WHERE true", tenantId);

const suite = integrationEnabled ? describe : describe.skip;

suite("CommissionAccrualPort.void (Issue #1109)", () => {
  let beneficiary: string;
  let owner: string;
  let approver: string;
  let payer: string;
  let employment: string;

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
      VALUES (${TENANT_A}, 'vp-a', 'VP A'), (${TENANT_B}, 'vp-b', 'VP B')
    `;
    beneficiary = await seedTenantUser(TENANT_A);
    owner = await seedTenantUser(TENANT_A);
    approver = await seedTenantUser(TENANT_A);
    payer = await seedTenantUser(TENANT_A);
    employment = await seedEmployment(TENANT_A, beneficiary);
    await publishedRule(TENANT_A);
  });

  test("voids a pending accrual by source identity and the ledger reconciles", async () => {
    const id = await accrued(TENANT_A, sale(employment));

    const outcome = await doVoid(
      TENANT_A,
      owner,
      voidRequest(employment, "ORD-1", "1", { correlationId: "corr-1" })
    );

    expect(outcome.outcome).toBe("voided");
    expect(outcome.outcome === "voided" && outcome.accrual.id).toBe(id);
    expect(outcome.outcome === "voided" && outcome.accrual.status).toBe(
      "voided"
    );
    // The monetary fact is untouched: 2.5% of 1000.10 = 25.0025 -> 25.00.
    expect(outcome.outcome === "voided" && outcome.accrual.amount).toBe(
      "25.000000"
    );

    const admin = getAdminSql();
    const row = (await admin`
      SELECT status, amount::text AS amount, voided_by, void_reason_code
      FROM awcms_hr_commission_accruals WHERE id = ${id}
    `) as {
      status: string;
      amount: string;
      voided_by: string;
      void_reason_code: string;
    }[];

    expect(row[0]!.status).toBe("voided");
    expect(Number(row[0]!.amount)).toBe(25);
    expect(row[0]!.voided_by).toBe(owner);
    expect(row[0]!.void_reason_code).toBe("sale_voided");

    // Ledger sums: no live bucket, the amount is in `voided`; append-only log
    // holds birth + void; nothing was added or deleted.
    const reconciliation = await inTenant(TENANT_A, (tx) =>
      reconcileAccruals(tx, TENANT_A)
    );

    expect(reconciliation.reconciled).toBe(true);
    expect(
      reconciliation.balances.map((b) => [b.status, b.count, Number(b.total)])
    ).toEqual([["voided", 1, 25]]);
    expect(
      await count("awcms_hr_commission_accruals WHERE true", TENANT_A)
    ).toBe(1);

    const log = (await admin`
      SELECT from_status, to_status FROM awcms_hr_commission_transitions
      WHERE accrual_id = ${id} ORDER BY seq
    `) as { from_status: string | null; to_status: string }[];

    expect(log.map((l) => [l.from_status, l.to_status])).toEqual([
      [null, "pending"],
      ["pending", "voided"]
    ]);
  });

  test("voids an approved accrual", async () => {
    const id = await accrued(TENANT_A, sale(employment));

    expect((await transition(TENANT_A, id, "approve", approver)).outcome).toBe(
      "ok"
    );

    const outcome = await doVoid(TENANT_A, owner, voidRequest(employment));

    expect(outcome.outcome).toBe("voided");

    const reconciliation = await inTenant(TENANT_A, (tx) =>
      reconcileAccruals(tx, TENANT_A)
    );

    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.balances.map((b) => b.status)).toEqual(["voided"]);

    // A voided accrual can never be released or paid.
    expect((await transition(TENANT_A, id, "release", approver)).outcome).toBe(
      "invalid_state"
    );
  });

  test("the audit row and the event carry ids and codes, never an amount or a source reference", async () => {
    const id = await accrued(TENANT_A, sale(employment, "ORD-SECRET-77"));

    await doVoid(
      TENANT_A,
      owner,
      voidRequest(employment, "ORD-SECRET-77", "1", { correlationId: "corr-9" })
    );

    expect(await audits(TENANT_A)).toBe(1);
    expect(await events(TENANT_A)).toBe(1);

    const admin = getAdminSql();
    const event = (await admin`
      SELECT aggregate_type, aggregate_id, producer_module, correlation_id,
             actor_tenant_user_id, payload
      FROM awcms_domain_events
      WHERE tenant_id = ${TENANT_A} AND event_type = 'awcms.hr.commission.voided'
    `) as {
      aggregate_type: string;
      aggregate_id: string;
      producer_module: string;
      correlation_id: string;
      actor_tenant_user_id: string;
      payload: Record<string, unknown>;
    }[];

    expect(event[0]!.aggregate_type).toBe("hr_commission.accrual");
    expect(event[0]!.aggregate_id).toBe(id);
    expect(event[0]!.producer_module).toBe("hr_commission");
    expect(event[0]!.correlation_id).toBe("corr-9");
    expect(event[0]!.actor_tenant_user_id).toBe(owner);
    expect(event[0]!.payload).toMatchObject({
      accrualId: id,
      employmentId: employment,
      sourceType: "sale_line",
      ruleKey: "upsell",
      ruleVersion: 1,
      fromStatus: "pending",
      reasonCode: "sale_voided"
    });

    const audit = (await admin`
      SELECT correlation_id, attributes::text AS attributes, message
      FROM awcms_audit_events
      WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.accrual.voided'
    `) as { correlation_id: string; attributes: string; message: string }[];

    expect(audit[0]!.correlation_id).toBe("corr-9");

    for (const text of [
      JSON.stringify(event[0]!.payload),
      audit[0]!.attributes,
      audit[0]!.message
    ]) {
      expect(text).not.toContain("ORD-SECRET-77");
      expect(text).not.toContain("25.00");
      expect(text).not.toContain("1000.10");
    }
  });

  test("a replay is already_voided and writes nothing", async () => {
    const id = await accrued(TENANT_A, sale(employment));

    expect(
      (await doVoid(TENANT_A, owner, voidRequest(employment))).outcome
    ).toBe("voided");

    const logged = await transitions(TENANT_A);

    for (const reason of ["sale_voided", "other_reason"]) {
      const again = await doVoid(
        TENANT_A,
        approver,
        voidRequest(employment, "ORD-1", "1", { reason })
      );

      expect(again.outcome).toBe("already_voided");
      expect(again.outcome === "already_voided" && again.accrual.id).toBe(id);
    }

    expect(await audits(TENANT_A)).toBe(1);
    expect(await events(TENANT_A)).toBe(1);
    expect(await transitions(TENANT_A)).toBe(logged);

    const row = (await getAdminSql()`
      SELECT voided_by, void_reason_code FROM awcms_hr_commission_accruals
      WHERE id = ${id}
    `) as { voided_by: string; void_reason_code: string }[];

    expect(row[0]).toEqual({
      voided_by: owner,
      void_reason_code: "sale_voided"
    });
  });

  test("a redelivered accrue after a void is still the original (not resurrected)", async () => {
    await accrued(TENANT_A, sale(employment));
    await doVoid(TENANT_A, owner, voidRequest(employment));

    const again = await inTenant(TENANT_A, (tx) =>
      port.accrue(tx, TENANT_A, null, sale(employment))
    );

    expect(again.outcome).toBe("replayed");
    expect(again.outcome === "replayed" && again.accrual.status).toBe("voided");
  });

  test("not_found: nothing accrued for that source, line or employment", async () => {
    await accrued(TENANT_A, sale(employment));
    const other = await seedEmployment(TENANT_A);

    for (const request of [
      voidRequest(employment, "ORD-404"),
      voidRequest(employment, "ORD-1", "2"),
      voidRequest(other),
      {
        ...voidRequest(employment),
        source: { type: "other_type", ref: "ORD-1", line: "1" }
      }
    ]) {
      expect((await doVoid(TENANT_A, owner, request)).outcome).toBe(
        "not_found"
      );
    }

    expect(await audits(TENANT_A)).toBe(0);
    expect(await events(TENANT_A)).toBe(0);

    const status = (await getAdminSql()`
      SELECT status FROM awcms_hr_commission_accruals
    `) as { status: string }[];

    expect(status.map((s) => s.status)).toEqual(["pending"]);
  });

  test("closed period: payable and paid accruals are refused and nothing is written", async () => {
    const payableId = await accrued(TENANT_A, sale(employment, "ORD-P"));
    const paidId = await accrued(TENANT_A, sale(employment, "ORD-Q"));

    for (const id of [payableId, paidId]) {
      expect(
        (await transition(TENANT_A, id, "approve", approver)).outcome
      ).toBe("ok");
      expect(
        (await transition(TENANT_A, id, "release", approver)).outcome
      ).toBe("ok");
    }

    expect((await transition(TENANT_A, paidId, "pay", payer)).outcome).toBe(
      "ok"
    );

    const logged = await transitions(TENANT_A);
    const payable = await doVoid(
      TENANT_A,
      owner,
      voidRequest(employment, "ORD-P")
    );
    const paid = await doVoid(
      TENANT_A,
      owner,
      voidRequest(employment, "ORD-Q")
    );

    expect(payable).toEqual({
      outcome: "period_closed",
      accrualId: payableId,
      status: "payable"
    });
    expect(paid).toEqual({
      outcome: "period_closed",
      accrualId: paidId,
      status: "paid"
    });
    expect(await transitions(TENANT_A)).toBe(logged);
    expect(await audits(TENANT_A)).toBe(0);
    expect(await events(TENANT_A)).toBe(0);

    const reconciliation = await inTenant(TENANT_A, (tx) =>
      reconcileAccruals(tx, TENANT_A)
    );

    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.balances.map((b) => b.status).sort()).toEqual([
      "paid",
      "payable"
    ]);
  });

  test("tenant isolation: another tenant cannot void, and the same source in another tenant is independent", async () => {
    const idA = await accrued(TENANT_A, sale(employment));
    const userB = await seedTenantUser(TENANT_B);
    const employmentB = await seedEmployment(TENANT_B);

    await publishedRule(TENANT_B);

    const idB = await accrued(TENANT_B, sale(employmentB));

    // Tenant B names tenant A's employment id and source: RLS hides the row.
    expect(
      (await doVoid(TENANT_B, userB, voidRequest(employment))).outcome
    ).toBe("not_found");
    expect(
      (await doVoid(TENANT_A, owner, voidRequest(employmentB))).outcome
    ).toBe("not_found");

    // The application-level tenant filter on its own: the transaction's RLS
    // context is tenant A (so A's row IS visible), but the port is told
    // tenant B. Only the port's own `tenant_id` predicate can refuse this.
    expect(
      (
        await inTenant(TENANT_A, (tx) =>
          port.void(tx, TENANT_B, userB, voidRequest(employment))
        )
      ).outcome
    ).toBe("not_found");

    // The same source ref in B voids only B's row.
    expect(
      (await doVoid(TENANT_B, userB, voidRequest(employmentB))).outcome
    ).toBe("voided");

    const rows = (await getAdminSql()`
      SELECT id, status FROM awcms_hr_commission_accruals
    `) as { id: string; status: string }[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));

    expect(byId[idA]).toBe("pending");
    expect(byId[idB]).toBe("voided");
    expect(await events(TENANT_A)).toBe(0);
    expect(await events(TENANT_B)).toBe(1);
  });

  test("a system actor and a malformed request are refused without a write", async () => {
    await accrued(TENANT_A, sale(employment));

    expect(
      (await doVoid(TENANT_A, null, voidRequest(employment))).outcome
    ).toBe("actor_required");

    for (const bad of [
      voidRequest("not-a-uuid"),
      voidRequest(employment, "bad ref"),
      voidRequest(employment, "ORD-1", "1", { reason: "Free text reason!" }),
      { ...voidRequest(employment), source: undefined } as never
    ]) {
      expect((await doVoid(TENANT_A, owner, bad)).outcome).toBe(
        "input_invalid"
      );
    }

    expect(await audits(TENANT_A)).toBe(0);
    expect(await events(TENANT_A)).toBe(0);
  });

  test("a void commits and rolls back with the caller's transaction", async () => {
    const id = await accrued(TENANT_A, sale(employment));

    await expect(
      inTenant(TENANT_A, async (tx) => {
        const outcome = await port.void(
          tx,
          TENANT_A,
          owner,
          voidRequest(employment)
        );

        expect(outcome.outcome).toBe("voided");
        throw new Error("caller failed after the void");
      })
    ).rejects.toThrow("caller failed after the void");

    const row = (await getAdminSql()`
      SELECT status FROM awcms_hr_commission_accruals WHERE id = ${id}
    `) as { status: string }[];

    expect(row[0]!.status).toBe("pending");
    expect(await audits(TENANT_A)).toBe(0);
    expect(await events(TENANT_A)).toBe(0);
  });

  test("racing voids serialise: one voided, the rest already_voided, one audit and one event", async () => {
    await accrued(TENANT_A, sale(employment));

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        doVoid(TENANT_A, owner, voidRequest(employment))
      )
    );
    const tally = results.map((r) => r.outcome).sort();

    expect(tally).toEqual([
      "already_voided",
      "already_voided",
      "already_voided",
      "already_voided",
      "already_voided",
      "voided"
    ]);
    expect(await audits(TENANT_A)).toBe(1);
    expect(await events(TENANT_A)).toBe(1);
  });

  test("a void racing a release never voids a payable accrual", async () => {
    const id = await accrued(TENANT_A, sale(employment));

    expect((await transition(TENANT_A, id, "approve", approver)).outcome).toBe(
      "ok"
    );

    const [released, voided] = await Promise.all([
      transition(TENANT_A, id, "release", approver),
      doVoid(TENANT_A, owner, voidRequest(employment))
    ]);
    const status = (
      (await getAdminSql()`
        SELECT status FROM awcms_hr_commission_accruals WHERE id = ${id}
      `) as { status: string }[]
    )[0]!.status;

    // Either order is legal, but never both: a voided accrual cannot be
    // released, and a released one is refused as period_closed.
    if (status === "voided") {
      expect(released.outcome).toBe("invalid_state");
      expect(voided.outcome).toBe("voided");
    } else {
      expect(status).toBe("payable");
      expect(released.outcome).toBe("ok");
      expect(voided.outcome).toBe("period_closed");
    }
  });
});
