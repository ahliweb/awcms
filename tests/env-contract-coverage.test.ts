/**
 * `config:env:coverage:check` — the half of the env contract nothing watched.
 *
 * `tests/env-required-vars-doc.test.ts` compares the documented MANDATORY list
 * against the enforced one. Optional-but-behaviour-changing variables sat
 * outside both, and eleven had accumulated. The one that matters most is
 * reinstated below as the central case: `TENANT_DOMAIN_DNS_PROVIDER`, whose two
 * values are "make no outbound call" and "talk to a real DNS API", and which
 * appeared in neither `.env.example`, doc 18, nor `validate-env.ts`.
 *
 * The last block runs the gate against the real repository, so this file is
 * also the drift detector.
 */
import { describe, expect, test } from "bun:test";

import {
  TOOLING_ONLY,
  aliasedEnvReads,
  collectEnvReads,
  declaredInEnvExample,
  findCoverageViolations,
  stripComments
} from "../scripts/env-contract-coverage-check";

describe("findCoverageViolations", () => {
  test("flags the defect this gate exists for: a behaviour switch absent from .env.example", () => {
    const violations = findCoverageViolations(
      new Map([
        ["TENANT_DOMAIN_DNS_PROVIDER", ["scripts/tenant-domain-dns-sync.ts"]]
      ]),
      new Set(["APP_ENV", "DATABASE_URL"])
    );

    expect(violations).toEqual([
      {
        name: "TENANT_DOMAIN_DNS_PROVIDER",
        // Naming the file matters: otherwise an operator learns only that
        // something somewhere reads an undocumented variable.
        files: ["scripts/tenant-domain-dns-sync.ts"]
      }
    ]);
  });

  test("a documented variable passes", () => {
    expect(
      findCoverageViolations(
        new Map([["DATABASE_URL", ["src/lib/database/client.ts"]]]),
        new Set(["DATABASE_URL"])
      )
    ).toEqual([]);
  });

  test("a tooling-only variable is excused", () => {
    expect(
      findCoverageViolations(
        new Map([["RELEASE_VERIFY_TAG", ["scripts/release-verify.ts"]]]),
        new Set()
      )
    ).toEqual([]);
  });

  test("every tooling-only entry says why an operator would never set it", () => {
    for (const entry of TOOLING_ONLY) {
      expect(entry.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.reason.length).toBeGreaterThan(60);
    }
  });
});

describe("declaredInEnvExample", () => {
  test("a commented placeholder counts as declared", () => {
    // Secrets must NOT carry a real value in the repo, so the commented form is
    // the correct way to ship them — the `EMAIL_MAILKETING_*` precedent.
    const declared = declaredInEnvExample(
      ["APP_ENV=development", "# R2_SECRET_ACCESS_KEY=replace-me"].join("\n")
    );

    expect(declared.has("APP_ENV")).toBe(true);
    expect(declared.has("R2_SECRET_ACCESS_KEY")).toBe(true);
  });

  test("prose mentioning a variable name does NOT count as declaring it", () => {
    // `.env.example` referred to "the TENANT_DOMAIN_CLOUDFLARE_* settings
    // above" when no such settings existed. A looser match would have called
    // that documented.
    const declared = declaredInEnvExample(
      "# Requires TENANT_DOMAIN_CLOUDFLARE_ZONE_ID to be set somewhere."
    );

    expect(declared.has("TENANT_DOMAIN_CLOUDFLARE_ZONE_ID")).toBe(false);
  });
});

describe("stripComments", () => {
  test("a docblock mentioning process.env is not a read", () => {
    // Real case: `security-readiness.ts` explains a rule using
    // `token: process.env.TOKEN ?? "..."`. Without stripping, the gate demands
    // an entry for a variable no code touches.
    const source = [
      "/**",
      ' * e.g. `token: process.env.TOKEN ?? "x"` reads from env.',
      " */",
      "const url = process.env.DATABASE_URL;"
    ].join("\n");

    const stripped = stripComments(source);

    expect(stripped).not.toContain("process.env.TOKEN");
    expect(stripped).toContain("process.env.DATABASE_URL");
  });
});

describe("aliasedEnvReads", () => {
  // The gate used to match `process.env.X` only, and said so in its own header
  // as an accepted limit. It was not: the pattern it could not see is the one
  // most config modules in this repo use, so ~129 of ~178 variables were
  // invisible and the gate printed OK while `REDIS_*` was missing entirely.
  test("sees a read through a parameter bound to process.env", () => {
    const source = [
      "export function readConfig(env: NodeJS.ProcessEnv = process.env) {",
      "  return { enabled: env.REDIS_ENABLED, url: env.REDIS_URL };",
      "}"
    ].join("\n");

    expect([...aliasedEnvReads(source)].sort()).toEqual([
      "REDIS_ENABLED",
      "REDIS_URL"
    ]);
  });

  test("sees a read through a const binding, and a destructured read", () => {
    const source = [
      "const env = process.env;",
      "const value = env.APP_URL;",
      "const { DATABASE_URL } = process.env;"
    ].join("\n");

    expect([...aliasedEnvReads(source)].sort()).toEqual([
      "APP_URL",
      "DATABASE_URL"
    ]);
  });

  // This is the precision the old header comment was protecting, and the reason
  // the fix resolves aliases instead of matching any `env.X`: an identifier that
  // merely happens to be called `env` is not process.env.
  test("does NOT swallow an env-shaped identifier that is not process.env", () => {
    const source = [
      "const env = { MODE: 'test' };",
      "const mode = env.MODE;",
      "const other = someRecord.SOME_KEY;"
    ].join("\n");

    expect([...aliasedEnvReads(source)]).toEqual([]);
  });

  test("does not read `process.env.X` itself as a binding of the object", () => {
    // `const x = process.env.FOO` must not register `x` as an alias, or every
    // `x.BAR` afterwards would be reported as an env read.
    const source = ["const x = process.env.FOO;", "const y = x.BAR;"].join(
      "\n"
    );

    expect([...aliasedEnvReads(source)]).toEqual([]);
  });
});

describe("the real repository", () => {
  test("every variable the code reads is in .env.example", async () => {
    const violations = findCoverageViolations(
      await collectEnvReads(),
      declaredInEnvExample(await Bun.file(".env.example").text())
    );

    expect(violations.map((v) => v.name)).toEqual([]);
  }, 60000);

  test("the R2 credentials R2_ENABLED=true needs are all templated", async () => {
    // `R2_ENABLED=false` shipped alone: an operator flipping it on had no
    // template for the four credentials the uploader then requires.
    const declared = declaredInEnvExample(
      await Bun.file(".env.example").text()
    );

    for (const name of [
      "R2_ACCOUNT_ID",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY"
    ]) {
      expect(declared.has(name)).toBe(true);
    }
  });

  test("is wired into `bun run check`", async () => {
    const manifest = (await Bun.file("package.json").json()) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts["config:env:coverage:check"]).toBeDefined();
    expect(manifest.scripts.check).toContain("config:env:coverage:check");
  });
});
