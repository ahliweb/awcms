/**
 * The public-form challenge seam (Issue #1353). Pure: no database.
 *
 * A FIXTURE provider (an in-memory self-hosted token issuer) stands in for "a
 * module declared a provider", installed through the same extension-point source
 * the web composition root uses. Each protection has a test that goes RED when
 * the protection is removed (mutations recorded in the PR body):
 *  - verifier error / timeout refuses      -> `fail-closed`
 *  - replay refused (burn BEFORE verify)   -> `single use`, `concurrent replay`
 *  - form / tenant bound                   -> the two `refused` tests
 *  - one uniform refusal                   -> `no oracle`
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearPublicFormChallengeTestSolversForTests,
  enforcePublicFormCaptcha,
  registerPublicFormChallengeTestSolver,
  issuePublicFormChallenge,
  PUBLIC_FORM_CHALLENGE_BURN_CAPACITY,
  PUBLIC_FORM_NAMES,
  resetPublicFormChallengeForTests,
  solvePublicFormChallengeForTests
} from "../src/lib/security/public-form-challenge";
import {
  installExtensionPointSource,
  uninstallExtensionPointSourceForTests
} from "../src/modules/_shared/extension-point-source";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import type { ModulePublicFormChallengeProvider } from "../src/modules/_shared/public-form-challenge-contract";
import { readdirSync, readFileSync } from "node:fs";
import { stripComments } from "../scripts/lib/source-text";
import {
  isTurnstileChallengeEnabled,
  turnstileChallengeProvider
} from "../src/modules/identity-access/infrastructure/turnstile-challenge-provider";
import { isTurnstileRequired } from "../src/lib/security/turnstile";
import {
  bindPublicFormChallengeVerifier,
  requirePublicFormChallengeVerifier,
  unbindPublicFormChallengeVerifierForTests
} from "../src/modules/_shared/public-form-challenge-verifier-slot";
import {
  findDirectTurnstileCalls,
  TURNSTILE_ENTRY_IMPORT_ALLOW_LIST,
  findTestSolverRegistrations
} from "../scripts/extension-points-check";
import { invoke } from "./integration/harness";
import { validatePublicFormChallengeProviderDeclarations } from "../src/modules/_shared/extension-point-declarations";
import { listModules } from "../src/modules";
import {
  INVITATION_ACCEPT_TURNSTILE_ACTION,
  LOGIN_TURNSTILE_ACTION,
  PASSWORD_RESET_TURNSTILE_ACTION,
  REGISTER_TURNSTILE_ACTION,
  SETUP_TURNSTILE_ACTION
} from "../src/lib/security/turnstile";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

type Fixture = ModulePublicFormChallengeProvider & {
  mode: { throws: boolean; hangs: boolean; enabled: boolean };
  verifyCalls: number;
};

/** A self-hosted style provider: `issue` mints a token bound to (form, tenant); `verify` checks the binding and consumes it. */
function makeFixture(key = "fixture_captcha"): Fixture {
  const issued = new Map<
    string,
    { formName: string; tenantId: string | null; used: boolean }
  >();
  const fixture: Fixture = {
    mode: { throws: false, hangs: false, enabled: true },
    verifyCalls: 0,
    key,
    description: "fixture",
    isEnabled: () => fixture.mode.enabled,
    async issue(formName, tenantId) {
      const challengeId = `tok_${crypto.randomUUID()}`;
      issued.set(challengeId, { formName, tenantId, used: false });

      return { challengeId, prompt: "2+2" };
    },
    async verify(input) {
      fixture.verifyCalls += 1;

      if (fixture.mode.throws) {
        throw new Error(`boom ${input.token}`);
      }

      if (fixture.mode.hangs) {
        return new Promise(() => undefined);
      }

      const row = issued.get(input.token);

      if (
        !row ||
        row.used ||
        row.formName !== input.formName ||
        row.tenantId !== input.tenantId
      ) {
        return { ok: false, reason: "refused" };
      }

      row.used = true;
      return { ok: true };
    }
  };

  return fixture;
}

function moduleWith(
  ...providers: ModulePublicFormChallengeProvider[]
): ModuleDescriptor {
  return {
    key: "fixture_module",
    name: "Fixture",
    version: "1.0.0",
    status: "active",
    description: "fixture",
    dependencies: [],
    publicFormChallengeProviders: providers
  } as unknown as ModuleDescriptor;
}

