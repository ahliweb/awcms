/**
 * `requiresMfaEnrolment` — the pure parts (ADR-0141, finding PS-13). The
 * behaviour against a real database is `tests/integration/mfa-required-
 * permissions.integration.test.ts`; this file pins what can be pinned without
 * one: the declaration, the decision matrix, the SHAPE of the wiring in the
 * chokepoint, and the two readiness checks' no-database paths.
 *
 * ## Why some of these are SOURCE tests
 *
 * "The gate runs only after an allow, and before the log row is written" is an
 * ordering claim, and the same arrangement-vs-mutation argument that
 * `guard-structural-gate-order.test.ts` makes applies: a behavioural suite
 * passes for the correct order AND for a mutated one in some of the cases. Each
 * is paired with an EXISTENCE assertion so a renamed sentinel fails loudly
 * instead of making the ordering test pass over an empty string.
 */
import { describe, expect, test } from "bun:test";

import {
  checkMfaEnrolmentAvailableForRequiredPermissions,
  checkMfaRequiredPermissionHolders
} from "../scripts/security-readiness";
import {
  MFA_ENROLMENT_PATH,
  MFA_ENROLMENT_REQUIRED_CODE,
  MFA_ENROLMENT_REQUIRED_POLICY,
  collectMfaRequiredPermissionKeys,
  evaluateMfaEnrolmentRequirement,
  type MfaEnrolmentFacts
} from "../src/modules/identity-access/domain/mfa-required-permissions";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";

const GUARD = "src/modules/identity-access/application/access-guard.ts";
const GATE = "src/modules/identity-access/application/mfa-enrolment-gate.ts";

function fixtureModule(
  key: string,
  permissions: NonNullable<ModuleDescriptor["permissions"]>
): Pick<ModuleDescriptor, "key" | "permissions"> {
  return { key, permissions };
}

describe("declaring a permission as requiring an enrolled factor", () => {
  test("collects exactly the permissions that say `true`", () => {
    const keys = collectMfaRequiredPermissionKeys([
      fixtureModule("hr_fixture", [
        {
          activityCode: "runs",
          action: "approve",
          description: "flagged",
          requiresMfaEnrolment: true
        },
        {
          activityCode: "runs",
          action: "read",
          description: "explicitly not flagged",
          requiresMfaEnrolment: false
        },
        { activityCode: "runs", action: "list", description: "omitted" }
      ]),
      fixtureModule("other_fixture", [
        {
          activityCode: "vault",
          action: "reveal",
          description: "flagged in a second module",
          requiresMfaEnrolment: true
        }
      ]),
      { key: "no_permissions_fixture" }
    ]);

    expect([...keys].sort()).toEqual([
      "hr_fixture.runs.approve",
      "other_fixture.vault.reveal"
    ]);
  });

  test("only a literal `true` flags — a truthy value of another type does not", () => {
    // A flag that a string, a number or a stray object could trip is a flag
    // somebody turns on by accident while meaning something else.
    const keys = collectMfaRequiredPermissionKeys([
      fixtureModule("loose_fixture", [
        {
          activityCode: "a",
          action: "b",
          description: "string",
          requiresMfaEnrolment: "true" as unknown as boolean
        },
        {
          activityCode: "a",
          action: "c",
          description: "number",
          requiresMfaEnrolment: 1 as unknown as boolean
        }
      ])
    ]);

    expect(keys.size).toBe(0);
  });

  test("the contract field is documented where authors read it", async () => {
    const contract = await Bun.file(
      "src/modules/_shared/module-contract.ts"
    ).text();

    expect(contract).toContain("requiresMfaEnrolment?: boolean");
    // 4.3.0 introduced the field; later MINOR bumps keep it (4.4.0, ADR-0140).
    expect(contract).toMatch(/MODULE_CONTRACT_VERSION = "4\.\d+\.\d+"/);
  });
});

