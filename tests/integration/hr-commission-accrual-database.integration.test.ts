/**
 * The accrual ledger against a real PostgreSQL, as the least-privilege runtime
 * role, with FORCE RLS in force (Issue #951, ADR-0132).
 *
 * `hr-commission-accrual-api.integration.test.ts` proves the HTTP wiring. This
 * file attacks the invariants that live in the DATABASE and must hold even if
 * the application code were bypassed:
 *
 *   * RLS and composite foreign keys on both tables;
 *   * EXACTLY-ONCE: a double delivery is one row, and so are ten racing ones;
 *   * the amount comes from the PUBLISHED rule in force on the EVENT's date
 *     (exact decimal arithmetic), never from now(), a draft or a retired version;
 *   * the back-dated publish rule (sql/187);
 *   * the monetary facts are immutable; the machine allows exactly five edges
 *     and the database agrees with the pure `canTransition` on every pair; a
 *     voided accrual can never be paid; the beneficiary cannot approve;
 *   * the transition log is written only by the ledger, is append-only, and the
 *     ledger reconciles to it (and says so when it does not);
 *   * the parents (rule, employment) are locked FOR SHARE, so a concurrent
 *     retire / soft delete cannot slip between the check and the insert;
 *   * two racing transitions of one accrual serialise on its row;
 *   * no NaN, no delete, no personal column.
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
  assertRejected as assertRejectedByDatabase,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type { CommissionAccrualRequest } from "../../src/modules/_shared/ports/commission-accrual-port";
import {
  accrueCommission,
  getAccrual,
  reconcileAccruals,
  transitionAccrual
} from "../../src/modules/hr-commission/application/hr-commission-accrual-ledger";
import { createCommissionAccrualPort } from "../../src/modules/hr-commission/application/hr-commission-accrual-port-adapter";
import {
  ACCRUAL_STATUSES,
  canTransition,
  employmentEarnsOn,
  isBackdatedWindow,
  sodViolation,
  type AccrualAction,
  type AccrualStatus
} from "../../src/modules/hr-commission/domain/hr-commission-accrual-state";
import { ROUNDING_MODES } from "../../src/modules/hr-commission/domain/hr-commission-decimal";
import { evaluateCommission } from "../../src/modules/hr-commission/domain/hr-commission-evaluation";

async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<Error> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  resetDatabaseCircuitBreakerForTests();
  const text = `${error.message} ${String((error as { errno?: unknown }).errno ?? "")}`;
  expect(text).toMatch(expected);
  return error;
}

const TENANT_A = "a9510000-0000-4000-8000-00000000000a";
const TENANT_B = "a9510000-0000-4000-8000-00000000000b";

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

let userCounter = 0;
/** Set per test: the person who PAYS (never the approver or the beneficiary). */
let payerId = "";

async function seedTenantUser(tenantId: string, tag: string): Promise<string> {
  userCounter += 1;
  const admin = getAdminSql();
  const unique = `${tag}-${userCounter}`;
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${unique}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${unique}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

let employmentCounter = 0;

async function seedEmployment(
  tenantId: string,
  values: {
    hiredOn?: string;
    terminatedOn?: string | null;
    deleted?: boolean;
    tenantUserId?: string | null;
  } = {}
): Promise<string> {
  employmentCounter += 1;
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Employee ${employmentCounter}`})
    RETURNING id
  `) as { id: string }[];
  // Commission tests link arbitrary logins; the PS-14 link guard (#979, tested
  // in the hr_workforce database suite) is taken out of the way for the insert.
  await admin`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  let employment: { id: string }[];

  try {
    employment = (await admin`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`E-${employmentCounter}`},
              ${values.hiredOn ?? "2026-01-01"}::date, ${values.tenantUserId ?? null})
      RETURNING id
    `) as { id: string }[];
  } finally {
    await admin`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  }
  const id = employment[0]!.id;

  if (values.terminatedOn) {
    await admin`
      UPDATE awcms_hr_employments SET terminated_on = ${values.terminatedOn}::date
      WHERE id = ${id}
    `;
  }

  if (values.deleted) {
    await admin`
      UPDATE awcms_hr_employments SET deleted_at = now() WHERE id = ${id}
    `;
  }

  return id;
}

type RuleValues = {
  key?: string;
  from?: string;
  to?: string | null;
  calculation?: "percent" | "fixed";
  rate?: string;
  fixed?: string;
  min?: string | null;
  max?: string | null;
  scale?: number;
  currency?: string;
  mode?: string;
  sourceType?: string;
  retire?: boolean;
};

let versionCounter = 0;

