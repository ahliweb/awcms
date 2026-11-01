/**
 * The commission intake queue, pure and static parts (Issue #1189, ADR-0147).
 *
 * The database behaviour (RLS, grants, exactly-once, the poster) is proven in
 * `tests/integration/hr-commission-intake.integration.test.ts`. This file holds
 * everything that needs no database: the status machine and retry schedule, the
 * request digests, the mapping from the ledger's outcome to an intake row's fate,
 * masking, the body validator, the port's early exits against a recording fake,
 * and a static read of migration `sql/316` for the privilege claims the ADR makes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  CommissionAccrualOutcome,
  CommissionAccrualRequest,
  CommissionVoidOutcome,
  CommissionVoidRequest
} from "../src/modules/_shared/ports/commission-accrual-port";
import {
  submitAccrualIntent,
  submitVoidIntent
} from "../src/modules/hr-commission/application/hr-commission-intake-store";
import { accrualRequestDigest } from "../src/modules/hr-commission/domain/hr-commission-accrual-validation";
import {
  INTAKE_DEFER_DELAY_SECONDS,
  INTAKE_EXCEPTION_RETENTION_DAYS,
  INTAKE_MAX_ATTEMPTS,
  INTAKE_VOID_GRACE_SECONDS,
  clampRetentionDays,
  decideVoidOrigin,
  sourceRefFingerprint,
  INTAKE_RETENTION_DEFAULT_DAYS,
  INTAKE_RETENTION_MAX_DAYS,
  INTAKE_RETENTION_MIN_DAYS,
  INTAKE_STATUSES,
  INTAKE_TERMINAL_STATUSES,
  attemptsExhausted,
  canMoveIntake,
  intakeRequestDigest,
  isIntakeTerminal,
  maskIdentifier,
  maskUuid,
  retryDelaySeconds,
  settleAccrueOutcome,
  settleVoidOutcome,
  validateIntakeSettingBody,
  voidRequestDigest
} from "../src/modules/hr-commission/domain/hr-commission-intake";
import { FORBIDDEN_PAYROLL_TABLE_PATTERNS } from "../src/modules/_shared/payroll-data-boundary";

const EMPLOYMENT = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

const accrue = (
  extra: Partial<CommissionAccrualRequest> = {}
): CommissionAccrualRequest => ({
  employmentId: EMPLOYMENT,
  ruleKey: "upsell",
  source: { type: "sale_line", ref: "ORD-1", line: "1" },
  baseAmount: "1000.10",
  currencyCode: "XTS",
  occurredAt: new Date(Date.now() - 3600_000),
  occurredOn: new Date(Date.now() - 3600_000).toISOString().slice(0, 10),
  ...extra
});

const voidReq = (
  extra: Partial<CommissionVoidRequest> = {}
): CommissionVoidRequest => ({
  source: { type: "sale_line", ref: "ORD-1", line: "1" },
  employmentId: EMPLOYMENT,
  reason: "sale_voided",
  ...extra
});

describe("status machine", () => {
  test("allows exactly the edges the database guard allows", () => {
    const allowed: [string, string][] = [
      ["pending", "pending"],
      ["pending", "posting"],
      ["posting", "posting"],
      ["posting", "pending"],
      ["posting", "posted"],
      ["posting", "refused"],
      ["posting", "failed"]
    ];

    for (const from of INTAKE_STATUSES) {
      for (const to of INTAKE_STATUSES) {
        expect(canMoveIntake(from, to)).toBe(
          allowed.some(([a, b]) => a === from && b === to)
        );
      }
    }
  });

  test("a pending row cannot jump to a settled status; a settled row never moves", () => {
    for (const to of INTAKE_TERMINAL_STATUSES) {
      expect(canMoveIntake("pending", to)).toBe(false);
    }

    for (const from of INTAKE_TERMINAL_STATUSES) {
      expect(isIntakeTerminal(from)).toBe(true);

      for (const to of INTAKE_STATUSES) {
        expect(canMoveIntake(from, to)).toBe(false);
      }
    }

    expect(isIntakeTerminal("pending")).toBe(false);
    expect(isIntakeTerminal("posting")).toBe(false);
  });

  test("the retention window is the ADR's: default 30, floor 7, ceiling 90", () => {
    expect(INTAKE_RETENTION_MIN_DAYS).toBe(7);
    expect(INTAKE_RETENTION_DEFAULT_DAYS).toBe(30);
    expect(INTAKE_RETENTION_MAX_DAYS).toBe(90);
  });
});

describe("retry schedule", () => {
  test("doubles from 30 seconds and is capped at an hour", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(8)).toBe(3600);
    expect(retryDelaySeconds(500)).toBe(3600);
  });

  test("a row is exhausted at the attempt cap and not before", () => {
    expect(attemptsExhausted(INTAKE_MAX_ATTEMPTS - 1)).toBe(false);
    expect(attemptsExhausted(INTAKE_MAX_ATTEMPTS)).toBe(true);
  });
});

describe("request digests", () => {
  test("an accrual uses the ledger's own digest, so 'same request' means one thing", () => {
    const request = accrue();

    expect(intakeRequestDigest("accrue", request)).toBe(
      accrualRequestDigest(request)
    );
  });

  test("a redelivery with a different correlation id or actor is the SAME request", () => {
    expect(intakeRequestDigest("accrue", accrue({ correlationId: "a" }))).toBe(
      intakeRequestDigest("accrue", accrue({ correlationId: "b" }))
    );
    expect(voidRequestDigest(voidReq({ correlationId: "a" }))).toBe(
      voidRequestDigest(voidReq({ correlationId: "b" }))
    );
  });

  test("a different amount, reason or source line is a different request", () => {
    expect(
      intakeRequestDigest("accrue", accrue({ baseAmount: "1.00" }))
    ).not.toBe(intakeRequestDigest("accrue", accrue()));
    expect(voidRequestDigest(voidReq({ reason: "refund" }))).not.toBe(
      voidRequestDigest(voidReq())
    );
    expect(
      voidRequestDigest(
        voidReq({ source: { type: "sale_line", ref: "ORD-1" } })
      )
    ).not.toBe(voidRequestDigest(voidReq()));
  });

  test("a void never collides with an accrual of the same identity", () => {
    expect(voidRequestDigest(voidReq())).not.toBe(
      intakeRequestDigest("accrue", accrue())
    );
    expect(voidRequestDigest(voidReq())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("settling an accrue outcome", () => {
  test("a success or a replay is posted; every other outcome is a terminal refusal", () => {
    const accrual = {
      id: "a",
      employmentId: EMPLOYMENT,
      ruleKey: "upsell",
      ruleVersion: 1,
      status: "pending" as const,
      amount: "1.00",
      currencyCode: "XTS"
    };

    expect(settleAccrueOutcome({ outcome: "accrued", accrual })).toEqual({
      disposition: "posted",
      outcomeCode: "accrued"
    });
    expect(settleAccrueOutcome({ outcome: "replayed", accrual })).toEqual({
      disposition: "posted",
      outcomeCode: "replayed"
    });

    const refusals: CommissionAccrualOutcome[] = [
      { outcome: "source_conflict", accrualId: "x" },
      { outcome: "no_effective_rule" },
      { outcome: "rule_ambiguous" },
      { outcome: "source_type_mismatch", expectedSourceType: "t" },
      { outcome: "currency_mismatch", expectedCurrencyCode: "XTS" },
      { outcome: "employment_not_found" },
      { outcome: "employment_not_eligible" },
      { outcome: "input_invalid", message: "m" }
    ];

    for (const outcome of refusals) {
      expect(settleAccrueOutcome(outcome)).toEqual({
        disposition: "refused",
        outcomeCode: outcome.outcome
      });
    }
  });
});

describe("settling a void outcome", () => {
  const accrual = {
    id: "a",
    employmentId: EMPLOYMENT,
    ruleKey: "upsell",
    ruleVersion: 1,
    status: "voided" as const,
    amount: "1.00",
    currencyCode: "XTS"
  };

  test("voided and already_voided are posted", () => {
    for (const outcome of ["voided", "already_voided"] as const) {
      expect(settleVoidOutcome({ outcome, accrual })).toEqual({
        disposition: "posted",
        outcomeCode: outcome
      });
    }
  });

  test("period_closed goes to a human and is never silently voided or retried", () => {
    const outcome: CommissionVoidOutcome = {
      outcome: "period_closed",
      accrualId: "x",
      status: "paid"
    };

    expect(settleVoidOutcome(outcome)).toEqual({
      disposition: "refused",
      outcomeCode: "period_closed"
    });
  });

  test("once the ledger was asked, every other outcome is a terminal refusal", () => {
    for (const outcome of [
      { outcome: "not_found" },
      { outcome: "actor_required" },
      { outcome: "input_invalid", message: "m" }
    ] as CommissionVoidOutcome[]) {
      expect(settleVoidOutcome(outcome)).toEqual({
        disposition: "refused",
        outcomeCode: outcome.outcome
      });
    }
  });
});

describe("a void only reverses what this intake created (H1)", () => {
  test("with the origin posted the void proceeds, whatever its age", () => {
    expect(decideVoidOrigin(true, 0)).toBe("proceed");
    expect(decideVoidOrigin(true, INTAKE_VOID_GRACE_SECONDS * 10)).toBe(
      "proceed"
    );
  });

  test("without the origin it waits for the grace window, then is refused", () => {
    expect(decideVoidOrigin(false, 0)).toBe("defer");
    expect(decideVoidOrigin(false, INTAKE_VOID_GRACE_SECONDS - 1)).toBe(
      "defer"
    );
    expect(decideVoidOrigin(false, INTAKE_VOID_GRACE_SECONDS)).toBe("refuse");
  });

  test("while the accrue is still live in the queue the void keeps waiting past the grace (M-A)", () => {
    expect(decideVoidOrigin(false, INTAKE_VOID_GRACE_SECONDS * 5, true)).toBe(
      "defer"
    );
    expect(decideVoidOrigin(false, INTAKE_VOID_GRACE_SECONDS * 5, false)).toBe(
      "refuse"
    );
    expect(decideVoidOrigin(true, INTAKE_VOID_GRACE_SECONDS * 5, true)).toBe(
      "proceed"
    );
  });

  test("the grace window is a day and a waiting void is looked at every quarter hour", () => {
    expect(INTAKE_VOID_GRACE_SECONDS).toBe(86_400);
    expect(INTAKE_DEFER_DELAY_SECONDS).toBe(900);
  });
});

describe("retention clamp (L3) and the audit fingerprint (M3)", () => {
  test("a caller can never go outside the declared floor and ceiling", () => {
    expect(clampRetentionDays(-1)).toBe(INTAKE_RETENTION_MIN_DAYS);
    expect(clampRetentionDays(0)).toBe(INTAKE_RETENTION_MIN_DAYS);
    expect(clampRetentionDays(30)).toBe(30);
    expect(clampRetentionDays(100_000)).toBe(INTAKE_RETENTION_MAX_DAYS);
    expect(clampRetentionDays(Number.NaN)).toBe(INTAKE_RETENTION_DEFAULT_DAYS);
  });

  test("refused and failed rows are kept to the ceiling, longer than posted ones", () => {
    expect(INTAKE_EXCEPTION_RETENTION_DAYS).toBe(INTAKE_RETENTION_MAX_DAYS);
    expect(INTAKE_EXCEPTION_RETENTION_DAYS).toBeGreaterThan(
      INTAKE_RETENTION_DEFAULT_DAYS
    );
  });

  test("the source fingerprint is short, stable and does not contain the reference", () => {
    const fingerprint = sourceRefFingerprint("ORD-CONFIDENTIAL-7");

    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprint).toBe(sourceRefFingerprint("ORD-CONFIDENTIAL-7"));
    expect(fingerprint).not.toBe(sourceRefFingerprint("ORD-CONFIDENTIAL-8"));
  });
});

describe("masking", () => {
  test("never returns the whole identifier", () => {
    expect(maskIdentifier("ORD-2026-000123")).not.toContain("000123");
    expect(maskIdentifier("ORD-2026-000123").startsWith("ORD-")).toBe(true);
    expect(maskIdentifier("ab")).toBe("**");
    expect(maskUuid(EMPLOYMENT)).toBe("11111111-****-1111");
    expect(maskUuid(EMPLOYMENT)).not.toContain("4111");
  });
});

describe("setting body", () => {
  test("accepts exactly a boolean", () => {
    expect(
      validateIntakeSettingBody({ commissionIntakeEnabled: true })
    ).toEqual({
      valid: true,
      value: { commissionIntakeEnabled: true }
    });
    expect(
      validateIntakeSettingBody({ commissionIntakeEnabled: false }).valid
    ).toBe(true);
  });

  test("refuses a string, a missing key, an extra key and a non-object", () => {
    for (const body of [
      { commissionIntakeEnabled: "true" },
      {},
      { commissionIntakeEnabled: true, extra: 1 },
      null,
      [],
      "x"
    ]) {
      expect(validateIntakeSettingBody(body).valid).toBe(false);
    }
  });
});

/** A transaction that records statements and answers only what the port reads. */
function fakeTx(options: { enabled: boolean; insertCount?: number }) {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join("?");

    statements.push(text);

    if (text.includes("FROM awcms_hr_commission_intake_settings")) {
      return Promise.resolve([{ commission_intake_enabled: options.enabled }]);
    }

    return Promise.resolve(
      Object.assign([], { count: options.insertCount ?? 1 })
    );
  };
  const tx = Object.assign(tag, {
    savepoint: (fn: (sp: unknown) => Promise<unknown>) => fn(tag)
  });

  return { tx: tx as unknown as Bun.SQL, statements };
}

