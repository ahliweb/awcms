/**
 * `bun run admin:screen-coverage:check` — the rule, driven with planted gaps.
 *
 * The live registry passing proves little: it passes today because the ledger
 * was generated from today. What has to be proven is that each direction FAILS
 * on the defect it exists for — and one direction in particular, because the
 * repo has already paid for getting it wrong four times: a scanner that reports
 * a COVERED permission as uncovered trains its readers to widen the exception
 * list until the gate asks nothing.
 */
import { describe, expect, test } from "bun:test";

import {
  collectCoverage,
  evaluateScreenCoverage,
  extractScreenClaims
} from "../scripts/admin-screen-coverage-check";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";

const DECLARED = ["mod.thing.read", "mod.thing.write"];

describe("extractScreenClaims", () => {
  test("reads the literal triple", () => {
    expect([
      ...extractScreenClaims(
        'permissionKey("comments", "moderation", "approve")'
      )
    ]).toEqual(["comments.moderation.approve"]);
  });

  test("resolves a file-local helper bound to a literal module key", () => {
    // The real shape, from `blog-presentation.astro`. A matcher that stops at
    // literal triples reports all eight of these as unclaimed — verified: eight
    // false positives, every one of them a control that ships and works.
    const source = [
      "const can = (activity: string, action: string): boolean =>",
      '  ssr.permissions.has(permissionKey("blog_content", activity, action));',
      'const canReadWidgets = can("widgets", "read");',
      'const canConfigureTheme = can("theme", "configure");'
    ].join("\n");

    expect([...extractScreenClaims(source)].sort()).toEqual([
      "blog_content.theme.configure",
      "blog_content.widgets.read"
    ]);
  });

  test("does NOT resolve a helper whose module key is itself a variable", () => {
    // Guessing there would trade one wrong answer for its opposite. Unresolved
    // is the honest outcome, and it fails toward "unclaimed" — the direction a
    // human then has to look at.
    const source = [
      "const can = (m: string, a: string) =>",
      '  ssr.permissions.has(permissionKey(m, a, "read"));',
      'const x = can("blog_content", "widgets");'
    ].join("\n");

    expect([...extractScreenClaims(source)]).toEqual([]);
  });
});

describe("evaluateScreenCoverage", () => {
  const claimed = (...keys: string[]) => ({
    claimed: new Set(keys),
    declared: DECLARED
  });

  test("a permission with a screen passes", () => {
    expect(
      evaluateScreenCoverage(
        claimed("mod.thing.read", "mod.thing.write"),
        {},
        []
      )
    ).toEqual([]);
  });

  test("THE CASE: a permission no screen claims fails", () => {
    const problems = evaluateScreenCoverage(claimed("mod.thing.read"), {}, []);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("mod.thing.write");
  });

  test("a written decision covers it", () => {
    expect(
      evaluateScreenCoverage(
        claimed("mod.thing.read"),
        {
          "mod.thing.write": "machine-to-machine only"
        },
        []
      )
    ).toEqual([]);
  });

  test("the ledger covers it", () => {
    expect(
      evaluateScreenCoverage(claimed("mod.thing.read"), {}, ["mod.thing.write"])
    ).toEqual([]);
  });

  test("a STALE ledger entry fails — this is what makes the ledger one-way", () => {
    // Without this, the list would grow a tail of permissions that quietly got
    // screens, and its length would stop meaning anything.
    const problems = evaluateScreenCoverage(
      claimed("mod.thing.read", "mod.thing.write"),
      {},
      ["mod.thing.write"]
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("only ever shrinks");
  });

  test("a stale DECISION fails too", () => {
    const problems = evaluateScreenCoverage(
      claimed("mod.thing.read", "mod.thing.write"),
      { "mod.thing.write": "machine-to-machine only" },
      []
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("stale decision");
  });

  test("a ledger entry for a permission nobody declares any more fails", () => {
    const problems = evaluateScreenCoverage(
      claimed("mod.thing.read", "mod.thing.write"),
      {},
      ["mod.removed.read"]
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no module declares it");
  });

  test("being in BOTH registers fails", () => {
    const problems = evaluateScreenCoverage(
      claimed("mod.thing.read"),
      { "mod.thing.write": "decided" },
      ["mod.thing.write"]
    );

    expect(problems.some((p) => p.includes("BOTH registers"))).toBe(true);
  });

  test("a screen gating on an undeclared key fails", () => {
    // A control nobody can ever see: no role can hold a key no module declares.
    const problems = evaluateScreenCoverage(
      {
        claimed: new Set([...DECLARED, "mod.thing.teleport"]),
        declared: DECLARED
      },
      {},
      []
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no module declares");
  });
});

describe("the live repo", () => {
  test("the screen corpus is not empty", async () => {
    const { screens, declared } = await collectCoverage();

    expect(screens.length).toBeGreaterThanOrEqual(30);
    expect(declared.length).toBeGreaterThanOrEqual(200);
  });

  test("the ledger holds only keys that are really declared and really unscreened", async () => {
    const { claimed, declared } = await collectCoverage();

    for (const key of NOT_YET_SCREENED) {
      expect(declared).toContain(key);
      expect(claimed.has(key)).toBe(false);
    }
  });

  test("the gate passes against the repo as committed", () => {
    const result = Bun.spawnSync([
      "bun",
      "scripts/admin-screen-coverage-check.ts"
    ]);

    expect(result.exitCode).toBe(0);
  });
});
