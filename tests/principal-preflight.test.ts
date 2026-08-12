/**
 * Issue #430 — the census that has to be right months before it matters.
 *
 * The whole point of running this early is that a within-tenant collision is a
 * customer conversation, not a patch. A census that MISSES one is worse than no
 * census: it converts "we found this in March" into "the migration aborted at
 * 02:00 on a Saturday".
 *
 * So the assertions here are mostly about what it must NOT do — merge addresses
 * that are different people, or call a tenant clear when it is not.
 */
import { describe, expect, test } from "bun:test";

import {
  looksLikeEmail,
  normalizeLoginIdentifier,
  runPrincipalPreflight,
  type PreflightIdentity
} from "../src/modules/identity-access/domain/principal-preflight";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function identity(
  identityId: string,
  tenantId: string,
  loginIdentifier: string
): PreflightIdentity {
  return {
    identityId,
    tenantId,
    tenantCode: tenantId === TENANT_A ? "alpha" : "beta",
    loginIdentifier
  };
}

describe("normalization is conservative on purpose", () => {
  test("lowercases and trims", () => {
    expect(normalizeLoginIdentifier("  Alice@Corp.COM ")).toBe(
      "alice@corp.com"
    );
  });

  test("does NOT strip dots — they are different people at some providers", () => {
    // Merging is unrecoverable; a collision report is not. The census applies
    // exactly the rule the migration will apply, and no more.
    expect(normalizeLoginIdentifier("a.b@corp.com")).not.toBe(
      normalizeLoginIdentifier("ab@corp.com")
    );
  });

  test("does NOT strip +tags", () => {
    expect(normalizeLoginIdentifier("alice+ops@corp.com")).not.toBe(
      normalizeLoginIdentifier("alice@corp.com")
    );
  });
});

describe("the blocking finding", () => {
  test("case-only difference in ONE tenant is a collision", () => {
    const report = runPrincipalPreflight([
      identity("i1", TENANT_A, "Alice@corp.com"),
      identity("i2", TENANT_A, "alice@corp.com")
    ]);

    expect(report.clear).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.kind).toBe("within_tenant_collision");
  });

  test("whitespace-only difference in ONE tenant is a collision", () => {
    const report = runPrincipalPreflight([
      identity("i1", TENANT_A, "alice@corp.com "),
      identity("i2", TENANT_A, "alice@corp.com")
    ]);

    expect(report.clear).toBe(false);
  });

  test("the SAME address in TWO tenants is NOT a collision — it is the point", () => {
    // One human in two tenants is precisely what the principal migration makes
    // possible. Flagging it would report the feature as the problem.
    const report = runPrincipalPreflight([
      identity("i1", TENANT_A, "alice@corp.com"),
      identity("i2", TENANT_B, "alice@corp.com")
    ]);

    expect(report.clear).toBe(true);
    expect(report.principalsThatWouldBeCreated).toBe(1);
    expect(report.principalsSpanningMultipleTenants).toBe(1);
  });

  test("a collision names every raw identifier, so the fix is actionable", () => {
    // "There is a collision" is not enough to have the conversation with. The
    // operator needs to see BOTH spellings to know which is the duplicate.
    const report = runPrincipalPreflight([
      identity("i1", TENANT_A, "Alice@corp.com"),
      identity("i2", TENANT_A, "alice@corp.com ")
    ]);

    const finding = report.findings[0]!;
    if (finding.kind !== "within_tenant_collision") throw new Error("shape");

    expect(finding.rawIdentifiers).toEqual([
      "Alice@corp.com",
      "alice@corp.com "
    ]);
    expect(finding.identityIds).toEqual(["i1", "i2"]);
    expect(finding.tenantCode).toBe("alpha");
  });
});

describe("the advisory finding does not block", () => {
  test("a non-email identifier is reported but keeps the report clear", () => {
    const report = runPrincipalPreflight([
      identity("i1", TENANT_A, "operator")
    ]);

    // TWO findings since #430's census was completed: `operator` is neither an
    // address by shape nor mailable. They are separate questions and the sets
    // do not coincide — see the `not_mailable` describe block below.
    expect(report.findings.map((finding) => finding.kind).sort()).toEqual([
      "non_email_identifier",
      "not_mailable"
    ]);
    // It still becomes a principal. Blocking on it would stall the migration
    // for a state that is survivable.
    expect(report.clear).toBe(true);
  });

  test("looksLikeEmail rejects the shapes that would surprise someone", () => {
    expect(looksLikeEmail("alice@corp.com")).toBe(true);
    expect(looksLikeEmail("operator")).toBe(false);
    expect(looksLikeEmail("alice@corp")).toBe(false);
    expect(looksLikeEmail("alice @corp.com")).toBe(false);
    expect(looksLikeEmail("a@b@corp.com")).toBe(false);
  });
});

