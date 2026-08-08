/**
 * `tsc` refuses unused locals and unused parameters, and the chain actually
 * runs it.
 *
 * ## Why this guard exists
 *
 * CodeQL alert #147 (`js/unused-local-variable`) reported an unused
 * `MEDIA_PERMISSIONS` import in `src/pages/api/v1/media/objects/index.ts` — on
 * `main`, a week after it merged. Nothing in the 34-gate `check` chain had
 * anything to say about it: `lint` is `prettier --check`, which formats and
 * never analyses, and this repo carries no ESLint/oxlint. `tsc` was already
 * running on every PR and would have caught it in under a second, but
 * `tsconfig.json` extends `astro/tsconfigs/strict`, and `noUnusedLocals` /
 * `noUnusedParameters` live one level up in `strictest`. The repo had already
 * cherry-picked `noUncheckedIndexedAccess` and `noImplicitOverride` out of
 * `strictest`; these two were simply never picked up with them.
 *
 * Turning them on surfaced a second finding CodeQL had NOT reported — a
 * `timedOut` flag in `src/lib/jobs/job-runner.ts`, written by the job timeout
 * timer and read nowhere, beside a status classification that derives
 * "timeout" by elimination. That is the shape this gate is really for: dead
 * state sitting next to live state, which reads as deliberate until someone
 * checks.
 *
 * ## Why a test and not just the setting
 *
 * A compiler flag can be deleted in the same commit as the error that
 * annoyed someone, with no signal anywhere. Both halves are asserted because
 * either alone is inert: the flag does nothing if no command runs `tsc`, and
 * running `tsc` proves nothing if the flag is gone. Same reasoning, and the
 * same failure mode, as `codeql-coverage-statement.test.ts`.
 *
 * Note for whoever hits this next: an intentionally-unused parameter is
 * spelled with a leading underscore (see `resolveLegacyBlogRedirect` in
 * `seo-distribution/application/redirect-resolution-service.ts`, where two
 * strategies share one call signature). Reach for that before reaching for
 * this file.
 *
 * Plain file reads: no compiler run, no network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "..");

const tsconfig = JSON.parse(
  readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")
) as { compilerOptions?: Record<string, unknown> };

const packageJson = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
) as { scripts?: Record<string, string> };

describe("unused-code typecheck gate", () => {
  test("tsconfig.json refuses unused locals", () => {
    expect(tsconfig.compilerOptions?.noUnusedLocals).toBe(true);
  });

  test("tsconfig.json refuses unused parameters", () => {
    expect(tsconfig.compilerOptions?.noUnusedParameters).toBe(true);
  });

  // The flags are only worth anything because something runs the compiler.
  // `astro/tsconfigs/strict` is the base, so neither flag is inherited — they
  // have to be spelled out above, and `check` has to reach `typecheck`.
  test("the check chain runs the type checker that enforces them", () => {
    expect(packageJson.scripts?.typecheck).toContain("tsc");
    expect(packageJson.scripts?.typecheck).toContain("--noEmit");
    expect(packageJson.scripts?.check).toContain("bun run typecheck");
  });
});
