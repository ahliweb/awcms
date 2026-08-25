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
  adminPageExists,
  checkCitedAdminPaths,
  checkCitedAdrs,
  checkCitedPaths,
  checkCitedRunTargets,
  extractCitedAdrNumbers,
  extractCitedRunTargets,
  extractCitedAdminPaths,
  extractCitedSourcePaths,
  isKnownRunTarget,
  moduleReadmePaths,
  skillSourcePaths,
  stripAspirationalBlocks,
  stripHistoricalBlocks,
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

  test("a target declared deferred in scripts/README §Deferred passes", () => {
    // `scripts/README.md` §Deferred EXPLICITLY permits skills to name these, so
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
    expect(problems[0]!.message).toContain("Deferred");
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

  test("every deferred prefix is actually documented in scripts/README §Deferred", async () => {
    // Binds the gate's explicit list back to the doc it claims to mirror. Without
    // this, the list could quietly grow into a way to silence the rule.
    const readme = await Bun.file("scripts/README.md").text();
    const deferredSection = readme.slice(readme.indexOf("## Deferred"));

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

/**
 * The two holes the assessment of 4 August 2026 §9.6 found in this gate.
 *
 * Both are cases where rule 1 silently narrowed itself, and neither was written
 * down anywhere — which is the part that matters: a gate that answers a
 * narrower question than its documentation claims trains its readers to trust
 * an answer it is not giving.
 */
describe("§9.6 — line-wrapped paths are still claims", () => {
  test("a path broken across lines by markdown wrapping is extracted", () => {
    // Prettier produces exactly this when the line runs long, and it is how
    // `src/lib/config/registry.ts` sat in `awcms-production-preflight` — a file
    // that has never existed here — inside a skill that is NOT exempt.
    const wrapped = "… didorong oleh `src/lib/config/\nregistry.ts`'s field.";

    expect(extractCitedSourcePaths(wrapped)).toEqual([
      "src/lib/config/registry.ts"
    ]);
  });

  test("the single-line form is unchanged", () => {
    expect(
      extractCitedSourcePaths("see `src/lib/security/security-headers.ts` here")
    ).toEqual(["src/lib/security/security-headers.ts"]);
  });

  test("normalising whitespace does not invent a path out of prose", () => {
    // The join must not reach across a code span boundary and glue two
    // unrelated spans into one plausible-looking path.
    expect(
      extractCitedSourcePaths("`src/a.ts` and then `src/b.ts`").sort()
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("§9.6 — the aspirational exemption is scoped to a block", () => {
  const body = [
    "Gated prose cites `src/real.ts`.",
    "<!-- aspirational:mulai -->",
    "Target spec cites `src/imaginary.ts` and `bun run never:existed`.",
    "<!-- aspirational:selesai -->",
    "More gated prose cites `src/also-real.ts`."
  ].join("\n");

  test("paths inside the block are not treated as claims", () => {
    expect(
      extractCitedSourcePaths(stripAspirationalBlocks(body)).sort()
    ).toEqual(["src/also-real.ts", "src/real.ts"]);
  });

  test("commands inside the block are not treated as instructions", () => {
    expect(extractCitedRunTargets(stripAspirationalBlocks(body))).toEqual([]);
  });

  test("the rest of the body stays gated — that is the whole point", () => {
    // The old per-skill exemption switched rule 1 off for the ENTIRE file, so
    // `src/real.ts` disappearing would have gone unnoticed in a skill like
    // `awcms-performance`. It does not now.
    const problems = checkCitedPaths(
      "awcms-example",
      extractCitedSourcePaths(stripAspirationalBlocks(body)),
      false,
      (candidate) => candidate === "src/also-real.ts"
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("src/real.ts");
  });

  test("an unterminated marker exempts nothing", () => {
    // Fail closed: a half-written block must not silently swallow the rest of
    // the file. The regex requires both markers, so the body is unchanged.
    const unterminated = "<!-- aspirational:mulai -->\ncites `src/x.ts`";

    expect(stripAspirationalBlocks(unterminated)).toBe(unterminated);
  });
});

describe("rule 5 — cited `/admin/…` screens exist", () => {
  const pages = exists([
    "src/pages/admin/site-search.astro",
    "src/pages/admin/blog-presentation.astro",
    "src/pages/admin/tenant/domains.astro"
  ]);

  test("the ORIGINAL defect: a screen declared missing that had shipped", () => {
    // `awcms-site-search` listed `/admin/search` under "Yang BELUM ada (jangan
    // klaim ada)" while `src/pages/admin/site-search.astro` was in the repo —
    // wrong about existence AND about the URL, so a reader is sent to build
    // what exists, at an address that does not.
    const problems = checkCitedAdminPaths(
      "awcms-site-search",
      ["/admin/search"],
      pages
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("/admin/search");
  });

  test("the screen that actually ships passes", () => {
    expect(
      checkCitedAdminPaths("awcms-site-search", ["/admin/site-search"], pages)
    ).toEqual([]);
  });

  test("a nested page resolves through its directory index too", () => {
    expect(adminPageExists("/admin/tenant/domains", pages)).toBe(true);
    expect(
      adminPageExists(
        "/admin/tenant",
        exists(["src/pages/admin/tenant/index.astro"])
      )
    ).toBe(true);
  });

  test("a query string is not part of the address", () => {
    // `/admin/blog-presentation?section=widgets` is where widgets really live;
    // the skill that claimed `/admin/blog/widgets` was wrong about the page,
    // not about the section.
    expect(
      extractCitedAdminPaths(
        "widgets: `/admin/blog-presentation?section=widgets`"
      )
    ).toEqual(["/admin/blog-presentation"]);
  });

  test.each([
    ["a wildcard", "`/admin/blog/*`"],
    ["an ellipsis", "`/admin/master-data/idn-regions/...`"],
    ["a route param", "`/admin/modules/[moduleKey]`"]
  ])("%s is a pattern, not an address, and is skipped", (_label, source) => {
    expect(extractCitedAdminPaths(source)).toEqual([]);
  });

  test("line-initial paths are claims too — that is where route MAPS live", () => {
    // The worst instance was a fenced block listing fourteen `/admin/blog/*`
    // addresses, none of them backticked; matching only backticked citations
    // would have read that block and found nothing to check.
    expect(
      extractCitedAdminPaths(
        "```txt\n/admin/blog/posts    -> daftar post\n/admin/blog/tags     -> manajer tag\n```"
      )
    ).toEqual(["/admin/blog/posts", "/admin/blog/tags"]);
  });

  test("a fenced historical passage may name a screen that never existed", () => {
    // `workflow-approval`'s README says `/admin/workflows` "never existed in
    // this repo" — a sentence that has to be able to name it.
    const source =
      "<!-- historis:mulai -->\nDulu tertulis `/admin/workflows`.\n<!-- historis:selesai -->";

    expect(extractCitedAdminPaths(stripHistoricalBlocks(source))).toEqual([]);
  });

  test("an UNCLOSED historical fence does not exempt the rest of the file", () => {
    // Otherwise one stray marker silently disables the rule from that point on.
    const source =
      "<!-- historis:mulai -->\nDulu `/admin/a`.\nSekarang `/admin/b`.";

    expect(extractCitedAdminPaths(stripHistoricalBlocks(source))).toEqual([
      "/admin/a",
      "/admin/b"
    ]);
  });

  test("the module-README corpus is not empty", async () => {
    // A glob resolving to nothing would make rule 5's wider — and more
    // authoritative — half pass vacuously.
    const readmes = await moduleReadmePaths();

    expect(readmes.length).toBeGreaterThanOrEqual(15);
    expect(readmes).toContain("src/modules/blog-content/README.md");
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

describe("mirrors are checked too (#729)", () => {
  test("skillSourcePaths returns the English copy and its mirror, English first", () => {
    const present = new Set([
      ".claude/skills/x/SKILL.md",
      ".claude/skills/x/SKILL.id.md"
    ]);

    expect(
      skillSourcePaths(".claude/skills", "x", (p) => present.has(p))
    ).toEqual([".claude/skills/x/SKILL.md", ".claude/skills/x/SKILL.id.md"]);
  });

  test("a mirror is checked when present and never DEMANDED", () => {
    // Which skills carry a translation is a separate decision from whether the
    // ones that do are correct. Requiring a mirror would turn this gate into a
    // translation mandate.
    const englishOnly = new Set([".claude/skills/x/SKILL.md"]);

    expect(
      skillSourcePaths(".claude/skills", "x", (p) => englishOnly.has(p))
    ).toEqual([".claude/skills/x/SKILL.md"]);
  });

  test("the module README corpus includes the mirrors", async () => {
    const readmes = await moduleReadmePaths();

    expect(readmes.some((f) => f.endsWith("/README.md"))).toBe(true);
    expect(readmes.some((f) => f.endsWith("/README.id.md"))).toBe(true);
    // A corpus that silently lost one half would make the wider rule pass
    // vacuously for it — the failure mode this repo has shipped once already.
    expect(readmes.filter((f) => f.endsWith("/README.id.md")).length).toBe(
      readmes.filter((f) => f.endsWith("/README.md")).length
    );
  });

  test("the LABEL names the file while the KEY stays the skill", () => {
    // The exemption lookups (`ASPIRATIONAL_SKILLS`, `subjectModuleKey`) are
    // keyed on the skill name. Passing a decorated label as that key silently
    // defeats both — which is exactly what happened in the first draft of this
    // change, turning a green gate into 19 false failures on the ENGLISH files.
    const problems = checkCitedRunTargets(
      "awcms-testing",
      ["nope:does:not:exist"],
      new Set<string>(),
      false,
      "awcms-testing (SKILL.id.md)"
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.skill).toBe("awcms-testing (SKILL.id.md)");
  });

  test("an aspirational skill stays exempt when a label is supplied", () => {
    // The regression above, stated as a property: the exemption must key off
    // the skill, not off however the failure is being reported.
    expect(
      checkCitedRunTargets(
        "awcms-testing",
        ["nope:does:not:exist"],
        new Set<string>(),
        true,
        "awcms-testing (SKILL.id.md)"
      )
    ).toEqual([]);
  });
});
