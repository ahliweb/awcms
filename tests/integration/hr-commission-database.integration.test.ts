/**
 * The hr_commission schema against a real PostgreSQL, as the least-privilege
 * runtime role, with FORCE RLS in force (Issue #950, ADR-0132).
 *
 * `hr-commission-api.integration.test.ts` proves the HTTP wiring. This file
 * attacks the invariants that live in the DATABASE and must hold even if the
 * application code were bypassed:
 *
 *   * RLS: a tenant cannot read, write or re-point another tenant's rules;
 *   * composite (tenant_id, id) foreign keys on every actor stamp;
 *   * a PUBLISHED version is immutable (every column), may only become
 *     RETIRED, and a RETIRED one never changes; a DRAFT is editable;
 *   * published windows of one rule never overlap — including when two
 *     transactions publish at the same moment (the advisory lock);
 *   * nothing is ever deleted, and awcms_app holds no DELETE;
 *   * the CHECK constraints: shape (percent XOR fixed), bounds, scale, window,
 *     lifecycle stamps;
 *   * no personal, photo, biometric or device column exists.
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

/** Pins WHY the database refused, so a test cannot pass on an unrelated failure. */
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

const TENANT_A = "a9500000-0000-4000-8000-00000000000a";
const TENANT_B = "a9500000-0000-4000-8000-00000000000b";

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

async function seedTenantUser(tenantId: string, tag: string): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

type RuleValues = {
  key?: string;
  version?: number;
  status?: "draft" | "published" | "retired";
  from?: string;
  to?: string | null;
  calculation?: "percent" | "fixed";
  rate?: string | null;
  fixed?: string | null;
  min?: string | null;
  max?: string | null;
  scale?: number;
  currency?: string;
};

let versionCounter = 0;

/**
 * Creates a rule as the RUNTIME role. A row is BORN a draft (a trigger insists),
 * so `published` is a draft that is then published and `retired` is a draft that
 * is then abandoned (the intentional draft -> retired path).
 */