describe("the port's early exits", () => {
  test("a malformed accrual is input_invalid and touches nothing", async () => {
    const { tx, statements } = fakeTx({ enabled: true });
    const outcome = await submitAccrualIntent(
      tx,
      TENANT,
      null,
      accrue({ ruleKey: "BAD KEY" })
    );

    expect(outcome.outcome).toBe("input_invalid");
    expect(statements).toHaveLength(0);
  });

  test("a void with no person is actor_required and touches nothing", async () => {
    const { tx, statements } = fakeTx({ enabled: true });

    expect(await submitVoidIntent(tx, TENANT, null, voidReq())).toEqual({
      outcome: "actor_required"
    });
    expect(statements).toHaveLength(0);
  });

  test("a malformed void is input_invalid before the actor is considered", async () => {
    const { tx } = fakeTx({ enabled: true });
    const outcome = await submitVoidIntent(
      tx,
      TENANT,
      null,
      voidReq({ reason: "Free Text Reason" })
    );

    expect(outcome.outcome).toBe("input_invalid");
  });

  test("with the switch off nothing is written, for an accrual or a void", async () => {
    const { tx, statements } = fakeTx({ enabled: false });

    expect(await submitAccrualIntent(tx, TENANT, null, accrue())).toEqual({
      outcome: "disabled"
    });
    expect(await submitVoidIntent(tx, TENANT, ACTOR, voidReq())).toEqual({
      outcome: "disabled"
    });
    expect(statements.filter((text) => text.includes("INSERT"))).toHaveLength(
      0
    );
  });

  test("a written row is queued; a conflict that wrote nothing is duplicate", async () => {
    const written = fakeTx({ enabled: true, insertCount: 1 });
    const conflict = fakeTx({ enabled: true, insertCount: 0 });

    expect(
      (await submitAccrualIntent(written.tx, TENANT, null, accrue())).outcome
    ).toBe("queued");
    expect(
      (await submitAccrualIntent(conflict.tx, TENANT, null, accrue())).outcome
    ).toBe("duplicate");
    expect(
      (await submitVoidIntent(conflict.tx, TENANT, ACTOR, voidReq())).outcome
    ).toBe("duplicate");
  });

  test("the insert has no conflict target and no RETURNING, so INSERT alone is enough", async () => {
    const { tx, statements } = fakeTx({ enabled: true });

    await submitAccrualIntent(tx, TENANT, null, accrue());

    const insert = statements.find((text) => text.includes("INSERT INTO"))!;

    expect(insert).toContain("ON CONFLICT DO NOTHING");
    expect(insert).not.toContain("ON CONFLICT (");
    expect(insert).not.toContain("ON CONFLICT ON CONSTRAINT");
    expect(insert).not.toContain("RETURNING");
  });

  test("the port never reads the ledger, a rule or an employment", async () => {
    const { tx, statements } = fakeTx({ enabled: true });

    await submitAccrualIntent(tx, TENANT, null, accrue());
    await submitVoidIntent(tx, TENANT, ACTOR, voidReq());

    for (const text of statements) {
      expect(text).not.toContain("awcms_hr_commission_accruals");
      expect(text).not.toContain("awcms_hr_commission_transitions");
      expect(text).not.toContain("awcms_hr_commission_rules");
      expect(text).not.toContain("awcms_hr_employments");
    }
  });
});

