/**
 * The pure half of the BFF session handoff (ADR-0050).
 *
 * Every rule here is one an attacker would like to be lenient, and the
 * redirect_uri decision is the one ADR-0050 names outright as the way this
 * design fails: "an open-redirect here means handing the code to an attacker,
 * and every other property of the flow stops mattering."
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { describe, expect, test } from "bun:test";

import {
  decideHandoffRedemption,
  decideRedirectUri,
  generateHandoffCode,
  HANDOFF_CODE_TTL_SECONDS,
  hashBffClientSecret,
  hashesEqual,
  hashHandoffCode
} from "../src/modules/identity-access/domain/session-handoff";

const ALLOWED = "https://portal.example.test/internal/callback";
const ALLOW_LIST = [ALLOWED, "https://staging.example.test/internal/callback"];

describe("redirect_uri allow-list", () => {
  test("an exactly-registered https URI is allowed", () => {
    const decision = decideRedirectUri(ALLOWED, ALLOW_LIST);

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.redirectUri).toBe(ALLOWED);
  });

  test("a prefix of a registered URI is REFUSED — the classic form of this bug", () => {
    // `https://portal.example.test` prefix-matches
    // `https://portal.example.test.evil.test`, which is why this is an exact
    // match and not `startsWith`.
    for (const attack of [
      "https://portal.example.test.evil.test/internal/callback",
      "https://portal.example.test/internal/callback/../../evil",
      "https://portal.example.test/internal/callback2",
      "https://evil.test/internal/callback"
    ]) {
      const decision = decideRedirectUri(attack, ALLOW_LIST);
      expect(decision.allowed).toBe(false);
    }
  });

  test("same origin, different path is refused — an origin match is not enough", () => {
    // An attacker who can host content on a permitted origin picks the path,
    // and an open redirect there forwards the code onward.
    const decision = decideRedirectUri(
      "https://portal.example.test/anything-else",
      ALLOW_LIST
    );

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(
      "not_allow_listed"
    );
  });

  test("http is refused outright — the code would cross the wire in clear text", () => {
    const decision = decideRedirectUri(
      "http://portal.example.test/internal/callback",
      ["http://portal.example.test/internal/callback"]
    );

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(
      "not_absolute_https"
    );
  });

  test("a query or fragment is refused, not stripped", () => {
    // Stripping would mean the URI the caller asked for and the URI the code is
    // bound to differ — exactly what binding is supposed to remove.
    for (const value of [`${ALLOWED}?next=/evil`, `${ALLOWED}#evil`]) {
      const decision = decideRedirectUri(value, ALLOW_LIST);
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        "has_query_or_fragment"
      );
    }
  });

  test("a relative or malformed URI is refused", () => {
    for (const value of [
      "/internal/callback",
      "not a url",
      "",
      "//evil.test"
    ]) {
      expect(decideRedirectUri(value, ALLOW_LIST).allowed).toBe(false);
    }
  });

  test("an empty allow-list permits nothing", () => {
    // Fail-closed: an empty list must never read as "unrestricted".
    expect(decideRedirectUri(ALLOWED, []).allowed).toBe(false);
  });
});

describe("redemption preconditions", () => {
  const NOW = new Date("2026-08-02T12:00:00.000Z");
  const CLIENT = "11111111-1111-4111-8111-111111111111";
  const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";

  function state(
    overrides: Partial<
      Parameters<typeof decideHandoffRedemption>[0] & object
    > = {}
  ) {
    return {
      expiresAt: new Date(NOW.getTime() + 30_000),
      redeemedAt: null,
      clientId: CLIENT,
      redirectUri: ALLOWED,
      ...overrides
    };
  }

  const presented = { clientId: CLIENT, redirectUri: ALLOWED };

  test("a fresh, unspent, matching code is redeemable", () => {
    expect(decideHandoffRedemption(state(), presented, NOW).ok).toBe(true);
  });

  test("an unknown code is refused", () => {
    const decision = decideHandoffRedemption(null, presented, NOW);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toBe("unknown_code");
  });

  test("a spent code is refused", () => {
    const decision = decideHandoffRedemption(
      state({ redeemedAt: new Date(NOW.getTime() - 1000) }),
      presented,
      NOW
    );
    expect(decision.ok === false && decision.reason).toBe("already_redeemed");
  });

  test("expiry is exclusive at the boundary", () => {
    // `expires_at == now` is expired, not "just barely valid". A boundary that
    // admits equality is a boundary that admits a clock skew of zero.
    expect(
      decideHandoffRedemption(state({ expiresAt: NOW }), presented, NOW).ok
    ).toBe(false);
    expect(
      decideHandoffRedemption(
        state({ expiresAt: new Date(NOW.getTime() + 1) }),
        presented,
        NOW
      ).ok
    ).toBe(true);
  });

  test("a second registered client cannot spend another's code", () => {
    const decision = decideHandoffRedemption(
      state(),
      { clientId: OTHER_CLIENT, redirectUri: ALLOWED },
      NOW
    );
    expect(decision.ok === false && decision.reason).toBe("client_mismatch");
  });

  test("the redirect_uri must match the one the code was bound to", () => {
    const decision = decideHandoffRedemption(
      state(),
      {
        clientId: CLIENT,
        redirectUri: "https://staging.example.test/internal/callback"
      },
      NOW
    );
    expect(decision.ok === false && decision.reason).toBe(
      "redirect_uri_mismatch"
    );
  });
});

describe("code and secret hashing", () => {
  test("codes are namespaced, and cannot be confused with other bearer hashes", () => {
    const hash = hashHandoffCode("some-code");

    expect(hash).toMatch(/^ho-sha256:[0-9a-f]{64}$/);
    // A session hash is `sha256:…` and a machine credential is `mc-sha256:…`.
    // Distinct prefixes are what let the database CHECK refuse a token of the
    // wrong kind stored here.
    expect(hash.startsWith("sha256:")).toBe(false);
    expect(hash.startsWith("mc-sha256:")).toBe(false);
    expect(hashBffClientSecret("some-secret")).toMatch(
      /^bff-sha256:[0-9a-f]{64}$/
    );
  });

  test("the same input hashes to the same value and different inputs do not", () => {
    expect(hashHandoffCode("a")).toBe(hashHandoffCode("a"));
    expect(hashHandoffCode("a")).not.toBe(hashHandoffCode("b"));
  });

  test("generated codes are long, url-safe, and not repeated", () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => generateHandoffCode())
    );

    expect(codes.size).toBe(200);
    for (const code of codes) {
      // base64url of 32 bytes — no `+`, `/`, or `=` to be mangled in a query
      // string on the way back to the BFF.
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  test("hash comparison is constant-time and still correct", () => {
    const a = hashHandoffCode("x");

    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, hashHandoffCode("y"))).toBe(false);
    // Different lengths must answer false rather than throw, which is what
    // `timingSafeEqual` does on its own.
    expect(hashesEqual(a, "short")).toBe(false);
    expect(hashesEqual("", "")).toBe(true);
  });
});

describe("the TTL is stated in both places", () => {
  test("the constant matches what the database CHECK allows", async () => {
    expect(HANDOFF_CODE_TTL_SECONDS).toBeLessThanOrEqual(60);

    const migration = await Bun.file(
      "sql/088_awcms_session_handoff_schema.sql"
    ).text();

    // A TTL living only in a TypeScript constant is one an edit can widen to an
    // hour with the row still accepted. The database is the backstop, and this
    // asserts the backstop is really there.
    expect(migration).toContain(
      "expires_at <= created_at + interval '60 seconds'"
    );
  });
});
