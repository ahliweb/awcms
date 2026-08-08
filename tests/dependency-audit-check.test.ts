/**
 * `deps:audit:check` blocks on high/critical advisories, and the exception
 * list cannot rot.
 *
 * Pure evaluation against synthetic reports — no registry, no `bun audit` run.
 * The shapes below are copied from real `bun audit --json` output taken on
 * 2026-08-08, when the repo had three open `high` advisories and no gate.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateAudit,
  parseAuditOutput,
  type AuditReport
} from "../scripts/dependency-audit-check";
import {
  EXCEPTIONS,
  type AuditException
} from "../scripts/dependency-audit-exceptions";

const NANOID_URL = "https://github.com/advisories/GHSA-2v37-7h3g-55p8";
const JSYAML_URL = "https://github.com/advisories/GHSA-5p4m-2wfm-xmqj";

/** The exact report shape that was open on `main` before the gate landed. */
const REAL_REPORT: AuditReport = {
  "js-yaml": [
    {
      id: 1138114,
      url: JSYAML_URL,
      title: "JS-YAML: Quadratic CPU consumption in !!omap resolution",
      severity: "high",
      vulnerable_versions: ">=3.0.0 <3.15.1"
    },
    {
      id: 1138115,
      url: JSYAML_URL,
      title: "JS-YAML: Quadratic CPU consumption in !!omap resolution",
      severity: "high",
      vulnerable_versions: ">=4.0.0 <4.3.1"
    }
  ],
  nanoid: [
    {
      id: 1138813,
      url: NANOID_URL,
      title:
        "nanoid: custom generators can loop indefinitely when size is zero",
      severity: "high",
      vulnerable_versions: "<3.3.17"
    }
  ]
};

describe("evaluateAudit", () => {
  test("a clean report passes", () => {
    const result = evaluateAudit({}, []);

    expect(result.ok).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });

  test("the three advisories that were actually open on main all block", () => {
    const result = evaluateAudit(REAL_REPORT, []);

    expect(result.ok).toBe(false);
    expect(result.blocking).toHaveLength(3);
    expect(result.violations.join("\n")).toContain("nanoid");
    expect(result.violations.join("\n")).toContain("js-yaml");
  });

  test("moderate and low are reported but never block", () => {
    const result = evaluateAudit(
      {
        "some-dev-tool": [
          {
            id: 1,
            url: "https://example.invalid/a",
            title: "moderate thing",
            severity: "moderate",
            vulnerable_versions: "<1.0.0"
          },
          {
            id: 2,
            url: "https://example.invalid/b",
            title: "low thing",
            severity: "low",
            vulnerable_versions: "<1.0.0"
          }
        ]
      },
      []
    );

    expect(result.ok).toBe(true);
    expect(result.informational).toHaveLength(2);
  });

  test("an exception suppresses exactly its own advisory, not the package", () => {
    const exception: AuditException = {
      packageName: "js-yaml",
      advisoryUrl: JSYAML_URL,
      reason: "uji",
      owner: "uji",
      reviewDate: "2027-01-01"
    };

    const result = evaluateAudit(REAL_REPORT, [exception]);

    // Both js-yaml rows share the GHSA, so both are suppressed; nanoid is a
    // different advisory and MUST still block. An exception that silenced the
    // whole package would be the bug this asserts against.
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.packageName).toBe("nanoid");
    expect(result.ok).toBe(false);
  });

  test("an exception matching nothing FAILS the gate as stale", () => {
    const stale: AuditException = {
      packageName: "long-since-fixed",
      advisoryUrl: "https://example.invalid/gone",
      reason: "uji",
      owner: "uji",
      reviewDate: "2027-01-01"
    };

    const result = evaluateAudit({}, [stale]);

    expect(result.ok).toBe(false);
    expect(result.staleExceptions).toHaveLength(1);
    expect(result.violations.join("\n")).toContain("pengecualian usang");
  });
});

describe("parseAuditOutput", () => {
  test("skips the banner lines bun writes before the JSON", () => {
    const parsed = parseAuditOutput('[0.05ms] ".env"\nbun audit v1.3.14\n{}');

    expect(parsed).toEqual({});
  });

  test("throws on empty output rather than reporting clean", () => {
    // The 'could not run' case. Returning {} here would make an unreachable
    // registry indistinguishable from a clean audit — the whole point of the
    // gate failing closed.
    expect(() => parseAuditOutput("   ")).toThrow();
  });

  test("throws on non-JSON output", () => {
    expect(() => parseAuditOutput("error: network unreachable")).toThrow();
  });
});

describe("the shipped exception list", () => {
  test("is empty — every advisory is closed by an override instead", () => {
    // Not style: an empty list makes the next exception the only entry, so it
    // cannot be added without a reviewer seeing it. Same reasoning ADR-0058
    // settled for the permission-enforcement gate.
    expect(EXCEPTIONS).toHaveLength(0);
  });

  test("any future entry must carry reason, owner, and reviewDate", () => {
    for (const entry of EXCEPTIONS) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.owner.length).toBeGreaterThan(0);
      expect(entry.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
