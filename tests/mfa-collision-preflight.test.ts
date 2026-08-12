/**
 * The MFA collision census — ADR-0087, Gelombang 7 PR 7.3 of Issue #423.
 *
 * The census exists to tell an operator, before the deploy window, which
 * authenticator each human keeps. Its only value is being RIGHT: a census that
 * names the wrong survivor is worse than no census, because it is believed and
 * the correction arrives as a support ticket from somebody locked out.
 *
 * So the ordering is pinned against the migration's own text rather than against
 * a comment claiming they agree. Pure — no database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  rankFactors,
  runMfaCollisionPreflight,
  SURVIVOR_ORDER_KEYS,
  type MfaCollisionFactor
} from "../src/modules/identity-access/domain/mfa-collision-preflight";

const MIGRATION = "sql/114_awcms_principal_mfa.sql";

function factor(
  overrides: Partial<MfaCollisionFactor> & { factorId: string }
): MfaCollisionFactor {
  return {
    principalId: "human-1",
    identityId: `identity-${overrides.factorId}`,
    tenantId: "tenant-1",
    tenantCode: "t1",
    factorType: "totp",
    status: "active",
    lastUsedStep: -1,
    activatedAt: null,
    ...overrides
  };
}

describe("the census ranks EXACTLY as the migration does", () => {
  test("`sql/114` still spells the ORDER BY this module reimplements", () => {
    // The whole contract lives in two files, and the one that decides is the SQL.
    // If somebody re-tunes the migration's ordering, this goes red rather than
    // the census quietly predicting a survivor the migration does not pick.
    const sql = readFileSync(MIGRATION, "utf8");
    const expected = SURVIVOR_ORDER_KEYS.map((key) => `f.${key}`).join(", ");

    expect(sql.replace(/\s+/g, " ")).toContain(`ORDER BY ${expected}`);
  });

  test("the survivor is the LAST USED factor, not the newest enrolment", () => {
    // The defect this rules out is the one the ADR argues about at length:
    // ranking by `activated_at` picks the most recent enrolment, which may be on
    // a phone that has since been replaced — and picking it locks the person out
    // of the authenticator they are actually holding.
    const ranked = rankFactors([
      factor({
        factorId: "newest-enrolment",
        lastUsedStep: 5,
        activatedAt: new Date("2026-08-01T00:00:00Z")
      }),
      factor({
        factorId: "actually-used",
        lastUsedStep: 900,
        activatedAt: new Date("2026-01-01T00:00:00Z")
      })
    ]);

    expect(ranked[0]!.factorId).toBe("actually-used");
  });

  test("`activated_at` breaks a tie in step, with NULLS LAST", () => {
    const ranked = rankFactors([
      factor({
        factorId: "never-activated",
        lastUsedStep: 7,
        activatedAt: null
      }),
      factor({
        factorId: "older",
        lastUsedStep: 7,
        activatedAt: new Date("2026-01-01T00:00:00Z")
      }),
      factor({
        factorId: "newer",
        lastUsedStep: 7,
        activatedAt: new Date("2026-06-01T00:00:00Z")
      })
    ]);

    expect(ranked.map((row) => row.factorId)).toEqual([
      "newer",
      "older",
      "never-activated"
    ]);
  });

  test("the id tiebreak makes a full tie deterministic", () => {
    // Without it two factors identical in both keys would rank by input order,
    // and the census would name a different survivor than a re-run — or than the
    // migration, whose planner order is not the census's array order.
    const both = [
      factor({ factorId: "b" }),
      factor({ factorId: "a" }),
      factor({ factorId: "c" })
    ];

    expect(rankFactors(both).map((row) => row.factorId)).toEqual([
      "a",
      "b",
      "c"
    ]);
    expect(rankFactors([...both].reverse()).map((row) => row.factorId)).toEqual(
      ["a", "b", "c"]
    );
  });
});

describe("what the census reports", () => {
  test("one human, one factor per tenant — the collision the ADR is about", () => {
    const report = runMfaCollisionPreflight([
      factor({
        factorId: "f-a",
        tenantId: "tenant-a",
        tenantCode: "alpha",
        lastUsedStep: 100,
        activatedAt: new Date("2026-02-01T00:00:00Z")
      }),
      factor({
        factorId: "f-b",
        tenantId: "tenant-b",
        tenantCode: "beta",
        lastUsedStep: 900,
        activatedAt: new Date("2026-01-01T00:00:00Z")
      })
    ]);

    expect(report.factorsScanned).toBe(2);
    expect(report.principalsWithFactor).toBe(1);
    expect(report.factorsThatWouldBeDisabled).toBe(1);
    expect(report.clear).toBe(false);

    const [finding] = report.findings;

    if (!finding || finding.kind !== "multi_factor_principal") {
      throw new Error(`expected a collision finding, got ${finding?.kind}`);
    }

    expect(finding.survivor.factorId).toBe("f-b");
    expect(finding.survivor.tenantCode).toBe("beta");
    expect(finding.disabled.map((row) => row.factorId)).toEqual(["f-a"]);
  });

  test("one factor per human is not a finding, however many humans", () => {
    const report = runMfaCollisionPreflight([
      factor({ factorId: "f-1", principalId: "human-1" }),
      factor({ factorId: "f-2", principalId: "human-2" }),
      factor({ factorId: "f-3", principalId: "human-3" })
    ]);

    expect(report.principalsWithFactor).toBe(3);
    expect(report.factorsThatWouldBeDisabled).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.clear).toBe(true);
  });

  test("two factors of DIFFERENT types are not a collision", () => {
    // The partial unique index is on `(principal_id, factor_type)`, so the day a
    // second factor type lands, holding one of each is legal. Grouping by
    // principal alone would report a collision the migration does not create and
    // send an operator to warn somebody who loses nothing.
    const report = runMfaCollisionPreflight([
      factor({ factorId: "f-totp", factorType: "totp" }),
      factor({ factorId: "f-webauthn", factorType: "webauthn" })
    ]);

    expect(report.factorsThatWouldBeDisabled).toBe(0);
    expect(report.findings).toEqual([]);
  });

  test("a live factor on an UNLINKED identity is reported, not silently dropped", () => {
    // `sql/114` §3a reads `WHERE i.principal_id IS NOT NULL`, so this factor is
    // not migrated at all — the person's MFA disappears rather than losing a
    // duplicate. It should never happen; the census is how it stops being
    // invisible if it does.
    const report = runMfaCollisionPreflight([
      factor({ factorId: "orphan", principalId: null, tenantCode: "gamma" })
    ]);

    expect(report.principalsWithFactor).toBe(0);
    expect(report.factorsThatWouldBeDisabled).toBe(0);
    expect(report.clear).toBe(false);

    const [finding] = report.findings;

    if (!finding || finding.kind !== "unlinked_factor") {
      throw new Error(`expected an unlinked finding, got ${finding?.kind}`);
    }

    expect(finding.factorId).toBe("orphan");
    expect(finding.tenantCode).toBe("gamma");
  });

  test("a pending factor counts — it is a secret already displayed as a QR", () => {
    const report = runMfaCollisionPreflight([
      factor({ factorId: "active", status: "active", lastUsedStep: 10 }),
      factor({ factorId: "pending", status: "pending", lastUsedStep: -1 })
    ]);

    expect(report.factorsThatWouldBeDisabled).toBe(1);

    const [finding] = report.findings;

    if (!finding || finding.kind !== "multi_factor_principal") {
      throw new Error(`expected a collision finding, got ${finding?.kind}`);
    }

    expect(finding.survivor.factorId).toBe("active");
    expect(finding.disabled[0]!.status).toBe("pending");
  });
});