describe("the decision", () => {
  const base: MfaEnrolmentFacts = {
    required: true,
    viaMachineCredential: false,
    enrolled: false,
    enrolmentAvailable: true
  };

  test("an unflagged permission is never refused, whatever else is true", () => {
    for (const viaMachineCredential of [true, false]) {
      for (const enrolled of [true, false]) {
        for (const enrolmentAvailable of [true, false]) {
          expect(
            evaluateMfaEnrolmentRequirement({
              required: false,
              viaMachineCredential,
              enrolled,
              enrolmentAvailable
            })
          ).toEqual({ outcome: "satisfied" });
        }
      }
    }
  });

  test("a flagged permission is satisfied by an enrolled person, and only by one", () => {
    expect(
      evaluateMfaEnrolmentRequirement({ ...base, enrolled: true })
    ).toEqual({ outcome: "satisfied" });
    expect(evaluateMfaEnrolmentRequirement(base).outcome).toBe("refused");
  });

  test("an unenrolled person is told WHERE to enrol", () => {
    const verdict = evaluateMfaEnrolmentRequirement(base);

    expect(verdict.outcome).toBe("refused");
    if (verdict.outcome !== "refused") throw new Error("unreachable");
    expect(verdict.reason).toBe("not_enrolled");
    expect(verdict.message).toContain(MFA_ENROLMENT_PATH);
  });

  test("where nobody can enrol the refusal names an administrator, not a screen that cannot help", () => {
    const verdict = evaluateMfaEnrolmentRequirement({
      ...base,
      enrolmentAvailable: false
    });

    if (verdict.outcome !== "refused") throw new Error("unreachable");
    expect(verdict.reason).toBe("enrolment_unavailable");
    expect(verdict.message).not.toContain(MFA_ENROLMENT_PATH);
    expect(verdict.message).toContain("administrator");
  });

  test("a machine credential is refused even if 'enrolled' and 'available' are both true", () => {
    const verdict = evaluateMfaEnrolmentRequirement({
      required: true,
      viaMachineCredential: true,
      enrolled: true,
      enrolmentAvailable: true
    });

    if (verdict.outcome !== "refused") throw new Error("unreachable");
    expect(verdict.reason).toBe("machine_credential");
  });

  test("the refusal can never be an allow: no input combination upgrades a refusal", () => {
    // Deny-only by construction: `satisfied` requires `!required` or `enrolled &&
    // !viaMachineCredential`. Enumerate rather than argue.
    for (const required of [true, false]) {
      for (const viaMachineCredential of [true, false]) {
        for (const enrolled of [true, false]) {
          for (const enrolmentAvailable of [true, false]) {
            const satisfied =
              evaluateMfaEnrolmentRequirement({
                required,
                viaMachineCredential,
                enrolled,
                enrolmentAvailable
              }).outcome === "satisfied";

            expect(satisfied).toBe(
              !required || (enrolled && !viaMachineCredential)
            );
          }
        }
      }
    }
  });
});