describe("the setting body and the intake system actor (H1)", () => {
  test("the actor is an optional UUID, lower-cased; null clears; junk is refused", () => {
    expect(
      validateIntakeSettingBody({
        commissionIntakeEnabled: true,
        intakeActorTenantUserId: ACTOR.toUpperCase()
      })
    ).toEqual({
      valid: true,
      value: { commissionIntakeEnabled: true, intakeActorTenantUserId: ACTOR }
    });
    expect(
      validateIntakeSettingBody({
        commissionIntakeEnabled: false,
        intakeActorTenantUserId: null
      })
    ).toEqual({
      valid: true,
      value: { commissionIntakeEnabled: false, intakeActorTenantUserId: null }
    });
    expect(
      validateIntakeSettingBody({
        commissionIntakeEnabled: true,
        intakeActorTenantUserId: "not-a-uuid"
      }).valid
    ).toBe(false);
  });
});

describe("the port refuses what the table would refuse, without echoing it", () => {
  test("a correlation id outside the source-reference alphabet is input_invalid and writes nothing", async () => {
    const { tx, statements } = fakeTx({ enabled: true });

    for (const correlationId of ["has space", "x".repeat(129), "a/b"]) {
      expect(
        (await submitAccrualIntent(tx, TENANT, null, accrue({ correlationId })))
          .outcome
      ).toBe("input_invalid");
      expect(
        (await submitVoidIntent(tx, TENANT, ACTOR, voidReq({ correlationId })))
          .outcome
      ).toBe("input_invalid");
    }

    expect(statements).toHaveLength(0);
  });

  test("a CHECK violation (23514) is input_invalid with no row detail", async () => {
    const tag = (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join("?").includes("FROM awcms_hr_commission_intake_settings")
          ? [{ commission_intake_enabled: true }]
          : []
      );
    const tx = Object.assign(tag, {
      savepoint: async () => {
        throw Object.assign(
          new Error("Failing row contains (secret, 424242)"),
          {
            errno: "23514"
          }
        );
      }
    }) as unknown as Bun.SQL;
    const outcome = await submitAccrualIntent(tx, TENANT, null, accrue());

    expect(outcome.outcome).toBe("input_invalid");
    expect(JSON.stringify(outcome)).not.toContain("424242");
    expect(JSON.stringify(outcome)).not.toContain("Failing row");
  });
});

