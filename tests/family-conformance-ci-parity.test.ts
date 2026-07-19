/**
 * Parity test (Issue #183, epic #177, ADR-0032) — the conformance step must
 * not silently drop out of `bun run check` OR the CI/release workflows, and the
 * DB-gated fail-closed contract test must stay wired into the dedicated
 * DB-suite steps of both pipelines.
 *
 * This is the guard ADR-0015 §6 documents the need for (PR #770 lesson: a new
 * `bun run X:check` was added to package.json's `check` but never to
 * `.github/workflows/ci.yml`'s manually-listed steps, so it silently never ran
 * in CI). No DB, no network — plain file reads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("family conformance — CI/check parity", () => {
  test("package.json `check` chain runs family:conformance:check", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["family:conformance:check"]).toBeDefined();
    expect(pkg.scripts.check).toContain("bun run family:conformance:check");
  });

  test("ci.yml quality job runs family:conformance:check as an explicit step", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("bun run family:conformance:check");
  });

  test("ci.yml integration-tests lists the DB-gated conformance test", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("tests/family-conformance-db.test.ts");
  });

  test("release.yml inherits the gate via `bun run check` and lists the DB test", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("bun run check");
    expect(release).toContain("tests/family-conformance-db.test.ts");
  });

  test("ci.yml runs the minimum-supported (Bun 1.3.0) cell", () => {
    // F1 AC "menguji current DAN minimum-supported": a dedicated cell must set
    // up the floor Bun and run a meaningful subset. (The family-conformance gate
    // ALSO enforces this via its CI-Bun-set check; this is the direct guard.)
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("minimum-supported:");
    expect(ci).toMatch(/bun-version:\s*"1\.3\.0"/);
  });

  test("ci.yml keeps the e2e-smoke SSR-start-on-Bun proof (Astro SSR contract)", () => {
    // The "Astro SSR production build/start on Bun" family contract is exercised
    // by `bun run build` (in `check`) PLUS the e2e-smoke job, which actually
    // STARTS the built server on Bun (`bun ./dist/server/entry.mjs`) and drives
    // login/SSR render. There is no standalone in-suite SSR test (a duplicate
    // build+start+probe would just re-run e2e-smoke); this parity assertion is
    // the guard — deleting e2e-smoke turns conformance RED.
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("e2e-smoke:");
    expect(ci).toContain("bun ./dist/server/entry.mjs");
  });
});
