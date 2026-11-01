/**
 * The commission intake queue and its `awcms_app` poster against a real
 * PostgreSQL (Issue #1189, ADR-0147), with FORCE RLS in force and the real
 * `awcms_worker` / `awcms_app` roles.
 *
 * What this proves, in the ADR's own terms:
 *
 *   * the WORKER holds INSERT on the intake table and nothing else on it, and no
 *     privilege on any payroll-family relation (SELECT of the queue or of an
 *     accrual is refused by the database);
 *   * a submit through the port, run as the worker, queues; a replay is a
 *     duplicate; ten racing submits are one row; the switch off writes nothing;
 *   * two tenants: a submit in one never posts in the other, and RLS holds under
 *     the runtime role;
 *   * the poster, as `awcms_app`, drains the queue through the ONE posting core:
 *     the accrual, the audit row and the transition log are the synchronous
 *     path's own, exactly once under a replay, a retry after a crash, and two
 *     posters at once;
 *   * a transient error is retried with a back-off and ends `failed` at the cap
 *     (poison), a crash after the ledger write rolls the write back, and neither
 *     an amount nor an error message reaches the audit trail;
 *   * `source_conflict` and `period_closed` are routed to the exceptions list,
 *     a void before its accrual waits for it, a void without a person is refused;
 *   * retention deletes only settled rows, and the worker's count-only function
 *     answers the lifecycle engine without reading the table.
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
  createRuntimePool,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type {
  CommissionAccrualRequest,
  CommissionVoidRequest
} from "../../src/modules/_shared/ports/commission-accrual-port";
import { transitionAccrual } from "../../src/modules/hr-commission/application/hr-commission-accrual-ledger";
import {
  getIntakeSetting,
  listIntakeExceptions,
  parseExceptionCursor,
  setIntakeEnabled
} from "../../src/modules/hr-commission/application/hr-commission-intake-store";
import { createCommissionIntakePort } from "../../src/modules/hr-commission/application/hr-commission-intake-port-adapter";
import {
  purgeTerminalIntents,
  runIntakePosterForTenant,
  type PostingCore
} from "../../src/modules/hr-commission/application/hr-commission-intake-poster";
import { runIntakePosterJob } from "../../src/modules/hr-commission/application/hr-commission-intake-job";
import { INTAKE_MAX_ATTEMPTS } from "../../src/modules/hr-commission/domain/hr-commission-intake";
import {
  accrueCommission,
  voidCommissionBySource
} from "../../src/modules/hr-commission/application/hr-commission-accrual-ledger";

const TENANT_A = "a1189000-0000-4000-8000-00000000000a";
const TENANT_B = "a1189000-0000-4000-8000-00000000000b";

const port = createCommissionIntakePort();

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

/** The event consumer's seat: `awcms_worker`, in a tenant transaction. */
function asWorker<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getWorkerRoleSql(), tenantId, fn);
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
    VALUES (${tenantId}, ${profile[0]!.id}, ${`i${counter}@example.com`}, 'x')
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

  await admin`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard_insert`;

  try {
    const employment = (await admin`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`E-${counter}`},
              '2026-01-01'::date, ${tenantUserId})
      RETURNING id
    `) as { id: string }[];

    return employment[0]!.id;
  } finally {
    await admin`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  }
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

/** One instant for the whole file: a redelivery carries the SAME occurredAt. */
const SALE_AT = new Date(Math.floor((Date.now() - 3600_000) / 1000) * 1000);

function sale(
  employmentId: string,
  ref = "ORD-1",
  extra: Partial<CommissionAccrualRequest> = {}
): CommissionAccrualRequest {
  const at = SALE_AT;

  return {
    employmentId,
    ruleKey: "upsell",
    source: { type: "sale_line", ref, line: "1" },
    baseAmount: "1000.10",
    currencyCode: "XTS",
    occurredAt: at,
    occurredOn: at.toISOString().slice(0, 10),
    ...extra
  };
}

function reversal(
  employmentId: string,
  ref = "ORD-1",
  extra: Partial<CommissionVoidRequest> = {}
): CommissionVoidRequest {
  return {
    employmentId,
    source: { type: "sale_line", ref, line: "1" },
    reason: "sale_voided",
    ...extra
  };
}

const submitAsWorker = (
  tenantId: string,
  request: CommissionAccrualRequest,
  actor: string | null = null
) =>
  asWorker(tenantId, (tx) => port.submitAccrual(tx, tenantId, actor, request));

const submitVoidAsWorker = (
  tenantId: string,
  request: CommissionVoidRequest,
  actor: string | null
) => asWorker(tenantId, (tx) => port.submitVoid(tx, tenantId, actor, request));

/** The poster as the app role. */
const post = (
  tenantId: string,
  options: Parameters<typeof runIntakePosterForTenant>[2] = {}
) => runIntakePosterForTenant(getRuntimeSql(), tenantId, options);

type Count = { n: number };

async function count(table: string, tenantId: string): Promise<number> {
  const rows = (await getAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = '${tenantId}'`
  )) as Count[];

  return rows[0]!.n;
}

type IntentRow = {
  id: string;
  kind: string;
  status: string;
  outcome_code: string | null;
  attempts: number;
};

async function intents(tenantId: string): Promise<IntentRow[]> {
  return (await getAdminSql()`
    SELECT id, kind, status, outcome_code, attempts
    FROM awcms_hr_commission_intents
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at, id
  `) as IntentRow[];
}

/** Ages every intake row of a tenant (created_at back, due now): the guard trigger forbids this to anyone but a superuser fixture. */
async function ageIntents(tenantId: string, interval: string): Promise<void> {
  const admin = getAdminSql();

  await admin`ALTER TABLE awcms_hr_commission_intents DISABLE TRIGGER awcms_hr_commission_intents_guard_update`;

  try {
    await admin.unsafe(
      `UPDATE awcms_hr_commission_intents
       SET created_at = created_at - interval '${interval}',
           next_attempt_at = now() - interval '1 second'
       WHERE tenant_id = '${tenantId}' AND status IN ('pending', 'posting')`
    );
  } finally {
    await admin`ALTER TABLE awcms_hr_commission_intents ENABLE TRIGGER awcms_hr_commission_intents_guard_update`;
  }
}

async function expectRefused(
  promise: Promise<unknown>,
  pattern: RegExp
): Promise<void> {
  let caught: unknown;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  resetDatabaseCircuitBreakerForTests();
  expect(caught).toBeDefined();
  expect(
    `${(caught as Error).message} ${String((caught as { errno?: unknown }).errno ?? "")}`
  ).toMatch(pattern);
}

