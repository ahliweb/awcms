/**
 * How the weekly freshness report treats transitive held-back entries
 * (Issue #1367): their latest comes from the registry, never from
 * `bun outdated` (which lists direct dependencies only).
 */
import { describe, expect, test } from "bun:test";

import {
  buildManifest,
  evaluateHeldBack,
  type Section
} from "../scripts/dependency-freshness";
import type { HeldBackEntry } from "../scripts/dependency-held-back";

const ok = <T>(data: T): Section<T> => ({ status: "ok", data });

const transitive: HeldBackEntry = {
  packageName: "@astrojs/compiler-rs",
  transitive: true,
  heldVersion: "0.5.2",
  reason: "0.5.3 binding crashes without AVX",
  releaseCondition: "A binding release that runs on the x86-64 baseline.",
  owner: "ahliweb",
  reviewDate: "2099-01-01"
};

const latestOf = (value: string | undefined) => () => value;

describe("transitive held-back entries", () => {
  test("a newer release is flagged for a release-condition check, not failed", () => {
    const result = evaluateHeldBack(
      [transitive],
      "2026-11-22",
      latestOf("0.5.4")
    )[0];

    expect(result?.status).toBe("active");
    expect(result?.note).toContain(
      "check whether the release condition is met"
    );
    expect(result?.note).toContain("x86-64 baseline");
  });

  test("an unreachable registry is unverified; a hold no longer behind is stale", () => {
    expect(
      evaluateHeldBack([transitive], "2026-11-22", latestOf(undefined))[0]
        ?.status
    ).toBe("unverified");
    expect(
      evaluateHeldBack([transitive], "2026-11-22", latestOf("0.5.2"))[0]?.status
    ).toBe("stale");
  });

  test("buildManifest uses the registry value for the real transitive entry", () => {
    const manifest = buildManifest({
      generatedAt: "2026-11-22T00:00:00.000Z",
      bunVersionUsed: "1.4.4",
      // Empty on purpose: `bun outdated` would read "current" -> stale.
      outdated: ok({ directDependencyCount: 10, rows: [] }),
      advisories: ok({
        blocking: [],
        informationalCount: 0,
        exceptionCount: 0,
        bySeverity: {}
      }),
      bun: ok({ pinned: "1.4.4", latest: "1.4.4", drift: "current" as const }),
      images: [],
      transitiveLatest: { "@astrojs/compiler-rs": "99.0.0" }
    });
    const row = manifest.heldBack.find(
      (entry) => entry.entry.packageName === "@astrojs/compiler-rs"
    );

    expect(row?.status).toBe("active");
    expect(row?.latest).toBe("99.0.0");
  });
});