describe("the wiring in the chokepoint", () => {
  async function guardBody(): Promise<string> {
    const source = await Bun.file(GUARD).text();
    const start = source.indexOf(
      "export async function authorizeInTransaction("
    );

    expect(start).toBeGreaterThan(-1);

    const rest = source.slice(start + 1);
    const next = rest.search(
      /\nexport (?:async function|function|type|const)\s/
    );

    return next === -1 ? rest : rest.slice(0, next);
  }

  test("every sentinel exists — the pairing that stops the ordering tests passing vacuously", async () => {
    const body = await guardBody();

    expect(body).toContain("checkMfaEnrolmentRequirement(");
    expect(body).toContain("MFA_ENROLMENT_REQUIRED_POLICY");
    expect(body).toContain("MFA_ENROLMENT_REQUIRED_CODE");
    expect(body).toContain("recordDecisionLog(");
    expect(MFA_ENROLMENT_REQUIRED_POLICY).toBe("mfa_enrolment_required");
    expect(MFA_ENROLMENT_REQUIRED_CODE).toBe("MFA_ENROLMENT_REQUIRED");
  });

  test("it runs only on a decision that already allowed, and before the decision is logged", async () => {
    const body = await guardBody();
    const gate = body.indexOf("checkMfaEnrolmentRequirement(");
    const onlyAfterAllow = body.lastIndexOf("rbacDecision.allowed", gate);
    const finalLog = body.indexOf("recordDecisionLog(", gate);

    expect(gate).toBeGreaterThan(-1);
    // `rbacDecision.allowed ? await check…` — the guard on the same expression.
    expect(onlyAfterAllow).toBeGreaterThan(-1);
    expect(gate - onlyAfterAllow).toBeLessThan(80);
    // Folded into THE decision: the log write that records it comes after.
    expect(finalLog).toBeGreaterThan(gate);
  });

  test("it is deny-only: the refusal can only replace an allow, never a deny", async () => {
    const body = await guardBody();

    // The refusal is the `decision` only when `mfaRefusal` is non-null, and
    // `mfaRefusal` is non-null only when `rbacDecision.allowed` was true.
    expect(body).toMatch(
      /const mfaRefusal = rbacDecision\.allowed\s*\?\s*await checkMfaEnrolmentRequirement\(/
    );
    expect(body).toMatch(
      /const decision = mfaRefusal\s*\?\s*\{\s*allowed: false/
    );
  });

  test("it runs below the grant read, and that is correct: it reads the caller's own enrolment, not their grants", async () => {
    // Documented as a deliberate difference from the structural gates in
    // `guard-structural-gate-order.test.ts`. Pinned here so that "move it above
    // the grant read to match the others" is a decision somebody has to argue,
    // not a tidy-up — above it, an unauthorised caller would learn which
    // actions require MFA.
    const body = await guardBody();

    expect(body.indexOf("checkMfaEnrolmentRequirement(")).toBeGreaterThan(
      body.indexOf("fetchGrantedPermissionKeys(")
    );
  });

  test("a field gated on a flagged key honours the requirement too", async () => {
    const source = await Bun.file(GUARD).text();
    const start = source.indexOf(
      "export async function evaluateFieldAccessInTransaction("
    );

    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start)).toContain("checkMfaEnrolmentRequirement(");
  });

  test("the field gate reads machine-ness from the CONTEXT, never from an optional argument (audit F-1)", async () => {
    const source = await Bun.file(GUARD).text();
    const field = source.slice(
      source.indexOf("export async function evaluateFieldAccessInTransaction(")
    );

    // Existence pair first, so the negative assertions cannot pass over nothing.
    expect(field).toContain("context.viaMachineCredential === true");
    // A parameter that defaults to "session" when omitted is the defect: the
    // three analytics callers omit it.
    expect(field).not.toMatch(/options\??:\s*\{\s*viaMachineCredential/);
    // And the producer stamps it on the context it returns.
    expect(source).toMatch(
      /context: machine \? \{ \.\.\.context, viaMachineCredential: true \} : context/
    );
  });

  test("the injected-keys seam is unioned with the registry, never a replacement (audit F-5)", async () => {
    const gate = await Bun.file(GATE).text();

    expect(gate).toContain("isMfaRequiredPermissionKey(permissionKeyValue) ||");
    expect(gate).toContain("options.requiredKeys?.has(permissionKeyValue)");
    // The old shape — `requiredKeys ? requiredKeys.has(...) : registry` — is the
    // one an empty set could use to switch the requirement off.
    expect(gate).not.toMatch(
      /options\.requiredKeys\s*\?\s*options\.requiredKeys\.has/
    );
  });

  test("POST /access/evaluate applies the gate to the caller's own enrolment before it logs (audit F-6)", async () => {
    const route = await Bun.file("src/pages/api/v1/access/evaluate.ts").text();
    const gate = route.indexOf("checkMfaEnrolmentRequirement(");
    const log = route.indexOf("recordDecisionLog(\n", gate);

    expect(gate).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(gate);
    expect(route).toContain("MFA_ENROLMENT_REQUIRED_POLICY");
  });
});

describe("never an unconditional step-up (ADR-0141 §4)", () => {
  test("the gate asks whether a factor EXISTS and never demands a step-up proof", async () => {
    const gate = await Bun.file(GATE).text();

    // Existence pair: the gate does read enrolment...
    expect(gate).toContain("getMfaStatus(");
    // ...and does not touch the step-up gate. `requireStepUp` here would turn
    // "you must be ABLE to give a second factor" into "give one now, on every
    // request" — and it would lock out exactly the people the refusal exists to
    // send to enrolment, because they cannot reach aal2.
    expect(gate).not.toContain("requireStepUp");
    expect(gate).not.toContain("stepUpSession");
  });

  test("the enrolment routes are not behind the chokepoint", async () => {
    for (const route of ["start", "verify"]) {
      const source = await Bun.file(
        `src/pages/api/v1/auth/mfa/totp/enroll/${route}.ts`
      ).text();

      expect(source).toContain("resolveEnrollAuth");
      expect(source).not.toContain("authorizeInTransaction");
    }
  });
});

describe("readiness checks, without a database", () => {
  test("enrolment availability passes loudly when nothing is flagged", () => {
    const result = checkMfaEnrolmentAvailableForRequiredPermissions(
      new Set(),
      {}
    );

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("critical");
    expect(result.evidence).toContain("No module declares");
  });

  test("enrolment availability FAILS when a permission is flagged and nobody can enrol", () => {
    const result = checkMfaEnrolmentAvailableForRequiredPermissions(
      new Set(["hr_fixture.runs.approve"]),
      { AUTH_MFA_ENABLED: "false" }
    );

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("critical");
    expect(result.evidence).toContain("1 permission(s)");
    expect(result.evidence).toContain("AUTH_MFA_ENABLED");
  });

  test("an unset AUTH_MFA_ENABLED is the same as off — fail-closed", () => {
    expect(
      checkMfaEnrolmentAvailableForRequiredPermissions(
        new Set(["hr_fixture.runs.approve"]),
        {}
      ).status
    ).toBe("fail");
  });

  test("enrolment availability passes when flagged and enrolment is on", () => {
    expect(
      checkMfaEnrolmentAvailableForRequiredPermissions(
        new Set(["hr_fixture.runs.approve"]),
        { AUTH_MFA_ENABLED: "true" }
      ).status
    ).toBe("pass");
  });

  test("the holder report passes loudly with nothing flagged, without touching a database", async () => {
    const result = await checkMfaRequiredPermissionHolders({
      requiredKeys: new Set()
    });

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain("No module declares");
  });

  test("a check that cannot reach the database says so instead of passing", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const result = await checkMfaRequiredPermissionHolders({
        requiredKeys: new Set(["hr_fixture.runs.approve"])
      });

      expect(result.status).toBe("fail");
      expect(result.evidence).toContain("Could not verify");
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  test("the orchestrator runs both checks", async () => {
    const source = await Bun.file("scripts/security-readiness.ts").text();
    const start = source.indexOf(
      "export async function runSecurityReadinessChecks"
    );

    expect(start).toBeGreaterThan(-1);

    const body = source.slice(
      start,
      source.indexOf("function statusIcon", start)
    );

    expect(body).toContain(
      "checkMfaEnrolmentAvailableForRequiredPermissions()"
    );
    expect(body).toContain("checkMfaRequiredPermissionHolders()");
  });
});
