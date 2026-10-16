import { describe, expect, test } from "bun:test";
import {
  approveDelegatedAccess,
  redeemDelegatedAccess
} from "../src/modules/identity-access/application/delegated-access-store";
import { validateDelegatedGrantTtl } from "../src/modules/identity-access/domain/delegated-access";

const approvedAt = new Date("2025-01-01T00:00:00Z");
const grantExp = new Date(approvedAt.getTime() + 30 * 86_400_000);

function fakeTx() {
  const sqls: string[] = [];
  let grant: Record<string, string> | undefined;
  const tx = (async (s: TemplateStringsArray, ..._v: unknown[]) => {
    const q = s.join("?");
    sqls.push(q);
    if (q.includes("INSERT INTO awcms_delegated_access_grants")) {
      grant = {
        id: "g1",
        role_id: "r1",
        partner_tenant_id: "partner-a",
        expires_at: grantExp.toISOString(),
        created_at: approvedAt.toISOString()
      };
      return [{ id: "g1" }];
    }
    if (q.includes("FROM awcms_delegated_access_grants")) return [grant];
    return [];
  }) as unknown as Bun.SQL;
  return { tx, sqls };
}

async function approve(tx: Bun.SQL) {
  const a = await approveDelegatedAccess(tx, "t1", approvedAt, {
    partnerTenantId: "partner-a",
    roleId: "r1",
    approvedByTenantUserId: "u1",
    purpose: "support",
    expiresAt: grantExp
  });
  if (!a.ok) throw new Error("approve failed");
  return a;
}

describe("identity-access g04 regressions", () => {
  test("redemption after the 24h code TTL is refused (SELECT + CAS bound to created_at)", async () => {
    const { tx, sqls } = fakeTx();
    const a = await approve(tx);
    const later = new Date(approvedAt.getTime() + 48 * 3_600_000);
    const n = sqls.length;
    const r = await redeemDelegatedAccess(
      tx,
      "t1",
      a.accessCode,
      "pr1",
      later,
      "partner-a"
    );
    expect(r).toEqual({ ok: false, code: "CODE_INVALID" });
    expect(sqls.length - n).toBe(1);
    expect(sqls[n]).toContain("created_at >");
  });

  test("redemption from a tenant other than the grant's partner is refused", async () => {
    const { tx, sqls } = fakeTx();
    const a = await approve(tx);
    const soon = new Date(approvedAt.getTime() + 3_600_000);
    const n = sqls.length;
    const r = await redeemDelegatedAccess(
      tx,
      "t1",
      a.accessCode,
      "pr1",
      soon,
      "partner-b"
    );
    expect(r).toEqual({ ok: false, code: "CODE_INVALID" });
    expect(sqls.length - n).toBe(1);
    expect(sqls[n]).toContain("partner_tenant_id =");
  });

  test("validateDelegatedGrantTtl rejects an Invalid Date", () => {
    expect(validateDelegatedGrantTtl(approvedAt, new Date("nope")).ok).toBe(
      false
    );
  });
});
