/**
 * The payroll DPIA-addendum go-live gate (Issue #1449).
 *
 * Every control here is tested by breaking it: the module-key list, the env
 * shape, the artifact checks, the template coherence in both languages, and the
 * two enforcement points (`enableTenantModule` and the chokepoint source).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listModules } from "../src/modules";
import {
  PAYROLL_ADDENDUM_DIRECTORY,
  PAYROLL_ADDENDUM_GATED_MODULE_KEYS,
  PAYROLL_ADDENDUM_REQUIRED_SECTIONS,
  evaluatePayrollAddendumRequirement,
  parsePayrollAddendumGateRecord,
  payrollAddendumArtifactProblems,
  readPayrollAddendumFromEnv
} from "../src/modules/_shared/payroll-dpia-addendum-gate";
import {
  checkPayrollAddendumArtifact,
  sha256Hex
} from "../scripts/lib/payroll-addendum-artifact";
import { checkPayrollAddendumOnRecord } from "../scripts/security-readiness";
import { validateEnv } from "../scripts/validate-env";

const NOW = new Date("2026-11-23T00:00:00.000Z");
const SHA = "a".repeat(64);
const goodEnv = {
  HR_PAYROLL_DPIA_ADDENDUM_REF: "acme-prod-2026",
  HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON: "2026-11-20",
  HR_PAYROLL_DPIA_ADDENDUM_SHA256: SHA
};

const TEMPLATE = readFileSync(
  "docs/awcms/dpia-addendum-hr-payroll-template.md",
  "utf8"
);
const TEMPLATE_ID = readFileSync(
  "docs/awcms/dpia-addendum-hr-payroll-template.id.md",
  "utf8"
);

/** The template completed the way a controller would. */
function completed(source: string, approvedOn = "2026-11-20"): string {
  return source
    .replace(/- status: draft/, "- status: approved")
    .replace(/- o5-outcome: .*/, "- o5-outcome: A")
    .replace(/- approved-on: .*/, `- approved-on: ${approvedOn}`)
    .replace(
      /- controller-signed-by: .*/,
      "- controller-signed-by: A. Person, director"
    )
    .replace(/- controller-signed-on: .*/, "- controller-signed-on: 2026-11-19")
    .replace(/- counsel-reviewed-on: .*/, "- counsel-reviewed-on: 2026-11-18")
    .replace(/\[\[[^\]]*\]\]/g, "filled");
}

function problemsFor(markdown: string, approvedOn = "2026-11-20"): string[] {
  return payrollAddendumArtifactProblems({
    markdown,
    actualSha256: SHA,
    expected: { ref: "acme-prod-2026", approvedOn, sha256: SHA }
  });
}

describe("the gated module list", () => {
  test("hr_payroll is gated and an ordinary module is not", () => {
    expect(PAYROLL_ADDENDUM_GATED_MODULE_KEYS).toContain("hr_payroll");
    expect(
      evaluatePayrollAddendumRequirement("hr_payroll", {}, NOW)
    ).not.toBeNull();
    expect(
      evaluatePayrollAddendumRequirement("tenant_admin", {}, NOW)
    ).toBeNull();
  });

  test("a registered module key that mentions payroll is gated (a rename cannot escape)", () => {
    const escaped = listModules()
      .map((descriptor) => descriptor.key)
      .filter(
        (key) =>
          /payroll/.test(key) &&
          !PAYROLL_ADDENDUM_GATED_MODULE_KEYS.includes(key)
      );

    expect(escaped).toEqual([]);
  });
});