function request(tenantId: string | null = TENANT_A): Request {
  return new Request("http://localhost/api/v1/auth/password/forgot", {
    method: "POST",
    headers: tenantId ? { "x-awcms-tenant-id": tenantId } : {}
  });
}

async function body(response: Response | null): Promise<unknown> {
  return response === null ? null : await response.json();
}

let fixture: Fixture;

beforeEach(() => {
  resetPublicFormChallengeForTests();
  fixture = makeFixture();
  installExtensionPointSource(() => [moduleWith(fixture)]);
  clearPublicFormChallengeTestSolversForTests();
  registerPublicFormChallengeTestSolver(
    fixture.key,
    async (formName, tenantId) => {
      const challenge = await fixture.issue(formName, tenantId);

      return { challengeToken: challenge.challengeId };
    }
  );
});

afterEach(() => {
  uninstallExtensionPointSourceForTests();
  installExtensionPointSource(listModules);
});

async function solved(formName: string, tenantId: string | null = TENANT_A) {
  return (await solvePublicFormChallengeForTests(formName, tenantId)) ?? {};
}

describe("off by default", () => {
  test("no source installed + Turnstile flags on: REFUSED, never a no-op (fail-closed, ADR-0164)", async () => {
    uninstallExtensionPointSourceForTests();

    const response = await enforcePublicFormCaptcha(
      request(),
      "password_reset",
      { loginIdentifier: "a" },
      {
        env: {
          AUTH_ONLINE_SECURITY_ENABLED: "true",
          AUTH_ONLINE_SECURITY_PROFILE: "full_online",
          TURNSTILE_ENABLED: "true"
        } as NodeJS.ProcessEnv
      }
    );

    expect(response?.status).toBe(400);
  });

  test("no source installed at all: refused too (a process that cannot tell must not skip)", async () => {
    uninstallExtensionPointSourceForTests();
    expect((await enforcePublicFormCaptcha(request(), "f", {}))?.status).toBe(
      400
    );
  });

  test("a declared provider that is not enabled is invisible", async () => {
    fixture.mode.enabled = false;
    expect(await enforcePublicFormCaptcha(request(), "f", {})).toBeNull();
    expect(fixture.verifyCalls).toBe(0);
  });

  test("the real module list with no env: no-op (Turnstile is off)", async () => {
    installExtensionPointSource(listModules);
    expect(
      await enforcePublicFormCaptcha(request(), "login", {}, { env: {} })
    ).toBeNull();
  });
});

describe("enabled provider", () => {
  test("a request without a token is refused as required", async () => {
    const response = await enforcePublicFormCaptcha(request(), "f", {});

    expect(response?.status).toBe(400);
    expect(
      ((await body(response)) as { error: { code: string } }).error.code
    ).toBe("CHALLENGE_REQUIRED");
    expect(fixture.verifyCalls).toBe(0);
  });

  test("a valid token is accepted once and refused on replay (single use)", async () => {
    const fields = await solved("f");

    expect(await enforcePublicFormCaptcha(request(), "f", fields)).toBeNull();

    const replay = await enforcePublicFormCaptcha(request(), "f", fields);

    expect(replay?.status).toBe(400);
  });

  test("replay is refused by the SEAM even when the provider would accept it again", async () => {
    // A provider with no single-use of its own: the burn still holds.
    fixture.verify = async () => ({ ok: true });
    const fields = { challengeToken: "reusable" };

    expect(await enforcePublicFormCaptcha(request(), "f", fields)).toBeNull();
    expect(
      (await enforcePublicFormCaptcha(request(), "f", fields))?.status
    ).toBe(400);
  });

  test("concurrent replay: exactly one of N racing requests passes", async () => {
    fixture.verify = async () => ({ ok: true });
    const fields = { challengeToken: "race" };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        enforcePublicFormCaptcha(request(), "f", fields)
      )
    );

    expect(results.filter((response) => response === null)).toHaveLength(1);
  });

  test("a token issued for another form is refused", async () => {
    const fields = await solved("form_a");

    expect(
      (await enforcePublicFormCaptcha(request(), "form_b", fields))?.status
    ).toBe(400);
  });

  test("a token issued for another tenant is refused", async () => {
    const fields = await solved("f", TENANT_B);

    expect(
      (await enforcePublicFormCaptcha(request(TENANT_A), "f", fields))?.status
    ).toBe(400);
  });

  test("an explicit tenantId option binds instead of the header, and null binds tenant-less", async () => {
    const fields = await solved("f", null);

    expect(
      await enforcePublicFormCaptcha(request(TENANT_A), "f", fields, {
        tenantId: null
      })
    ).toBeNull();
  });
});

