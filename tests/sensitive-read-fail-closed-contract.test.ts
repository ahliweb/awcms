/**
 * Fail-closed contract for sensitive reads (Issue #1014 L6, follow-up to #978).
 *
 * The static gate (`findSwallowedSensitiveReads`) rejects the shapes that
 * swallow an audit failure; it cannot see every path. The routes of #957 and
 * #961 must therefore prove it by behaviour with
 * `expectAuditFailureYieldsNoData` (tests/fixtures/sensitive-read-fail-closed.ts).
 * This file proves the assertion on a correct handler and on a swallowing one,
 * so it fails when it should.
 */
import { describe, expect, test } from "bun:test";

import { recordSensitiveRead } from "../src/modules/logging/application/sensitive-read-audit";
import {
  expectAuditFailureYieldsNoData,
  failingTx
} from "./fixtures/sensitive-read-fail-closed";

const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const TENANT = "00000000-0000-4000-8000-000000000001";
const ROW = "00000000-0000-4000-8000-0000000000b1";

const call = (tx: Bun.SQL) =>
  recordSensitiveRead(tx, {
    tenantId: TENANT,
    actorTenantUserId: ACTOR,
    permission: "hr_commission.accruals.read",
    itemCount: 1,
    resourceIds: [ROW]
  });

describe("recordSensitiveRead fails closed", () => {
  test("a failing audit write rejects, so the caller's transaction aborts", async () => {
    await expect(call(failingTx())).rejects.toThrow();
  });

  test("a well-formed handler returns no data when the audit fails", async () => {
    await expectAuditFailureYieldsNoData(async (tx) => {
      const rows = [{ id: ROW, amount: "1500000.00" }];

      await call(tx);

      return { data: rows, status: 200 };
    });
  });

  test("the assertion catches a handler that swallows the failure", async () => {
    await expect(
      expectAuditFailureYieldsNoData(async (tx) => {
        const rows = [{ id: ROW, amount: "1500000.00" }];

        try {
          await call(tx);
        } catch {
          // swallowed: the bug this issue guards against
        }

        return { data: rows, status: 200 };
      })
    ).rejects.toThrow();
  });
});