describe("sizing", () => {
  test("counts the principals a backfill would create", () => {
    const report = runPrincipalPreflight([
      identity("i1", TENANT_A, "alice@corp.com"),
      identity("i2", TENANT_B, "alice@corp.com"),
      identity("i3", TENANT_A, "bob@corp.com")
    ]);

    expect(report.identitiesScanned).toBe(3);
    expect(report.principalsThatWouldBeCreated).toBe(2);
    expect(report.principalsSpanningMultipleTenants).toBe(1);
  });

  test("an empty deployment is clear, not a crash", () => {
    expect(runPrincipalPreflight([])).toEqual({
      identitiesScanned: 0,
      principalsThatWouldBeCreated: 0,
      principalsSpanningMultipleTenants: 0,
      findings: [],
      clear: true
    });
  });
});

describe("not_mailable is a DIFFERENT question from non_email_identifier (#430)", () => {
  function census(identifiers: readonly string[]) {
    return runPrincipalPreflight(
      identifiers.map((loginIdentifier, index) => ({
        identityId: `id-${index}`,
        tenantId: "tenant-a",
        tenantCode: "a",
        loginIdentifier
      }))
    );
  }

  function kinds(identifier: string): string[] {
    return census([identifier])
      .findings.map((finding) => finding.kind)
      .sort();
  }

  test("`a@localhost` is NOT an email by the census, and IS mailable by the reset path", () => {
    // The assertion that makes importing `isMailableLoginIdentifier` load-bearing
    // rather than decorative. The census's docblock used to claim a non-email
    // identifier "can never receive an invitation or a password reset"; this
    // address is the counterexample, and the reset path duly sends to it.
    expect(kinds("a@localhost")).toEqual(["non_email_identifier"]);
  });

  test("`operator` is neither an email nor mailable — both findings fire", () => {
    expect(kinds("operator")).toEqual(["non_email_identifier", "not_mailable"]);
  });

  test("`@example.com` has an empty local part: an email by shape, not mailable", () => {
    // `looksLikeEmail` accepts `[^\s@]+@[^\s@]+\.[^\s@]+`, which an empty local
    // part fails — but the two predicates disagree on WHICH malformed shapes
    // matter, and that disagreement is the point of reporting both.
    const found = kinds("@example.com");

    expect(found).toContain("not_mailable");
  });

  test("an ordinary address raises nothing", () => {
    expect(kinds("alice@corp.com")).toEqual([]);
  });

  test("neither advisory blocks the migration — only a collision does", () => {
    // `clear` must stay bound to `within_tenant_collision` alone. An advisory
    // that blocked would turn a census into a gate, and a census that refuses
    // to finish tells you nothing about the rest of the estate.
    expect(census(["operator", "a@localhost"]).clear).toBe(true);
  });
});

describe("both per-tenant censuses scope their reads EXPLICITLY, not via RLS alone", () => {
  // A defect both preflight scripts shipped with, found by RUNNING them against
  // a seeded database rather than by reading them — and invisible in a diff.
  //
  // Each loops over tenants inside `withTenantOrThrow` and relied on RLS to cut
  // the rows down. A superuser or the migration role BYPASSES RLS entirely, and
  // running ops scripts as the owner is an ordinary setup — so every pass read
  // every row in the installation and re-tagged it with whichever tenant's turn
  // it was.
  //
  // The consequences were not symmetric, and the worse one is the older script:
  //
  // - `identity:mfa-collisions:preflight` multiplied its counts (two seeded
  //   factors reported as four) and named the wrong tenants.
  // - `identity:principals:preflight` reported ONE human working legitimately in
  //   two tenants as TWO BLOCKING within-tenant collisions — telling an operator
  //   to decide which of two REAL accounts was a duplicate. A census that is
  //   confidently wrong in the direction of deletion is worse than none, and
  //   this one was wrong about the exact case principals exist for.
  //
  // Source-based on purpose: the behaviour needs a database with two tenants and
  // an owner connection, which the default suite has neither of — and a
  // behavioural test that skips is not a regression test. Mutation-proved:
  // deleting either predicate reddens this.
  const SCRIPTS = [
    "scripts/identity-access-principal-preflight.ts",
    "scripts/identity-mfa-collisions-preflight.ts"
  ];

  for (const script of SCRIPTS) {
    test(`${script} binds its per-tenant read to \`tenant_id\``, async () => {
      const source = (await Bun.file(script).text())
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");

      const inLoop = source.slice(source.indexOf("withTenantOrThrow"));

      expect(inLoop).toContain("tenant_id = ${tenant.id}");
    });
  }
});