describe("fail-closed", () => {
  test("a verifier that throws refuses the request", async () => {
    fixture.mode.throws = true;

    const response = await enforcePublicFormCaptcha(request(), "f", {
      challengeToken: "anything"
    });

    expect(response?.status).toBe(400);
    expect(JSON.stringify(await body(response))).not.toContain("boom");
  });

  test("a verifier that never answers is refused at the deadline", async () => {
    fixture.mode.hangs = true;

    const response = await enforcePublicFormCaptcha(
      request(),
      "f",
      { challengeToken: "slow" },
      { timeoutMs: 25 }
    );

    expect(response?.status).toBe(400);
  });

  test("only an exact { ok: true } passes (truthy junk does not)", async () => {
    for (const junk of [undefined, null, true, 1, { ok: "yes" }, { ok: 1 }]) {
      fixture.verify = (async () => junk) as never;
      expect(
        (
          await enforcePublicFormCaptcha(request(), "f", {
            challengeToken: `t_${crypto.randomUUID()}`
          })
        )?.status
      ).toBe(400);
    }
  });

  test("two enabled providers are a configuration error: refused", async () => {
    const second = makeFixture("second_captcha");
    installExtensionPointSource(() => [moduleWith(fixture, second)]);

    expect(
      (await enforcePublicFormCaptcha(request(), "f", await solved("f")))
        ?.status
    ).toBe(400);
  });

  test("a configuration fault is refused with the provider's own refusal text (no config oracle)", async () => {
    fixture.refusal = {
      invalidCode: "PROVIDER_INVALID",
      invalidMessage: "Provider says no."
    };
    const second = makeFixture("second_captcha");
    installExtensionPointSource(() => [moduleWith(fixture, second)]);
    const ambiguous = await body(
      await enforcePublicFormCaptcha(request(), "f", await solved("f"))
    );

    installExtensionPointSource(() => [moduleWith(fixture)]);
    const ordinary = await body(
      await enforcePublicFormCaptcha(request(), "f", {
        challengeToken: "not-issued"
      })
    );

    expect(ambiguous).toEqual(ordinary);
    expect((ordinary as { error: { code: string } }).error.code).toBe(
      "PROVIDER_INVALID"
    );
  });

  test("a missing token on an ambiguous configuration is also the invalid refusal, not 'required'", async () => {
    const second = makeFixture("second_captcha");
    installExtensionPointSource(() => [moduleWith(fixture, second)]);

    expect(
      (
        (await body(await enforcePublicFormCaptcha(request(), "f", {}))) as {
          error: { code: string };
        }
      ).error.code
    ).toBe("CHALLENGE_INVALID");
  });

  test("burn keys cannot collide through the separator byte", async () => {
    fixture.verify = async () => ({ ok: true });

    // Old key = provider \0 id \0 token \0: both of these were "x\0y\0z".
    expect(
      await enforcePublicFormCaptcha(request(), "f", {
        challengeId: "x\u0000y",
        challengeToken: "z"
      })
    ).toBeNull();
    expect(
      await enforcePublicFormCaptcha(request(), "f", {
        challengeId: "x",
        challengeToken: "y\u0000z"
      })
    ).toBeNull();
    // ... and the genuine replay is still refused.
    expect(
      (
        await enforcePublicFormCaptcha(request(), "f", {
          challengeId: "x",
          challengeToken: "y\u0000z"
        })
      )?.status
    ).toBe(400);
  });

  test("a provider whose isEnabled throws is not trusted to be off", async () => {
    fixture.isEnabled = () => {
      throw new Error("config");
    };

    expect((await enforcePublicFormCaptcha(request(), "f", {}))?.status).toBe(
      400
    );
  });

  test("an oversize field is refused without reaching the verifier", async () => {
    const response = await enforcePublicFormCaptcha(request(), "f", {
      challengeToken: "x".repeat(5_000)
    });

    expect(response?.status).toBe(400);
    expect(fixture.verifyCalls).toBe(0);
  });

  test("non-string fields count as absent", async () => {
    const response = await enforcePublicFormCaptcha(request(), "f", {
      challengeToken: { $ne: 1 }
    });

    expect(
      ((await body(response)) as { error: { code: string } }).error.code
    ).toBe("CHALLENGE_REQUIRED");
  });

  test("the burn memory is bounded", async () => {
    fixture.verify = async () => ({ ok: true });

    for (let i = 0; i < PUBLIC_FORM_CHALLENGE_BURN_CAPACITY + 50; i += 1) {
      await enforcePublicFormCaptcha(request(), "f", {
        challengeToken: `bounded_${i}`
      });
    }

    // The oldest were evicted to stay within capacity; the newest are still burned.
    expect(
      (
        await enforcePublicFormCaptcha(request(), "f", {
          challengeToken: `bounded_${PUBLIC_FORM_CHALLENGE_BURN_CAPACITY + 49}`
        })
      )?.status
    ).toBe(400);
  });
});

