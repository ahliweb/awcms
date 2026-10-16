/**
 * G10 regression: a factor disabled between `findActiveFactor`'s unlocked read
 * and `lockFactorForVerify`'s row lock must not verify from the stale snapshot,
 * and must not count a failure. The fake tx models a row whose status is now
 * 'disabled': any statement that re-asserts `status = 'active'` sees no row.
 */
import { describe, expect, test } from "bun:test";

import { verifyStepUpFactor } from "../src/modules/identity-access/application/mfa";
import {
  advanceLastUsedStep,
  consumeRecoveryCode,
  lockFactorForVerify
} from "../src/modules/identity-access/application/principal-mfa-store";

function disabledFactorTx(): { tx: Bun.SQL; statements: string[] } {
  const statements: string[] = [];
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const sql = strings.raw.join("?");
    statements.push(sql);
    const checksActive = /status = 'active'/.test(sql);
    if (sql.includes("FROM awcms_identities")) {
      return Promise.resolve([{ principal_id: "p1" }]);
    }
    if (sql.includes("SELECT id, secret_ciphertext")) {
      // Stale unlocked read: still active at that moment.
      return Promise.resolve([
        {
          id: "f1",
          secret_ciphertext: "x",
          last_used_step: 0,
          failed_verify_count: 0,
          locked_until: null
        }
      ]);
    }
    if (sql.includes("FOR UPDATE")) {
      return Promise.resolve(
        checksActive ? [] : [{ failed_verify_count: 0, locked_until: null }]
      );
    }
    if (sql.includes("awcms_principal_mfa_recovery_codes")) {
      return Promise.resolve(
        /f\.status = 'active'/.test(sql) ? [] : [{ id: "rc1" }]
      );
    }
    void args;
    return Promise.resolve([]);
  }) as unknown as Bun.SQL;
  return { tx, statements };
}

describe("G10: factor disabled between read and lock", () => {
  test("step-up with a valid recovery code is rejected and no failure is counted", async () => {
    const { tx, statements } = disabledFactorTx();
    const result = await verifyStepUpFactor(
      tx,
      "t1",
      "i1",
      { recoveryCode: "AAAA-BBBB" },
      {},
      new Date()
    );
    expect(result).toEqual({ ok: false, code: "MFA_INVALID_CODE" });
    expect(statements.some((s) => s.includes("failed_verify_count = "))).toBe(
      false
    );
    expect(statements.some((s) => s.includes("used_at ="))).toBe(false);
  });

  test("store statements re-assert status = 'active'", async () => {
    const { tx, statements } = disabledFactorTx();
    expect(await lockFactorForVerify(tx, "f1")).toBeNull();
    expect(await advanceLastUsedStep(tx, "f1", 5, new Date())).toBe(false);
    expect(await consumeRecoveryCode(tx, "p1", "f1", "h", new Date())).toBe(
      false
    );
    expect(statements.every((s) => /status = 'active'/.test(s))).toBe(true);
  });
});
