/**
 * Adoption of the public-form challenge seam (Issue #1353, follow-up to the seam
 * PR): provider-declared client widget, module-declared form routes, the CSP
 * origins of the enabled provider, the route gate, and the pages / newsletter /
 * comments that moved onto the seam.
 *
 * No database. MUTATION PROOF is listed in the PR body: each control below was
 * broken, the named test went red, and it was restored.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { APIRoute } from "astro";
import { parse as parseYaml } from "yaml";

import {
  PUBLIC_FORM_NAMES,
  resetPublicFormChallengeForTests,
  resolvePublicFormChallengeCspOrigins,
  resolvePublicFormChallengeWidget,
  resolvePublicFormForRoute
} from "../src/lib/security/public-form-challenge";
import { resetRateLimitForTests } from "../src/lib/security/rate-limit";
import { buildSecurityHeaders } from "../src/lib/security/security-headers";
import { TURNSTILE_ORIGIN } from "../src/lib/security/turnstile";
import { listModules } from "../src/modules";
import {
  challengeRoutePatternToRegExp,
  validatePublicFormChallengeFormDeclarations,
  validatePublicFormChallengeProviderDeclarations
} from "../src/modules/_shared/extension-point-declarations";
import {
  installExtensionPointSource,
  uninstallExtensionPointSourceForTests
} from "../src/modules/_shared/extension-point-source";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import type { ModulePublicFormChallengeProvider } from "../src/modules/_shared/public-form-challenge-contract";
import {
  TURNSTILE_WIDGET_ORIGIN,
  TURNSTILE_WIDGET_SCRIPT_SRC
} from "../src/modules/identity-access/infrastructure/turnstile-challenge-provider";
import {
  apiRouteOfPageFile,
  findChallengeRouteProblems
} from "../scripts/extension-points-check";
import { POST as commentsPOST } from "../src/pages/api/v1/comments/index";
import { POST as newsletterPOST } from "../src/pages/api/v1/newsletter/subscribe";

const read = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function moduleWith(
  providers: ModulePublicFormChallengeProvider[],
  forms: ModuleDescriptor["publicFormChallengeForms"] = []
): ModuleDescriptor {
  return {
    key: "fixture_mod",
    name: "Fixture",
    version: "1.0.0",
    status: "active",
    description: "fixture",
    dependencies: [],
    publicFormChallengeProviders: providers,
    publicFormChallengeForms: forms
  } as unknown as ModuleDescriptor;
}

function provider(
  overrides: Partial<ModulePublicFormChallengeProvider> = {}
): ModulePublicFormChallengeProvider {
  return {
    key: "fixture_captcha",
    description: "fixture",
    isEnabled: () => true,
    issue: async () => ({ challengeId: "c1", prompt: "KEY" }),
    verify: async () => ({ ok: true }),
    widget: {
      scriptSrc: "https://captcha.example/api.js",
      cspOrigins: ["https://captcha.example"],
      containerClass: "fixture-widget",
      attributes: ({ formName, challenge }) => ({
        "data-key": String(challenge.prompt),
        "data-form": formName
      })
    },
    ...overrides
  };
}

afterEach(() => {
  uninstallExtensionPointSourceForTests();
  installExtensionPointSource(listModules);
});

describe("widget declaration validation", () => {
  const messages = (widget: unknown) =>
    validatePublicFormChallengeProviderDeclarations([
      moduleWith([provider({ widget: widget as never })])
    ]).map((issue) => issue.message);

  test("the fixture widget is valid", () => {
    expect(messages(provider().widget)).toEqual([]);
  });

  test("an http, path-bearing, wildcard or scheme-only CSP origin is refused", () => {
    for (const origin of [
      "http://captcha.example",
      "https://captcha.example/path",
      "https://*.captcha.example",
      "https:",
      "*"
    ]) {
      expect(
        messages({ ...provider().widget, cspOrigins: [origin] }).join("|")
      ).toContain("invalid CSP origin");
    }
  });

  test("a script origin missing from cspOrigins, a non-https script and a credentialed script are refused", () => {
    expect(
      messages({ ...provider().widget, cspOrigins: [] }).join("|")
    ).toContain("must be listed in cspOrigins");
    expect(
      messages({
        ...provider().widget,
        scriptSrc: "http://captcha.example/api.js"
      }).join("|")
    ).toContain("https URL");
    expect(
      messages({
        ...provider().widget,
        scriptSrc: "https://u:p@captcha.example/api.js"
      }).join("|")
    ).toContain("https URL");
  });

  test("a container class that could break out of the attribute, and a missing attributes(), are refused", () => {
    expect(
      messages({ ...provider().widget, containerClass: 'a" onload="x' }).join(
        "|"
      )
    ).toContain("containerClass");
    expect(
      messages({ ...provider().widget, attributes: undefined }).join("|")
    ).toContain("attributes()");
  });
});

describe("form declaration validation", () => {
  const messages = (modules: ModuleDescriptor[]) =>
    validatePublicFormChallengeFormDeclarations(modules).map(
      (issue) => issue.message
    );

  test("the real registry is valid", () => {
    expect(messages(listModules())).toEqual([]);
  });

  test("bad names, empty routes, non-API routes and a route claimed twice are refused", () => {
    expect(
      messages([moduleWith([], [{ formName: "Bad-Name", routes: ["/api/x"] }])])
    ).toHaveLength(1);
    expect(
      messages([moduleWith([], [{ formName: "ok", routes: [] }])]).join("|")
    ).toContain("at least one route");
    for (const route of ["/login", "/api/x?y=1", "api/x", "/api//x"]) {
      expect(
        messages([moduleWith([], [{ formName: "ok", routes: [route] }])]).join(
          "|"
        )
      ).toContain("invalid route");
    }
    expect(
      messages([
        moduleWith(
          [],
          [
            { formName: "a", routes: ["/api/v1/x"] },
            { formName: "b", routes: ["/api/v1/x"] }
          ]
        )
      ]).join("|")
    ).toContain("also declared");
  });
});

describe("the platform declarations", () => {
  const forms = listModules().flatMap((m) =>
    (m.publicFormChallengeForms ?? []).map((f) => ({ module: m.key, ...f }))
  );

  test("every platform form name equals the name its route passes (PUBLIC_FORM_NAMES)", () => {
    const names = new Set(Object.values(PUBLIC_FORM_NAMES));

    expect(forms.length).toBeGreaterThanOrEqual(7);

    for (const form of forms) {
      expect(names.has(form.formName as never)).toBe(true);
    }

    for (const name of names) {
      expect(forms.some((f) => f.formName === name)).toBe(true);
    }
  });

  test("the Turnstile widget constants restate turnstile.ts exactly", () => {
    expect(TURNSTILE_WIDGET_ORIGIN).toBe(TURNSTILE_ORIGIN);
    expect(TURNSTILE_WIDGET_SCRIPT_SRC.startsWith(`${TURNSTILE_ORIGIN}/`)).toBe(
      true
    );
  });

  test("route to form resolves every declared route, a dynamic segment, and nothing else", () => {
    for (const form of forms) {
      for (const route of form.routes) {
        const concrete = route.replace(/\[[A-Za-z0-9_]+\]/g, "abc");

        expect(resolvePublicFormForRoute(concrete)).toBe(form.formName);
      }
    }

    expect(
      resolvePublicFormForRoute("/api/v1/auth/invitations/abc/accept")
    ).toBe("invitation_accept");
    // A segment never spans a slash, and an unrelated or prefix route is nothing.
    expect(
      resolvePublicFormForRoute("/api/v1/auth/invitations/a/b/accept")
    ).toBeUndefined();
    expect(resolvePublicFormForRoute("/api/v1/auth/loginx")).toBeUndefined();
    expect(resolvePublicFormForRoute("/api/v1/auth/login/x")).toBeUndefined();
    expect(resolvePublicFormForRoute("/api/v1/users")).toBeUndefined();
  });

  test("route patterns escape regex metacharacters", () => {
    expect(challengeRoutePatternToRegExp("/api/a.b").test("/api/aXb")).toBe(
      false
    );
    expect(challengeRoutePatternToRegExp("/api/a.b").test("/api/a.b")).toBe(
      true
    );
  });

  test("a module declaring a NEW form is reached with no shared-file edit", () => {
    installExtensionPointSource(() => [
      moduleWith([provider()], [{ formName: "demo", routes: ["/api/v1/demo"] }])
    ]);

    expect(resolvePublicFormForRoute("/api/v1/demo")).toBe("demo");
  });
});

describe("provider-driven widget", () => {
  const install = (p: ModulePublicFormChallengeProvider[]) =>
    installExtensionPointSource(() => [moduleWith(p)]);

  test("a declared widget is resolved for the enabled provider, with the form as context", async () => {
    install([provider()]);

    expect(await resolvePublicFormChallengeWidget("login")).toEqual({
      providerKey: "fixture_captcha",
      scriptSrc: "https://captcha.example/api.js",
      containerClass: "fixture-widget",
      attributes: { "data-key": "KEY", "data-form": "login" }
    });
  });

  test("nothing renders with no provider on, no widget declared, null attributes, a throwing issue, or an ambiguous configuration", async () => {
    install([provider({ isEnabled: () => false })]);
    expect(await resolvePublicFormChallengeWidget("login")).toBeNull();

    install([provider({ widget: undefined })]);
    expect(await resolvePublicFormChallengeWidget("login")).toBeNull();

    install([
      provider({
        widget: { ...provider().widget!, attributes: () => null }
      })
    ]);
    expect(await resolvePublicFormChallengeWidget("login")).toBeNull();

    install([
      provider({
        issue: async () => {
          throw new Error("boom");
        }
      })
    ]);
    expect(await resolvePublicFormChallengeWidget("login")).toBeNull();

    install([provider(), provider({ key: "second_captcha" })]);
    expect(await resolvePublicFormChallengeWidget("login")).toBeNull();

    uninstallExtensionPointSourceForTests();
    expect(await resolvePublicFormChallengeWidget("login")).toBeNull();
  });

  test("provider output is untrusted: only data-* attributes with bounded string values survive", async () => {
    install([
      provider({
        widget: {
          ...provider().widget!,
          attributes: () =>
            ({
              "data-ok": "1",
              onload: "alert(1)",
              "data-Bad": "x",
              "data-n": 5,
              "data-empty": "",
              "data-long": "x".repeat(5_000),
              "data-challenge-widget": "x",
              'data-x" onload="y': "z"
            }) as never
        }
      })
    ]);

    expect(
      (await resolvePublicFormChallengeWidget("login"))?.attributes
    ).toEqual({ "data-ok": "1" });
  });

  describe("Turnstile (the first provider) through the same path", () => {
    const KEYS = [
      "AUTH_ONLINE_SECURITY_ENABLED",
      "AUTH_ONLINE_SECURITY_PROFILE",
      "TURNSTILE_ENABLED",
      "TURNSTILE_SITE_KEY"
    ] as const;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const key of KEYS) saved[key] = process.env[key];
      installExtensionPointSource(listModules);
    });
    afterEach(() => {
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    const enable = () => {
      process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
      process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
      process.env.TURNSTILE_ENABLED = "true";
      process.env.TURNSTILE_SITE_KEY = "pub-site-key";
    };

    test("renders the Cloudflare widget with the site key and the form as action", async () => {
      enable();

      expect(
        await resolvePublicFormChallengeWidget(PUBLIC_FORM_NAMES.register)
      ).toEqual({
        providerKey: "cloudflare_turnstile",
        scriptSrc: TURNSTILE_WIDGET_SCRIPT_SRC,
        containerClass: "cf-turnstile",
        attributes: {
          "data-sitekey": "pub-site-key",
          "data-action": "register"
        }
      });
      expect(resolvePublicFormChallengeCspOrigins()).toEqual([
        TURNSTILE_ORIGIN
      ]);
    });

    test("off by default, and with no site key: nothing renders and no origin opens", async () => {
      expect(
        await resolvePublicFormChallengeWidget(PUBLIC_FORM_NAMES.login)
      ).toBeNull();
      expect(resolvePublicFormChallengeCspOrigins()).toEqual([]);

      enable();
      delete process.env.TURNSTILE_SITE_KEY;
      expect(
        await resolvePublicFormChallengeWidget(PUBLIC_FORM_NAMES.login)
      ).toBeNull();
    });
  });
});

describe("CSP origins of the enabled provider", () => {
  const csp = (origins?: readonly string[], turnstileEnabled = false) =>
    buildSecurityHeaders({
      isProduction: false,
      turnstileEnabled,
      mediaPublicBaseUrl: "",
      mediaUploadAccountId: "",
      challengeWidgetOrigins: origins
    }).find(([name]) => name === "Content-Security-Policy")![1];
  const directive = (policy: string, name: string) =>
    policy
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `));

  test("default is byte-for-byte the policy without the option", () => {
    expect(csp(undefined)).toBe(csp([]));
    expect(csp(undefined)).not.toContain("captcha.example");
    expect(directive(csp(undefined), "frame-src")).toBeUndefined();
  });

  test("a declared origin opens script-src and frame-src, once, next to Turnstile's", () => {
    const policy = csp(["https://captcha.example", TURNSTILE_ORIGIN], true);

    expect(directive(policy, "script-src")).toContain(
      "https://captcha.example"
    );
    expect(directive(policy, "frame-src")).toBe(
      `frame-src ${TURNSTILE_ORIGIN} https://captcha.example`
    );
    expect(policy.split(TURNSTILE_ORIGIN).length - 1).toBe(2);
  });

  test("a malformed origin is dropped, never emitted (the policy cannot be widened by a bad entry)", () => {
    const policy = csp([
      "*",
      "https:",
      "http://captcha.example",
      "https://captcha.example/path",
      "https://ok.example; script-src 'unsafe-inline'"
    ]);

    expect(policy).not.toContain("captcha.example");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("https: ");
    expect(directive(policy, "frame-src")).toBeUndefined();
  });
});

describe("form names", () => {
  test("the names module stays dependency-free (a descriptor and the gate import it without reaching the Turnstile secret)", () => {
    expect(read("src/modules/_shared/public-form-names.ts")).not.toMatch(
      /^\s*(import|export\s.*\sfrom)\b/m
    );
  });
});

describe("middleware wiring", () => {
  test("the CSP is built with the enabled provider's origins", () => {
    expect(read("src/middleware.ts")).toContain(
      "challengeWidgetOrigins: resolvePublicFormChallengeCspOrigins()"
    );
  });
});

describe("route gate", () => {
  const SEAM_CALL = `await enforcePublicFormCaptcha(request, PUBLIC_FORM_NAMES.demoKey, body);`;
  const mod = (forms: ModuleDescriptor["publicFormChallengeForms"]) => [
    moduleWith([], forms)
  ];

  test("maps page files to routes", () => {
    expect(apiRouteOfPageFile("src/pages/api/v1/a/index.ts")).toBe("/api/v1/a");
    expect(apiRouteOfPageFile("src/pages/api/v1/a/[t]/accept.ts")).toBe(
      "/api/v1/a/[t]/accept"
    );
    expect(apiRouteOfPageFile("src/pages/login.astro")).toBeNull();
    expect(apiRouteOfPageFile("src/lib/x.ts")).toBeNull();
  });

  test("a route that calls the seam without being declared is reported", () => {
    const problems = findChallengeRouteProblems(
      mod([]),
      [{ path: "src/pages/api/v1/demo.ts", text: SEAM_CALL }],
      { demoKey: "demo" }
    );

    expect(problems.join("|")).toContain("no module declares /api/v1/demo");
  });

  test("a declared route with no file, and a name that disagrees, are reported", () => {
    expect(
      findChallengeRouteProblems(
        mod([{ formName: "demo", routes: ["/api/v1/gone"] }]),
        [],
        { demoKey: "demo" }
      ).join("|")
    ).toContain("not an API route file");
    expect(
      findChallengeRouteProblems(
        mod([{ formName: "other", routes: ["/api/v1/demo"] }]),
        [{ path: "src/pages/api/v1/demo.ts", text: SEAM_CALL }],
        { demoKey: "demo" }
      ).join("|")
    ).toContain('never names its declared form "other"');
  });

  test("a declared, present, agreeing route is clean; a commented-out call does not count", () => {
    expect(
      findChallengeRouteProblems(
        mod([{ formName: "demo", routes: ["/api/v1/demo"] }]),
        [{ path: "src/pages/api/v1/demo.ts", text: SEAM_CALL }],
        { demoKey: "demo" }
      )
    ).toEqual([]);
    expect(
      findChallengeRouteProblems(
        mod([]),
        [
          {
            path: "src/pages/api/v1/demo.ts",
            text: `// ${SEAM_CALL}\nexport {}`
          }
        ],
        { demoKey: "demo" }
      )
    ).toEqual([]);
  });

  test("an aliased or re-exported seam import cannot hide an undeclared route", () => {
    for (const text of [
      `import { enforcePublicFormCaptcha as guard } from "x";\nawait guard(request, "demo", body);`,
      `import * as seam from "x";\nconst g = seam.enforcePublicFormCaptcha;\nawait g(request, "demo", body);`
    ]) {
      expect(
        findChallengeRouteProblems(
          mod([]),
          [{ path: "src/pages/api/v1/demo.ts", text }],
          { demoKey: "demo" }
        ).join("|")
      ).toContain("no module declares /api/v1/demo");
    }
  });

  test("the real tree is clean", () => {
    const files: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;

        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name))
          files.push({ path: full, text: readFileSync(full, "utf8") });
      }
    };
    walk("src/pages/api");

    expect(
      findChallengeRouteProblems(listModules(), files, PUBLIC_FORM_NAMES)
    ).toEqual([]);
  });
});

describe("pages carry the provider's widget, not a hard-coded one", () => {
  const PAGES: ReadonlyArray<[string, string]> = [
    ["src/pages/login.astro", "PUBLIC_FORM_NAMES.login"],
    ["src/pages/register.astro", "PUBLIC_FORM_NAMES.register"],
    ["src/pages/forgot-password.astro", "PUBLIC_FORM_NAMES.passwordReset"],
    ["src/pages/reset-password.astro", "PUBLIC_FORM_NAMES.passwordReset"],
    ["src/pages/accept-invitation.astro", "PUBLIC_FORM_NAMES.invitationAccept"]
  ];

  for (const [file, formName] of PAGES) {
    test(`${file}: widget component for ${formName}, no Turnstile markup, no legacy field`, () => {
      const text = read(file);

      expect(text).toContain("<PublicFormChallengeWidget");
      expect(text).toContain(`formName={${formName}}`);
      expect(text).not.toContain("challenges.cloudflare.com");
      expect(text).not.toContain('class="cf-turnstile');
      expect(text).not.toMatch(
        /turnstileToken\s*[:,}]|"cf-turnstile-response"/
      );
      expect(text).toContain("readChallengeFields(");
      expect(text).toContain("focusChallengeOnRefusal(");
      expect(text).toContain("../lib/ui/public-form-challenge-client");
    });
  }

  test("the component renders no inline script body and only an external src", () => {
    const text = read("src/components/PublicFormChallengeWidget.astro");

    expect(text).toContain("data-challenge-widget");
    expect(text).toMatch(/<script is:inline src=\{widget\.scriptSrc\}/);
    expect(text).not.toMatch(/<script[^>]*>[^<]*\S[^<]*<\/script>/);
    expect(text).not.toContain("challenges.cloudflare.com");
  });
});

describe("newsletter and comments adopt the seam with one call each", () => {
  const KEYS = [
    "AUTH_ONLINE_SECURITY_ENABLED",
    "AUTH_ONLINE_SECURITY_PROFILE",
    "TURNSTILE_ENABLED",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "TURNSTILE_EXPECTED_HOSTNAME"
  ] as const;
  const saved: Record<string, string | undefined> = {};
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  let ip = 0;

  beforeEach(() => {
    installExtensionPointSource(listModules);
    resetPublicFormChallengeForTests();
    resetRateLimitForTests();
    fetchCalls = 0;
    for (const key of KEYS) saved[key] = process.env[key];
    process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
    process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
    process.env.TURNSTILE_ENABLED = "true";
    process.env.TURNSTILE_SITE_KEY = "site";
    process.env.TURNSTILE_SECRET_KEY = `sk_${crypto.randomUUID()}`;
    process.env.TURNSTILE_EXPECTED_HOSTNAME = "app.example.test";
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({ success: false, "error-codes": ["x"] });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function post(handler: APIRoute, body: unknown, extra = {}) {
    ip += 1;
    const response = (await handler({
      request: new Request("http://localhost/api/v1/route", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "k1",
          ...extra
        },
        body: JSON.stringify(body)
      }),
      cookies: { get: () => undefined },
      clientAddress: `198.51.100.${(ip % 250) + 1}`,
      url: new URL("http://localhost/api/v1/route"),
      locals: {}
    } as never)) as Response;

    return {
      status: response.status,
      code: (
        (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null
      )?.error?.code
    };
  }

  const NEWSLETTER = { email: "reader@example.test" };
  const COMMENT = {
    resourceType: "blog_post",
    resourceId: "x",
    body: "hello"
  };

  test("provider on, no token: 400 TURNSTILE_REQUIRED before any database work and no siteverify call", async () => {
    expect(await post(newsletterPOST, NEWSLETTER)).toEqual({
      status: 400,
      code: "TURNSTILE_REQUIRED"
    });
    expect(await post(commentsPOST, COMMENT)).toEqual({
      status: 400,
      code: "TURNSTILE_REQUIRED"
    });
    expect(fetchCalls).toBe(0);
  });

  test("a rejected token is refused once and its replay never reaches Cloudflare again", async () => {
    for (const [handler, body] of [
      [newsletterPOST, NEWSLETTER],
      [commentsPOST, COMMENT]
    ] as const) {
      fetchCalls = 0;
      const token = `tok_${crypto.randomUUID()}`;
      const first = await post(handler, { ...body, challengeToken: token });
      const replay = await post(handler, { ...body, challengeToken: token });

      expect(first.code).toBe("TURNSTILE_INVALID");
      expect(replay.code).toBe("TURNSTILE_INVALID");
      expect(fetchCalls).toBe(1);
    }
  });

  test("each handler makes exactly one seam call, after its rate limiter and before database access", () => {
    for (const [file, name, limiter, db] of [
      [
        "src/pages/api/v1/newsletter/subscribe.ts",
        "newsletterSubscribe",
        "checkSharedRateLimit(",
        "getDatabaseClient();"
      ],
      [
        "src/pages/api/v1/comments/index.ts",
        "commentSubmit",
        "comments:submit:",
        "const sql = getDatabaseClient();\n  const now"
      ]
    ] as const) {
      const text = read(file);
      const calls = text.match(/await enforcePublicFormCaptcha\(/g) ?? [];
      const at = text.indexOf("await enforcePublicFormCaptcha(");

      expect(calls).toHaveLength(1);
      expect(text).toContain(`PUBLIC_FORM_NAMES.${name}`);
      expect(text).toContain("if (challengeRefusal)");
      expect(at).toBeGreaterThan(text.indexOf(limiter));
      expect(at).toBeLessThan(text.lastIndexOf(db));
    }
  });
});

describe("OpenAPI documents every declared challenge route (#1353)", () => {
  // Resolve a request-body schema through $ref and allOf to its property names.
  const propertyNames = (
    schema: Record<string, unknown> | undefined,
    spec: Record<string, any>,
    seen = new Set<unknown>()
  ): Set<string> => {
    const out = new Set<string>();
    if (!schema || seen.has(schema)) return out;
    seen.add(schema);
    const ref = schema.$ref as string | undefined;
    if (ref) {
      const target = ref
        .replace(/^#\//, "")
        .split("/")
        .reduce<any>((node, key) => node?.[key], spec);
      return propertyNames(target, spec, seen);
    }
    for (const key of Object.keys((schema.properties as object) ?? {}))
      out.add(key);
    for (const part of (schema.allOf as Record<string, unknown>[]) ?? [])
      for (const key of propertyNames(part, spec, seen)) out.add(key);
    return out;
  };

  const spec = parseYaml(
    readFileSync("openapi/awcms-public-api.openapi.yaml", "utf8")
  ) as Record<string, any>;

  const routes = listModules().flatMap((module) =>
    (module.publicFormChallengeForms ?? []).flatMap((form) =>
      form.routes.map((route) => ({ route, formName: form.formName }))
    )
  );

  test("there are declared routes to check", () => {
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  for (const { route, formName } of routes) {
    test(`${formName} on ${route} declares the neutral challenge field and the legacy token`, () => {
      const path = route.replace(/\[([^\]]+)\]/g, "{$1}");
      const operation = spec.paths?.[path]?.post;
      expect(operation).toBeDefined();
      const names = propertyNames(
        operation.requestBody?.content?.["application/json"]?.schema,
        spec
      );
      expect(names.has("challengeToken")).toBe(true);
      expect(names.has("turnstileToken")).toBe(true);
    });
  }
});