async function insertRule(tenantId: string, values: RuleValues = {}) {
  versionCounter += 1;
  const status = values.status ?? "draft";
  const calculation = values.calculation ?? "percent";
  const rate =
    values.rate !== undefined
      ? values.rate
      : calculation === "percent"
        ? "2.5"
        : null;
  const fixed =
    values.fixed !== undefined
      ? values.fixed
      : calculation === "fixed"
        ? "10"
        : null;

  const id = await inTenant(
    tenantId,
    async (tx) =>
      (
        (await tx`
          INSERT INTO awcms_hr_commission_rules
            (tenant_id, rule_key, version_no, name, source_type,
             calculation, rate, fixed_amount, min_amount, max_amount,
             currency_code, rounding_mode, rounding_scale, effective_from,
             effective_to)
          VALUES (${tenantId}, ${values.key ?? "r"},
                  ${values.version ?? versionCounter}, 'Rule',
                  'sale_line', ${calculation}, ${rate}::numeric,
                  ${fixed}::numeric, ${values.min ?? null}::numeric,
                  ${values.max ?? null}::numeric, ${values.currency ?? "XTS"},
                  'half_up', ${values.scale ?? 2}::smallint,
                  ${values.from ?? "2026-01-01"}::date,
                  ${values.to ?? null}::date)
          RETURNING id
        `) as { id: string }[]
      )[0]!.id
  );

  if (status === "published") {
    await inTenant(
      tenantId,
      (tx) => tx`
        UPDATE awcms_hr_commission_rules
        SET status = 'published', published_at = now(),
            backdated_reason = 'fixture' WHERE id = ${id}
      `
    );
  } else if (status === "retired") {
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

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_commission database invariants (Issue #950, ADR-0132)", () => {
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
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'cm-a', 'CM A'), (${TENANT_B}, 'cm-b', 'CM B')
    `;
  });

  describe("tenant isolation", () => {
    test("RLS is ENABLED and FORCED, with USING and WITH CHECK", async () => {
      const rows = (await getAdminSql()`
        SELECT c.relrowsecurity, c.relforcerowsecurity,
               count(p.polname)::int AS policies,
               bool_and(p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS both
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname = 'awcms_hr_commission_rules'
        GROUP BY c.relrowsecurity, c.relforcerowsecurity
      `) as {
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
        both: boolean;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.relrowsecurity).toBe(true);
      expect(rows[0]!.relforcerowsecurity).toBe(true);
      expect(rows[0]!.policies).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.both).toBe(true);
    });

    test("a tenant cannot read, write or re-point another tenant's rule", async () => {
      const id = await insertRule(TENANT_A);

      expect(
        await inTenant(
          TENANT_B,
          (tx) =>
            tx`SELECT id FROM awcms_hr_commission_rules WHERE id = ${id}` as Promise<
              unknown[]
            >
        )
      ).toHaveLength(0);

      expect(
        await inTenant(
          TENANT_B,
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET name = 'x'
               WHERE id = ${id} RETURNING id` as Promise<unknown[]>
        )
      ).toHaveLength(0);

      // WITH CHECK: B cannot write a row that names A.
      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_rules
              (tenant_id, rule_key, version_no, name, source_type, calculation,
               rate, currency_code, rounding_mode, rounding_scale, effective_from)
            VALUES (${TENANT_A}, 'x', 1, 'n', 's', 'percent', 1, 'XTS',
                    'half_up', 2, '2026-01-01')
          `
        ),
        /row-level security|violates/i
      );
    });

    test("composite foreign keys: no actor stamp crosses tenants", async () => {
      const userB = await seedTenantUser(TENANT_B, "b");

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_rules
              (tenant_id, rule_key, version_no, name, source_type, calculation,
               rate, currency_code, rounding_mode, rounding_scale,
               effective_from, created_by)
            VALUES (${TENANT_A}, 'x', 1, 'n', 's', 'percent', 1, 'XTS',
                    'half_up', 2, '2026-01-01', ${userB})
          `
        ),
        /foreign key|violates/i
      );
    });
  });

  describe("immutability", () => {
    test("a draft is editable and may be published", async () => {
      const id = await insertRule(TENANT_A);

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET name = 'Renamed', rate = 3, updated_at = now() WHERE id = ${id}
        `
      );
      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET status = 'published', published_at = now(),
            backdated_reason = 'fixture' WHERE id = ${id}
        `
      );

      const rows = (await getAdminSql()`
        SELECT status, name FROM awcms_hr_commission_rules WHERE id = ${id}
      `) as { status: string; name: string }[];
      expect(rows[0]).toEqual({ status: "published", name: "Renamed" });
    });

    test("a PUBLISHED version cannot change any column", async () => {
      const id = await insertRule(TENANT_A, { status: "published" });

      const edits: [string, (tx: Bun.TransactionSQL) => Promise<unknown>][] = [
        [
          "name",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET name = 'x' WHERE id = ${id}`
        ],
        [
          "rate",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET rate = 99 WHERE id = ${id}`
        ],
        [
          "currency",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET currency_code = 'ZZZ' WHERE id = ${id}`
        ],
        [
          "rounding",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET rounding_mode = 'down' WHERE id = ${id}`
        ],
        [
          "window start",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET effective_from = '2025-01-01' WHERE id = ${id}`
        ],
        [
          "window end",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET effective_to = '2030-01-01' WHERE id = ${id}`
        ],
        [
          "source type",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET source_type = 'other' WHERE id = ${id}`
        ],
        [
          "back to draft",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET status = 'draft', published_at = NULL WHERE id = ${id}`
        ],
        [
          "published stamp",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET published_at = now() - interval '1 day' WHERE id = ${id}`
        ],
        [
          "a no-op that is not a retirement",
          (tx) =>
            tx`UPDATE awcms_hr_commission_rules SET updated_at = now() WHERE id = ${id}`
        ]
      ];

      for (const [label, edit] of edits) {
        await assertRejected(inTenant(TENANT_A, edit), /immutable|55000/);
        expect(label).toBeTruthy();
      }
    });

    test("a published version may only become RETIRED, changing nothing else", async () => {
      const id = await insertRule(TENANT_A, { status: "published" });

      // Retiring AND editing in the same statement is refused.
      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'retired', retired_at = now(), rate = 50 WHERE id = ${id}
          `
        ),
        /immutable|55000/
      );

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET status = 'retired', retired_at = now(), updated_at = now()
          WHERE id = ${id}
        `
      );

      const rows = (await getAdminSql()`
        SELECT status, rate::text AS rate FROM awcms_hr_commission_rules WHERE id = ${id}
      `) as { status: string; rate: string }[];
      expect(rows[0]!.status).toBe("retired");
      expect(Number(rows[0]!.rate)).toBe(2.5);
    });

    test("a RETIRED version never changes again", async () => {
      const id = await insertRule(TENANT_A, { status: "retired" });

      for (const set of [
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_commission_rules SET name = 'x' WHERE id = ${id}`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_commission_rules SET status = 'published', retired_at = NULL, published_at = now() WHERE id = ${id}`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_commission_rules SET status = 'draft', published_at = NULL, retired_at = NULL WHERE id = ${id}`
      ]) {
        await assertRejected(inTenant(TENANT_A, set), /immutable|55000/);
      }
    });

    test("identity never changes, even on a draft", async () => {
      const id = await insertRule(TENANT_A);

      for (const set of [
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_commission_rules SET rule_key = 'other' WHERE id = ${id}`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_hr_commission_rules SET version_no = 99 WHERE id = ${id}`
      ]) {
        await assertRejected(inTenant(TENANT_A, set), /identity|55000/);
      }
    });

    test("nothing is ever deleted: awcms_app holds no DELETE, and a trigger refuses it for anyone", async () => {
      const id = await insertRule(TENANT_A);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_hr_commission_rules WHERE id = ${id}`
        ),
        /permission denied|42501/
      );

      // The table's OWNER (the trigger is the second layer) is refused too.
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_hr_commission_rules WHERE id = ${id}`,
        /cannot be deleted|55000/
      );

      const privileges = (await getAdminSql()`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'awcms_app' AND table_name = 'awcms_hr_commission_rules'
          AND privilege_type IN ('DELETE', 'TRUNCATE')
      `) as unknown[];
      expect(privileges).toHaveLength(0);
    });
  });

  describe("effective dating", () => {
    test("published windows of one rule never overlap; touching windows are fine", async () => {
      await insertRule(TENANT_A, {
        status: "published",
        from: "2026-01-01",
        to: "2026-07-01"
      });

      // Touching (half-open): allowed.
      await insertRule(TENANT_A, {
        status: "published",
        from: "2026-07-01",
        to: null
      });

      // Overlaps the open-ended one.
      await assertRejected(
        insertRule(TENANT_A, {
          status: "published",
          from: "2027-01-01",
          to: "2027-02-01"
        }),
        /overlap|23P01/
      );
      // Overlaps the first.
      await assertRejected(
        insertRule(TENANT_A, {
          status: "published",
          from: "2025-06-01",
          to: "2026-01-02"
        }),
        /overlap|23P01/
      );
    });

    test("another rule key, another tenant, a draft and a retired version do not collide", async () => {
      await insertRule(TENANT_A, { status: "published", from: "2026-01-01" });

      await insertRule(TENANT_A, {
        key: "other",
        status: "published",
        from: "2026-01-01"
      });
      await insertRule(TENANT_B, { status: "published", from: "2026-01-01" });
      await insertRule(TENANT_A, { status: "draft", from: "2026-01-01" });
      await insertRule(TENANT_A, { status: "retired", from: "2026-01-01" });
    });

    test("publishing a draft that overlaps is refused by the trigger even if the application is bypassed", async () => {
      await insertRule(TENANT_A, {
        status: "published",
        from: "2026-01-01",
        to: "2026-06-01"
      });
      const draft = await insertRule(TENANT_A, {
        from: "2026-03-01",
        to: null
      });

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'published', published_at = now(),
                backdated_reason = 'fixture' WHERE id = ${draft}
          `
        ),
        /overlap|23P01/
      );
    });

    test("retiring a published version frees its window", async () => {
      const first = await insertRule(TENANT_A, {
        status: "published",
        from: "2026-01-01"
      });

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_hr_commission_rules
          SET status = 'retired', retired_at = now() WHERE id = ${first}
        `
      );

      await insertRule(TENANT_A, { status: "published", from: "2026-01-01" });
    });

    test("two concurrent publishes of overlapping windows: exactly one commits", async () => {
      const a = await insertRule(TENANT_A, { from: "2026-01-01", to: null });
      const b = await insertRule(TENANT_A, { from: "2026-03-01", to: null });

      // Each transaction publishes its draft and then HOLDS the transaction
      // open, so the two overlap. Without the advisory lock both overlap
      // checks see no published row and both commit.
      const publish = (id: string) =>
        inTenant(TENANT_A, async (tx) => {
          await tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'published', published_at = now(),
            backdated_reason = 'fixture' WHERE id = ${id}
          `;
          await tx`SELECT pg_sleep(0.5)`;
        });

      const results = await Promise.allSettled([publish(a), publish(b)]);
      resetDatabaseCircuitBreakerForTests();

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as
        PromiseRejectedResult | undefined;
      expect(String(rejected?.reason?.message)).toMatch(/overlap/);

      const published = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_hr_commission_rules
        WHERE tenant_id = ${TENANT_A} AND status = 'published'
      `) as { n: number }[];
      expect(published[0]!.n).toBe(1);
    });

    test("a version number is unique per rule", async () => {
      await insertRule(TENANT_A, { version: 1 });

      await assertRejected(
        insertRule(TENANT_A, { version: 1 }),
        /duplicate key|unique|23505/i
      );
      await insertRule(TENANT_A, { version: 1, key: "other" });
    });
  });

  describe("CHECK constraints", () => {
    const refused: [string, RuleValues][] = [
      ["a percent rule with a fixed amount", { fixed: "1" }],
      ["a percent rule with no rate", { rate: null }],
      ["a percent rate above 100", { rate: "100.000001" }],
      ["a negative rate", { rate: "-1" }],
      ["a fixed rule with a rate", { calculation: "fixed", rate: "1" }],
      ["a fixed rule with no amount", { calculation: "fixed", fixed: null }],
      ["a negative fixed amount", { calculation: "fixed", fixed: "-1" }],
      ["a floor above the ceiling", { min: "10", max: "5" }],
      ["a floor finer than the scale", { min: "0.001" }],
      ["a ceiling finer than the scale", { max: "0.001" }],
      ["an empty window", { from: "2026-01-01", to: "2026-01-01" }],
      ["an inverted window", { from: "2026-02-01", to: "2026-01-01" }],
      ["a lowercase currency", { currency: "xts" }],
      ["a scale of 7", { scale: 7 }],
      ["version 0", { version: 0 }]
    ];

    for (const [label, values] of refused) {
      test(`refuses ${label}`, async () => {
        await assertRejected(
          insertRule(TENANT_A, values),
          /check constraint|violates|23514/i
        );
      });
    }

    test("refuses a lifecycle that disagrees with its stamps", async () => {
      const id = await insertRule(TENANT_A);

      await assertRejected(
        inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_hr_commission_rules
            SET status = 'published', effective_from = current_date
            WHERE id = ${id}
          `
        ),
        /check constraint|lifecycle|23514/i
      );
    });

    test("a row is born a draft: any other status or stamp on INSERT is refused", async () => {
      const insert = (status: string, published: boolean, retired: boolean) =>
        inTenant(
          TENANT_A,
          (tx) => tx`
            INSERT INTO awcms_hr_commission_rules
              (tenant_id, rule_key, version_no, status, name, source_type,
               calculation, rate, currency_code, rounding_mode, rounding_scale,
               effective_from, published_at, retired_at)
            VALUES (${TENANT_A}, 'born', ${(versionCounter += 1)}, ${status},
                    'n', 's', 'percent', 1, 'XTS', 'half_up', 2, '2026-01-01',
                    ${published ? new Date() : null},
                    ${retired ? new Date() : null})
          `
        );

      await assertRejected(
        insert("published", true, false),
        /inserted as a draft|55000/
      );
      await assertRejected(
        insert("retired", false, true),
        /inserted as a draft|55000/
      );
      // A draft carrying a stamp is refused as well.
      await assertRejected(
        insert("draft", true, false),
        /inserted as a draft|55000|check/i
      );
    });

    test("NaN is refused in every money and rate column", async () => {
      const columns: [string, RuleValues][] = [
        ["rate", { rate: "NaN" }],
        ["fixed_amount", { calculation: "fixed", fixed: "NaN" }],
        ["min_amount", { min: "NaN" }],
        ["max_amount", { max: "NaN" }]
      ];

      for (const [column, values] of columns) {
        await assertRejected(
          insertRule(TENANT_A, values),
          /not_nan|check constraint|23514/i
        );
        expect(column).toBeTruthy();
      }
    });

    test("money is exact: numeric round-trips 1.005 untouched", async () => {
      const id = await insertRule(TENANT_A, { rate: "1.005", scale: 3 });
      const rows = (await getAdminSql()`
        SELECT rate::text AS rate FROM awcms_hr_commission_rules WHERE id = ${id}
      `) as { rate: string }[];

      expect(Number(rows[0]!.rate)).toBe(1.005);
      expect(rows[0]!.rate).toBe("1.005000");
    });
  });

  describe("minimisation", () => {
    test("no personal, photo, biometric or device column exists, and no person reference besides actor stamps", async () => {
      const columns = (await getAdminSql()`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'awcms_hr_commission_rules'
      `) as { column_name: string }[];
      const names = columns.map((c) => c.column_name);

      expect(names.length).toBeGreaterThan(15);

      const forbidden =
        /email|phone|address|birth|nik|npwp|tax_id|national|photo|image|selfie|face|biometric|fingerprint|device|latitude|longitude|geo|location|employment|profile|employee|person/i;

      expect(names.filter((n) => forbidden.test(n))).toEqual([]);
    });
  });
});