/** A PUBLISHED rule, made the only way the database allows: a draft, then published. */
async function publishedRule(
  tenantId: string,
  values: RuleValues = {}
): Promise<string> {
  versionCounter += 1;
  const calculation = values.calculation ?? "percent";
  const id = await inTenant(
    tenantId,
    async (tx) =>
      (
        (await tx`
          INSERT INTO awcms_hr_commission_rules
            (tenant_id, rule_key, version_no, name, source_type, calculation,
             rate, fixed_amount, min_amount, max_amount, currency_code,
             rounding_mode, rounding_scale, effective_from, effective_to)
          VALUES (${tenantId}, ${values.key ?? "upsell"}, ${versionCounter},
                  'Rule', ${values.sourceType ?? "sale_line"}, ${calculation},
                  ${calculation === "percent" ? (values.rate ?? "2.5") : null}::numeric,
                  ${calculation === "fixed" ? (values.fixed ?? "10") : null}::numeric,
                  ${values.min ?? null}::numeric, ${values.max ?? null}::numeric,
                  ${values.currency ?? "XTS"}, ${values.mode ?? "half_up"},
                  ${values.scale ?? 2}::smallint,
                  ${values.from ?? "2026-01-01"}::date, ${values.to ?? null}::date)
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

  if (values.retire) {
    await inTenant(
      tenantId,
      (tx) => tx`
        UPDATE awcms_hr_commission_rules
        SET status = 'retired', retired_at = now() WHERE id = ${id}
      `
    );
  }

  return id;
}

function sale(
  employmentId: string,
  extra: Partial<CommissionAccrualRequest> = {}
): CommissionAccrualRequest {
  return {
    employmentId,
    ruleKey: "upsell",
    source: { type: "sale_line", ref: "ORD-1", line: "1" },
    baseAmount: "1000.10",
    currencyCode: "XTS",
    occurredAt: new Date("2026-03-10T10:00:00Z"),
    occurredOn: "2026-03-10",
    ...extra
  };
}

function accrue(
  tenantId: string,
  request: CommissionAccrualRequest,
  actor: string | null = null
) {
  return inTenant(tenantId, (tx) =>
    accrueCommission(tx, tenantId, actor, request)
  );
}

async function accrued(
  tenantId: string,
  request: CommissionAccrualRequest
): Promise<string> {
  const result = await accrue(tenantId, request);

  if (result.outcome !== "accrued") {
    throw new Error(`fixture: expected accrued, got ${result.outcome}`);
  }

  return result.accrual.id;
}

const actorOf = (userId: string) => ({
  actorTenantUserId: userId,
  correlationId: undefined
});

function transition(
  tenantId: string,
  id: string,
  action: "approve" | "release" | "void" | "pay",
  userId: string
) {
  return inTenant(tenantId, (tx) =>
    transitionAccrual(tx, tenantId, id, action, actorOf(userId))
  );
}

/** Drives an accrual to `status` by the legitimate path. */
async function accrualAt(
  tenantId: string,
  employmentId: string,
  status: AccrualStatus,
  actor: string,
  ref: string
): Promise<string> {
  const id = await accrued(
    tenantId,
    sale(employmentId, { source: { type: "sale_line", ref } })
  );
  const path: Record<
    AccrualStatus,
    ("approve" | "release" | "void" | "pay")[]
  > = {
    pending: [],
    approved: ["approve"],
    payable: ["approve", "release"],
    paid: ["approve", "release", "pay"],
    voided: ["void"]
  };

  for (const action of path[status]) {
    expect(
      (
        await transition(
          tenantId,
          id,
          action,
          action === "pay" ? payerId : actor
        )
      ).outcome
    ).toBe("ok");
  }

  return id;
}

async function rows(tenantId: string): Promise<number> {
  const found = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_hr_commission_accruals
    WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return found[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_commission accrual ledger database invariants (Issue #951)", () => {
  let owner: string; // the beneficiary's own login
  let manager: string; // a second person
  let payer: string; // a third: whoever approved cannot pay
  let employment: string;

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    versionCounter = 0;
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_id_marker, tenant_code, tenant_name)
      VALUES (${TENANT_A}, NULL, 'ac-a', 'AC A'), (${TENANT_B}, NULL, 'ac-b', 'AC B')
    `.catch(async () => {
      await getAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT_A}, 'ac-a', 'AC A'), (${TENANT_B}, 'ac-b', 'AC B')
      `;
    });
    owner = await seedTenantUser(TENANT_A, "owner");
    manager = await seedTenantUser(TENANT_A, "manager");
    payer = await seedTenantUser(TENANT_A, "payer");
    payerId = payer;
    employment = await seedEmployment(TENANT_A, { tenantUserId: owner });
    await publishedRule(TENANT_A);
  });

  describe("tenant isolation", () => {
    test("RLS is ENABLED and FORCED, with USING and WITH CHECK, on both tables", async () => {
      const found = (await getAdminSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               bool_and(p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS both
        FROM pg_class c
        JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname IN ('awcms_hr_commission_accruals', 'awcms_hr_commission_transitions')
        GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        both: boolean;
      }[];

      expect(found).toHaveLength(2);

      for (const row of found) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
        expect(row.both).toBe(true);
      }
    });

    test("a tenant cannot read, move or write another tenant's accrual", async () => {
      const id = await accrued(TENANT_A, sale(employment));
      const ruleOfA = (
        (await getAdminSql()`
          SELECT id FROM awcms_hr_commission_rules WHERE tenant_id = ${TENANT_A}
        `) as { id: string }[]
      )[0]!.id;

      expect(
        await inTenant(TENANT_B, (tx) => getAccrual(tx, TENANT_B, id))
      ).toBeNull();
      expect(
        await inTenant(
          TENANT_B,
          (tx) =>
            tx`SELECT id FROM awcms_hr_commission_transitions
               WHERE accrual_id = ${id}` as Promise<unknown[]>
        )
      ).toHaveLength(0);
      expect(
        await inTenant(
          TENANT_B,
          (tx) =>
            tx`UPDATE awcms_hr_commission_accruals SET status = 'voided'
               WHERE id = ${id} RETURNING id` as Promise<unknown[]>
        )
      ).toHaveLength(0);

      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_accruals
              (tenant_id, employment_id, rule_id, rule_key, rule_version,
               source_type, source_ref, calculation, base_amount, rate, amount,
               currency_code, occurred_at, occurred_on, request_digest)
            VALUES (${TENANT_A}, ${employment}, ${ruleOfA}, 'upsell', 1,
                    'sale_line', 'other', 'percent', 1, 2.5, 0.03, 'XTS',
                    '2026-03-10T10:00:00Z', '2026-03-10', ${"a".repeat(64)})
          `
        ),
        // The BEFORE INSERT guard reads the parents under RLS, so tenant B does
        // not even see tenant A's rule; the WITH CHECK policy is the second wall.
        /row-level security|violates|not a published version|23514/i
      );
    });

    test("composite foreign keys: an employment, a rule or an actor of another tenant is refused", async () => {
      const ruleB = await publishedRule(TENANT_B);
      const employmentB = await seedEmployment(TENANT_B);

      // The service layer cannot even see them...
      expect((await accrue(TENANT_A, sale(employmentB))).outcome).toBe(
        "employment_not_found"
      );

      // ...and the database refuses a hand-written row that points across.
      const insertWith = (employmentId: string, ruleId: string) =>
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_accruals
              (tenant_id, employment_id, rule_id, rule_key, rule_version,
               source_type, source_ref, calculation, base_amount, rate, amount,
               currency_code, occurred_at, occurred_on, request_digest)
            VALUES (${TENANT_A}, ${employmentId}, ${ruleId}, 'upsell', 1,
                    'sale_line', 'x', 'percent', 1, 2.5, 0.03, 'XTS',
                    '2026-03-10T10:00:00Z', '2026-03-10', ${"a".repeat(64)})
          `
        );

      await assertRejected(
        insertWith(employmentB, ruleB),
        /foreign key|23503|check|23514|violates/i
      );
      await assertRejected(
        insertWith(employment, ruleB),
        /foreign key|23503|check|23514|violates/i
      );
    });
  });

  describe("exactly-once accrual", () => {
    test("a double delivery is one accrual, one transition, and the original is returned", async () => {
      const first = await accrue(TENANT_A, sale(employment));
      const second = await accrue(TENANT_A, sale(employment));

      expect(first.outcome).toBe("accrued");
      expect(second.outcome).toBe("replayed");

      if (first.outcome === "accrued" && second.outcome === "replayed") {
        expect(second.accrual.id).toBe(first.accrual.id);
        expect(second.accrual.amount).toBe(first.accrual.amount);
      }

      expect(await rows(TENANT_A)).toBe(1);
      expect(
        (
          (await getAdminSql()`
            SELECT count(*)::int AS n FROM awcms_hr_commission_transitions
          `) as { n: number }[]
        )[0]!.n
      ).toBe(1);
    });

    test("equal decimals are the same request; a different amount for the same source is a conflict and writes nothing", async () => {
      await accrue(TENANT_A, sale(employment, { baseAmount: "10" }));

      expect(
        (await accrue(TENANT_A, sale(employment, { baseAmount: "10.000" })))
          .outcome
      ).toBe("replayed");

      const conflict = await accrue(
        TENANT_A,
        sale(employment, { baseAmount: "11" })
      );

      expect(conflict.outcome).toBe("source_conflict");
      expect(
        (
          await accrue(
            TENANT_A,
            sale(employment, {
              baseAmount: "10",
              occurredAt: new Date("2026-03-11T10:00:00Z"),
              occurredOn: "2026-03-11"
            })
          )
        ).outcome
      ).toBe("source_conflict");
      expect(await rows(TENANT_A)).toBe(1);
    });

    test("TEN racing deliveries of one source produce exactly one accrual", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => accrue(TENANT_A, sale(employment)))
      );
      const outcomes = results.map((result) => result.outcome);

      expect(outcomes.filter((outcome) => outcome === "accrued")).toHaveLength(
        1
      );
      expect(outcomes.filter((outcome) => outcome === "replayed")).toHaveLength(
        9
      );
      expect(await rows(TENANT_A)).toBe(1);

      const ids = new Set(
        results.map((result) =>
          "accrual" in result ? result.accrual.id : "none"
        )
      );

      expect(ids.size).toBe(1);
    });

    test("one source line split between two staff accrues once for each, and the key is the database's", async () => {
      const second = await seedEmployment(TENANT_A);

      expect((await accrue(TENANT_A, sale(employment))).outcome).toBe(
        "accrued"
      );
      expect((await accrue(TENANT_A, sale(second))).outcome).toBe("accrued");
      expect((await accrue(TENANT_A, sale(second))).outcome).toBe("replayed");
      expect(await rows(TENANT_A)).toBe(2);

      // Bypassing the application: the unique key refuses the duplicate.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_accruals
              (tenant_id, employment_id, rule_id, rule_key, rule_version,
               source_type, source_ref, source_line, operation, calculation,
               base_amount, rate, amount, currency_code, occurred_at,
               occurred_on, request_digest)
            SELECT tenant_id, employment_id, rule_id, rule_key, rule_version,
                   source_type, source_ref, source_line, operation, calculation,
                   base_amount, rate, amount, currency_code, occurred_at,
                   occurred_on, ${"b".repeat(64)}
            FROM awcms_hr_commission_accruals WHERE employment_id = ${employment}
          `
        ),
        /duplicate key|unique|23505/i
      );
    });

    test("a voided accrual is not resurrected by a redelivery: the original (voided) is returned", async () => {
      const id = await accrued(TENANT_A, sale(employment));
      await transition(TENANT_A, id, "void", manager);

      const again = await accrue(TENANT_A, sale(employment));

      expect(again.outcome).toBe("replayed");
      expect(again.outcome === "replayed" && again.accrual.status).toBe(
        "voided"
      );
      expect(await rows(TENANT_A)).toBe(1);
    });

    test("the port adapter is the same core", async () => {
      const port = createCommissionAccrualPort();
      const outcome = await inTenant(TENANT_A, (tx) =>
        port.accrue(tx, TENANT_A, null, sale(employment))
      );

      expect(outcome.outcome).toBe("accrued");
    });
  });

  describe("the amount: the published rule in force on the EVENT date, exact", () => {
    test("percent: 2.5 % of 1000.10 is 25.0025, rounded once to 25.00; no float", async () => {
      const result = await accrue(TENANT_A, sale(employment));

      expect(result.outcome === "accrued" && result.accrual.amount).toBe(
        "25.000000"
      );
    });

    test("a half-cent boundary rounds on the boundary it sits on (fixed 10.005 x 3 = 30.015 -> 30.02)", async () => {
      await publishedRule(TENANT_A, {
        key: "per_unit",
        calculation: "fixed",
        fixed: "10.005",
        scale: 2
      });
      const result = await accrue(
        TENANT_A,
        sale(employment, {
          ruleKey: "per_unit",
          baseAmount: undefined,
          units: 3
        })
      );

      expect(result.outcome === "accrued" && result.accrual.amount).toBe(
        "30.020000"
      );
    });

    test("the version is chosen by the sale's date, never by now()", async () => {
      await resetDatabase();
      versionCounter = 0;
      await getAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT_A}, 'ac-a', 'AC A')
      `;
      const user = await seedTenantUser(TENANT_A, "o2");
      const emp = await seedEmployment(TENANT_A, { tenantUserId: user });
      await publishedRule(TENANT_A, {
        rate: "2",
        from: "2026-01-01",
        to: "2026-06-01"
      });
      await publishedRule(TENANT_A, { rate: "5", from: "2026-06-01" });

      const early = await accrue(
        TENANT_A,
        sale(emp, {
          source: { type: "sale_line", ref: "early" },
          baseAmount: "100",
          occurredAt: new Date("2026-03-10T10:00:00Z"),
          occurredOn: "2026-03-10"
        })
      );
      const late = await accrue(
        TENANT_A,
        sale(emp, {
          source: { type: "sale_line", ref: "late" },
          baseAmount: "100",
          occurredAt: new Date("2026-07-01T10:00:00Z"),
          occurredOn: "2026-07-01"
        })
      );
      const boundary = await accrue(
        TENANT_A,
        sale(emp, {
          source: { type: "sale_line", ref: "boundary" },
          baseAmount: "100",
          occurredAt: new Date("2026-06-01T10:00:00Z"),
          occurredOn: "2026-06-01"
        })
      );

      expect(early.outcome === "accrued" && early.accrual.amount).toBe(
        "2.000000"
      );
      expect(early.outcome === "accrued" && early.accrual.ruleVersion).toBe(1);
      expect(late.outcome === "accrued" && late.accrual.amount).toBe(
        "5.000000"
      );
      expect(late.outcome === "accrued" && late.accrual.ruleVersion).toBe(2);
      // The window is half-open: the end date belongs to the successor.
      expect(
        boundary.outcome === "accrued" && boundary.accrual.ruleVersion
      ).toBe(2);
    });

    test("the floor and the ceiling clamp the rounded amount", async () => {
      await publishedRule(TENANT_A, {
        key: "clamped",
        rate: "10",
        min: "5",
        max: "50"
      });
      const amount = async (ref: string, base: string) => {
        const result = await accrue(
          TENANT_A,
          sale(employment, {
            ruleKey: "clamped",
            source: { type: "sale_line", ref },
            baseAmount: base
          })
        );

        return result.outcome === "accrued"
          ? result.accrual.amount
          : result.outcome;
      };

      expect(await amount("lo", "1")).toBe("5.000000");
      expect(await amount("mid", "100")).toBe("10.000000");
      expect(await amount("hi", "100000")).toBe("50.000000");
    });

    test("no effective rule: before the window, after a retire, a draft, an unknown key", async () => {
      const veteran = await seedEmployment(TENANT_A, { hiredOn: "2025-01-01" });

      expect(
        (
          await accrue(
            TENANT_A,
            sale(veteran, {
              source: { type: "sale_line", ref: "old" },
              occurredAt: new Date("2025-12-31T10:00:00Z"),
              occurredOn: "2025-12-31"
            })
          )
        ).outcome
      ).toBe("no_effective_rule");
      expect(
        (await accrue(TENANT_A, sale(employment, { ruleKey: "nope" }))).outcome
      ).toBe("no_effective_rule");

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules SET status = 'retired',
            retired_at = now() WHERE tenant_id = ${TENANT_A}
        `
      );
      expect((await accrue(TENANT_A, sale(employment))).outcome).toBe(
        "no_effective_rule"
      );

      // A draft never applies.
      await inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_hr_commission_rules
            (tenant_id, rule_key, version_no, name, source_type, calculation,
             rate, currency_code, rounding_mode, rounding_scale, effective_from)
          VALUES (${TENANT_A}, 'upsell', 99, 'Draft', 'sale_line', 'percent',
                  50, 'XTS', 'half_up', 2, '2026-01-01')
        `
      );
      expect((await accrue(TENANT_A, sale(employment))).outcome).toBe(
        "no_effective_rule"
      );
      expect(await rows(TENANT_A)).toBe(0);
    });

    test("a mismatched source type or currency is refused and names what the rule expects", async () => {
      const wrongType = await accrue(
        TENANT_A,
        sale(employment, { source: { type: "booking", ref: "B1" } })
      );
      const wrongCurrency = await accrue(
        TENANT_A,
        sale(employment, { currencyCode: "XXX" })
      );

      expect(wrongType).toEqual({
        outcome: "source_type_mismatch",
        expectedSourceType: "sale_line"
      });
      expect(wrongCurrency).toEqual({
        outcome: "currency_mismatch",
        expectedCurrencyCode: "XTS"
      });
      expect(await rows(TENANT_A)).toBe(0);
    });

    test("a percent rule given units, or a fixed rule given a base, is an input error", async () => {
      await publishedRule(TENANT_A, {
        key: "per_unit",
        calculation: "fixed",
        fixed: "1"
      });

      expect(
        (
          await accrue(
            TENANT_A,
            sale(employment, { baseAmount: undefined, units: 2 })
          )
        ).outcome
      ).toBe("input_invalid");
      expect(
        (await accrue(TENANT_A, sale(employment, { ruleKey: "per_unit" })))
          .outcome
      ).toBe("input_invalid");
    });

    test("a result that cannot be stored is refused, never truncated", async () => {
      await publishedRule(TENANT_A, {
        key: "huge",
        rate: "100",
        scale: 2
      });

      const result = await accrue(
        TENANT_A,
        sale(employment, { ruleKey: "huge", baseAmount: "999999999999" })
      );

      // 100 % of 999,999,999,999 is below 10^12: allowed.
      expect(result.outcome).toBe("accrued");

      await publishedRule(TENANT_A, {
        key: "huge_fixed",
        calculation: "fixed",
        fixed: "999999999999"
      });
      expect(
        (
          await accrue(
            TENANT_A,
            sale(employment, {
              ruleKey: "huge_fixed",
              source: { type: "sale_line", ref: "h2" },
              baseAmount: undefined,
              units: 1_000_000
            })
          )
        ).outcome
      ).toBe("input_invalid");
    });
  });

  describe("the back-dated publish rule (sql/187)", () => {
    const draft = (from: string) =>
      inTenant(
        TENANT_A,
        async (tx) =>
          (
            (await tx`
              INSERT INTO awcms_hr_commission_rules
                (tenant_id, rule_key, version_no, name, source_type, calculation,
                 rate, currency_code, rounding_mode, rounding_scale,
                 effective_from)
              VALUES (${TENANT_A}, 'late', 1, 'Late', 'sale_line', 'percent', 3,
                      'XTS', 'half_up', 2, ${from}::date)
              RETURNING id
            `) as { id: string }[]
          )[0]!.id
      );

    test("a window starting in the past cannot be published without a reason, even by a bypassing client", async () => {
      const id = await draft("2026-02-01");

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'published', published_at = now() WHERE id = ${id}
          `
        ),
        /back-dated reason|55000/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'published', published_at = now(),
                backdated_reason = '   ' WHERE id = ${id}
          `
        ),
        /back-dated reason|55000/
      );
    });

    test("with a reason it publishes, the database stamps the fact, and a late sale in the window now accrues", async () => {
      const id = await draft("2026-02-01");

      // Before it exists in force: nothing to apply.
      expect(
        (
          await accrue(
            TENANT_A,
            sale(employment, {
              ruleKey: "late",
              occurredAt: new Date("2026-02-10T10:00:00Z"),
              occurredOn: "2026-02-10"
            })
          )
        ).outcome
      ).toBe("no_effective_rule");

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET status = 'published', published_at = now(),
              backdated_reason = 'agreed retroactively' WHERE id = ${id}
        `
      );

      const stored = (await getAdminSql()`
        SELECT publish_backdated, backdated_reason FROM awcms_hr_commission_rules
        WHERE id = ${id}
      `) as { publish_backdated: boolean; backdated_reason: string }[];

      expect(stored[0]).toEqual({
        publish_backdated: true,
        backdated_reason: "agreed retroactively"
      });
      expect(
        (
          await accrue(
            TENANT_A,
            sale(employment, {
              ruleKey: "late",
              occurredAt: new Date("2026-02-10T10:00:00Z"),
              occurredOn: "2026-02-10"
            })
          )
        ).outcome
      ).toBe("accrued");
    });

    test("a client cannot assert the flag: a window starting today or later publishes un-flagged and drops any reason", async () => {
      const today = (
        (await getAdminSql()`
          SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d
        `) as { d: string }[]
      )[0]!.d;
      const id = await draft(today);

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET status = 'published', published_at = now(),
              publish_backdated = true, backdated_reason = 'pretend' WHERE id = ${id}
        `
      );

      const stored = (await getAdminSql()`
        SELECT publish_backdated, backdated_reason FROM awcms_hr_commission_rules
        WHERE id = ${id}
      `) as { publish_backdated: boolean; backdated_reason: string | null }[];

      expect(stored[0]).toEqual({
        publish_backdated: false,
        backdated_reason: null
      });
    });

    test("a draft cannot carry the flag, and the published pair is immutable afterwards", async () => {
      const id = await draft("2026-02-01");

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET publish_backdated = true, backdated_reason = 'x' WHERE id = ${id}
          `
        ),
        /check constraint|23514/i
      );

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET status = 'published', published_at = now(),
              backdated_reason = 'why' WHERE id = ${id}
        `
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules SET backdated_reason = 'changed'
            WHERE id = ${id}
          `
        ),
        /immutable|55000/
      );
    });

    test("the pure rule and the trigger agree on the boundary", async () => {
      const today = (
        (await getAdminSql()`
          SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d,
                 to_char((now() AT TIME ZONE 'UTC')::date - 1, 'YYYY-MM-DD') AS y,
                 to_char((now() AT TIME ZONE 'UTC')::date + 1, 'YYYY-MM-DD') AS t
        `) as { d: string; y: string; t: string }[]
      )[0]!;

      for (const [from, ruleKey] of [
        [today.y, "b1"],
        [today.d, "b2"],
        [today.t, "b3"]
      ] as const) {
        const id = await inTenant(
          TENANT_A,
          async (tx) =>
            (
              (await tx`
                INSERT INTO awcms_hr_commission_rules
                  (tenant_id, rule_key, version_no, name, source_type, calculation,
                   rate, currency_code, rounding_mode, rounding_scale, effective_from)
                VALUES (${TENANT_A}, ${ruleKey}, 1, 'B', 'sale_line', 'percent', 1,
                        'XTS', 'half_up', 2, ${from}::date)
                RETURNING id
              `) as { id: string }[]
            )[0]!.id
        );
        await inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'published', published_at = now(), backdated_reason = 'r'
            WHERE id = ${id}
          `
        );
        const flagged = (
          (await getAdminSql()`
            SELECT publish_backdated FROM awcms_hr_commission_rules WHERE id = ${id}
          `) as { publish_backdated: boolean }[]
        )[0]!.publish_backdated;

        expect(flagged).toBe(isBackdatedWindow(from, today.d));
      }
    });
  });

  describe("the beneficiary: an employment, live and employed on the event date", () => {
    test("the database and the pure rule agree on every boundary", async () => {
      type EmploymentValues = NonNullable<Parameters<typeof seedEmployment>[1]>;
      const cases: [string, EmploymentValues, string][] = [
        ["before hire", { hiredOn: "2026-03-11" }, "2026-03-10"],
        ["on the hire day", { hiredOn: "2026-03-10" }, "2026-03-10"],
        [
          "on the termination day",
          { terminatedOn: "2026-03-10" },
          "2026-03-10"
        ],
        [
          "the day after termination",
          { terminatedOn: "2026-03-09" },
          "2026-03-10"
        ],
        ["soft-deleted", { deleted: true }, "2026-03-10"],
        ["a plain live employment", {}, "2026-03-10"]
      ];

      for (const [label, values, on] of cases) {
        const id = await seedEmployment(TENANT_A, values);
        const expected = employmentEarnsOn(
          {
            hiredOn: values.hiredOn ?? "2026-01-01",
            terminatedOn: values.terminatedOn ?? null,
            deleted: values.deleted ?? false
          },
          on
        );
        const outcome = (
          await accrue(
            TENANT_A,
            sale(id, {
              source: {
                type: "sale_line",
                ref: `emp-${label.replaceAll(" ", "-")}`
              }
            })
          )
        ).outcome;

        expect({ label, outcome }).toEqual({
          label,
          outcome: expected ? "accrued" : "employment_not_eligible"
        });

        // The trigger itself, bypassing the application's pre-check.
        const raw = inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_accruals
              (tenant_id, employment_id, rule_id, rule_key, rule_version,
               source_type, source_ref, calculation, base_amount, rate, amount,
               currency_code, occurred_at, occurred_on, request_digest)
            SELECT ${TENANT_A}, ${id}, r.id, r.rule_key, r.version_no, 'sale_line',
                   ${`raw-${label.replaceAll(" ", "-")}`}, 'percent', 1, 2.5, 0.03, 'XTS',
                   '2026-03-10T10:00:00Z', ${on}::date, ${"c".repeat(64)}
            FROM awcms_hr_commission_rules r WHERE r.tenant_id = ${TENANT_A}
              AND r.rule_key = 'upsell'
          `
        );

        if (expected) {
          await raw;
        } else {
          await assertRejected(raw, /not live and employed|23514/);
        }
      }
    });

    test("an unknown employment is not found", async () => {
      expect(
        (await accrue(TENANT_A, sale("22222222-2222-4222-8222-222222222222")))
          .outcome
      ).toBe("employment_not_found");
    });
  });

  describe("a birth is validated by the database, bypassing the application", () => {
    const insertRaw = (
      overrides: Partial<{
        amount: string;
        ruleKey: string;
        version: number;
        sourceType: string;
        currency: string;
        status: string;
        rate: string;
        occurredOn: string;
        ruleWhere: string;
      }> = {}
    ) =>
      inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_hr_commission_accruals
            (tenant_id, employment_id, rule_id, rule_key, rule_version,
             source_type, source_ref, calculation, base_amount, rate, amount,
             currency_code, occurred_at, occurred_on, request_digest, status)
          SELECT ${TENANT_A}, ${employment}, r.id,
                 ${overrides.ruleKey ?? "upsell"}, ${overrides.version ?? 1},
                 ${overrides.sourceType ?? "sale_line"}, ${`raw-${Math.random()}`},
                 'percent', 100, ${overrides.rate ?? "2.5"}::numeric,
                 ${overrides.amount ?? "2.5"}::numeric,
                 ${overrides.currency ?? "XTS"}, '2026-03-10T10:00:00Z',
                 ${overrides.occurredOn ?? "2026-03-10"}::date, ${"d".repeat(64)},
                 ${overrides.status ?? "pending"}
          FROM awcms_hr_commission_rules r
          WHERE r.tenant_id = ${TENANT_A} AND r.rule_key = 'upsell'
        `
      );

    test("a correct row is accepted", async () => {
      await insertRaw();
      expect(await rows(TENANT_A)).toBe(1);
    });

    test("every disagreement with the rule is refused", async () => {
      for (const [label, overrides] of [
        ["a different version", { version: 2 }],
        ["a different source type", { sourceType: "booking" }],
        ["a different currency", { currency: "XXX" }],
        ["a different rate snapshot", { rate: "3" }],
        ["a date before the window", { occurredOn: "2025-12-31" }]
      ] as const) {
        await assertRejected(
          insertRaw(overrides),
          /not a published version in force|23514/
        );
        expect(label).toBeTruthy();
      }
    });

    test("an amount outside the rule's floor and ceiling is refused", async () => {
      await publishedRule(TENANT_A, {
        key: "bounded",
        min: "5",
        max: "50"
      });

      for (const amount of ["4.99", "50.01"]) {
        await assertRejected(
          inTenant(
            TENANT_A,
            (tx) => tx`
              INSERT INTO awcms_hr_commission_accruals
                (tenant_id, employment_id, rule_id, rule_key, rule_version,
                 source_type, source_ref, calculation, base_amount, rate, amount,
                 currency_code, occurred_at, occurred_on, request_digest)
              SELECT ${TENANT_A}, ${employment}, r.id, r.rule_key, r.version_no,
                     'sale_line', ${`b-${amount}`}, 'percent', 100, 2.5,
                     ${amount}::numeric, 'XTS', '2026-03-10T10:00:00Z',
                     '2026-03-10', ${"e".repeat(64)}
              FROM awcms_hr_commission_rules r
              WHERE r.tenant_id = ${TENANT_A} AND r.rule_key = 'bounded'
            `
          ),
          /floor and ceiling|23514/
        );
      }
    });

    test("a row cannot be born anywhere but pending", async () => {
      await assertRejected(
        insertRaw({ status: "paid" }),
        /born pending|55000|check/i
      );
    });

    test("NaN is refused in every money column", async () => {
      for (const column of ["amount", "base_amount", "rate"]) {
        await assertRejected(
          inTenant(
            TENANT_A,
            (tx) => tx`
              INSERT INTO awcms_hr_commission_accruals
                (tenant_id, employment_id, rule_id, rule_key, rule_version,
                 source_type, source_ref, calculation, base_amount, rate, amount,
                 currency_code, occurred_at, occurred_on, request_digest)
              SELECT ${TENANT_A}, ${employment}, r.id, r.rule_key, r.version_no,
                     'sale_line', ${`nan-${column}`}, 'percent',
                     ${column === "base_amount" ? "NaN" : "100"}::numeric,
                     ${column === "rate" ? "NaN" : "2.5"}::numeric,
                     ${column === "amount" ? "NaN" : "2.5"}::numeric,
                     'XTS', '2026-03-10T10:00:00Z', '2026-03-10', ${"f".repeat(64)}
              FROM awcms_hr_commission_rules r
              WHERE r.tenant_id = ${TENANT_A} AND r.rule_key = 'upsell'
            `
          ),
          /check constraint|23514|violates/i
        );
      }
    });

    test("negative, oversized and shape-inconsistent rows are refused", async () => {
      await assertRejected(
        insertRaw({ amount: "-1" }),
        /check constraint|23514|violates/i
      );
      await assertRejected(
        insertRaw({ amount: "1000000000000" }),
        /check constraint|23514|violates|22003/i
      );
    });
  });

  describe("the monetary facts are immutable; the machine is the database's", () => {
    test("no monetary fact, identity or source column can ever change", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      for (const set of [
        "amount = amount + 1",
        "base_amount = base_amount + 1",
        "rate = 1",
        "currency_code = 'XXX'",
        "rule_version = 2",
        "source_ref = 'other'",
        "employment_id = employment_id",
        "occurred_on = '2026-03-11'",
        "request_digest = repeat('0', 64)",
        "created_at = now() + interval '1 day'",
        "operation = 'accrue'"
      ]) {
        if (
          set === "employment_id = employment_id" ||
          set === "operation = 'accrue'"
        ) {
          // A no-op assignment is not a change.
          continue;
        }

        await assertRejected(
          inTenant(TENANT_A, (tx) =>
            tx.unsafe(
              `UPDATE awcms_hr_commission_accruals SET ${set} WHERE id = '${id}'`
            )
          ),
          /immutable monetary facts|55000|check|23514/i
        );
      }
    });

    test("nothing is ever deleted: awcms_app holds no DELETE and a trigger refuses it for anyone", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_hr_commission_accruals WHERE id = ${id}`
        ),
        /permission denied|42501/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_hr_commission_accruals WHERE id = ${id}`,
        /cannot be deleted|55000/
      );
    });

    test("the database agrees with the pure state machine on EVERY pair of states", async () => {
      let n = 0;

      for (const from of ACCRUAL_STATUSES) {
        for (const to of ACCRUAL_STATUSES) {
          n += 1;

          if (from === to) {
            // A status that does not change is not a transition.
            continue;
          }

          const id = await accrualAt(
            TENANT_A,
            employment,
            from,
            manager,
            `matrix-${n}`
          );
          const attempt = inTenant(TENANT_A, (tx) => {
            switch (to) {
              case "approved":
                return tx`UPDATE awcms_hr_commission_accruals SET status = 'approved', approved_at = now(), approved_by = ${manager} WHERE id = ${id}`;
              case "payable":
                return tx`UPDATE awcms_hr_commission_accruals SET status = 'payable', released_at = now(), released_by = ${manager} WHERE id = ${id}`;
              case "paid":
                return tx`UPDATE awcms_hr_commission_accruals SET status = 'paid', paid_at = now(), paid_by = ${payer} WHERE id = ${id}`;
              case "voided":
                return tx`UPDATE awcms_hr_commission_accruals SET status = 'voided', voided_at = now(), voided_by = ${manager} WHERE id = ${id}`;
              default:
                return tx`UPDATE awcms_hr_commission_accruals SET status = 'pending' WHERE id = ${id}`;
            }
          });

          if (canTransition(from, to)) {
            await attempt;
          } else {
            await assertRejected(
              attempt,
              /not a permitted transition|55000|check|23514/i
            );
            const status = (
              (await getAdminSql()`
                SELECT status FROM awcms_hr_commission_accruals WHERE id = ${id}
              `) as { status: string }[]
            )[0]!.status;

            expect(status).toBe(from);
          }
        }
      }
    });

    test("a voided accrual can never be paid, however it is attempted", async () => {
      const id = await accrualAt(TENANT_A, employment, "voided", manager, "v1");

      expect((await transition(TENANT_A, id, "pay", payer)).outcome).toBe(
        "invalid_state"
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'paid', paid_at = now(), paid_by = ${manager}
            WHERE id = ${id}
          `
        ),
        /not a permitted transition|55000/
      );
      expect((await transition(TENANT_A, id, "release", manager)).outcome).toBe(
        "invalid_state"
      );
    });

    test("a stamp cannot move without a status transition, and an edge touches only its own stamps", async () => {
      const id = await accrualAt(
        TENANT_A,
        employment,
        "approved",
        manager,
        "s1"
      );

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals SET approved_by = ${owner}
            WHERE id = ${id}
          `
        ),
        /stamp changes only with a status transition|55000/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'payable', released_at = now(), released_by = ${manager},
                approved_by = ${owner}
            WHERE id = ${id}
          `
        ),
        /unexpected approval stamp change|55000/
      );
    });

    test("the beneficiary cannot approve their own accrual, in the service and in the trigger", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      expect((await transition(TENANT_A, id, "approve", owner)).outcome).toBe(
        "sod_violation"
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'approved', approved_at = now(), approved_by = ${owner}
            WHERE id = ${id}
          `
        ),
        /beneficiary cannot approve|55000/
      );
      expect((await transition(TENANT_A, id, "approve", manager)).outcome).toBe(
        "ok"
      );
    });

    test("every edge needs a person: a system actor is refused", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            transitionAccrual(tx, TENANT_A, id, "approve", {
              actorTenantUserId: null,
              correlationId: undefined
            })
          )
        ).outcome
      ).toBe("actor_required");
    });

    test("the full path stamps who and when, and pay records an opaque reference", async () => {
      const id = await accrualAt(
        TENANT_A,
        employment,
        "payable",
        manager,
        "p1"
      );
      const paid = await inTenant(TENANT_A, (tx) =>
        transitionAccrual(tx, TENANT_A, id, "pay", actorOf(payer), {
          paymentReference: "batch-1"
        })
      );

      expect(paid.outcome).toBe("ok");

      const found = await inTenant(TENANT_A, (tx) =>
        getAccrual(tx, TENANT_A, id)
      );

      expect(found!.accrual.status).toBe("paid");
      expect(found!.accrual.paymentReference).toBe("batch-1");
      expect(found!.accrual.paidAt).not.toBeNull();
      expect(
        found!.transitions.map((t) => `${t.fromStatus}>${t.toStatus}`)
      ).toEqual([
        "null>pending",
        "pending>approved",
        "approved>payable",
        "payable>paid"
      ]);
      expect((await transition(TENANT_A, id, "pay", payer)).outcome).toBe(
        "invalid_state"
      );
    });
  });

  describe("the transition log", () => {
    test("it is written only by the ledger: a direct insert is refused, even for a row that would be true", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_transitions
              (tenant_id, accrual_id, from_status, to_status, actor_tenant_user_id)
            VALUES (${TENANT_A}, ${id}, 'pending', 'approved', ${manager})
          `
        ),
        /written only by the accrual ledger|55000/
      );
    });

    test("it is append-only: no UPDATE, no DELETE, for the runtime role or the owner", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      await assertRejected(
        inTenant(
          TENANT_A,
          (
            tx
          ) => tx`UPDATE awcms_hr_commission_transitions SET reason_code = 'x'
                     WHERE accrual_id = ${id}`
        ),
        /permission denied|42501/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_hr_commission_transitions WHERE accrual_id = ${id}`
        ),
        /permission denied|42501/
      );
      await assertRejected(
        getAdminSql()`UPDATE awcms_hr_commission_transitions SET reason_code = 'x' WHERE accrual_id = ${id}`,
        /append-only|55000/
      );
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_hr_commission_transitions WHERE accrual_id = ${id}`,
        /append-only|55000/
      );
    });

    test("the void reason is carried onto the log as a code", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      await inTenant(TENANT_A, (tx) =>
        transitionAccrual(tx, TENANT_A, id, "void", actorOf(manager), {
          reasonCode: "sale_cancelled"
        })
      );

      const found = await inTenant(TENANT_A, (tx) =>
        getAccrual(tx, TENANT_A, id)
      );
      const last = found!.transitions.at(-1)!;

      expect(last).toMatchObject({
        fromStatus: "pending",
        toStatus: "voided",
        actorTenantUserId: manager,
        reasonCode: "sale_cancelled"
      });
    });

    test("balances reconcile to the transitions; tampering outside the application is reported", async () => {
      const second = await seedEmployment(TENANT_A, {
        tenantUserId: await seedTenantUser(TENANT_A, "second")
      });
      await accrualAt(TENANT_A, employment, "pending", manager, "r1");
      await accrualAt(TENANT_A, employment, "approved", manager, "r2");
      await accrualAt(TENANT_A, second, "payable", manager, "r3");
      const paid = await accrualAt(TENANT_A, second, "paid", manager, "r4");
      await accrualAt(TENANT_A, second, "voided", manager, "r5");

      const clean = await inTenant(TENANT_A, (tx) =>
        reconcileAccruals(tx, TENANT_A)
      );

      expect(clean.reconciled).toBe(true);
      expect(clean.statusMismatches).toEqual([]);
      expect(clean.brokenChains).toEqual([]);
      expect(clean.balances).toEqual(clean.balancesFromTransitions);
      expect(
        clean.balances.map((b) => `${b.status}:${b.count}:${b.total}`).sort()
      ).toEqual([
        "approved:1:25.000000",
        "paid:1:25.000000",
        "payable:1:25.000000",
        "pending:1:25.000000",
        "voided:1:25.000000"
      ]);

      // A superuser changes the status with the triggers off: the ledger no
      // longer matches its log, and the reconciliation says exactly which.
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`UPDATE awcms_hr_commission_accruals SET status = 'payable',
                   paid_at = NULL, paid_by = NULL, payment_reference = NULL
                 WHERE id = ${paid}`;
      });

      const dirty = await inTenant(TENANT_A, (tx) =>
        reconcileAccruals(tx, TENANT_A)
      );

      expect(dirty.reconciled).toBe(false);
      expect(dirty.statusMismatches).toEqual([paid]);
    });
  });

  describe("the beneficiary login snapshot (Issue #1019)", () => {
    // The link guard (sql/228) refuses a login of another profile; these
    // tests re-point the link on purpose, as a maintenance session could.
    const setLink = (employmentId: string, userId: string | null) =>
      getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard"
        );
        await tx`
          UPDATE awcms_hr_employments SET tenant_user_id = ${userId}
          WHERE id = ${employmentId}
        `;
        await tx.unsafe(
          "ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard"
        );
      });

    const snapshotOf = async (id: string): Promise<string | null> =>
      (
        (await getAdminSql()`
          SELECT beneficiary_tenant_user_id AS b FROM awcms_hr_commission_accruals
          WHERE id = ${id}
        `) as { b: string | null }[]
      )[0]!.b;

    const rawApprove = (id: string, by: string) =>
      inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_accruals
          SET status = 'approved', approved_at = now(), approved_by = ${by}
          WHERE id = ${id}
        `
      );

    test("a birth stamps the employment's login; a writer-supplied value is discarded", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      expect(await snapshotOf(id)).toBe(owner);

      const ruleId = (
        (await getAdminSql()`
          SELECT id FROM awcms_hr_commission_rules WHERE tenant_id = ${TENANT_A}
        `) as { id: string }[]
      )[0]!.id;
      const forged = (await inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_hr_commission_accruals
            (tenant_id, employment_id, rule_id, rule_key, rule_version,
             source_type, source_ref, calculation, base_amount, rate, amount,
             currency_code, occurred_at, occurred_on, request_digest,
             beneficiary_tenant_user_id)
          VALUES (${TENANT_A}, ${employment}, ${ruleId}, 'upsell', 1,
                  'sale_line', 'forged', 'percent', 1, 2.5, 0.03, 'XTS',
                  '2026-03-10T10:00:00Z', '2026-03-10', ${"a".repeat(64)},
                  ${manager})
          RETURNING id
        `
      )) as { id: string }[];

      expect(await snapshotOf(forged[0]!.id)).toBe(owner);
    });

    test("an unlinked employment is born with no snapshot", async () => {
      const unlinked = await seedEmployment(TENANT_A);
      const id = await accrued(TENANT_A, sale(unlinked));

      expect(await snapshotOf(id)).toBeNull();
    });

    test("the snapshot is a fact: it cannot be changed after birth", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET beneficiary_tenant_user_id = ${manager} WHERE id = ${id}
          `
        ),
        /immutable monetary facts|55000/
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET beneficiary_tenant_user_id = NULL WHERE id = ${id}
          `
        ),
        /immutable monetary facts|55000/
      );
    });

    test("the reported bypass is refused: unlink, self-approve, self-release, relink", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      // Step 1: the beneficiary unlinks their own employment's login.
      await setLink(employment, null);

      // Step 2: they approve and release their own accrual, in the service...
      const selfApprove = await transition(TENANT_A, id, "approve", owner);
      expect(selfApprove).toEqual({
        outcome: "sod_violation",
        kind: "beneficiary"
      });
      // ...and in the database, were the service bypassed.
      await assertRejected(
        rawApprove(id, owner),
        /beneficiary or the creator|55000/
      );

      // Step 3: relinking changes nothing either.
      await setLink(employment, owner);
      expect((await transition(TENANT_A, id, "approve", owner)).outcome).toBe(
        "sod_violation"
      );
      await assertRejected(
        rawApprove(id, owner),
        /beneficiary or the creator|55000/
      );

      // The accrual never moved.
      expect(await snapshotOf(id)).toBe(owner);
      expect(await getAccrualStatus(id)).toBe("pending");
    });

    test("release and pay by the beneficiary are refused even while unlinked", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      expect((await transition(TENANT_A, id, "approve", manager)).outcome).toBe(
        "ok"
      );
      await setLink(employment, null);

      expect((await transition(TENANT_A, id, "release", owner)).outcome).toBe(
        "sod_violation"
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'payable', released_at = now(), released_by = ${owner}
            WHERE id = ${id}
          `
        ),
        /cannot release their own|55000/
      );

      // The two-person control still works with the login unlinked.
      expect((await transition(TENANT_A, id, "release", manager)).outcome).toBe(
        "ok"
      );
      expect((await transition(TENANT_A, id, "pay", owner)).outcome).toBe(
        "sod_violation"
      );
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'paid', paid_at = now(), paid_by = ${owner}
            WHERE id = ${id}
          `
        ),
        /cannot pay the accrual|55000/
      );
      expect((await transition(TENANT_A, id, "pay", payer)).outcome).toBe("ok");
    });

    test("re-pointing the link: both the snapshotted and the current login are the beneficiary", async () => {
      const id = await accrued(TENANT_A, sale(employment));

      await setLink(employment, payer);

      expect((await transition(TENANT_A, id, "approve", owner)).outcome).toBe(
        "sod_violation"
      );
      expect((await transition(TENANT_A, id, "approve", payer)).outcome).toBe(
        "sod_violation"
      );
      await assertRejected(
        rawApprove(id, payer),
        /beneficiary or the creator|55000/
      );
      expect((await transition(TENANT_A, id, "approve", manager)).outcome).toBe(
        "ok"
      );
    });

    test("fail closed: no linked login and no snapshot refuses approve, release and pay (409 in the handler)", async () => {
      const unlinked = await seedEmployment(TENANT_A);
      const id = await accrued(TENANT_A, sale(unlinked));

      expect(await transition(TENANT_A, id, "approve", manager)).toEqual({
        outcome: "sod_violation",
        kind: "beneficiary_unresolved"
      });
      await assertRejected(
        rawApprove(id, manager),
        /BENEFICIARY_LOGIN_UNRESOLVED/
      );

      // Release and pay are refused by the database too: put the row into
      // `approved` / `payable` with the triggers off (a maintenance session),
      // then attempt the next edge with them on.
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`UPDATE awcms_hr_commission_accruals
                 SET status = 'approved', approved_at = now(), approved_by = ${manager}
                 WHERE id = ${id}`;
      });
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'payable', released_at = now(), released_by = ${payer}
            WHERE id = ${id}
          `
        ),
        /BENEFICIARY_LOGIN_UNRESOLVED/
      );
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`UPDATE awcms_hr_commission_accruals
                 SET status = 'payable', released_at = now(), released_by = ${payer}
                 WHERE id = ${id}`;
      });
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_accruals
            SET status = 'paid', paid_at = now(), paid_by = ${owner}
            WHERE id = ${id}
          `
        ),
        /BENEFICIARY_LOGIN_UNRESOLVED/
      );

      // Neither edge is open to the service either.
      expect(await transition(TENANT_A, id, "pay", payer)).toEqual({
        outcome: "sod_violation",
        kind: "beneficiary_unresolved"
      });

      // Voiding stays the safe way out (of a pending accrual).
      const pending = await accrued(
        TENANT_A,
        sale(unlinked, { source: { type: "sale_line", ref: "ORD-V" } })
      );

      expect(
        (await transition(TENANT_A, pending, "void", manager)).outcome
      ).toBe("ok");
    });

    test("linking a login to a previously unlinked employment makes the transition possible for others", async () => {
      const unlinked = await seedEmployment(TENANT_A);
      const id = await accrued(TENANT_A, sale(unlinked));

      const newcomer = await seedTenantUser(TENANT_A, "newcomer");

      await setLink(unlinked, newcomer);

      // No snapshot (born unlinked), but the current link binds the newcomer.
      expect(
        (await transition(TENANT_A, id, "approve", newcomer)).outcome
      ).toBe("sod_violation");
      expect((await transition(TENANT_A, id, "approve", manager)).outcome).toBe(
        "ok"
      );

      // Unlinking again afterwards and releasing: no snapshot, no link -> refused.
      await setLink(unlinked, null);
      expect((await transition(TENANT_A, id, "release", payer)).outcome).toBe(
        "sod_violation"
      );
    });
  });

  async function getAccrualStatus(id: string): Promise<string> {
    return (
      (await getAdminSql()`
        SELECT status FROM awcms_hr_commission_accruals WHERE id = ${id}
      `) as { status: string }[]
    )[0]!.status;
  }

  describe("concurrency", () => {
    test("a concurrent soft delete of the employment serialises with an accrual: the employment row is locked FOR SHARE", async () => {
      let release!: () => void;
      let lockTaken!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<void>((resolve) => (lockTaken = resolve));

      const flipper = getRuntimeSql().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
        await tx`
          UPDATE awcms_hr_employments SET deleted_at = now()
          WHERE tenant_id = ${TENANT_A} AND id = ${employment}
        `;
        lockTaken();
        await hold;
      });

      await locked;

      let settled = false;
      const posting = accrue(TENANT_A, sale(employment)).then((result) => {
        settled = true;

        return result;
      });

      // A plain read would validate against the still-visible live row and finish.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      release();
      await flipper;

      expect((await posting).outcome).toBe("employment_not_eligible");
      expect(await rows(TENANT_A)).toBe(0);
    });

    test("a concurrent retire of the rule serialises with an accrual: the published rule rows are locked FOR SHARE", async () => {
      let release!: () => void;
      let lockTaken!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<void>((resolve) => (lockTaken = resolve));

      const retirer = getRuntimeSql().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
        await tx`
          UPDATE awcms_hr_commission_rules SET status = 'retired', retired_at = now()
          WHERE tenant_id = ${TENANT_A} AND rule_key = 'upsell'
        `;
        lockTaken();
        await hold;
      });

      await locked;

      let settled = false;
      const posting = accrue(TENANT_A, sale(employment)).then((result) => {
        settled = true;

        return result;
      });

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      release();
      await retirer;

      expect((await posting).outcome).toBe("no_effective_rule");
      expect(await rows(TENANT_A)).toBe(0);
    });

    test("two racing pays of one payable accrual: exactly one succeeds, the other is refused as an outcome, not an error", async () => {
      const id = await accrualAt(
        TENANT_A,
        employment,
        "payable",
        manager,
        "c1"
      );
      const results = await Promise.all([
        transition(TENANT_A, id, "pay", payer),
        transition(TENANT_A, id, "pay", payer),
        transition(TENANT_A, id, "pay", payer)
      ]);
      const outcomes = results.map((result) => result.outcome).sort();

      expect(outcomes).toEqual(["invalid_state", "invalid_state", "ok"]);

      const found = await inTenant(TENANT_A, (tx) =>
        getAccrual(tx, TENANT_A, id)
      );

      expect(
        found!.transitions.filter((t) => t.toStatus === "paid")
      ).toHaveLength(1);
    });

    test("an approve racing a void of one pending accrual: one wins and the log tells one story", async () => {
      const id = await accrued(TENANT_A, sale(employment));
      const results = await Promise.all([
        transition(TENANT_A, id, "approve", manager),
        transition(TENANT_A, id, "void", manager)
      ]);
      const outcomes = results.map((result) => result.outcome);

      // approve-then-void is legal (approved -> voided), void-then-approve is not.
      expect(
        outcomes.filter((outcome) => outcome === "ok").length
      ).toBeGreaterThanOrEqual(1);

      const found = await inTenant(TENANT_A, (tx) =>
        getAccrual(tx, TENANT_A, id)
      );
      const chain = found!.transitions.map((t) => t.toStatus);

      expect(chain[0]).toBe("pending");
      expect(chain.at(-1)).toBe(found!.accrual.status);
      expect(
        (await inTenant(TENANT_A, (tx) => reconcileAccruals(tx, TENANT_A)))
          .reconciled
      ).toBe(true);
    });
  });

  describe("the stored amount is the rule's evaluation (database recomputation)", () => {
    const day = 86_400_000;

    /** Inserts a row by hand with the amount given, as the runtime role: the trigger decides. */
    function raw(
      ruleKey: string,
      ref: string,
      base: string | null,
      units: number | null,
      amount: string,
      occurredAt = "2026-03-10T10:00:00Z",
      occurredOn = "2026-03-10",
      employmentId = employment
    ) {
      return inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_hr_commission_accruals
            (tenant_id, employment_id, rule_id, rule_key, rule_version,
             source_type, source_ref, calculation, base_amount, units, rate,
             fixed_amount, amount, currency_code, occurred_at, occurred_on,
             request_digest)
          SELECT ${TENANT_A}, ${employmentId}, r.id, r.rule_key, r.version_no,
                 r.source_type, ${ref}, r.calculation, ${base}::numeric,
                 ${units}::integer, r.rate, r.fixed_amount, ${amount}::numeric,
                 r.currency_code, ${occurredAt}::timestamptz, ${occurredOn}::date,
                 ${"9".repeat(64)}
          FROM awcms_hr_commission_rules r
          WHERE r.tenant_id = ${TENANT_A} AND r.rule_key = ${ruleKey}
            AND r.status = 'published'
        `
      );
    }

    const wrong = (amount: string, delta: string) =>
      (BigInt(amount.replace(".", "")) + BigInt(delta))
        .toString()
        .replace(/(\d+)(\d{2})$/, "$1.$2");

    test("the SQL evaluation and the pure evaluation agree over every rounding mode and half boundary, with a floor and a ceiling", async () => {
      const bases = [
        "0.01",
        "0.20",
        "0.60",
        "1.00",
        "2.20",
        "3.00",
        "10.10",
        "33.33",
        "100.10",
        "999.99",
        "1000.10"
      ];
      let n = 0;

      for (const mode of ROUNDING_MODES) {
        for (const clamp of [false, true]) {
          const key = `m_${mode}_${clamp ? "c" : "n"}`;
          const terms = {
            calculation: "percent" as const,
            rate: "2.5",
            fixedAmount: null,
            minAmount: clamp ? "0.02" : null,
            maxAmount: clamp ? "20" : null,
            currencyCode: "XTS",
            roundingMode: mode,
            roundingScale: 2
          };

          await publishedRule(TENANT_A, {
            key,
            rate: "2.5",
            scale: 2,
            mode,
            min: clamp ? "0.02" : null,
            max: clamp ? "20" : null
          });

          for (const base of bases) {
            n += 1;
            const expected = evaluateCommission(terms, {
              baseAmount: base
            }).amount;

            // The pure answer is accepted by the database...
            await raw(key, `a-${n}`, base, null, expected);
            // ...and a cent either side is refused by it.
            for (const delta of ["1", "-1"]) {
              if (BigInt(expected.replace(".", "")) + BigInt(delta) < 0n)
                continue;
              await assertRejected(
                raw(key, `w-${n}${delta}`, base, null, wrong(expected, delta)),
                /not the rule's evaluation|23514/
              );
            }
          }
        }
      }

      expect(n).toBe(ROUNDING_MODES.length * 2 * bases.length);
    });

    test("fixed rules agree too (10.005 per unit, every mode)", async () => {
      let n = 0;

      for (const mode of ROUNDING_MODES) {
        const key = `f_${mode}`;

        await publishedRule(TENANT_A, {
          key,
          calculation: "fixed",
          fixed: "10.005",
          scale: 2,
          mode
        });

        for (const units of [0, 1, 3, 7]) {
          n += 1;
          const expected = evaluateCommission(
            {
              calculation: "fixed",
              rate: null,
              fixedAmount: "10.005",
              minAmount: null,
              maxAmount: null,
              currencyCode: "XTS",
              roundingMode: mode,
              roundingScale: 2
            },
            { units }
          ).amount;

          await raw(key, `fa-${n}`, null, units, expected);
          await assertRejected(
            raw(key, `fw-${n}`, null, units, wrong(expected, "1")),
            /not the rule's evaluation|23514/
          );
        }
      }
    });

    test("a service-computed amount is accepted by the database (the two agree end to end)", async () => {
      for (const mode of ROUNDING_MODES) {
        await publishedRule(TENANT_A, { key: `e_${mode}`, mode, rate: "7.5" });

        const result = await accrue(
          TENANT_A,
          sale(employment, {
            ruleKey: `e_${mode}`,
            source: { type: "sale_line", ref: `e-${mode}` },
            baseAmount: "123.45"
          })
        );

        expect(result.outcome).toBe("accrued");
      }
    });

    test("an event older than 730 days is refused by the database and by the service; one just inside is accepted", async () => {
      const veteran = await seedEmployment(TENANT_A, { hiredOn: "2020-01-01" });

      await publishedRule(TENANT_A, {
        key: "old",
        from: "2020-01-01",
        rate: "10"
      });

      const at = (days: number) => new Date(Date.now() - days * day);
      const on = (date: Date) => date.toISOString().slice(0, 10);

      await raw(
        "old",
        "age-ok",
        "100",
        null,
        "10.00",
        at(725).toISOString(),
        on(at(725)),
        veteran
      );
      await assertRejected(
        raw(
          "old",
          "age-old",
          "100",
          null,
          "10.00",
          at(740).toISOString(),
          on(at(740)),
          veteran
        ),
        /older than 730 days|23514/
      );

      expect(
        (
          await accrue(
            TENANT_A,
            sale(veteran, {
              ruleKey: "old",
              source: { type: "sale_line", ref: "svc-old" },
              baseAmount: "100",
              occurredAt: at(740),
              occurredOn: on(at(740))
            })
          )
        ).outcome
      ).toBe("input_invalid");
      expect(
        (
          await accrue(
            TENANT_A,
            sale(veteran, {
              ruleKey: "old",
              source: { type: "sale_line", ref: "svc-ok" },
              baseAmount: "100",
              occurredAt: at(725),
              occurredOn: on(at(725))
            })
          )
        ).outcome
      ).toBe("accrued");
    });
  });

  describe("segregation of duties (the trigger and the pure rule agree)", () => {
    type Who = "beneficiary" | "creator" | "approver" | "other";

    test("every actor against approve, release and pay: refused exactly when sodViolation says so, in the service AND in the trigger", async () => {
      const creator = await seedTenantUser(TENANT_A, "creator");
      const approver = await seedTenantUser(TENANT_A, "approver");
      const other = await seedTenantUser(TENANT_A, "other");
      const who: Record<Who, string> = {
        beneficiary: owner,
        creator,
        approver,
        other
      };
      let n = 0;

      const fresh = async (to: "pending" | "approved" | "payable") => {
        n += 1;
        const id = await inTenant(TENANT_A, (tx) =>
          accrueCommission(
            tx,
            TENANT_A,
            creator,
            sale(employment, { source: { type: "sale_line", ref: `sod-${n}` } })
          )
        );

        if (id.outcome !== "accrued") throw new Error("fixture");

        const accrualId = id.accrual.id;
        const steps: [AccrualAction, string][] =
          to === "pending"
            ? []
            : to === "approved"
              ? [["approve", approver]]
              : [
                  ["approve", approver],
                  ["release", other]
                ];

        for (const [action, user] of steps) {
          expect(
            (await transition(TENANT_A, accrualId, action, user)).outcome
          ).toBe("ok");
        }

        return accrualId;
      };

      const raw = (
        action: "approve" | "release" | "pay",
        id: string,
        user: string
      ) =>
        inTenant(TENANT_A, (tx) => {
          switch (action) {
            case "approve":
              return tx`UPDATE awcms_hr_commission_accruals SET status = 'approved', approved_at = now(), approved_by = ${user} WHERE id = ${id}`;
            case "release":
              return tx`UPDATE awcms_hr_commission_accruals SET status = 'payable', released_at = now(), released_by = ${user} WHERE id = ${id}`;
            default:
              return tx`UPDATE awcms_hr_commission_accruals SET status = 'paid', paid_at = now(), paid_by = ${user} WHERE id = ${id}`;
          }
        });

      const cases: [
        "approve" | "release" | "pay",
        "pending" | "approved" | "payable"
      ][] = [
        ["approve", "pending"],
        ["release", "approved"],
        ["pay", "payable"]
      ];

      for (const [action, before] of cases) {
        for (const actorKind of Object.keys(who) as Who[]) {
          const user = who[actorKind];
          // The parties are those of THIS accrual: created by `creator`, approved
          // by `approver` once it has been approved.
          const parties = {
            beneficiaryUserId: owner,
            snapshotBeneficiaryUserId: owner,
            createdBy: creator,
            approvedBy: before === "pending" ? null : approver
          };
          const expected = sodViolation(action, user, parties);

          // The service.
          const viaService = await fresh(before);
          const outcome = await transition(TENANT_A, viaService, action, user);

          expect({ action, actorKind, outcome: outcome.outcome }).toEqual({
            action,
            actorKind,
            outcome: expected === null ? "ok" : "sod_violation"
          });

          // The trigger, with the application bypassed.
          const viaTrigger = await fresh(before);

          if (expected === null) {
            await raw(action, viaTrigger, user);
          } else {
            await assertRejected(
              raw(action, viaTrigger, user),
              /cannot approve|cannot release|cannot pay|55000/
            );
          }
        }
      }
    });

    test("void is not segregated: the beneficiary and the creator may void", async () => {
      const creator = await seedTenantUser(TENANT_A, "creator2");
      const a = await accrued(TENANT_A, sale(employment));
      const b = await inTenant(TENANT_A, (tx) =>
        accrueCommission(
          tx,
          TENANT_A,
          creator,
          sale(employment, { source: { type: "sale_line", ref: "v-b" } })
        )
      );

      expect((await transition(TENANT_A, a, "void", owner)).outcome).toBe("ok");
      expect(
        b.outcome === "accrued" &&
          (await transition(TENANT_A, b.accrual.id, "void", creator)).outcome
      ).toBe("ok");
    });
  });

  describe("shape and privileges", () => {
    test("awcms_app holds SELECT, INSERT, UPDATE on accruals and SELECT, INSERT on transitions, nothing more", async () => {
      const grants = (await getAdminSql()`
        SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'awcms_app'
          AND table_name IN ('awcms_hr_commission_accruals', 'awcms_hr_commission_transitions')
        ORDER BY table_name, privilege_type
      `) as { table_name: string; privilege_type: string }[];

      expect(
        grants.map((grant) => `${grant.table_name}:${grant.privilege_type}`)
      ).toEqual([
        "awcms_hr_commission_accruals:INSERT",
        "awcms_hr_commission_accruals:SELECT",
        "awcms_hr_commission_accruals:UPDATE",
        "awcms_hr_commission_transitions:INSERT",
        "awcms_hr_commission_transitions:SELECT"
      ]);
    });

    test("no personal, contact, identifier, account, photo, biometric or device column exists", async () => {
      const columns = (await getAdminSql()`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('awcms_hr_commission_accruals', 'awcms_hr_commission_transitions')
      `) as { column_name: string }[];
      const forbidden =
        /name|email|phone|address|nik|npwp|account|bank|photo|image|selfie|biometric|device|fingerprint|latitude|longitude|ip_|note|reason_text/i;

      expect(
        columns
          .map((column) => column.column_name)
          .filter((name) => forbidden.test(name))
      ).toEqual([]);
    });
  });
});