describe("static guards on the unmerged migration and the routes (M4, L1)", () => {
  const read = (...parts: string[]) =>
    readFileSync(join(import.meta.dir, "..", ...parts), "utf8");
  const sqlText = read("sql", "316_awcms_hr_commission_intake.sql").replace(
    /--[^\n]*/g,
    ""
  );

  test("sql/316 creates the delete guard that keeps work undeletable", () => {
    expect(sqlText).toMatch(
      /CREATE TRIGGER awcms_hr_commission_intents_guard_delete\s+BEFORE DELETE ON awcms_hr_commission_intents/
    );
    expect(sqlText).toMatch(
      /CREATE TRIGGER awcms_hr_commission_intents_guard_update\s+BEFORE UPDATE/
    );
    expect(sqlText).toMatch(
      /CREATE TRIGGER awcms_hr_commission_intents_guard_insert\s+BEFORE INSERT/
    );
  });

  test("the worker reads the settings table by column only, never the actor or the stamps", () => {
    expect(sqlText).toMatch(
      /GRANT SELECT \(tenant_id, commission_intake_enabled\)\s+ON awcms_hr_commission_intake_settings TO awcms_worker/
    );
    expect(sqlText).not.toMatch(
      /GRANT SELECT ON awcms_hr_commission_intake_settings TO awcms_worker/
    );
  });

  test("the system actor is mandatory while intake is on, and the correlation id keeps to the reference alphabet", () => {
    expect(sqlText).toContain(
      "CHECK (NOT commission_intake_enabled OR intake_actor_tenant_user_id IS NOT NULL)"
    );
    expect(sqlText).toContain("correlation_id ~ '^[A-Za-z0-9_.:-]{1,128}$'");
  });

  test("each route names its own permission: PUT configures, GET and the list read", () => {
    // Doc comments name both permissions; only the code may decide the guard.
    const settings = read(
      "src",
      "pages",
      "api",
      "v1",
      "hr-commission",
      "intake",
      "settings.ts"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const putAt = settings.indexOf("export const PUT");
    const getAt = settings.indexOf("export const GET");

    expect(getAt).toBeGreaterThan(-1);
    expect(putAt).toBeGreaterThan(getAt);

    const getBlock = settings.slice(getAt, putAt);
    const putBlock = settings.slice(putAt);

    expect(getBlock).toContain("HR_COMMISSION_GUARDS.intake.read");
    expect(getBlock).not.toContain("intake.configure");
    expect(putBlock).toContain("HR_COMMISSION_GUARDS.intake.configure");
    expect(putBlock).not.toContain("intake.read");

    const exceptions = read(
      "src",
      "pages",
      "api",
      "v1",
      "hr-commission",
      "intake",
      "exceptions.ts"
    );

    expect(exceptions).toContain("HR_COMMISSION_GUARDS.intake.read");
    expect(exceptions).not.toContain("intake.configure");
  });
});

describe("migration sql/316 (static)", () => {
  const sql = readFileSync(
    join(import.meta.dir, "..", "sql", "316_awcms_hr_commission_intake.sql"),
    "utf8"
  );
  const code = sql.replace(/--[^\n]*/g, "");

  test("neither new table is a payroll-family name (ADR-0147 section 1)", () => {
    for (const table of [
      "awcms_hr_commission_intents",
      "awcms_hr_commission_intake_settings"
    ]) {
      expect(
        FORBIDDEN_PAYROLL_TABLE_PATTERNS.some((pattern) => pattern.test(table))
      ).toBe(false);
    }
  });

  test("the worker is granted INSERT on the intake table and nothing else on it", () => {
    const workerGrants = [
      ...code.matchAll(
        /GRANT\s+([A-Z, ()a-z_]+?)\s+ON\s+(\w+)\s+TO\s+awcms_worker\s*;/g
      )
    ].map((match) => [match[2], match[1]]);

    expect(workerGrants).toContainEqual([
      "awcms_hr_commission_intents",
      "INSERT"
    ]);
    expect(workerGrants).toContainEqual([
      "awcms_hr_commission_intake_settings",
      "SELECT (tenant_id, commission_intake_enabled)"
    ]);
    expect(
      workerGrants.filter(([table]) => table === "awcms_hr_commission_intents")
    ).toHaveLength(1);
  });

  test("the migration names no payroll-family relation at all", () => {
    expect(code).not.toMatch(/awcms_hr_commission_(accruals|transitions)/);
    expect(code).not.toMatch(/awcms_hr_payroll/);
  });

  test("RLS is enabled and forced with USING and WITH CHECK on both tables", () => {
    for (const table of [
      "awcms_hr_commission_intents",
      "awcms_hr_commission_intake_settings"
    ]) {
      expect(code).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(code).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(code).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_tenant_isolation[\\s\\S]*?USING \\(tenant_id = current_setting\\('app.current_tenant_id'\\)::uuid\\)[\\s\\S]*?WITH CHECK \\(tenant_id = current_setting\\('app.current_tenant_id'\\)::uuid\\)`
        )
      );
    }
  });

  test("the identity key is the one ADR-0147 names", () => {
    expect(code).toContain(
      "UNIQUE (tenant_id, kind, source_type, source_ref, source_line,\n            employment_id, request_digest)"
    );
  });

  test("every function pins its search_path", () => {
    const functions = code.match(
      /CREATE OR REPLACE FUNCTION[\s\S]*?(?=\$\$|\$function\$)/g
    )!;

    expect(functions.length).toBeGreaterThanOrEqual(4);

    for (const header of functions) {
      expect(header).toMatch(/SET search_path = public, pg_temp/);
    }
  });
});
