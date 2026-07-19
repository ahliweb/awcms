/**
 * Unit tests for the pure OIDC decision logic (Issue #185): ID-token claim
 * validation (issuer/audience/azp/expiry/nonce/sub), OAuth-request evaluation,
 * email-domain allow-list, break-glass requirement, auto-link resolution, state
 * param round-trip, PKCE S256 challenge, and `returnTo` sanitization.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateOAuthRequest,
  isEmailDomainAllowed,
  validateIdTokenClaims
} from "../src/modules/identity-access/domain/oidc-policy";
import {
  evaluateBreakGlassRequirement,
  isAutoLinkAllowedForProvider,
  validateCreateAuthProviderInput
} from "../src/modules/identity-access/domain/tenant-sso-policy";
import {
  buildOAuthStateParam,
  computePkceChallengeS256,
  parseOAuthStateParam,
  sanitizeReturnTo
} from "../src/lib/auth/oauth-state-token";

const BASE = {
  expectedIssuer: "https://idp.example",
  expectedAudience: "client-abc",
  expectedNonce: "nonce-xyz",
  nowSec: 1_000_000
};

function claims(over: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "subject-1",
    iss: "https://idp.example",
    aud: "client-abc",
    exp: BASE.nowSec + 300,
    iat: BASE.nowSec - 5,
    nonce: "nonce-xyz",
    ...over
  };
}

describe("validateIdTokenClaims", () => {
  test("accepts a fully valid token", () => {
    const r = validateIdTokenClaims(claims({}), BASE);
    expect(r.outcome).toBe("valid");
    if (r.outcome === "valid") {
      expect(r.subject).toBe("subject-1");
      expect(r.issuer).toBe("https://idp.example");
    }
  });

  test("rejects a missing/empty subject (never keys on email)", () => {
    expect(validateIdTokenClaims(claims({ sub: "" }), BASE).outcome).toBe(
      "invalid"
    );
    expect(validateIdTokenClaims(claims({ sub: 123 }), BASE).outcome).toBe(
      "invalid"
    );
  });

  test("rejects issuer / audience / nonce mismatch", () => {
    expect(
      validateIdTokenClaims(claims({ iss: "https://evil" }), BASE).outcome
    ).toBe("invalid");
    expect(validateIdTokenClaims(claims({ aud: "other" }), BASE).outcome).toBe(
      "invalid"
    );
    expect(
      validateIdTokenClaims(claims({ nonce: "wrong" }), BASE).outcome
    ).toBe("invalid");
  });

  test("accepts an array aud containing the client, requires azp when multiple", () => {
    expect(
      validateIdTokenClaims(
        claims({ aud: ["client-abc", "other"], azp: "client-abc" }),
        BASE
      ).outcome
    ).toBe("valid");
    // multiple audiences without azp -> invalid
    expect(
      validateIdTokenClaims(claims({ aud: ["client-abc", "other"] }), BASE)
        .outcome
    ).toBe("invalid");
    // azp present but wrong -> invalid
    expect(
      validateIdTokenClaims(claims({ azp: "someone-else" }), BASE).outcome
    ).toBe("invalid");
  });

  test("rejects expired and future-issued tokens (bounded skew)", () => {
    expect(
      validateIdTokenClaims(claims({ exp: BASE.nowSec - 120 }), BASE).outcome
    ).toBe("invalid");
    expect(
      validateIdTokenClaims(claims({ iat: BASE.nowSec + 3600 }), BASE).outcome
    ).toBe("invalid");
  });
});

describe("evaluateOAuthRequest", () => {
  const now = new Date(1_000_000);
  test("valid when unconsumed and unexpired", () => {
    expect(
      evaluateOAuthRequest(
        { expiresAt: new Date(now.getTime() + 1000), consumedAt: null },
        now
      ).outcome
    ).toBe("valid");
  });
  test("invalid when not found / already used / expired", () => {
    expect(evaluateOAuthRequest(null, now).outcome).toBe("invalid");
    expect(
      evaluateOAuthRequest(
        { expiresAt: new Date(now.getTime() + 1000), consumedAt: now },
        now
      ).outcome
    ).toBe("invalid");
    expect(
      evaluateOAuthRequest(
        { expiresAt: new Date(now.getTime() - 1), consumedAt: null },
        now
      ).outcome
    ).toBe("invalid");
  });
});

describe("isEmailDomainAllowed (fail-closed on empty list)", () => {
  test("empty list never allows", () => {
    expect(isEmailDomainAllowed("a@corp.com", [])).toBe(false);
  });
  test("matches by domain, case-insensitive", () => {
    expect(isEmailDomainAllowed("a@Corp.com", ["corp.com"])).toBe(true);
    expect(isEmailDomainAllowed("a@evil.com", ["corp.com"])).toBe(false);
    expect(isEmailDomainAllowed("no-at", ["corp.com"])).toBe(false);
  });
});

describe("evaluateBreakGlassRequirement", () => {
  test("no break-glass needed when neither restrictive flag is set", () => {
    expect(
      evaluateBreakGlassRequirement({
        passwordLoginEnabled: true,
        ssoRequired: false,
        breakGlassIdentityIds: [],
        eligibleBreakGlassCount: 0
      }).outcome
    ).toBe("ok");
  });
  test("sso_required or password disabled requires >=1 eligible", () => {
    expect(
      evaluateBreakGlassRequirement({
        passwordLoginEnabled: true,
        ssoRequired: true,
        breakGlassIdentityIds: ["x"],
        eligibleBreakGlassCount: 0
      }).outcome
    ).toBe("invalid");
    expect(
      evaluateBreakGlassRequirement({
        passwordLoginEnabled: false,
        ssoRequired: false,
        breakGlassIdentityIds: ["x"],
        eligibleBreakGlassCount: 1
      }).outcome
    ).toBe("ok");
  });
});

describe("isAutoLinkAllowedForProvider (two fail-closed layers)", () => {
  test("master switch off blocks everything", () => {
    expect(
      isAutoLinkAllowedForProvider(false, true, true, [], "corp.com")
    ).toBe(false);
  });
  test("requires verified email + provider domain allowed", () => {
    expect(
      isAutoLinkAllowedForProvider(true, false, true, [], "corp.com")
    ).toBe(false);
    expect(
      isAutoLinkAllowedForProvider(true, true, false, [], "corp.com")
    ).toBe(false);
    expect(isAutoLinkAllowedForProvider(true, true, true, [], "corp.com")).toBe(
      true
    );
  });
  test("policy domain list, when set, is an additional gate", () => {
    expect(
      isAutoLinkAllowedForProvider(true, true, true, ["corp.com"], "corp.com")
    ).toBe(true);
    expect(
      isAutoLinkAllowedForProvider(true, true, true, ["corp.com"], "other.com")
    ).toBe(false);
  });
});

describe("state param + PKCE + returnTo", () => {
  test("state param round-trips tenant id and rejects malformed", () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const param = buildOAuthStateParam(tenantId, "raw.token.value");
    const parsed = parseOAuthStateParam(param);
    expect(parsed?.tenantId).toBe(tenantId);
    expect(parsed?.token).toBe("raw.token.value");
    expect(parseOAuthStateParam("not-a-uuid.tok")).toBeNull();
    expect(parseOAuthStateParam("nostate")).toBeNull();
  });

  test("PKCE S256 challenge matches the RFC 7636 test vector", () => {
    // RFC 7636 Appendix B verifier/challenge pair.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(computePkceChallengeS256(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  test("sanitizeReturnTo only accepts same-origin absolute paths", () => {
    expect(sanitizeReturnTo("/admin/offices")).toBe("/admin/offices");
    expect(sanitizeReturnTo("//evil.com")).toBeNull();
    expect(sanitizeReturnTo("https://evil.com")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnTo("/\\evil")).toBeNull();
    expect(sanitizeReturnTo("relative")).toBeNull();
    expect(sanitizeReturnTo(null)).toBeNull();
  });

  test("sanitizeReturnTo rejects control characters (CRLF / NUL / TAB / DEL)", () => {
    expect(sanitizeReturnTo("/admin\r\nSet-Cookie: x=y")).toBeNull();
    expect(sanitizeReturnTo("/admin\nX")).toBeNull();
    expect(sanitizeReturnTo("/admin\tX")).toBeNull();
    expect(sanitizeReturnTo("/admin\u0000")).toBeNull();
    expect(sanitizeReturnTo("/admin\u007f")).toBeNull();
    // A clean same-origin path is still accepted.
    expect(sanitizeReturnTo("/admin/offices?tab=1")).toBe(
      "/admin/offices?tab=1"
    );
  });
});

describe("validateCreateAuthProviderInput", () => {
  test("requires https issuer and exactly one secret source", () => {
    const ok = validateCreateAuthProviderInput({
      providerKey: "okta",
      displayName: "Okta",
      issuerUrl: "https://okta.example",
      clientId: "abc",
      clientSecretEnvVar: "OKTA_SECRET"
    });
    expect(ok.valid).toBe(true);

    const httpIssuer = validateCreateAuthProviderInput({
      providerKey: "okta",
      displayName: "Okta",
      issuerUrl: "http://okta.example",
      clientId: "abc",
      clientSecretEnvVar: "X"
    });
    expect(httpIssuer.valid).toBe(false);

    const bothSecrets = validateCreateAuthProviderInput({
      providerKey: "okta",
      displayName: "Okta",
      issuerUrl: "https://okta.example",
      clientId: "abc",
      clientSecret: "s",
      clientSecretEnvVar: "X"
    });
    expect(bothSecrets.valid).toBe(false);

    const badKey = validateCreateAuthProviderInput({
      providerKey: "Okta Inc",
      displayName: "Okta",
      issuerUrl: "https://okta.example",
      clientId: "abc",
      clientSecretEnvVar: "X"
    });
    expect(badKey.valid).toBe(false);
  });
});