/** A clock far enough ahead that every settled row is past every retention window. */
const LONG_AFTER = { now: new Date(Date.now() + 400 * 86_400_000) };

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_commission intake queue and poster (Issue #1189)", () => {
  let owner: string;
  let manager: string;
  /** The tenant's intake system actor: the only identity the poster stamps. */
  let systemActor: string;
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
      VALUES (${TENANT_A}, 'ik-a', 'IK A'), (${TENANT_B}, 'ik-b', 'IK B')
    `;
    owner = await seedTenantUser(TENANT_A);
    manager = await seedTenantUser(TENANT_A);
    systemActor = await seedTenantUser(TENANT_A);
    employment = await seedEmployment(TENANT_A, owner);
    await publishedRule(TENANT_A);
    await inTenant(TENANT_A, (tx) =>
      setIntakeEnabled(tx, TENANT_A, true, manager, systemActor)
    );
  });

  describe("privileges (ADR-0147 section 1)", () => {
    test("RLS is ENABLED and FORCED with USING and WITH CHECK on both new tables", async () => {
      const found = (await getAdminSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               bool_and(p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS both
        FROM pg_class c
        JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname IN ('awcms_hr_commission_intents', 'awcms_hr_commission_intake_settings')
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

    test("the worker holds INSERT on the queue and no other verb, column or role-inherited privilege", async () => {
      if (!workerRoleActivated) return;

      const privilege = async (table: string, verb: string) =>
        (
          (await getAdminSql().unsafe(
            `SELECT has_table_privilege('awcms_worker', '${table}', '${verb}') AS held`
          )) as { held: boolean }[]
        )[0]!.held;
      const anyColumn = async (table: string, verb: string) =>
        (
          (await getAdminSql().unsafe(
            `SELECT has_any_column_privilege('awcms_worker', '${table}', '${verb}') AS held`
          )) as { held: boolean }[]
        )[0]!.held;

      expect(await privilege("awcms_hr_commission_intents", "INSERT")).toBe(
        true
      );

      for (const verb of [
        "SELECT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES"
      ]) {
        expect(await privilege("awcms_hr_commission_intents", verb)).toBe(
          false
        );
      }

      for (const verb of ["SELECT", "UPDATE"]) {
        expect(await anyColumn("awcms_hr_commission_intents", verb)).toBe(
          false
        );
      }

      // The switch is readable by COLUMN (tenant_id and the boolean) and nothing
      // more: not the system actor, not the stamps, not the table as a whole.
      const columnPrivilege = async (column: string) =>
        (
          (await getAdminSql().unsafe(
            `SELECT has_column_privilege('awcms_worker', 'awcms_hr_commission_intake_settings', '${column}', 'SELECT') AS held`
          )) as { held: boolean }[]
        )[0]!.held;

      expect(
        await privilege("awcms_hr_commission_intake_settings", "SELECT")
      ).toBe(false);
      expect(await columnPrivilege("commission_intake_enabled")).toBe(true);
      expect(await columnPrivilege("tenant_id")).toBe(true);
      expect(await columnPrivilege("intake_actor_tenant_user_id")).toBe(false);
      expect(await columnPrivilege("updated_by")).toBe(false);

      for (const verb of ["INSERT", "UPDATE", "DELETE"]) {
        expect(
          await privilege("awcms_hr_commission_intake_settings", verb)
        ).toBe(false);
      }

      // Nothing on any payroll-family relation, at table or column level.
      for (const table of [
        "awcms_hr_commission_accruals",
        "awcms_hr_commission_transitions"
      ]) {
        for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(table, verb)).toBe(false);
        }

        for (const verb of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
          expect(await anyColumn(table, verb)).toBe(false);
        }
      }
    });

    test("a worker session is refused SELECT of the queue, of an accrual and of the ledger log", async () => {
      if (!workerRoleActivated) return;

      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) => tx`SELECT id FROM awcms_hr_commission_intents`
        ),
        /permission denied|42501/
      );
      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) => tx`SELECT id FROM awcms_hr_commission_accruals`
        ),
        /permission denied|42501/
      );
      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) => tx`SELECT id FROM awcms_hr_commission_transitions`
        ),
        /permission denied|42501/
      );
    });

    test("a worker session cannot UPDATE or DELETE a queued row, and cannot post an accrual", async () => {
      if (!workerRoleActivated) return;

      expect((await submitAsWorker(TENANT_A, sale(employment))).outcome).toBe(
        "queued"
      );

      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) => tx`UPDATE awcms_hr_commission_intents SET status = 'posted'`
        ),
        /permission denied|42501/
      );
      await expectRefused(
        asWorker(TENANT_A, (tx) => tx`DELETE FROM awcms_hr_commission_intents`),
        /permission denied|42501/
      );
      await expectRefused(
        asWorker(TENANT_A, (tx) =>
          accrueCommission(tx, TENANT_A, null, sale(employment, "ORD-9"))
        ),
        /permission denied|42501/
      );
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(0);
    });

    test("the lifecycle count function answers the worker without a table read", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment));
      await post(TENANT_A);

      const future = new Date(Date.now() + 86_400_000).toISOString();
      const answered = await asWorker(
        TENANT_A,
        (tx) =>
          tx`SELECT awcms_hr_commission_lifecycle_eligible_count(
               'awcms_hr_commission_intents', ${TENANT_A}::uuid, ${future}::timestamptz
             ) AS n` as Promise<{ n: number }[]>
      );

      expect(answered[0]!.n).toBe(1);

      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) =>
            tx`SELECT awcms_hr_commission_lifecycle_eligible_count(
                 'awcms_hr_commission_accruals', ${TENANT_A}::uuid, ${future}::timestamptz)`
        ),
        /22023|not one of this module/
      );
    });
  });

  describe("the port, as the worker", () => {
    test("queues, answers a replay as duplicate, and a different request for the same identity is a second row", async () => {
      if (!workerRoleActivated) return;

      expect((await submitAsWorker(TENANT_A, sale(employment))).outcome).toBe(
        "queued"
      );
      expect((await submitAsWorker(TENANT_A, sale(employment))).outcome).toBe(
        "duplicate"
      );
      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(1);

      expect(
        (
          await submitAsWorker(
            TENANT_A,
            sale(employment, "ORD-1", { baseAmount: "2000.00" })
          )
        ).outcome
      ).toBe("queued");
      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(2);
    });

    test("ten racing submits of one request are one row", async () => {
      if (!workerRoleActivated) return;

      const request = sale(employment, "ORD-RACE");
      const results = await Promise.all(
        Array.from({ length: 10 }, () => submitAsWorker(TENANT_A, request))
      );
      const outcomes = results.map((result) => result.outcome);

      expect(outcomes.filter((outcome) => outcome === "queued")).toHaveLength(
        1
      );
      expect(
        outcomes.filter((outcome) => outcome === "duplicate")
      ).toHaveLength(9);
      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(1);

      // The same race on a wide pool, so the contenders are truly concurrent.
      const pool = createRuntimePool(10);

      try {
        const wide = await Promise.all(
          Array.from({ length: 10 }, () =>
            withTenantOrThrow(pool, TENANT_A, (tx) =>
              port.submitAccrual(
                tx,
                TENANT_A,
                null,
                sale(employment, "ORD-WIDE")
              )
            )
          )
        );

        expect(wide.filter((r) => r.outcome === "queued")).toHaveLength(1);
        expect(wide.filter((r) => r.outcome === "duplicate")).toHaveLength(9);
      } finally {
        await pool.close();
      }

      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(2);
    });

    test("with the switch off nothing is written, and the database refuses a raw insert too", async () => {
      if (!workerRoleActivated) return;

      await inTenant(TENANT_A, (tx) =>
        setIntakeEnabled(tx, TENANT_A, false, manager)
      );

      expect((await submitAsWorker(TENANT_A, sale(employment))).outcome).toBe(
        "disabled"
      );
      expect(
        (await submitVoidAsWorker(TENANT_A, reversal(employment), manager))
          .outcome
      ).toBe("disabled");
      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(0);

      // Defence in depth: bypass the port's read and the trigger still refuses.
      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) =>
            tx`INSERT INTO awcms_hr_commission_intents
                 (tenant_id, kind, source_type, source_ref, source_line,
                  employment_id, rule_key, base_amount, currency_code,
                  occurred_at, occurred_on, request_digest)
               VALUES (${TENANT_A}, 'accrue', 'sale_line', 'RAW', '', ${employment},
                       'upsell', 10, 'XTS', now(), current_date, ${"a".repeat(64)})`
        ),
        /not enabled|55000/
      );
    });

    test("a tenant that never set the switch is default-deny", async () => {
      if (!workerRoleActivated) return;

      const second = await seedEmployment(TENANT_B);

      expect((await submitAsWorker(TENANT_B, sale(second))).outcome).toBe(
        "disabled"
      );
    });

    test("an unknown employment is input_invalid and the consumer's transaction stays usable", async () => {
      if (!workerRoleActivated) return;

      const outcomes = await asWorker(TENANT_A, async (tx) => {
        const bad = await port.submitAccrual(
          tx,
          TENANT_A,
          null,
          sale("99999999-9999-4999-8999-999999999999")
        );
        const good = await port.submitAccrual(
          tx,
          TENANT_A,
          null,
          sale(employment, "ORD-AFTER")
        );

        return [bad.outcome, good.outcome];
      });

      expect(outcomes).toEqual(["input_invalid", "queued"]);
    });

    test("a void without a person is actor_required and writes nothing", async () => {
      if (!workerRoleActivated) return;

      expect(
        (await submitVoidAsWorker(TENANT_A, reversal(employment), null)).outcome
      ).toBe("actor_required");
      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(0);
    });

    test("the table refuses a row born anything but pending", async () => {
      await expectRefused(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`INSERT INTO awcms_hr_commission_intents
                 (tenant_id, kind, source_type, source_ref, source_line,
                  employment_id, rule_key, base_amount, currency_code,
                  occurred_at, occurred_on, request_digest, status, outcome_code)
               VALUES (${TENANT_A}, 'accrue', 'sale_line', 'BORN', '', ${employment},
                       'upsell', 10, 'XTS', now(), current_date, ${"b".repeat(64)},
                       'posted', 'accrued')`
        ),
        /born pending|55000/
      );
    });
  });

  describe("tenant isolation", () => {
    test("a submit in one tenant never posts in the other", async () => {
      if (!workerRoleActivated) return;

      const employmentB = await seedEmployment(TENANT_B);

      await publishedRule(TENANT_B);
      const actorB = await seedTenantUser(TENANT_B);

      await getAdminSql()`
        INSERT INTO awcms_hr_commission_intake_settings
          (tenant_id, commission_intake_enabled, intake_actor_tenant_user_id)
        VALUES (${TENANT_B}, true, ${actorB})
        ON CONFLICT (tenant_id) DO UPDATE SET commission_intake_enabled = true
      `;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-A"));

      await post(TENANT_B);

      expect(await count("awcms_hr_commission_accruals", TENANT_B)).toBe(0);
      expect((await intents(TENANT_A))[0]!.status).toBe("pending");

      await post(TENANT_A);

      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(1);
      expect(await count("awcms_hr_commission_accruals", TENANT_B)).toBe(0);

      // B's own queue is independent.
      await submitAsWorker(TENANT_B, sale(employmentB, "ORD-B"));
      await post(TENANT_B);
      expect(await count("awcms_hr_commission_accruals", TENANT_B)).toBe(1);
    });

    test("under the runtime role one tenant cannot read, write or reference the other's queue", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment));

      expect(
        await inTenant(
          TENANT_B,
          (tx) =>
            tx`SELECT id FROM awcms_hr_commission_intents` as Promise<unknown[]>
        )
      ).toHaveLength(0);

      // B's session can neither move nor delete A's rows: RLS hides them.
      expect(
        await inTenant(
          TENANT_B,
          async (tx) =>
            (await tx`UPDATE awcms_hr_commission_intents
                      SET next_attempt_at = now() WHERE tenant_id = ${TENANT_A}
                      RETURNING id`) as unknown[]
        )
      ).toHaveLength(0);
      expect(
        await inTenant(
          TENANT_B,
          async (tx) =>
            (await tx`DELETE FROM awcms_hr_commission_intents
                      WHERE tenant_id = ${TENANT_A} RETURNING id`) as unknown[]
        )
      ).toHaveLength(0);
      expect(await count("awcms_hr_commission_intents", TENANT_A)).toBe(1);

      // A row written for A while the session is scoped to B is refused (the
      // switch trigger reads B's settings first; WITH CHECK is the second wall).
      await expectRefused(
        inTenant(
          TENANT_B,
          (tx) =>
            tx`INSERT INTO awcms_hr_commission_intents
                 (tenant_id, kind, source_type, source_ref, source_line,
                  employment_id, rule_key, base_amount, currency_code,
                  occurred_at, occurred_on, request_digest)
               VALUES (${TENANT_A}, 'accrue', 'sale_line', 'X', '', ${employment},
                       'upsell', 10, 'XTS', now(), current_date, ${"c".repeat(64)})`
        ),
        /row-level security|42501|not enabled|55000/
      );

      // And another tenant's employment is not a valid reference.
      const employmentB = await seedEmployment(TENANT_B);
      const actorB = await seedTenantUser(TENANT_B);

      await inTenant(TENANT_B, (tx) =>
        setIntakeEnabled(tx, TENANT_B, true, actorB, actorB)
      );

      expect(
        (await submitAsWorker(TENANT_A, sale(employmentB, "ORD-X"))).outcome
      ).toBe("input_invalid");
    });
  });

  describe("the poster (ADR-0147 section 3)", () => {
    test("drains an accrual through the one posting core: accrual, audit row, transition log", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));

      const result = await post(TENANT_A);

      expect(result.claimed).toBe(1);
      expect(result.posted).toBe(1);

      const rows = await intents(TENANT_A);

      expect(rows[0]!.status).toBe("posted");
      expect(rows[0]!.outcome_code).toBe("accrued");

      const accruals = (await getAdminSql()`
        SELECT amount::text AS amount, status, created_by
        FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
      `) as { amount: string; status: string; created_by: string | null }[];

      // 2.5% of 1000.10 = 25.0025, rounded half-up to 2 places by the ledger.
      expect(accruals).toHaveLength(1);
      expect(accruals[0]!.status).toBe("pending");
      // Stamped with the tenant's intake system actor, never the worker's claim.
      expect(accruals[0]!.created_by).toBe(systemActor);
      expect(Number(accruals[0]!.amount)).toBe(25);

      const audits = (await getAdminSql()`
        SELECT action, severity FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.accrual.accrued'
      `) as { action: string }[];

      expect(audits).toHaveLength(1);

      const log = (await getAdminSql()`
        SELECT to_status FROM awcms_hr_commission_transitions
        WHERE tenant_id = ${TENANT_A}
      `) as { to_status: string }[];

      expect(log.map((row) => row.to_status)).toEqual(["pending"]);
    });

    test("a second run, a replayed submit and a redelivery after retention accrue nothing twice", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await post(TENANT_A);
      await post(TENANT_A);

      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(1);
      expect(
        (await submitAsWorker(TENANT_A, sale(employment, "ORD-1"))).outcome
      ).toBe("duplicate");

      // Retention removes the settled intake row; a redelivery is queued again
      // and the ledger answers it from the original.
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, LONG_AFTER)
      ).toBe(1);
      expect(
        (await submitAsWorker(TENANT_A, sale(employment, "ORD-1"))).outcome
      ).toBe("queued");

      const again = await post(TENANT_A);

      expect(again.posted).toBe(1);
      expect((await intents(TENANT_A))[0]!.outcome_code).toBe("replayed");
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT count(*)::int AS n FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.accrual.accrued'
        `) as Count[]
      ).toEqual([{ n: 1 }]);
    });

    test("a poster retried after a crash posts exactly once", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));

      // Crash 1: the ledger wrote and then the process died before the commit.
      const crashing: PostingCore = {
        accrue: async (tx, tenantId, actor, request) => {
          await accrueCommission(tx, tenantId, actor, request);
          throw new Error("simulated crash after the ledger write");
        },
        voidBySource: voidCommissionBySource
      };
      const first = await post(TENANT_A, { ledger: crashing });

      expect(first.retried).toBe(1);
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(0);
      expect((await intents(TENANT_A))[0]!.status).toBe("pending");

      // The back-off holds the row; the next tick (the lease/back-off elapsed)
      // posts it.
      expect((await post(TENANT_A)).claimed).toBe(0);
      await getAdminSql()`
        UPDATE awcms_hr_commission_intents SET next_attempt_at = now() - interval '1 second'
        WHERE tenant_id = ${TENANT_A}
      `;
      expect((await post(TENANT_A)).posted).toBe(1);

      // Crash 2: the process died holding the claim (row stuck in `posting`
      // with the ledger already written by an earlier life).
      await getAdminSql()`
        ALTER TABLE awcms_hr_commission_intents DISABLE TRIGGER awcms_hr_commission_intents_guard_update
      `;
      await getAdminSql()`
        UPDATE awcms_hr_commission_intents
        SET status = 'posting', outcome_code = NULL, attempts = 2,
            next_attempt_at = now() - interval '1 minute'
        WHERE tenant_id = ${TENANT_A}
      `;
      await getAdminSql()`
        ALTER TABLE awcms_hr_commission_intents ENABLE TRIGGER awcms_hr_commission_intents_guard_update
      `;

      const recovered = await post(TENANT_A);

      expect(recovered.posted).toBe(1);
      expect((await intents(TENANT_A))[0]!.outcome_code).toBe("replayed");
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(1);
    });

    test("a held lease is not claimed, a lapsed one is", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await getAdminSql()`
        UPDATE awcms_hr_commission_intents
        SET status = 'posting', attempts = 1, next_attempt_at = now() + interval '5 minutes'
        WHERE tenant_id = ${TENANT_A}
      `;

      expect((await post(TENANT_A)).claimed).toBe(0);

      await getAdminSql()`
        UPDATE awcms_hr_commission_intents
        SET next_attempt_at = now() - interval '1 second' WHERE tenant_id = ${TENANT_A}
      `;

      const result = await post(TENANT_A);

      expect(result.claimed).toBe(1);
      expect(result.posted).toBe(1);
    });

    test("two posters at once post every row exactly once", async () => {
      if (!workerRoleActivated) return;

      for (let index = 0; index < 20; index += 1) {
        await submitAsWorker(TENANT_A, sale(employment, `ORD-${index}`));
      }

      const pool = createRuntimePool(8);

      try {
        const results = await Promise.all([
          runIntakePosterForTenant(pool, TENANT_A, { claimBatch: 6 }),
          runIntakePosterForTenant(pool, TENANT_A, { claimBatch: 6 })
        ]);

        expect(results[0]!.posted + results[1]!.posted).toBe(20);
      } finally {
        await pool.close();
      }

      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(20);
      expect(
        (await intents(TENANT_A)).every((row) => row.status === "posted")
      ).toBe(true);
    });

    test("with the switch off the poster claims nothing, and housekeeping still runs", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await inTenant(TENANT_A, (tx) =>
        setIntakeEnabled(tx, TENANT_A, false, manager)
      );

      const result = await post(TENANT_A);

      expect(result.skipped).toBe("intake_disabled");
      expect(result.claimed).toBe(0);
      expect((await intents(TENANT_A))[0]!.status).toBe("pending");
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(0);
    });

    test("--dry-run counts and changes nothing", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));

      const result = await post(TENANT_A, { dryRun: true });

      expect(result.claimed).toBe(1);
      expect(result.posted).toBe(0);
      expect((await intents(TENANT_A))[0]!.status).toBe("pending");
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(0);
    });

    test("the job visits every active tenant and reports totals", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));

      const summary = await runIntakePosterJob(getRuntimeSql(), {});

      expect(summary.tenantsChecked).toBeGreaterThanOrEqual(2);
      expect(summary.tenantsErrored).toBe(0);
      expect(summary.totals.posted).toBe(1);
      expect(summary.tenantsSkipped).toBeGreaterThanOrEqual(1); // tenant B: off
    });
  });

  describe("poison and retries", () => {
    const alwaysThrows: PostingCore = {
      accrue: async () => {
        throw new Error("driver says: Key (employment_id)=(secret) is wrong");
      },
      voidBySource: voidCommissionBySource
    };

    test("a transient error is retried with a back-off and ends failed at the cap, with no message in the audit trail", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));

      for (let attempt = 1; attempt <= INTAKE_MAX_ATTEMPTS; attempt += 1) {
        await getAdminSql()`
          UPDATE awcms_hr_commission_intents
          SET next_attempt_at = now() - interval '1 second'
          WHERE tenant_id = ${TENANT_A} AND status = 'pending'
        `;

        const result = await post(TENANT_A, { ledger: alwaysThrows });

        if (attempt < INTAKE_MAX_ATTEMPTS) {
          expect(result.retried).toBe(1);

          const row = (await intents(TENANT_A))[0]!;

          expect(row.status).toBe("pending");
          expect(row.attempts).toBe(attempt);
        } else {
          expect(result.failed).toBe(1);
        }
      }

      const row = (await intents(TENANT_A))[0]!;

      expect(row.status).toBe("failed");
      expect(row.outcome_code).toBe("error");
      expect(row.attempts).toBe(INTAKE_MAX_ATTEMPTS);
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(0);

      const audit = (await getAdminSql()`
        SELECT action, severity, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.intake.failed'
      `) as { action: string; severity: string; attributes: string }[];

      expect(audit).toHaveLength(1);
      expect(audit[0]!.severity).toBe("warning");
      expect(audit[0]!.attributes).not.toContain("secret");
      expect(audit[0]!.attributes).not.toContain("driver");

      // A failed row is never claimed again.
      expect((await post(TENANT_A)).claimed).toBe(0);
    });

    test("a row whose every claim died mid-flight is failed, not claimed once more", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await getAdminSql()`
        UPDATE awcms_hr_commission_intents
        SET status = 'posting', attempts = ${INTAKE_MAX_ATTEMPTS},
            next_attempt_at = now() - interval '1 second'
        WHERE tenant_id = ${TENANT_A}
      `;

      const result = await post(TENANT_A);

      expect(result.failed).toBe(1);
      expect(result.claimed).toBe(0);
      expect((await intents(TENANT_A))[0]!.outcome_code).toBe(
        "attempts_exhausted"
      );
    });
  });

  describe("exceptions routed to a human", () => {
    test("the same identity with a different request surfaces as source_conflict, with masked ids and no amount", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-SECRET-1234"));
      await submitAsWorker(
        TENANT_A,
        sale(employment, "ORD-SECRET-1234", { baseAmount: "7777.77" })
      );
      await post(TENANT_A);

      const rows = await intents(TENANT_A);

      expect(rows.map((row) => row.outcome_code).sort()).toEqual([
        "accrued",
        "source_conflict"
      ]);
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(1);

      const page = await inTenant(TENANT_A, (tx) =>
        listIntakeExceptions(tx, TENANT_A)
      );
      const text = JSON.stringify(page);

      expect(page.exceptions).toHaveLength(1);
      expect(page.exceptions[0]!.outcomeCode).toBe("source_conflict");
      expect(page.exceptions[0]!.status).toBe("refused");
      expect(page.summary.counts.posted).toBe(1);
      expect(page.summary.counts.refused).toBe(1);
      expect(text).not.toContain("7777");
      expect(text).not.toContain("1000.10");
      expect(text).not.toContain("ORD-SECRET-1234");
      expect(text).not.toContain(employment);
    });

    test("a void for an accrual that is already payable is period_closed: refused, never silently voided or retried", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await post(TENANT_A);

      const accrualId = (
        (await getAdminSql()`
          SELECT id FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { id: string }[]
      )[0]!.id;

      for (const action of ["approve", "release"] as const) {
        const moved = await inTenant(TENANT_A, (tx) =>
          transitionAccrual(tx, TENANT_A, accrualId, action, {
            actorTenantUserId: manager,
            correlationId: undefined
          })
        );

        expect(moved.outcome).toBe("ok");
      }

      await submitVoidAsWorker(TENANT_A, reversal(employment), manager);

      const result = await post(TENANT_A);

      expect(result.refused).toBe(1);

      const voidRow = (await intents(TENANT_A)).find(
        (row) => row.kind === "void"
      )!;

      expect(voidRow.status).toBe("refused");
      expect(voidRow.outcome_code).toBe("period_closed");
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE id = ${accrualId}
        `) as { status: string }[]
      ).toEqual([{ status: "payable" }]);

      const page = await inTenant(TENANT_A, (tx) =>
        listIntakeExceptions(tx, TENANT_A)
      );

      expect(page.exceptions.map((e) => e.outcomeCode)).toEqual([
        "period_closed"
      ]);

      // One audit row, a warning, with codes and ids only.
      const audit = (await getAdminSql()`
        SELECT severity, attributes::text AS attributes FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.intake.refused'
      `) as { severity: string; attributes: string }[];

      expect(audit).toHaveLength(1);
      expect(audit[0]!.severity).toBe("warning");
      expect(audit[0]!.attributes).toContain("period_closed");
      expect(audit[0]!.attributes).not.toContain("1000");
    });

    test("a void posts the same audit row and event as the synchronous path", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await post(TENANT_A);
      await submitVoidAsWorker(TENANT_A, reversal(employment), manager);

      const result = await post(TENANT_A);

      expect(result.posted).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT status, voided_by FROM awcms_hr_commission_accruals
          WHERE tenant_id = ${TENANT_A}
        `) as { status: string; voided_by: string }[]
      ).toEqual([{ status: "voided", voided_by: systemActor }]);

      const events = (await getAdminSql()`
        SELECT event_type FROM awcms_domain_events
        WHERE tenant_id = ${TENANT_A} AND event_type = 'awcms.hr.commission.voided'
      `) as { event_type: string }[];

      expect(events).toHaveLength(1);
      expect(
        (await getAdminSql()`
          SELECT count(*)::int AS n FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A} AND action LIKE 'hr_commission.accrual.%void%'
        `) as Count[]
      ).toEqual([{ n: 1 }]);

      // A second void of the same sale is already_voided: posted, nothing new.
      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-1", { reason: "refund" }),
        manager
      );
      expect((await post(TENANT_A)).posted).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT count(*)::int AS n FROM awcms_domain_events
          WHERE tenant_id = ${TENANT_A} AND event_type = 'awcms.hr.commission.voided'
        `) as Count[]
      ).toEqual([{ n: 1 }]);
    });

    test("a void that arrives before its accrual waits for it, then posts", async () => {
      if (!workerRoleActivated) return;

      await submitVoidAsWorker(TENANT_A, reversal(employment), manager);
      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));

      const first = await post(TENANT_A);

      expect(first.deferred).toBe(1);
      expect(first.posted).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { status: string }[]
      ).toEqual([{ status: "pending" }]);

      await getAdminSql()`
        UPDATE awcms_hr_commission_intents SET next_attempt_at = now() - interval '1 second'
        WHERE tenant_id = ${TENANT_A} AND status = 'pending'
      `;

      expect((await post(TENANT_A)).posted).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { status: string }[]
      ).toEqual([{ status: "voided" }]);
    });

    test("a void for a sale that was never accrued waits out the grace window, then is refused", async () => {
      if (!workerRoleActivated) return;

      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "NEVER"),
        manager
      );

      // Inside the 24h grace it is deferred, not refused.
      const first = await post(TENANT_A);

      expect(first.deferred).toBe(1);
      expect(first.refused).toBe(0);
      expect((await intents(TENANT_A))[0]!.status).toBe("pending");

      await ageIntents(TENANT_A, "25 hours");

      expect((await post(TENANT_A)).refused).toBe(1);
      expect((await intents(TENANT_A))[0]!.outcome_code).toBe(
        "no_intake_origin"
      );
    });

    test("a business refusal (no effective rule) is terminal and not retried", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(
        TENANT_A,
        sale(employment, "ORD-1", { ruleKey: "no_such_rule" })
      );

      const result = await post(TENANT_A);

      expect(result.refused).toBe(1);
      expect(result.retried).toBe(0);
      expect((await intents(TENANT_A))[0]!.outcome_code).toBe(
        "no_effective_rule"
      );
      expect((await post(TENANT_A)).claimed).toBe(0);
    });
  });

  describe("exceptions pagination", () => {
    test("the exceptions list pages by keyset past the first page without skipping or repeating", async () => {
      if (!workerRoleActivated) return;

      for (let index = 0; index < 52; index += 1) {
        await submitAsWorker(
          TENANT_A,
          sale(employment, `ORD-P-${index}`, { ruleKey: "no_such_rule" })
        );
      }

      expect((await post(TENANT_A)).refused).toBe(52);

      const first = await inTenant(TENANT_A, (tx) =>
        listIntakeExceptions(tx, TENANT_A)
      );

      expect(first.exceptions).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();

      const cursor = parseExceptionCursor(first.nextCursor!)!;
      const second = await inTenant(TENANT_A, (tx) =>
        listIntakeExceptions(tx, TENANT_A, cursor)
      );

      expect(second.exceptions).toHaveLength(2);
      expect(second.nextCursor).toBeNull();

      const ids = [...first.exceptions, ...second.exceptions].map(
        (exception) => exception.id
      );

      expect(new Set(ids).size).toBe(52);
      expect(first.summary.counts.refused).toBe(52);
    });
  });

  describe("the worker's claim is not trusted (H1)", () => {
    test("a forged actor is ignored: the ledger, the audit and the void carry the system actor, and the claim survives only as an attribute", async () => {
      if (!workerRoleActivated) return;

      // The worker claims to be the beneficiary's own login (owner).
      await submitAsWorker(TENANT_A, sale(employment, "ORD-F"), owner);
      await submitVoidAsWorker(TENANT_A, reversal(employment, "ORD-F"), owner);
      await post(TENANT_A);
      await getAdminSql()`
        UPDATE awcms_hr_commission_intents SET next_attempt_at = now() - interval '1 second'
        WHERE tenant_id = ${TENANT_A} AND status = 'pending'
      `;
      await post(TENANT_A);

      const accrual = (await getAdminSql()`
        SELECT created_by, voided_by, status FROM awcms_hr_commission_accruals
        WHERE tenant_id = ${TENANT_A}
      `) as { created_by: string; voided_by: string; status: string }[];

      expect(accrual).toEqual([
        { created_by: systemActor, voided_by: systemActor, status: "voided" }
      ]);

      const actors = (await getAdminSql()`
        SELECT DISTINCT actor_tenant_user_id FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action LIKE 'hr_commission.%'
          AND actor_tenant_user_id IS NOT NULL
          AND action <> 'hr_commission.intake.configured'
      `) as { actor_tenant_user_id: string }[];

      expect(actors.map((row) => row.actor_tenant_user_id)).toEqual([
        systemActor
      ]);

      const posted = (await getAdminSql()`
        SELECT attributes->>'claimedBy' AS claimed_by,
               attributes->>'sourceRefFingerprint' AS fingerprint,
               attributes::text AS text
        FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.intake.posted'
      `) as { claimed_by: string; fingerprint: string; text: string }[];

      expect(posted).toHaveLength(2);

      for (const row of posted) {
        expect(row.claimed_by).toBe(owner);
        expect(row.fingerprint).toMatch(/^[0-9a-f]{12}$/);
        expect(row.text).not.toContain("ORD-F");
      }
    });

    test("a void cannot reach a manually created accrual: it waits, then is refused, and the accrual is untouched", async () => {
      if (!workerRoleActivated) return;

      // A person (not this intake) accrued it.
      await inTenant(TENANT_A, (tx) =>
        accrueCommission(tx, TENANT_A, manager, sale(employment, "ORD-MAN"))
      );

      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-MAN"),
        manager
      );

      const first = await post(TENANT_A);

      expect(first.deferred).toBe(1);
      expect(first.posted).toBe(0);

      await ageIntents(TENANT_A, "25 hours");

      expect((await post(TENANT_A)).refused).toBe(1);
      expect((await intents(TENANT_A))[0]!.outcome_code).toBe(
        "no_intake_origin"
      );
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { status: string }[]
      ).toEqual([{ status: "pending" }]);
    });

    test("an accrue intent that only REPLAYED a manual accrual is not an origin", async () => {
      if (!workerRoleActivated) return;

      await inTenant(TENANT_A, (tx) =>
        accrueCommission(tx, TENANT_A, manager, sale(employment, "ORD-MAN"))
      );
      // The same request arrives through the intake: the ledger replays it.
      await submitAsWorker(TENANT_A, sale(employment, "ORD-MAN"));
      await post(TENANT_A);

      expect((await intents(TENANT_A)).map((row) => row.outcome_code)).toEqual([
        "replayed"
      ]);

      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-MAN"),
        manager
      );
      await ageIntents(TENANT_A, "25 hours");
      await post(TENANT_A);

      const rows = await intents(TENANT_A);

      expect(rows.find((row) => row.kind === "void")!.outcome_code).toBe(
        "no_intake_origin"
      );
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { status: string }[]
      ).toEqual([{ status: "pending" }]);
    });

    test("an APPROVED intake accrual is voided as the port and ADR-0147 section 3 map it (pending and approved only); a payable one is period_closed", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-APP"));
      await submitAsWorker(TENANT_A, sale(employment, "ORD-PAY"));
      await post(TENANT_A);

      const ids = (await getAdminSql()`
        SELECT id, source_ref FROM awcms_hr_commission_accruals
        WHERE tenant_id = ${TENANT_A}
      `) as { id: string; source_ref: string }[];
      const idOf = (ref: string) =>
        ids.find((row) => row.source_ref === ref)!.id;
      const move = (id: string, action: "approve" | "release") =>
        inTenant(TENANT_A, (tx) =>
          transitionAccrual(tx, TENANT_A, id, action, {
            actorTenantUserId: manager,
            correlationId: undefined
          })
        );

      expect((await move(idOf("ORD-APP"), "approve")).outcome).toBe("ok");
      expect((await move(idOf("ORD-PAY"), "approve")).outcome).toBe("ok");
      expect((await move(idOf("ORD-PAY"), "release")).outcome).toBe("ok");

      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-APP"),
        manager
      );
      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-PAY"),
        manager
      );

      const result = await post(TENANT_A);

      expect(result.posted).toBe(1);
      expect(result.refused).toBe(1);

      const status = async (id: string) =>
        (
          (await getAdminSql()`
            SELECT status, voided_by FROM awcms_hr_commission_accruals WHERE id = ${id}
          `) as { status: string; voided_by: string | null }[]
        )[0]!;

      expect(await status(idOf("ORD-APP"))).toEqual({
        status: "voided",
        voided_by: systemActor
      });
      expect((await status(idOf("ORD-PAY"))).status).toBe("payable");
    });
  });

  describe("out-of-order delivery (M1)", () => {
    test("a void that arrives long before its accrue keeps waiting without spending its retry budget, then posts", async () => {
      if (!workerRoleActivated) return;

      await submitVoidAsWorker(TENANT_A, reversal(employment), manager);

      // Far more polls than the retry cap: waiting is not failing.
      for (let poll = 0; poll < INTAKE_MAX_ATTEMPTS + 3; poll += 1) {
        await getAdminSql()`
          UPDATE awcms_hr_commission_intents SET next_attempt_at = now() - interval '1 second'
          WHERE tenant_id = ${TENANT_A} AND status = 'pending'
        `;
        expect((await post(TENANT_A)).deferred).toBe(1);
      }

      const waiting = (await intents(TENANT_A))[0]!;

      expect(waiting.status).toBe("pending");
      expect(waiting.attempts).toBe(0);

      // The accrue finally arrives (after an outage); the void then posts.
      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await post(TENANT_A);
      await getAdminSql()`
        UPDATE awcms_hr_commission_intents SET next_attempt_at = now() - interval '1 second'
        WHERE tenant_id = ${TENANT_A} AND status = 'pending'
      `;
      expect((await post(TENANT_A)).posted).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { status: string }[]
      ).toEqual([{ status: "voided" }]);
    });
  });

  describe("a stuck accrue keeps its void waiting (M-A)", () => {
    const accrueAlwaysThrows: PostingCore = {
      accrue: async () => {
        throw new Error("simulated outage");
      },
      voidBySource: voidCommissionBySource
    };

    test("while the accrue is live in the queue the void is NOT refused past the grace; once it posts, the void posts", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-S"));
      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-S"),
        manager
      );

      // The poster is down for the accrue: it stays pending.
      expect(
        (await post(TENANT_A, { ledger: accrueAlwaysThrows })).retried
      ).toBe(1);

      // More than a day later, still stuck: the void still waits.
      await ageIntents(TENANT_A, "25 hours");

      const stuck = await post(TENANT_A, { ledger: accrueAlwaysThrows });

      expect(stuck.refused).toBe(0);
      expect(stuck.deferred).toBe(1);

      const waiting = (await intents(TENANT_A)).find(
        (row) => row.kind === "void"
      )!;

      expect(waiting.status).toBe("pending");
      expect(waiting.outcome_code).toBeNull();

      // The accrue finally posts; the void then posts, so no live commission is
      // left for the voided sale.
      await ageIntents(TENANT_A, "1 hour");

      const recovered = await post(TENANT_A);

      expect(recovered.posted).toBe(2);
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals WHERE tenant_id = ${TENANT_A}
        `) as { status: string }[]
      ).toEqual([{ status: "voided" }]);
    });

    test("an accrue that ended refused is not live: after the grace the void is refused no_intake_origin and listed for a human", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(
        TENANT_A,
        sale(employment, "ORD-R", { ruleKey: "no_such_rule" })
      );
      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-R"),
        manager
      );

      // Inside the grace the void waits even though the accrue is already refused.
      const first = await post(TENANT_A);

      expect(first.refused).toBe(1);
      expect(first.deferred).toBe(1);

      await ageIntents(TENANT_A, "25 hours");

      expect((await post(TENANT_A)).refused).toBe(1);

      const page = await inTenant(TENANT_A, (tx) =>
        listIntakeExceptions(tx, TENANT_A)
      );

      expect(page.exceptions.map((e) => e.outcomeCode).sort()).toEqual([
        "no_effective_rule",
        "no_intake_origin"
      ]);

      const warned = (await getAdminSql()`
        SELECT severity FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'hr_commission.intake.refused'
          AND attributes->>'outcomeCode' = 'no_intake_origin'
      `) as { severity: string }[];

      expect(warned).toEqual([{ severity: "warning" }]);
    });
  });

  describe("the void origin outlives the void window (M-B)", () => {
    test("an origin row survives the 30-day purge and goes at 90; other posted rows go at 30; a void at day 60 posts", async () => {
      if (!workerRoleActivated) return;

      // Sale A: an origin that will be voided late. Sale B: accrued and voided,
      // leaving a posted void row (not an origin).
      await submitAsWorker(TENANT_A, sale(employment, "ORD-A"));
      await submitAsWorker(TENANT_A, sale(employment, "ORD-B"));
      await post(TENANT_A);
      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-B"),
        manager
      );
      await post(TENANT_A);

      const days = (n: number) => ({
        now: new Date(Date.now() + n * 86_400_000)
      });

      // 40 days on: only the posted VOID row is past its 30 days.
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, days(40))
      ).toBe(1);
      expect(
        (await intents(TENANT_A)).map(
          (row) => `${row.kind}:${row.outcome_code}`
        )
      ).toEqual(["accrue:accrued", "accrue:accrued"]);

      // Day 60 for real: age the origin rows, purge with the real clock (kept),
      // and the late void for sale A still posts.
      const admin = getAdminSql();

      await admin`ALTER TABLE awcms_hr_commission_intents DISABLE TRIGGER awcms_hr_commission_intents_guard_update`;
      await admin`
        UPDATE awcms_hr_commission_intents
        SET created_at = created_at - interval '60 days',
            updated_at = updated_at - interval '60 days'
        WHERE tenant_id = ${TENANT_A}`;
      await admin`ALTER TABLE awcms_hr_commission_intents ENABLE TRIGGER awcms_hr_commission_intents_guard_update`;

      expect(await purgeTerminalIntents(getRuntimeSql(), TENANT_A)).toBe(0);

      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-A"),
        manager
      );

      expect((await post(TENANT_A)).posted).toBe(1);
      expect(
        (await getAdminSql()`
          SELECT status FROM awcms_hr_commission_accruals
          WHERE tenant_id = ${TENANT_A} AND source_ref = 'ORD-A'
        `) as { status: string }[]
      ).toEqual([{ status: "voided" }]);

      // At 90 days the origin rows go too.
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, days(100))
      ).toBe(3);
    });
  });

  describe("the system actor is re-validated every tick (L-A)", () => {
    test("a deactivated actor stops the queue and the settings say so; reactivating drains it", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await getAdminSql()`UPDATE awcms_tenant_users SET status = 'inactive' WHERE id = ${systemActor}`;

      const stopped = await post(TENANT_A);

      expect(stopped.skipped).toBe("actor_inactive");
      expect(stopped.claimed).toBe(0);
      expect((await intents(TENANT_A))[0]!.status).toBe("pending");
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(0);
      expect(
        (await inTenant(TENANT_A, (tx) => getIntakeSetting(tx, TENANT_A)))
          .intakeActorStatus
      ).toBe("actor_inactive");

      await getAdminSql()`UPDATE awcms_tenant_users SET status = 'active' WHERE id = ${systemActor}`;

      expect(
        (await inTenant(TENANT_A, (tx) => getIntakeSetting(tx, TENANT_A)))
          .intakeActorStatus
      ).toBe("active");

      const drained = await post(TENANT_A);

      expect(drained.posted).toBe(1);
      expect(await count("awcms_hr_commission_accruals", TENANT_A)).toBe(1);
    });
  });

  describe("the switch, the system actor and retention windows", () => {
    test("switching ON needs an active tenant user as the intake actor, and the database agrees", async () => {
      expect(
        await inTenant(TENANT_B, (tx) =>
          setIntakeEnabled(tx, TENANT_B, true, owner)
        )
      ).toEqual({ outcome: "actor_required" });

      // A user of ANOTHER tenant is not an actor.
      const foreign = await seedTenantUser(TENANT_B);

      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            setIntakeEnabled(tx, TENANT_A, true, manager, foreign)
          )
        ).outcome
      ).toBe("actor_invalid");

      // An inactive user is not an actor either.
      await getAdminSql()`UPDATE awcms_tenant_users SET status = 'inactive' WHERE id = ${manager}`;
      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            setIntakeEnabled(tx, TENANT_A, true, owner, manager)
          )
        ).outcome
      ).toBe("actor_invalid");

      // Defence in depth: the table itself refuses ON without an actor.
      await expectRefused(
        getAdminSql()`
          UPDATE awcms_hr_commission_intake_settings
          SET intake_actor_tenant_user_id = NULL WHERE tenant_id = ${TENANT_A}`,
        /actor_required_check|23514/
      );
    });

    test("posted rows go at the window, refused and failed rows are kept to the ceiling, and a caller cannot leave the declared bounds", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-OK"));
      await submitAsWorker(
        TENANT_A,
        sale(employment, "ORD-NO", { ruleKey: "no_such_rule" })
      );
      await post(TENANT_A);
      await submitVoidAsWorker(
        TENANT_A,
        reversal(employment, "ORD-OK"),
        manager
      );
      await post(TENANT_A);

      const at = (days: number) => ({
        now: new Date(Date.now() + days * 86_400_000)
      });

      // 40 days on: the posted VOID row is past 30 days. The void origin (the
      // posted accrue) and the refused row are kept to the 90-day ceiling.
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, at(40))
      ).toBe(1);
      expect(
        (await intents(TENANT_A)).map((row) => `${row.kind}:${row.status}`)
      ).toEqual(["accrue:posted", "accrue:refused"]);

      // A caller asking for 0 days is clamped to the floor (7), not "now".
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, {
          postedDays: 0,
          exceptionDays: 0
        })
      ).toBe(0);
      // Asking for a century is clamped to the ceiling (90).
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, {
          ...at(100),
          postedDays: 36_500,
          exceptionDays: 36_500
        })
      ).toBe(2);
    });

    test("a correlation id outside the reference alphabet is refused by the port and by the table", async () => {
      if (!workerRoleActivated) return;

      expect(
        (
          await submitAsWorker(
            TENANT_A,
            sale(employment, "ORD-C", { correlationId: "has space" })
          )
        ).outcome
      ).toBe("input_invalid");
      await expectRefused(
        asWorker(
          TENANT_A,
          (tx) =>
            tx`INSERT INTO awcms_hr_commission_intents
                 (tenant_id, kind, source_type, source_ref, source_line,
                  employment_id, rule_key, base_amount, currency_code,
                  occurred_at, occurred_on, correlation_id, request_digest)
               VALUES (${TENANT_A}, 'accrue', 'sale_line', 'C', '', ${employment},
                       'upsell', 10, 'XTS', now(), current_date, 'has space',
                       ${"d".repeat(64)})`
        ),
        /correlation_check|23514/
      );
    });

    test("the lifecycle count function answers for the settings table without a table read", async () => {
      if (!workerRoleActivated) return;

      const future = new Date(Date.now() + 86_400_000).toISOString();
      const answered = await asWorker(
        TENANT_A,
        (tx) =>
          tx`SELECT awcms_hr_commission_lifecycle_eligible_count(
               'awcms_hr_commission_intake_settings', ${TENANT_A}::uuid, ${future}::timestamptz
             ) AS n` as Promise<{ n: number }[]>
      );

      expect(answered[0]!.n).toBe(1);
    });
  });

  describe("state machine and retention", () => {
    test("the database freezes the request and a settled row, and refuses an illegal edge", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await post(TENANT_A);

      const id = (await intents(TENANT_A))[0]!.id;

      await expectRefused(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_commission_intents SET base_amount = 1 WHERE id = ${id}`
        ),
        /immutable|55000/
      );
      await expectRefused(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_commission_intents SET status = 'pending' WHERE id = ${id}`
        ),
        /settled row|55000/
      );

      await submitAsWorker(TENANT_A, sale(employment, "ORD-2"));
      await expectRefused(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_hr_commission_intents SET status = 'posted', outcome_code = 'accrued'
               WHERE tenant_id = ${TENANT_A} AND source_ref = 'ORD-2'`
        ),
        /may not move|55000/
      );
    });

    test("retention deletes only settled rows past the window; work is never deleted", async () => {
      if (!workerRoleActivated) return;

      await submitAsWorker(TENANT_A, sale(employment, "ORD-1"));
      await post(TENANT_A);
      await submitAsWorker(TENANT_A, sale(employment, "ORD-2"));

      // Inside the window nothing goes.
      expect(await purgeTerminalIntents(getRuntimeSql(), TENANT_A)).toBe(0);
      // Past every window: only the settled row.
      expect(
        await purgeTerminalIntents(getRuntimeSql(), TENANT_A, LONG_AFTER)
      ).toBe(1);

      const rows = await intents(TENANT_A);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("pending");

      await expectRefused(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_hr_commission_intents WHERE id = ${rows[0]!.id}`
        ),
        /still work|55000/
      );
    });
  });
});