describe("no oracle", () => {
  test("wrong form, wrong tenant, replay, verifier error and timeout are one response", async () => {
    const wrongForm = await enforcePublicFormCaptcha(
      request(),
      "form_b",
      await solved("form_a")
    );
    const wrongTenant = await enforcePublicFormCaptcha(
      request(TENANT_A),
      "f",
      await solved("f", TENANT_B)
    );
    const used = await solved("f");
    await enforcePublicFormCaptcha(request(), "f", used);
    const replay = await enforcePublicFormCaptcha(request(), "f", used);
    fixture.mode.throws = true;
    const thrown = await enforcePublicFormCaptcha(request(), "f", {
      challengeToken: "x1"
    });
    fixture.mode.throws = false;
    fixture.mode.hangs = true;
    const timedOut = await enforcePublicFormCaptcha(
      request(),
      "f",
      { challengeToken: "x2" },
      { timeoutMs: 20 }
    );

    const bodies = await Promise.all(
      [wrongForm, wrongTenant, replay, thrown, timedOut].map(async (r) => ({
        status: r?.status,
        body: await body(r)
      }))
    );

    for (const entry of bodies) {
      expect(entry.status).toBe(400);
      expect(entry.body).toEqual(bodies[0]!.body);
    }

    expect((bodies[0]!.body as { error: { code: string } }).error.code).toBe(
      "CHALLENGE_INVALID"
    );
  });
});

describe("issue / harness solver", () => {
  test("issuePublicFormChallenge goes through the active provider", async () => {
    const issued = await issuePublicFormChallenge("f", TENANT_A);

    expect(issued?.providerKey).toBe("fixture_captcha");
    expect(issued?.challenge.challengeId).toStartWith("tok_");
  });

  test("no provider on: nothing to issue and nothing to solve", async () => {
    fixture.mode.enabled = false;
    expect(await issuePublicFormChallenge("f", TENANT_A)).toBeNull();
    expect(await solvePublicFormChallengeForTests("f", TENANT_A)).toBeNull();
  });

  test("the seam never calls the test solver", async () => {
    let called = 0;
    registerPublicFormChallengeTestSolver(fixture.key, async () => {
      called += 1;
      return {};
    });
    await enforcePublicFormCaptcha(request(), "f", {});
    expect(called).toBe(0);
  });
});

describe("descriptor validation", () => {
  test("the real registry validates", () => {
    expect(
      validatePublicFormChallengeProviderDeclarations(listModules())
    ).toEqual([]);
  });

  test("a duplicate key, bad key, missing method and bad code are reported", () => {
    const a = makeFixture("dup");
    const b = makeFixture("dup");
    const bad = {
      ...makeFixture("Bad-Key"),
      verify: undefined,
      legacyTokenField: "challengeToken",
      refusal: { invalidCode: "lower" }
    } as unknown as ModulePublicFormChallengeProvider;
    const messages = validatePublicFormChallengeProviderDeclarations([
      moduleWith(a, b, bad)
    ]).map((issue) => issue.message);

    expect(messages.some((m) => m.includes("also declared"))).toBe(true);
    expect(messages.some((m) => m.includes("snake case key"))).toBe(true);
    expect(messages.some((m) => m.includes("verify()"))).toBe(true);
    expect(messages.some((m) => m.includes("legacyTokenField"))).toBe(true);
    expect(messages.some((m) => m.includes("refusal code"))).toBe(true);
  });
});

describe("platform forms", () => {
  test("form names are the Turnstile action labels", () => {
    expect(PUBLIC_FORM_NAMES.login).toBe(LOGIN_TURNSTILE_ACTION);
    expect(PUBLIC_FORM_NAMES.setup).toBe(SETUP_TURNSTILE_ACTION);
    expect(PUBLIC_FORM_NAMES.passwordReset).toBe(
      PASSWORD_RESET_TURNSTILE_ACTION
    );
    expect(PUBLIC_FORM_NAMES.register).toBe(REGISTER_TURNSTILE_ACTION);
    expect(PUBLIC_FORM_NAMES.invitationAccept).toBe(
      INVITATION_ACCEPT_TURNSTILE_ACTION
    );
  });
});

