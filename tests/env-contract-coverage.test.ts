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
  COMPUTED_ENV_READS,
  TOOLING_ONLY,
  aliasedEnvReads,
  collectEnvReads,
  declaredInEnvExample,
  directEnvReads,
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

// Issue #1119. Binding detection used to require `= process.env` on the same
// declaration, so a function that RECEIVES the environment was invisible:
// `parseVapidConfig(env: NodeJS.ProcessEnv)` read PUSH_VAPID_* and none of the
// three reached `.env.example` coverage or `ops/awcms-jobs.env-allowlist`.
describe("aliasedEnvReads: names bound to the environment by TYPE", () => {
  const names = (source: string) => [...aliasedEnvReads(source)].sort();

  test("a parameter typed NodeJS.ProcessEnv with NO default", () => {
    // The exact shape of src/modules/push-delivery/domain/vapid-config.ts.
    const source = [
      "export function parseVapidConfig(env: NodeJS.ProcessEnv): Result {",
      "  const publicKey = env.PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';",
      "  const privateKey = env.PUSH_VAPID_PRIVATE_KEY?.trim() ?? '';",
      "  return { subject: env.PUSH_VAPID_SUBJECT };",
      "}"
    ].join("\n");

    expect(names(source)).toEqual([
      "PUSH_VAPID_PRIVATE_KEY",
      "PUSH_VAPID_PUBLIC_KEY",
      "PUSH_VAPID_SUBJECT"
    ]);
  });

  test("a bare ProcessEnv, an optional parameter, Readonly<> and typeof process.env", () => {
    expect(names("function a(env: ProcessEnv) { return env.AA_ONE; }")).toEqual(
      ["AA_ONE"]
    );
    expect(
      names("function b(env?: NodeJS.ProcessEnv) { return env?.BB_TWO; }")
    ).toEqual(["BB_TWO"]);
    expect(
      names(
        "const c = (source: Readonly<NodeJS.ProcessEnv>) => source.CC_THREE;"
      )
    ).toEqual(["CC_THREE"]);
    expect(
      names("function d(vars: typeof process.env) { return vars.DD_FOUR; }")
    ).toEqual(["DD_FOUR"]);
  });

  test("a class field and a method parameter", () => {
    const source = [
      "class Gateway {",
      "  private readonly env: NodeJS.ProcessEnv;",
      "  token() { return this.env.GATEWAY_TOKEN; }",
      "  region(env: NodeJS.ProcessEnv) { return env.GATEWAY_REGION; }",
      "}"
    ].join("\n");

    expect(names(source)).toEqual(["GATEWAY_REGION", "GATEWAY_TOKEN"]);
  });

  test("a parameter WITH a default, including a generic type annotation with commas", () => {
    expect(
      names(
        "function a(env: NodeJS.ProcessEnv = process.env) { return env.WITH_DEFAULT; }"
      )
    ).toEqual(["WITH_DEFAULT"]);
    // `Record<string, string | undefined>`: the comma used to end the type and
    // the default was never recognised (DATABASE_POOL_MAX, TAX_TAXDATE_*).
    expect(
      names(
        "function b(env: Readonly<Record<string, string | undefined>> = process.env) { return env.GENERIC_DEFAULT; }"
      )
    ).toEqual(["GENERIC_DEFAULT"]);
  });

  test("a const binding, process.env direct, and both index forms", () => {
    const source = [
      "const env = process.env;",
      "const a = env.BOUND_NAME;",
      'const b = env["INDEX_ON_ALIAS"];',
      "const c = env?.OPTIONAL_CHAIN;",
      "const { DESTRUCTURED_FROM_ALIAS } = env;"
    ].join("\n");

    expect(names(source)).toEqual([
      "BOUND_NAME",
      "DESTRUCTURED_FROM_ALIAS",
      "INDEX_ON_ALIAS",
      "OPTIONAL_CHAIN"
    ]);
  });

  test("an object literal that reads through the alias: { X: env.X }", () => {
    const source = [
      "export function f(env: NodeJS.ProcessEnv) {",
      "  return load('TELEGRAM_CHAT_HASH_KEYS', { TELEGRAM_CHAT_HASH_KEYS: env.TELEGRAM_CHAT_HASH_KEYS });",
      "}"
    ].join("\n");

    expect(names(source)).toEqual(["TELEGRAM_CHAT_HASH_KEYS"]);
  });

  test("an env-shaped identifier of ANOTHER type stays invisible", () => {
    const source = [
      "function a(env: { MODE: string }) { return env.MODE; }",
      "function b(env: Record<string, string>) { return env.SOME_KEY; }",
      "function c(env: ProcessEnvironment) { return env.LOOKALIKE_TYPE; }",
      "const ctx: Context = makeContext();",
      "const d = ctx.OTHER_OBJECT;"
    ].join("\n");

    expect(names(source)).toEqual([]);
  });

  test("a plain assignment is a write, not a read; ??= and === still read", () => {
    const source = [
      "function a(env: NodeJS.ProcessEnv) {",
      '  env.WRITTEN_ONLY = "true";',
      "  env.DEFAULTED ??= 'x';",
      "  return env.COMPARED === 'y';",
      "}"
    ].join("\n");

    expect(names(source)).toEqual(["COMPARED", "DEFAULTED"]);
  });

  test("a default on one parameter does not bind its neighbour", () => {
    const source = [
      "function a(label: string, env: NodeJS.ProcessEnv = process.env) {",
      "  return label.NOT_AN_ENV_READ + env.REAL_READ;",
      "}"
    ].join("\n");

    expect(names(source)).toEqual(["REAL_READ"]);
  });
});

