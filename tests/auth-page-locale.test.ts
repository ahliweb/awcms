/**
 * The language of the pre-session auth pages (ADR-0095).
 *
 * Two things must hold and neither is visible by looking at the page:
 *
 *   1. The ORDER: cookie -> tenant default -> Accept-Language -> en, and the
 *      tenant lookup happens only when the caller names a tenant it knows
 *      WITHOUT an oracle (single-tenant deployment; sealed reset link).
 *   2. The language never tells a visitor whether an account or tenant exists:
 *      every failure the client can show is ONE fixed sentence per locale, and
 *      the pages never display text taken from a response body.
 *
 * Controls here were broken on purpose and the matching assertion went red
 * (see the PR description).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyAuthPageCacheHeaders,
  resolveAuthPageLocale,
  tenantForResetLocale
} from "../src/lib/i18n/auth-page-locale";
import { getTranslatorFor } from "../src/lib/i18n";
import { matchPublicCacheSurface } from "../src/lib/edge-cache/surface-registry";

const TENANT = "11111111-1111-4111-8111-111111111111";

function run(input: {
  cookie?: string;
  acceptLanguage?: string;
  tenantId?: string | null;
  tenantDefault?: string | null;
  throws?: boolean;
}) {
  const calls: string[] = [];
  const result = resolveAuthPageLocale({
    cookies: {
      get: (name) =>
        name === "awcms_locale" && input.cookie !== undefined
          ? { value: input.cookie }
          : undefined
    },
    request: new Request("https://app.example/login", {
      headers:
        input.acceptLanguage === undefined
          ? {}
          : { "accept-language": input.acceptLanguage }
    }),
    tenantId: input.tenantId ?? null,
    readTenantDefault: async (tenantId) => {
      calls.push(tenantId);
      if (input.throws) throw new Error("db down");
      return input.tenantDefault ?? null;
    }
  });

  return { result, calls };
}

describe("resolveAuthPageLocale — the chain", () => {
  test("a valid cookie wins over the tenant default and Accept-Language, and skips the lookup", async () => {
    const { result, calls } = run({
      cookie: "en",
      acceptLanguage: "id",
      tenantId: TENANT,
      tenantDefault: "id"
    });

    expect(await result).toBe("en");
    expect(calls).toEqual([]);
  });

  test("with no cookie, the tenant default outranks Accept-Language", async () => {
    const { result, calls } = run({
      acceptLanguage: "en",
      tenantId: TENANT,
      tenantDefault: "id"
    });

    expect(await result).toBe("id");
    expect(calls).toEqual([TENANT]);
  });

  test("an unrecognised cookie is no opinion: the tenant default still applies", async () => {
    const { result } = run({
      cookie: "<script>",
      tenantId: TENANT,
      tenantDefault: "id"
    });

    expect(await result).toBe("id");
  });

  test("with no tenant the lookup is never made and Accept-Language decides", async () => {
    const { result, calls } = run({
      acceptLanguage: "id-ID,id;q=0.9",
      tenantId: null,
      tenantDefault: "en"
    });

    expect(await result).toBe("id");
    expect(calls).toEqual([]);
  });

  test("an unsupported Accept-Language falls back to en", async () => {
    const { result } = run({ acceptLanguage: "fr-FR,de;q=0.8" });

    expect(await result).toBe("en");
  });

  test("an unsupported tenant default is ignored", async () => {
    const { result } = run({
      acceptLanguage: "en",
      tenantId: TENANT,
      tenantDefault: "xx"
    });

    expect(await result).toBe("en");
  });

  test("a failing lookup never fails the page", async () => {
    const { result } = run({
      acceptLanguage: "id",
      tenantId: TENANT,
      throws: true
    });

    expect(await result).toBe("id");
  });
});

const read = (relative: string) =>
  readFileSync(join(import.meta.dir, "..", relative), "utf8");

const PAGES = {
  login: "src/pages/login.astro",
  forgot: "src/pages/forgot-password.astro",
  reset: "src/pages/reset-password.astro"
} as const;

describe("the auth pages — no tenant or account oracle through the language", () => {
  test("no page hard-codes <html lang>, and each renders the resolved locale", () => {
    for (const path of Object.values(PAGES)) {
      const source = read(path);

      expect(source).not.toMatch(/<html lang="en"/);
      expect(source).toContain("<html lang={locale}>");
      expect(source).toContain("resolveAuthPageLocale(");
    }
  });

  test("login and forgot-password name a tenant to the resolver ONLY in single-tenant mode", () => {
    for (const path of [PAGES.login, PAGES.forgot]) {
      expect(read(path)).toContain("tenantId: singleTenant?.id ?? null");
    }
  });

  test("reset-password names a tenant to the resolver ONLY when it came out of a sealed link (behaviour)", () => {
    // The sealed, opened link: the one case that may name a tenant.
    expect(
      tenantForResetLocale({
        sealed: "blob",
        hasToken: true,
        openedTenantId: TENANT
      })
    ).toBe(TENANT);

    // A plain ?tenantId= (no seal) is attacker-chosen: never.
    expect(
      tenantForResetLocale({
        sealed: "",
        hasToken: true,
        openedTenantId: TENANT
      })
    ).toBeNull();
    // A broken seal (opens to nothing) next to a plain parameter: never.
    expect(
      tenantForResetLocale({
        sealed: "broken",
        hasToken: false,
        openedTenantId: TENANT
      })
    ).toBeNull();
    expect(
      tenantForResetLocale({
        sealed: "blob",
        hasToken: true,
        openedTenantId: ""
      })
    ).toBeNull();
  });

  test("the reset page feeds the resolver only through tenantForResetLocale, with the tenant gated on the seal", () => {
    const source = read(PAGES.reset);

    expect(source).toContain("tenantId: tenantForResetLocale({");
    expect(source).toContain('openedTenantId: sealed ? tenantId : ""');
    // Exactly one `tenantId:` key is handed to the resolver.
    const start = source.indexOf("resolveAuthPageLocale({");
    const call = source.slice(start, source.indexOf("});", start));

    expect(call.match(/\btenantId:/g)?.length).toBe(1);
  });

  test("a client script reads nothing from a response body but `success`, and names no error text from it", () => {
    for (const path of Object.values(PAGES)) {
      const source = read(path);
      const scriptStart = source.indexOf("<script");

      // Any access of `payload`, bracket or dot, other than `.success`.
      const script = source.slice(scriptStart);
      const accesses = [
        ...script.matchAll(/payload\??\.?\??\[?\s*([A-Za-z"'_]*)/g)
      ]
        .map((m) => m[1])
        .filter((name) => name && name !== "success");

      expect(accesses).toEqual([]);
      expect(script).not.toMatch(/payload\??\.?\[/);
    }
  });

  test("the login failure message does not depend on the response status", () => {
    const source = read(PAGES.login);
    const script = source.slice(source.indexOf("<script"));

    // Every showError() argument is a server-rendered, fixed data-msg sentence.
    const calls = [
      ...script.matchAll(/(?<!function )showError\(([^)]*)\)/g)
    ].map((m) => m[1]);

    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg).toMatch(/^messages\.msg[A-Za-z]+ \?\? ""$/);
    }
    expect(script).not.toMatch(/response\.status/);
  });

  test("the pages localise through server-rendered data-msg attributes, not client strings keyed by status", () => {
    expect(read(PAGES.login)).toContain("messages.msgFailed");
    expect(read(PAGES.forgot)).toContain("messages.msgSent");
    expect(read(PAGES.reset)).toContain("messages.msgInvalid");
  });

  test("the failure sentences are one fixed string per locale, identical whatever the account state", () => {
    const failures = [
      ["login", "Sign in failed. Check your details and try again."],
      ["recovery", "This password reset link is invalid or has expired."],
      [
        "recovery",
        "If an account exists for that identifier, password reset instructions have been sent."
      ]
    ] as const;

    for (const locale of ["en", "id"] as const) {
      const { tx } = getTranslatorFor(locale);

      for (const [context, msgid] of failures) {
        const first = tx(context, msgid);

        // Deterministic, and translated (id) or the English source (en).
        expect(tx(context, msgid)).toBe(first);
        expect(first.length).toBeGreaterThan(0);
        if (locale === "id") expect(first).not.toBe(msgid);
        else expect(first).toBe(msgid);
      }
    }
  });

  test("the forgot-password confirmation is the endpoint's own generic sentence in English", () => {
    const endpoint = read("src/pages/api/v1/auth/password/forgot.ts");
    const sentence =
      "If an account exists for that identifier, password reset instructions have been sent.";

    expect(endpoint).toContain(sentence);
    expect(getTranslatorFor("en").tx("recovery", sentence)).toBe(sentence);
  });
});

describe("the auth pages stay out of every shared cache", () => {
  test("none is a public cache surface", () => {
    for (const pathname of [
      "/login",
      "/forgot-password",
      "/reset-password",
      "/id/login",
      "/en/login"
    ]) {
      expect(matchPublicCacheSurface(pathname)).toBeNull();
    }
  });

  test("the response carries private, no-store and Vary regardless of EDGE_CACHE_MODE", () => {
    for (const pathname of [
      "/login",
      "/forgot-password",
      "/reset-password",
      "/id/login",
      "/en/reset-password"
    ]) {
      const response = applyAuthPageCacheHeaders(
        pathname,
        new Response("ok", { headers: { Vary: "Origin" } })
      );
      const vary = (response.headers.get("Vary") ?? "").toLowerCase();

      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(vary).toContain("origin");
      expect(vary).toContain("cookie");
      expect(vary).toContain("accept-language");
    }
  });

  test("any other path is left untouched", () => {
    for (const pathname of ["/", "/blog/x", "/admin/login", "/login/x"]) {
      const response = applyAuthPageCacheHeaders(pathname, new Response("ok"));

      expect(response.headers.get("Cache-Control")).toBeNull();
      expect(response.headers.get("Vary")).toBeNull();
    }
  });

  test("the middleware applies it on its single exit point", () => {
    const source = read("src/middleware.ts");

    expect(source).toContain("applyAuthPageCacheHeaders(pathname, response)");
    expect(source).toContain("context.url.pathname\n    )");
  });
});
