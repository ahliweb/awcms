/**
 * The order of the STRUCTURAL gates in `authorizeInTransaction` — cross-wave
 * rule 1 of `docs/awcms/program-model-keanggotaan-2026-08-09.md`, made
 * executable in the wave that adds the fourth of them (ADR-0084, Gelombang 5
 * PR 5.1 of Issue #423).
 *
 * ## The rule
 *
 * A structural gate answers "the caller's GRANTS must not be able to affect
 * this". Machine-credential read-only, module-disabled, entitlement-required,
 * platform-scope-required and tenant-suspended are all of that kind, and every
 * one of them must be decided ABOVE `fetchGrantedPermissionKeys`.
 *
 * Move any of them below it and the gate keeps working — for the wrong reason.
 * It becomes permission-SHAPED: a grant row that should not exist (a restored
 * backup, a hand-written INSERT, a provisioning path that forgot a `WHERE`)
 * becomes sufficient, and nothing observable changes until the day one appears.
 *
 * ## Why this is a SOURCE test and not a behavioural one
 *
 * Cross-wave rule 4, which generalises ADR-0063: a claim of the form "X runs
 * before Y" is satisfied by the correct arrangement AND by a mutated one, so a
 * behavioural suite cannot tell them apart. ADR-0063 records the concrete case —
 * a mutation that moved the RBAC check above the ABAC block left every test
 * green.
 *
 * And per the same rule, every assertion here is paired with an
 * EXISTENCE assertion. A `not.toMatch` or an index comparison over a literal
 * that no longer occurs passes vacuously; Issue #425 is the record of that
 * happening in this repo. If a sentinel is renamed, the existence test fails
 * loudly rather than the ordering test passing emptily.
 *
 * The mutation-proof for the detector itself is at the bottom: the ordering
 * function is run against a synthetic body with the gates in the WRONG order and
 * must report it.
 */
import { describe, expect, test } from "bun:test";

const GUARD_SOURCE_PATH =
  "src/modules/identity-access/application/access-guard.ts";

/**
 * The grant read. Every structural gate must be decided before this point.
 *
 * `scripts/access-chokepoint-check.ts` keys its "this handler decides
 * permissions" signal on the same literal, which is why `auth-context.ts`
 * carries a comment forbidding the rename.
 */
const GRANT_READ = "fetchGrantedPermissionKeys(";

/**
 * The structural gates, in the order they must appear, each keyed on the literal
 * that identifies its branch in the guard SOURCE.
 *
 * Four of the five are keyed on the `matchedPolicy` sentinel they write to
 * `awcms_abac_decision_logs`, because that sentinel is what a decision-log
 * consumer greps for and therefore the part that cannot be renamed without a
 * migration of its own. A variable name can be refactored freely and this test
 * should not object.
 *
 * **`entitlement_required` is keyed on its HTTP error code instead, and the
 * exception is a property of the code being BETTER rather than worse.** That
 * branch does not write its sentinel as a literal at all: it forwards
 * `entitlementDenial.matchedPolicy`, whose type is
 * `typeof ENTITLEMENT_REQUIRED_POLICY` — a single source of truth in
 * `domain/entitlement.ts` that cannot drift from the guard because the guard
 * never restates it. Writing the literal here too, for uniformity with the four
 * older branches, would REINTRODUCE the drift the constant removes. So the
 * detector keys on `"ENTITLEMENT_REQUIRED"`, which is unique in this function,
 * and `tests/entitlement-guard-chain.test.ts` pins the sentinel's value.
 *
 * The error code is NOT usable as the key for the other four: two of them
 * (machine-credential and platform-scope) both answer `ACCESS_DENIED`, so the
 * code does not identify a branch there.
 */
const STRUCTURAL_GATES: readonly { gate: string; token: string }[] = [
  { gate: "tenant_suspended", token: '"tenant_suspended"' },
  {
    gate: "machine_credential_readonly",
    token: '"machine_credential_readonly"'
  },
  { gate: "module_disabled", token: '"module_disabled"' },
  { gate: "entitlement_required", token: '"ENTITLEMENT_REQUIRED"' },
  { gate: "platform_scope_required", token: '"platform_scope_required"' }
];

function exportedFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);

  // Not a soft failure: a rename here would make every assertion below range
  // over an empty string and pass vacuously.
  expect(start).toBeGreaterThan(-1);

  const rest = source.slice(start + 1);
  const nextExport = rest.search(
    /\nexport (?:async function|function|type|const)\s/
  );

  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

/**
 * Gates that appear at or after the grant read, plus gates that appear out of
 * declared order. Pure over a body string so the probes below can feed it
 * source that was never written to disk.
 */