describe("directEnvReads", () => {
  test('process.env.X and process.env["X"] are reads; a computed index is not', () => {
    const source = [
      "const a = process.env.DOT_FORM;",
      'const b = process.env["DOUBLE_QUOTED"];',
      "const c = process.env['SINGLE_QUOTED'];",
      "const d = process.env[name];",
      "const e = process.env[`${prefix}SUFFIX`];"
    ].join("\n");

    expect([...directEnvReads(source)].sort()).toEqual([
      "DOT_FORM",
      "DOUBLE_QUOTED",
      "SINGLE_QUOTED"
    ]);
  });
});

describe("COMPUTED_ENV_READS", () => {
  test("every entry's code shape is still present in the file, comments excluded", async () => {
    for (const entry of COMPUTED_ENV_READS) {
      // Comments are stripped first: client.ts names every entry in a doc
      // comment, so matching raw source kept a stale entry alive after the real
      // literal was renamed.
      const code = stripComments(await Bun.file(entry.file).text());

      expect(code).toMatch(entry.needle);
      expect(entry.reason.length).toBeGreaterThan(30);
    }
  });

  test("the guard has teeth: a renamed literal, or a name left only in a comment, fails", () => {
    const entry = COMPUTED_ENV_READS.find(
      (candidate) => candidate.name === "WORKER_DATABASE_URL"
    )!;
    const real = '  kind === "worker"\n    ? "WORKER_DATABASE_URL"\n    : "x"';
    const renamed = real.replace("WORKER_DATABASE_URL", "WORKER_DB_RENAMED");
    const commentOnly = `/** \`WORKER_DATABASE_URL\` is configured */\n${renamed}`;

    expect(stripComments(real)).toMatch(entry.needle);
    expect(stripComments(renamed)).not.toMatch(entry.needle);
    expect(stripComments(commentOnly)).not.toMatch(entry.needle);
  });

  test("is merged into collectEnvReads", async () => {
    const reads = await collectEnvReads();

    for (const entry of COMPUTED_ENV_READS) {
      expect(reads.get(entry.name)).toContain(entry.file);
    }
  }, 60000);
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
