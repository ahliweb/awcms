/**
 * `bun run skills:check` — the rules, driven with planted inputs.
 *
 * The live skill set passing proves almost nothing: it passes today by
 * construction, because it was made to. What has to be proven is that each rule
 * FAILS on the defect it exists for — and this repo has three recorded cases of
 * a gate that answered "clean" for something dirty, or dirty for something
 * clean, and then had its wrong answer written up as a decision.
 *
 * So every rule below is exercised through its pure helper with inputs the
 * current repo does not contain, and the two directions are asserted separately.
 */
import { describe, expect, test } from "bun:test";

import {
  checkCitedAdrs,
  checkCitedPaths,
  checkCitedRunTargets,
  extractCitedAdrNumbers,
  extractCitedRunTargets,
  extractCitedSourcePaths,
  isKnownRunTarget,
  subjectModuleKey
} from "../scripts/skills-check";

const exists = (known: readonly string[]) => (candidate: string) =>
  known.includes(candidate);

describe("subject module resolution", () => {
  test.each([
    ["awcms-blog-content", "blog_content"],
    ["awcms-seo-distribution", "seo_distribution"],
    ["awcms-edge-cache", "edge_cache"]
  ])("%s → %s", (skill, expected) => {
    expect(subjectModuleKey(skill)).toBe(expected);
  });
});

describe("path extraction", () => {
  test("takes backticked src paths only", () => {
    const source = [
      "Prose about src/lib/whatever that is not a claim.",
      "But `src/lib/real.ts` is one.",
      "`src/modules/x/**` is a glob and `src/pages/` a bare prefix."
    ].join("\n");

    expect(extractCitedSourcePaths(source)).toEqual(["src/lib/real.ts"]);
  });

  test("deduplicates a path cited many times", () => {
    expect(extractCitedSourcePaths("`src/a.ts` then `src/a.ts` again")).toEqual(
      ["src/a.ts"]
    );
  });

  test("handles the bracketed route filenames Astro produces", () => {
    expect(
      extractCitedSourcePaths("`src/pages/admin/blog/[id].astro`")
    ).toEqual(["src/pages/admin/blog/[id].astro"]);
  });
});

describe("rule 1 — a live module's skill describes live code", () => {
  test("a missing path in a LIVE module's skill fails", () => {
    // The real defect this caught: four skills for shipped modules pointed at
    // `src/lib/<module>/…` after the files moved to
    // `src/modules/<module>/presentation/…`.
    const problems = checkCitedPaths(
      "awcms-seo-distribution",
      ["src/lib/seo/discovery-route.ts"],
      true,
      exists([])
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("IS in the module registry");
  });

  test("no exception list can rescue a live module's skill", () => {
    // `awcms-news-portal` IS listed as historical, but that only governs rule 3.
    // If its module ever returned to the registry, its paths would have to be
    // real — which is exactly what the dead-entry check downstream reports.
    const problems = checkCitedPaths(
      "awcms-news-portal",
      ["src/modules/news-portal/module.ts"],
      true,
      exists([])
    );

    expect(problems).toHaveLength(1);
  });

  test("a live module's skill whose paths all resolve passes", () => {
    expect(
      checkCitedPaths(
        "awcms-theming",
        ["src/modules/theming/presentation/theme-media.ts"],
        true,
        exists(["src/modules/theming/presentation/theme-media.ts"])
      )
    ).toEqual([]);
  });
});

describe("rule 3 — absent code must be declared", () => {
  test("an UNLISTED skill citing missing paths fails", () => {
    const problems = checkCitedPaths(
      "awcms-not-listed-anywhere",
      ["src/modules/invented/module.ts"],
      false,
      exists([])
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("ASPIRATIONAL_SKILLS");
  });

  test("a LISTED skill may cite missing paths", () => {
    expect(
      checkCitedPaths(
        "awcms-social-publishing",
        ["src/modules/social-publishing/module.ts"],
        false,
        exists([])
      )
    ).toEqual([]);
  });

  test("being listed does not require citing missing paths", () => {
    expect(
      checkCitedPaths("awcms-social-publishing", [], false, exists([]))
    ).toEqual([]);
  });
});

describe("rule 2 — cited ADRs exist", () => {
  test("extraction finds every reference and deduplicates", () => {
    expect(
      extractCitedAdrNumbers("ADR-0042 and ADR-0061, then ADR-0042 again")
    ).toEqual(["0042", "0061"]);
  });

  test("an ADR with no file fails", () => {
    const problems = checkCitedAdrs(
      "awcms-example",
      ["9999"],
      new Set(["0042"])
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("ADR-9999");
  });

  test("an ADR that exists passes", () => {
    expect(
      checkCitedAdrs("awcms-example", ["0042"], new Set(["0042"]))
    ).toEqual([]);
  });
});

describe("rule 4 — cited `bun run` targets are real or declared deferred", () => {
  const scripts = new Set(["check", "skills:check"]);

  test("extraction finds targets and deduplicates", () => {
    expect(
      extractCitedRunTargets(
        "run `bun run check` then `bun run skills:check`, then `bun run check`"
      )
    ).toEqual(["check", "skills:check"]);
  });

  test("a real target passes", () => {
    expect(isKnownRunTarget("check", scripts)).toBe(true);
  });

  test("a target declared deferred in scripts/README §Ditunda passes", () => {
    // `scripts/README.md` §Ditunda EXPLICITLY permits skills to name these, so
    // the rule must not re-litigate that policy.
    expect(isKnownRunTarget("production:preflight", scripts)).toBe(true);
    expect(isKnownRunTarget("performance:suite", scripts)).toBe(true);
    expect(isKnownRunTarget("i18n:extract", scripts)).toBe(true);
  });

  test("a pure ghost fails", () => {
    expect(isKnownRunTarget("github:snapshot:refresh", scripts)).toBe(false);

    const problems = checkCitedRunTargets(
      "awcms-github-snapshot",
      ["github:snapshot:refresh"],
      scripts,
      false
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("Ditunda");
  });

  test("an aspirational skill may name its future tooling", () => {
    expect(
      checkCitedRunTargets(
        "awcms-social-publishing",
        ["social-publishing:dispatch"],
        scripts,
        true
      )
    ).toEqual([]);
  });

  test("every deferred prefix is actually documented in scripts/README §Ditunda", async () => {
    // Binds the gate's explicit list back to the doc it claims to mirror. Without
    // this, the list could quietly grow into a way to silence the rule.
    const readme = await Bun.file("scripts/README.md").text();
    const deferredSection = readme.slice(readme.indexOf("## Ditunda"));

    for (const prefix of [
      "config:docs:check",
      "database:capacity:check",
      "i18n:",
      "modules:sync",
      "performance:",
      "production:preflight",
      "resilience:dr-drill"
    ]) {
      expect(deferredSection).toContain(prefix.replace(/:$/, ""));
    }
  });
});

describe("the live skill set", () => {
  test("skills:check passes against the repo as committed", async () => {
    // Weak on its own — see this file's header — but it is what makes the rules
    // above bind to reality rather than to a fixture.
    const result = Bun.spawnSync(["bun", "scripts/skills-check.ts"]);

    expect(result.exitCode).toBe(0);
  });
});