describe("test solvers cannot ride along in production", () => {
  test("a descriptor that carries solveForTests fails validation", () => {
    const smuggled = {
      ...makeFixture("smuggler"),
      solveForTests: async () => ({ challengeToken: "free" })
    } as unknown as ModulePublicFormChallengeProvider;

    expect(
      validatePublicFormChallengeProviderDeclarations([
        moduleWith(smuggled)
      ]).map((issue) => issue.message)
    ).toEqual([expect.stringContaining("solveForTests")]);
  });

  test("registering a solver outside NODE_ENV=test throws", () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      expect(() =>
        registerPublicFormChallengeTestSolver("k", async () => ({}))
      ).toThrow();
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  test("a registration call from src/ or scripts/ is reported", () => {
    expect(
      findTestSolverRegistrations([
        {
          path: "src/modules/x/module.ts",
          text: "registerPublicFormChallengeTestSolver('k', f)"
        },
        {
          path: "src/lib/security/public-form-challenge.ts",
          text: "export function registerPublicFormChallengeTestSolver() {}"
        },
        {
          path: "scripts/y.ts",
          text: "// registerPublicFormChallengeTestSolver"
        }
      ])
    ).toEqual(["src/modules/x/module.ts"]);
  });
});

describe("no second path around the seam", () => {
  const offending = (text: string) =>
    findDirectTurnstileCalls([{ path: "src/pages/api/v1/auth/x.ts", text }]);

  test("a plain import of either entry point is reported", () => {
    expect(
      offending(
        'import { enforceTurnstileIfRequired } from "../../lib/security/turnstile";'
      )
    ).toHaveLength(1);
    expect(
      offending(
        'import {\n  verifyTurnstileToken\n} from "../../lib/security/turnstile";'
      )
    ).toHaveLength(1);
  });

  test("the three evasions of the probe are reported: alias, namespace + string access, dynamic import", () => {
    expect(
      offending(
        'import { enforceTurnstileIfRequired as quiet } from "../lib/security/turnstile";'
      )
    ).toHaveLength(1);
    expect(
      offending(
        'import * as t from "../lib/security/turnstile";\nawait t["verifyTurnstileToken"](a, b, c);'
      )
    ).toHaveLength(1);
    expect(
      offending('const m = await import("../lib/security/turnstile");')
    ).toHaveLength(1);
    expect(
      offending('const m = require("../lib/security/turnstile.ts");')
    ).toHaveLength(1);
    expect(
      offending(
        'export { verifyTurnstileToken } from "../lib/security/turnstile";'
      )
    ).toHaveLength(1);
  });

  test("importing the other exports, a comment, or an unrelated module is not", () => {
    expect(
      offending(
        'import { isTurnstileRequired, TURNSTILE_ORIGIN } from "../lib/security/turnstile";'
      )
    ).toEqual([]);
    expect(
      offending("// import { verifyTurnstileToken } from './turnstile'")
    ).toEqual([]);
    expect(
      offending('import { verifyTurnstileToken } from "./not-the-module";')
    ).toEqual([]);
    expect(
      offending(
        'import "../styles/a.css";\nimport { x } from "../lib/security/turnstile";'
      )
    ).toEqual([]);
  });

  test("the allow-listed files are exempt, with a reason each; website-engagement is the recorded exception", () => {
    for (const path of Object.keys(TURNSTILE_ENTRY_IMPORT_ALLOW_LIST)) {
      expect(TURNSTILE_ENTRY_IMPORT_ALLOW_LIST[path]!.length).toBeGreaterThan(
        20
      );
      expect(
        findDirectTurnstileCalls([
          {
            path,
            text: 'import { verifyTurnstileToken } from "./turnstile";'
          }
        ])
      ).toEqual([]);
    }

    expect(
      TURNSTILE_ENTRY_IMPORT_ALLOW_LIST[
        "src/modules/website-engagement/application/submission-intake.ts"
      ]
    ).toContain("per SOURCE");
  });

  test("the real source tree has no other importer", () => {
    const files: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;

        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|astro)$/.test(entry.name))
          files.push({ path: full, text: readFileSync(full, "utf8") });
      }
    };
    walk("src");
    walk("scripts");

    expect(findDirectTurnstileCalls(files)).toEqual([]);
  });
});