export function findStructuralOrderViolations(
  body: string,
  gates: readonly { gate: string; token: string }[] = STRUCTURAL_GATES,
  grantRead: string = GRANT_READ
): string[] {
  const problems: string[] = [];
  const grantIndex = body.indexOf(grantRead);

  if (grantIndex === -1) {
    return [
      `the grant read \`${grantRead}\` is absent — either it was renamed or ` +
        "this detector stopped recognising it, and both are failures."
    ];
  }

  let previousIndex = -1;
  let previousGate = "";

  for (const { gate, token } of gates) {
    const index = body.indexOf(token);

    if (index === -1) {
      problems.push(
        `the structural gate \`${gate}\` is absent from the guard body — a ` +
          "renamed sentinel breaks every decision-log consumer that greps for it."
      );
      continue;
    }

    if (index > grantIndex) {
      problems.push(
        `\`${gate}\` is decided AFTER \`${grantRead}\`. A structural gate below ` +
          "the grant read is permission-shaped: a grant row that should not " +
          "exist becomes sufficient."
      );
    }

    if (index < previousIndex) {
      problems.push(
        `\`${gate}\` is decided before \`${previousGate}\`, reversing the ` +
          "declared order."
      );
    }

    previousIndex = index;
    previousGate = gate;
  }

  return problems;
}

describe("structural gates are decided above the grant read", () => {
  test("the live guard satisfies the ordering", async () => {
    const source = await Bun.file(GUARD_SOURCE_PATH).text();
    const body = exportedFunctionBody(source, "authorizeInTransaction");

    expect(findStructuralOrderViolations(body)).toEqual([]);
  });

  test("every sentinel exists — the pairing that stops the test above passing vacuously", async () => {
    const source = await Bun.file(GUARD_SOURCE_PATH).text();
    const body = exportedFunctionBody(source, "authorizeInTransaction");

    expect(body).toContain(GRANT_READ);

    for (const { token } of STRUCTURAL_GATES) {
      expect(body).toContain(token);
    }

    // The entitlement branch's decision-log sentinel is FORWARDED from the
    // domain rather than restated here. Named explicitly so a refactor that
    // inlines a literal — reintroducing the drift the constant removes — fails
    // this test instead of passing quietly.
    expect(body).toContain("entitlementDenial.matchedPolicy");
  });

  test("entitlement is decided AFTER module_disabled, not before it", async () => {
    // A tenant that turned its own module off is owed that answer rather than
    // an upsell. Asserted separately from the loop because it is the one
    // ordering constraint in this list that is a product decision rather than a
    // security one — and it would otherwise be invisible inside the sequence.
    const source = await Bun.file(GUARD_SOURCE_PATH).text();
    const body = exportedFunctionBody(source, "authorizeInTransaction");

    const moduleDisabled = body.indexOf('"module_disabled"');
    const entitlement = body.indexOf('"ENTITLEMENT_REQUIRED"');

    expect(moduleDisabled).toBeGreaterThan(-1);
    expect(entitlement).toBeGreaterThan(-1);
    expect(entitlement).toBeGreaterThan(moduleDisabled);
  });
});

describe("the detector is mutation-proven", () => {
  /**
   * `STRUCTURAL_GATES` keys entitlement on its ERROR CODE, so the probe bodies
   * below must spell it the same way the guard does. Mapped here rather than
   * written out at each call site, so the probes stay readable as ORDERINGS.
   */
  const TOKEN_FOR: Readonly<Record<string, string>> = {
    entitlement_required: "ENTITLEMENT_REQUIRED"
  };

  const body = (order: readonly string[]): string =>
    order
      .map((name) =>
        name === "GRANT"
          ? `const keys = ${GRANT_READ}tx);`
          : `"${TOKEN_FOR[name] ?? name}"`
      )
      .join("\n");

  test("a gate moved below the grant read is reported", () => {
    const problems = findStructuralOrderViolations(
      body([
        "tenant_suspended",
        "machine_credential_readonly",
        "module_disabled",
        "GRANT",
        "entitlement_required",
        "platform_scope_required"
      ])
    );

    expect(problems.join("\n")).toContain("entitlement_required");
    expect(problems.join("\n")).toContain("AFTER");
  });

  test("two gates in the wrong relative order are reported", () => {
    const problems = findStructuralOrderViolations(
      body([
        "tenant_suspended",
        "machine_credential_readonly",
        "entitlement_required",
        "module_disabled",
        "platform_scope_required",
        "GRANT"
      ])
    );

    expect(problems.join("\n")).toContain("reversing the declared order");
  });

  test("a renamed sentinel is reported, not silently skipped", () => {
    const problems = findStructuralOrderViolations(
      body([
        "tenant_suspended",
        "machine_credential_readonly",
        "module_disabled",
        "plan_required",
        "platform_scope_required",
        "GRANT"
      ])
    );

    expect(problems.join("\n")).toContain("`entitlement_required` is absent");
  });

  test("a renamed grant read is reported rather than passing everything", () => {
    const problems = findStructuralOrderViolations(
      body([
        "tenant_suspended",
        "machine_credential_readonly",
        "module_disabled",
        "entitlement_required",
        "platform_scope_required"
      ])
    );

    expect(problems.join("\n")).toContain("is absent");
  });

  test("the correct order produces no findings", () => {
    expect(
      findStructuralOrderViolations(
        body([
          "tenant_suspended",
          "machine_credential_readonly",
          "module_disabled",
          "entitlement_required",
          "platform_scope_required",
          "GRANT"
        ])
      )
    ).toEqual([]);
  });
});