describe("env shape (runtime half)", () => {
  test("no variable set: refused, and not 'configured'", () => {
    const result = readPayrollAddendumFromEnv({}, NOW);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.configured).toBe(false);
    expect(
      evaluatePayrollAddendumRequirement("hr_payroll", {}, NOW)?.matchedPolicy
    ).toBe("payroll_dpia_addendum_required");
  });

  test("all three well formed: allowed", () => {
    expect(
      evaluatePayrollAddendumRequirement("hr_payroll", goodEnv, NOW)
    ).toBeNull();
  });

  test.each([
    ["ref missing", { HR_PAYROLL_DPIA_ADDENDUM_REF: "" }],
    ["ref has a path separator", { HR_PAYROLL_DPIA_ADDENDUM_REF: "../x" }],
    ["ref uppercase", { HR_PAYROLL_DPIA_ADDENDUM_REF: "Acme-Prod" }],
    ["date not a date", { HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON: "2026-13-40" }],
    [
      "date in the future",
      { HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON: "2026-11-24" }
    ],
    ["digest too short", { HR_PAYROLL_DPIA_ADDENDUM_SHA256: "abc" }],
    ["digest uppercase", { HR_PAYROLL_DPIA_ADDENDUM_SHA256: "A".repeat(64) }]
  ])("%s: refused", (_label, override) => {
    expect(
      evaluatePayrollAddendumRequirement(
        "hr_payroll",
        { ...goodEnv, ...override },
        NOW
      )
    ).not.toBeNull();
  });

  test("config:validate rejects a half-set group and accepts none or all", () => {
    const base = {
      APP_ENV: "development",
      APP_URL: "http://localhost:4321",
      DATABASE_URL: "postgres://awcms:awcms_password@localhost:5432/awcms"
    };

    expect(validateEnv(base)).toEqual([]);
    expect(
      validateEnv({
        ...base,
        HR_PAYROLL_DPIA_ADDENDUM_REF: "acme-prod-2026"
      }).some((p) => p.startsWith("Payroll DPIA addendum"))
    ).toBe(true);
    expect(validateEnv({ ...base, ...goodEnv })).toEqual([]);
  });
});

describe("artifact (deploy-time half)", () => {
  test("a completed copy of the template, in both languages, passes", () => {
    expect(problemsFor(completed(TEMPLATE))).toEqual([]);
    expect(problemsFor(completed(TEMPLATE_ID))).toEqual([]);
  });

  test("the template itself never passes (draft and unfilled)", () => {
    expect(problemsFor(TEMPLATE).length).toBeGreaterThan(0);
    expect(problemsFor(TEMPLATE_ID).length).toBeGreaterThan(0);
  });

  test("the template carries exactly the sections the gate requires, in both languages", () => {
    for (const source of [TEMPLATE, TEMPLATE_ID]) {
      const found = [
        ...source.matchAll(/<!-- addendum-section: ([a-z0-9-]+) -->/g)
      ].map((match) => match[1]);

      expect(found.sort()).toEqual(
        [...PAYROLL_ADDENDUM_REQUIRED_SECTIONS].sort()
      );
    }
  });

  test("the gate record parses in both languages", () => {
    expect(
      parsePayrollAddendumGateRecord(completed(TEMPLATE))["o5-outcome"]
    ).toBe("A");
    expect(
      parsePayrollAddendumGateRecord(completed(TEMPLATE_ID))["o5-outcome"]
    ).toBe("A");
  });

  test.each([
    [
      "status draft",
      (s: string) => s.replace("- status: approved", "- status: draft")
    ],
    [
      "o5 outcome undecided",
      (s: string) => s.replace("- o5-outcome: A", "- o5-outcome: C")
    ],
    [
      "no signatory",
      (s: string) =>
        s.replace(/- controller-signed-by: .*/, "- controller-signed-by: TBD")
    ],
    [
      "no counsel date",
      (s: string) =>
        s.replace(/- counsel-reviewed-on: .*/, "- counsel-reviewed-on: ")
    ],
    [
      "bad signed date",
      (s: string) =>
        s.replace(
          "- controller-signed-on: 2026-11-19",
          "- controller-signed-on: yesterday"
        )
    ],
    [
      "a section deleted",
      (s: string) => s.replace("<!-- addendum-section: retention -->", "")
    ],
    ["a leftover marker", (s: string) => `${s}\nnote [[fill me]]\n`],
    [
      "approved-on differs from the env",
      (s: string) =>
        s.replace("- approved-on: 2026-11-20", "- approved-on: 2026-11-21")
    ]
  ])("%s: refused", (_label, mutate) => {
    expect(problemsFor(mutate(completed(TEMPLATE))).length).toBeGreaterThan(0);
  });

  test("a changed file no longer matches the recorded digest", () => {
    const problems = payrollAddendumArtifactProblems({
      markdown: completed(TEMPLATE),
      actualSha256: "b".repeat(64),
      expected: { ref: "acme-prod-2026", approvedOn: "2026-11-20", sha256: SHA }
    });

    expect(problems.some((p) => p.includes("changed after approval"))).toBe(
      true
    );
  });

  test("end to end on a real directory: off, missing file, then approved", async () => {
    const root = mkdtempSync(join(tmpdir(), "payroll-addendum-"));

    mkdirSync(join(root, PAYROLL_ADDENDUM_DIRECTORY), { recursive: true });
    expect(
      (await checkPayrollAddendumArtifact({}, { root, now: NOW })).state
    ).toBe("off");

    const missing = await checkPayrollAddendumArtifact(goodEnv, {
      root,
      now: NOW
    });

    expect(missing.state).toBe("invalid");

    const text = completed(TEMPLATE);

    writeFileSync(
      join(root, PAYROLL_ADDENDUM_DIRECTORY, "acme-prod-2026.md"),
      text
    );

    const digest = sha256Hex(new TextEncoder().encode(text));
    const env = { ...goodEnv, HR_PAYROLL_DPIA_ADDENDUM_SHA256: digest };

    expect(
      (await checkPayrollAddendumArtifact(env, { root, now: NOW })).state
    ).toBe("approved");

    // Edit after approval: the same env is now refused.
    writeFileSync(
      join(root, PAYROLL_ADDENDUM_DIRECTORY, "acme-prod-2026.md"),
      `${text}\nedited\n`
    );
    expect(
      (await checkPayrollAddendumArtifact(env, { root, now: NOW })).state
    ).toBe("invalid");
  });
});

