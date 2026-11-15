/**
 * `deps:license:check` (Issue #1173): every rule is proved in BOTH directions —
 * the clean input passes, and the specific breakage turns it red.
 */
import { describe, expect, test } from "bun:test";

import {
  buildCycloneDx,
  declaredLicense,
  evaluateLicenses,
  exceptionMatches,
  expressionAllowed,
  installPathOf,
  licenseFindings,
  parseBunLock,
  parseJsonc,
  parseRootDependencies,
  purlOf,
  requiredReachable,
  resolveDependencyKey,
  type LockPackage
} from "../scripts/dependency-license-check";
import {
  ALLOWED_LICENSES,
  LICENSE_EXCEPTIONS,
  type LicenseException
} from "../scripts/dependency-license-policy";

const ALLOWED = new Set(["MIT", "ISC", "Apache-2.0", "BSD-3-Clause"]);

const LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "demo",
      "dependencies": { "a": "^1.0.0", },
      "devDependencies": { "@s/b": "^2.0.0", },
    },
  },
  "packages": {
    "@s/b": ["@s/b@2.0.0", "", { "dependencies": { "c": "^1.0.0" } }, "sha512-AAAA"],
    "a": ["a@1.0.0", "", { "dependencies": { "c": "^2.0.0" }, "optionalDependencies": { "a-linux": "1.0.0" } }, "sha512-BBBB"],
    "a-linux": ["a-linux@1.0.0", "", { "os": "linux", "cpu": "x64" }, "sha512-CCCC"],
    "a/c": ["c@2.0.0", "", {}, "sha512-DDDD"],
    "c": ["c@1.0.0", "", {}, "sha512-EEEE"],
  }
}`;

function installed(map: Record<string, unknown>) {
  return (installPath: string) => map[installPath];
}

const ALL_MIT = installed({
  "node_modules/a": { license: "MIT" },
  "node_modules/@s/b": { license: "ISC" },
  "node_modules/a/node_modules/c": { license: "MIT" },
  "node_modules/c": { license: "Apache-2.0" }
});

function evaluate(
  readPackageJson: (p: string) => unknown | undefined,
  exceptions: readonly LicenseException[] = [],
  today = "2026-11-14"
) {
  return evaluateLicenses({
    packages: parseBunLock(LOCK),
    rootDependencies: parseRootDependencies(LOCK),
    readPackageJson,
    allowed: [...ALLOWED],
    exceptions,
    today
  });
}

describe("bun.lock parsing", () => {
  test("accepts trailing commas but not a comma inside a string", () => {
    expect(parseJsonc('{"a": ["x,}", 1,],}')).toEqual({ a: ["x,}", 1] });
    // An escaped quote does not end the string, so a `,]` after it is still text.
    expect(parseJsonc('{"a": "x\\",]", "b": 1,}')).toEqual({
      a: 'x",]',
      b: 1
    });
  });

  test("reads name, version, integrity, edges and platform constraint", () => {
    const packages = parseBunLock(LOCK);
    const nested = packages.find((p) => p.key === "a/c") as LockPackage;
    const platform = packages.find((p) => p.key === "a-linux") as LockPackage;
    const a = packages.find((p) => p.key === "a") as LockPackage;

    expect(nested).toMatchObject({ name: "c", version: "2.0.0" });
    expect(platform.platformSpecific).toBe(true);
    expect(a.platformSpecific).toBe(false);
    expect(a.optionalDependencies).toEqual(["a-linux"]);
    expect(a.integrity).toBe("sha512-BBBB");
    expect(parseRootDependencies(LOCK)).toEqual(["@s/b", "a"]);
  });

  test("a lock with no packages object is rejected, not read as empty", () => {
    expect(() => parseBunLock('{"lockfileVersion": 1}')).toThrow();
  });

  test("install paths are scope-aware and nest per segment", () => {
    expect(installPathOf("astro")).toBe("node_modules/astro");
    expect(installPathOf("@s/b")).toBe("node_modules/@s/b");
    expect(installPathOf("a/c")).toBe("node_modules/a/node_modules/c");
    expect(installPathOf("@s/b/c")).toBe("node_modules/@s/b/node_modules/c");
  });

  test("a dependency resolves to the nearest enclosing install", () => {
    const keys = new Set(parseBunLock(LOCK).map((p) => p.key));

    expect(resolveDependencyKey("a", "c", keys)).toBe("a/c");
    expect(resolveDependencyKey("@s/b", "c", keys)).toBe("c");
    expect(resolveDependencyKey("", "a", keys)).toBe("a");
    expect(resolveDependencyKey("a", "missing", keys)).toBeNull();
  });

  test("required reachability stops at an optional edge", () => {
    const reachable = requiredReachable(parseBunLock(LOCK), ["a", "@s/b"]);

    expect(reachable.has("a/c")).toBe(true);
    expect(reachable.has("a-linux")).toBe(false);
  });
});

describe("license expressions", () => {
  test("a single allowed identifier passes, an unlisted one fails", () => {
    expect(expressionAllowed("MIT", ALLOWED)).toBe(true);
    expect(expressionAllowed("GPL-3.0-only", ALLOWED)).toBe(false);
  });

  test("OR passes when any side is allowed; AND needs both", () => {
    expect(expressionAllowed("(GPL-3.0-only OR MIT)", ALLOWED)).toBe(true);
    expect(expressionAllowed("GPL-3.0-only OR AGPL-3.0-only", ALLOWED)).toBe(
      false
    );
    expect(expressionAllowed("MIT AND ISC", ALLOWED)).toBe(true);
    expect(expressionAllowed("MIT AND GPL-3.0-only", ALLOWED)).toBe(false);
    expect(expressionAllowed("(MIT AND ISC) OR GPL-3.0-only", ALLOWED)).toBe(
      true
    );
  });

  test("WITH is part of the license: it is not stripped to its base", () => {
    expect(expressionAllowed("MIT WITH Classpath-exception-2.0", ALLOWED)).toBe(
      false
    );
    expect(
      expressionAllowed(
        "MIT WITH Classpath-exception-2.0",
        new Set(["MIT WITH Classpath-exception-2.0"])
      )
    ).toBe(true);
  });

  test("anything it cannot parse is refused", () => {
    for (const bad of ["", "MIT OR", "(MIT", "MIT)", "OR MIT", "MIT MIT"]) {
      expect(expressionAllowed(bad, ALLOWED), bad).toBe(false);
    }
  });

  test("package.json license shapes, including the legacy ones", () => {
    expect(declaredLicense({ license: "MIT" })).toBe("MIT");
    expect(declaredLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(
      declaredLicense({ licenses: [{ type: "MIT" }, { type: "ISC" }] })
    ).toBe("(MIT OR ISC)");
    expect(declaredLicense({ license: "" })).toBeNull();
    expect(declaredLicense({})).toBeNull();
    expect(declaredLicense(null)).toBeNull();
  });
});

describe("evaluation", () => {
  test("a tree of allowed licenses is clean", () => {
    const report = evaluate(ALL_MIT);

    expect(report.failures).toEqual([]);
    expect(report.notInstalled).toEqual(["a-linux@1.0.0"]);
    expect(report.byLicense).toEqual({ MIT: 2, ISC: 1, "Apache-2.0": 1 });
  });

  test("a license outside the allow-list fails, naming package and license", () => {
    const report = evaluate((p) =>
      p === "node_modules/c" ? { license: "GPL-3.0-only" } : ALL_MIT(p)
    );

    expect(report.violations).toEqual(["c@1.0.0: GPL-3.0-only"]);
    expect(report.failures.join("\n")).toContain("outside the allow-list");
  });

  test("an unreadable license is UNKNOWN and fails, never counted as fine", () => {
    const noField = evaluate((p) => (p === "node_modules/c" ? {} : ALL_MIT(p)));

    expect(noField.unreadable[0]).toContain("no license field");
    expect(noField.failures.length).toBeGreaterThan(0);

    const missing = evaluate((p) =>
      p === "node_modules/c" ? undefined : ALL_MIT(p)
    );

    expect(missing.unreadable[0]).toContain("not found at");
    expect(missing.failures.length).toBeGreaterThan(0);
  });

  test("a required package that is absent from disk is not excused as platform-specific", () => {
    const report = evaluate(() => undefined);

    // a-linux alone is excused; the four required packages are not.
    expect(report.unreadable).toHaveLength(4);
    expect(report.notInstalled).toEqual(["a-linux@1.0.0"]);
  });

  test("a reasoned exception admits exactly its package and license", () => {
    const exception: LicenseException = {
      packageName: "c",
      license: "GPL-3.0-only",
      reason: "r",
      owner: "o",
      reviewDate: "2027-01-01"
    };
    const read = (p: string) =>
      p === "node_modules/c" ? { license: "GPL-3.0-only" } : ALL_MIT(p);

    expect(evaluate(read, [exception]).failures).toEqual([]);

    // The package changed license: the exception no longer covers it.
    const changed = (p: string) =>
      p === "node_modules/c" ? { license: "AGPL-3.0-only" } : ALL_MIT(p);

    expect(evaluate(changed, [exception]).violations).toEqual([
      "c@1.0.0: AGPL-3.0-only"
    ]);
  });

  test("an exception that matches nothing is stale and fails", () => {
    const report = evaluate(ALL_MIT, [
      {
        packageName: "gone",
        license: "GPL-3.0-only",
        reason: "r",
        owner: "o",
        reviewDate: "2027-01-01"
      }
    ]);

    expect(report.staleExceptions).toHaveLength(1);
    expect(report.failures.join("\n")).toContain("stale license exception");
  });

  test("an exception past its review date fails; the day before it does not", () => {
    const exception: LicenseException = {
      packageName: "c",
      license: "GPL-3.0-only",
      reason: "r",
      owner: "o",
      reviewDate: "2026-11-14"
    };
    const read = (p: string) =>
      p === "node_modules/c" ? { license: "GPL-3.0-only" } : ALL_MIT(p);

    expect(evaluate(read, [exception], "2026-11-14").failures).toEqual([]);
    expect(
      evaluate(read, [exception], "2026-11-15").expiredExceptions
    ).toHaveLength(1);
  });

  test("a family exception also counts as used when only platform variants exist", () => {
    const report = evaluate(ALL_MIT, [
      {
        packageName: "a-*",
        license: "LGPL-3.0-or-later",
        reason: "r",
        owner: "o",
        reviewDate: "2027-01-01"
      }
    ]);

    expect(report.staleExceptions).toEqual([]);
  });

  test("an exception satisfied only by an INSTALLED package that is already allowed is stale", () => {
    // `c` is installed and MIT: nothing needed the exception, and only a
    // package that is NOT installed (a platform variant) may keep one alive.
    const report = evaluate(ALL_MIT, [
      {
        packageName: "c",
        license: "GPL-3.0-only",
        reason: "r",
        owner: "o",
        reviewDate: "2027-01-01"
      }
    ]);

    expect(report.staleExceptions).toHaveLength(1);
    expect(report.failures.join("\n")).toContain("stale license exception");
  });

  test("a review date must be a real date and near, or the exception never expires", () => {
    const exception = (reviewDate: string): LicenseException => ({
      packageName: "c",
      license: "GPL-3.0-only",
      reason: "r",
      owner: "o",
      reviewDate
    });
    const read = (p: string) =>
      p === "node_modules/c" ? { license: "GPL-3.0-only" } : ALL_MIT(p);

    for (const bad of [
      "never",
      "+002027-01-01",
      "9999-12-31",
      "2026-13-45",
      "",
      "2099-01-01"
    ]) {
      const report = evaluate(read, [exception(bad)], "2026-11-14");

      expect(report.invalidExceptions).toHaveLength(1);
      expect(report.failures.join("\n")).toContain("invalid license exception");
    }

    expect(
      evaluate(read, [exception("2027-11-14")], "2026-11-14").failures
    ).toEqual([]);
  });

  test("no copyleft license is allowed globally: each is a dated exception", () => {
    expect(ALLOWED_LICENSES).not.toContain("MPL-2.0");
    expect(ALLOWED_LICENSES.some((id) => /GPL|MPL|EPL|CDDL/.test(id))).toBe(
      false
    );
  });

  test("prefix matching is a prefix, not a substring", () => {
    const exception: LicenseException = {
      packageName: "@img/sharp-libvips-*",
      license: "LGPL-3.0-or-later",
      reason: "r",
      owner: "o",
      reviewDate: "2027-01-01"
    };

    expect(
      exceptionMatches(
        exception,
        "@img/sharp-libvips-linux-x64",
        "LGPL-3.0-or-later"
      )
    ).toBe(true);
    expect(
      exceptionMatches(
        exception,
        "evil/@img/sharp-libvips-x",
        "LGPL-3.0-or-later"
      )
    ).toBe(false);
    expect(
      exceptionMatches(
        exception,
        "@img/sharp-libvips-linux-x64",
        "GPL-3.0-only"
      )
    ).toBe(false);
  });

  test("findings carry stable keys and no volatile numbers", () => {
    const read = (p: string) =>
      p === "node_modules/c" ? { license: "GPL-3.0-only" } : ALL_MIT(p);
    const first = licenseFindings(evaluate(read, [], "2026-11-14"));
    const later = licenseFindings(evaluate(read, [], "2027-03-01"));

    expect(first.findings.map((f) => f.key)).toEqual(["license:violation:c"]);
    expect(later.findings.map((f) => f.key)).toEqual(
      first.findings.map((f) => f.key)
    );
  });
});

describe("the repository's own policy", () => {
  test("every exception has a reason, an owner, a valid date and a license outside the allow-list", () => {
    for (const exception of LICENSE_EXCEPTIONS) {
      expect(exception.reason.length, exception.packageName).toBeGreaterThan(
        60
      );
      expect(exception.owner.trim()).not.toBe("");
      expect(exception.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ALLOWED_LICENSES).not.toContain(exception.license);
    }
  });

  test("no copyleft licence stronger than MPL-2.0 is allow-listed", () => {
    for (const license of ALLOWED_LICENSES) {
      expect(license).not.toMatch(/GPL|SSPL|EUPL|CPAL|OSL/);
    }
  });
});

describe("CycloneDX", () => {
  const packages = parseBunLock(LOCK);
  const report = evaluate(ALL_MIT);
  const bom = buildCycloneDx({
    root: { name: "demo", version: "1.0.0" },
    rootDependencies: ["a", "@s/b"],
    components: report.components,
    generatedAt: "2026-11-14T00:00:00.000Z"
  }) as {
    bomFormat: string;
    specVersion: string;
    components: Record<string, unknown>[];
    dependencies: { ref: string; dependsOn: string[] }[];
  };

  test("is a 1.6 BOM with one component per lock entry", () => {
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.6");
    expect(bom.components).toHaveLength(packages.length);
  });

  test("purls encode scopes; integrity becomes a SHA-512 hash", () => {
    expect(purlOf("@s/b", "2.0.0")).toBe("pkg:npm/%40s/b@2.0.0");

    const scoped = bom.components.find((c) => c.name === "@s/b") as {
      hashes: { alg: string; content: string }[];
      licenses: unknown[];
    };

    expect(scoped.hashes[0]?.alg).toBe("SHA-512");
    expect(scoped.licenses).toEqual([{ license: { id: "ISC" } }]);
  });

  test("an unverified component is marked, not given an invented license", () => {
    const platform = bom.components.find((c) => c.name === "a-linux") as {
      licenses?: unknown;
      properties: { name: string }[];
    };

    expect(platform.licenses).toBeUndefined();
    expect(platform.properties.map((p) => p.name)).toContain(
      "awcms:license-unverified"
    );
  });

  test("dependency edges follow nesting, and every ref resolves to a component", () => {
    const refs = new Set(bom.components.map((c) => c["bom-ref"] as string));
    const a = bom.dependencies.find((d) => d.ref.includes("#a"));

    expect(a?.dependsOn.some((ref) => ref.endsWith("c@2.0.0#a/c"))).toBe(true);

    for (const edge of bom.dependencies.slice(1)) {
      for (const target of edge.dependsOn) {
        expect(refs.has(target), target).toBe(true);
      }
    }
  });
});