describe("integration harness hook", () => {
  const echo = (async ({ request }: { request: Request }) =>
    Response.json(await request.json())) as never;

  async function sent(options: Parameters<typeof invoke>[1]) {
    return (await invoke(echo, { method: "POST", ...options })).body as Record<
      string,
      unknown
    >;
  }

  test("a platform form route gets a solved challenge by default", async () => {
    const result = await sent({
      path: "/api/v1/auth/password/forgot",
      headers: { "X-AWCMS-Tenant-ID": TENANT_A },
      body: { loginIdentifier: "a" }
    });

    expect(String(result.challengeToken)).toStartWith("tok_");
    expect(result.loginIdentifier).toBe("a");
  });

  test("the invitation accept route is recognised, and a solved token is accepted by the seam", async () => {
    const result = await sent({
      path: "/api/v1/auth/invitations/abc/accept",
      headers: { "x-awcms-tenant-id": TENANT_A },
      body: { password: "x" }
    });

    expect(
      await enforcePublicFormCaptcha(
        request(TENANT_A),
        "invitation_accept",
        result
      )
    ).toBeNull();
  });

  test("opt out with challenge: false; explicit fields and other paths are untouched", async () => {
    expect(
      await sent({
        path: "/api/v1/auth/password/forgot",
        body: { loginIdentifier: "a" },
        challenge: false
      })
    ).toEqual({ loginIdentifier: "a" });
    expect(
      (
        await sent({
          path: "/api/v1/auth/password/forgot",
          body: { challengeToken: "mine" }
        })
      ).challengeToken
    ).toBe("mine");
    expect(
      await sent({ path: "/api/v1/other", body: { loginIdentifier: "a" } })
    ).toEqual({ loginIdentifier: "a" });
  });

  test("no provider on: the body is exactly what the test sent", async () => {
    fixture.mode.enabled = false;

    expect(
      await sent({
        path: "/api/v1/auth/login",
        body: { loginIdentifier: "a", password: "b" }
      })
    ).toEqual({ loginIdentifier: "a", password: "b" });
  });
});

describe("the Turnstile descriptor stays light and the verifier is late-bound", () => {
  test("isEnabled agrees with isTurnstileRequired over every flag combination", () => {
    for (const enabled of [undefined, "true", "false"]) {
      for (const online of [undefined, "true", "false"]) {
        for (const profile of [undefined, "full_online", "disabled"]) {
          const env = {
            AUTH_ONLINE_SECURITY_ENABLED: online,
            AUTH_ONLINE_SECURITY_PROFILE: profile,
            TURNSTILE_ENABLED: enabled
          } as NodeJS.ProcessEnv;

          expect(isTurnstileChallengeEnabled(env)).toBe(
            isTurnstileRequired(env)
          );
        }
      }
    }
  });

  test("the descriptor does not import turnstile.ts (that would put TURNSTILE_SECRET_KEY into every job's import closure)", () => {
    const text = stripComments(
      readFileSync(
        new URL(
          "../src/modules/identity-access/infrastructure/turnstile-challenge-provider.ts",
          import.meta.url
        ),
        "utf8"
      )
    );

    expect(text).not.toMatch(/from\s+["'][^"']*security\/turnstile["']/);
    expect(text).not.toContain("TURNSTILE_SECRET_KEY");
  });

  test("the seam imports the bindings, so every enforcing process has the verifier bound", () => {
    expect(
      readFileSync(
        new URL(
          "../src/lib/security/public-form-challenge.ts",
          import.meta.url
        ),
        "utf8"
      )
    ).toContain('import "./public-form-challenge-bindings";');
  });

  test("a provider whose verifier is not bound refuses (fail-closed), it never passes", async () => {
    const env = {
      AUTH_ONLINE_SECURITY_ENABLED: "true",
      AUTH_ONLINE_SECURITY_PROFILE: "full_online",
      TURNSTILE_ENABLED: "true"
    } as NodeJS.ProcessEnv;
    const key = turnstileChallengeProvider.key;
    // Bound by the seam's own import of the bindings file.
    const real = requirePublicFormChallengeVerifier(key);

    installExtensionPointSource(() => [moduleWith(turnstileChallengeProvider)]);
    unbindPublicFormChallengeVerifierForTests(key);

    try {
      const response = await enforcePublicFormCaptcha(
        request(),
        "login",
        { turnstileToken: "t" },
        { env }
      );

      expect(response?.status).toBe(400);
    } finally {
      // Restore the real binding for the rest of the process.
      bindPublicFormChallengeVerifier(key, real);
    }
  });
});