describe("security:readiness check", () => {
  test("payroll off with no enabled row passes; with an enabled row fails", async () => {
    const off = await checkPayrollAddendumOnRecord(
      {},
      { listEnabledRows: async () => 0 }
    );
    const leaked = await checkPayrollAddendumOnRecord(
      {},
      { listEnabledRows: async () => 2 }
    );

    expect(off.status).toBe("pass");
    expect(leaked.status).toBe("fail");
    expect(leaked.severity).toBe("critical");
  });

  test("a half-set group fails", async () => {
    const result = await checkPayrollAddendumOnRecord(
      { HR_PAYROLL_DPIA_ADDENDUM_REF: "acme-prod-2026" },
      { listEnabledRows: async () => 0 }
    );

    expect(result.status).toBe("fail");
  });
});

describe("enforcement points", () => {
  test("the chokepoint refuses a gated module before permissions are looked up", () => {
    const source = readFileSync(
      "src/modules/identity-access/application/access-guard.ts",
      "utf8"
    );
    const gate = source.indexOf("evaluatePayrollAddendumRequirement(");
    const permissions = source.indexOf("fetchGrantedPermissionKeys(");

    expect(gate).toBeGreaterThan(-1);
    // The refusal is unconditional on anything but the denial itself: a
    // `false &&` or an extra tenant exemption in front of it must fail here.
    expect(source).toMatch(
      /if \(addendumDenial\) \{[\s\S]*?denied: fail\(403, "PAYROLL_DPIA_ADDENDUM_REQUIRED"/
    );
    expect(source).toMatch(
      /evaluatePayrollAddendumRequirement\(\s*guard\.moduleKey,\s*process\.env\s*\)/
    );
    expect(gate).toBeLessThan(permissions);
  });

  test("the enable path refuses before it writes", () => {
    const source = readFileSync(
      "src/modules/module-management/application/tenant-module-lifecycle.ts",
      "utf8"
    );
    const gate = source.indexOf("evaluatePayrollAddendumRequirement(");
    const write = source.indexOf("INSERT INTO awcms_tenant_modules");

    expect(gate).toBeGreaterThan(-1);
    expect(source).toMatch(
      /if \(addendumDenial\) \{\s*return \{\s*outcome: "rejected"/
    );
    expect(gate).toBeLessThan(write);
  });
});
