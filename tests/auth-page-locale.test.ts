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

import { resolveAuthPageLocale } from "../src/lib/i18n/auth-page-locale";
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

  test("reset-password names a tenant to the resolver ONLY when it came out of a sealed link", () => {
    const source = read(PAGES.reset);

    // A plain ?tenantId= is attacker-chosen: it must never reach the resolver.
    expect(source).toContain("tenantId: sealed && hasToken && tenantId");
    expect(source).not.toMatch(/tenantId:\s*tenantId\s*[,}\n]/);
  });

  test("no page displays text taken from a response body", () => {
    for (const path of Object.values(PAGES)) {
      const source = read(path);

      expect(source).not.toMatch(/payload\??\.(data\??\.)?(message|error)/);
      expect(source).not.toMatch(/response\.(text|statusText)/);
    }
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
  test("none is a public cache surface, so a cookie-varied language can never be cached", () => {
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
});
