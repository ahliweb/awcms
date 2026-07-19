/**
 * Dependency-free OIDC ID-token JWT verification (Issue #185, epic
 * ERP-readiness enterprise auth #177). Ported/adapted from awcms-mini
 * `src/lib/auth/jwt-verify.ts` (Issue #590), which was RS256-only for Google.
 *
 * ADAPTATIONS vs mini (issue #185's own "fail-closed algorithm" requirement):
 *   - Supports RS256 AND ES256 (Google/Entra use RS256; some Keycloak/others
 *     issue ES256), the two algorithms in `ALLOWED_JWT_ALGORITHMS`.
 *   - A strict algorithm allow-list is enforced, AND the header `alg` must
 *     match the resolved JWK's key type (RS256↔RSA, ES256↔EC P-256). This
 *     rejects `alg: "none"` and every algorithm-confusion variant (e.g. an
 *     `HS256` token "verified" with the public key as an HMAC secret — HMAC is
 *     never in the allow-list, and an RSA key can never satisfy an EC verify or
 *     vice versa).
 *
 * Bun-only: signature verification is delegated to the platform's own WebCrypto
 * (`crypto.subtle`), never a hand-rolled RSA/EC implementation and never an
 * added `jose`/`jsonwebtoken` dependency. This file only does JWT framing
 * (base64url, header/payload parsing) and JWKS key selection; issuer/audience/
 * expiry/nonce/azp POLICY lives in the pure
 * `modules/identity-access/domain/oidc-policy.ts`.
 */
export const ALLOWED_JWT_ALGORITHMS = ["RS256", "ES256"] as const;

export type AllowedJwtAlgorithm = (typeof ALLOWED_JWT_ALGORITHMS)[number];

export function isAllowedJwtAlgorithm(
  alg: unknown
): alg is AllowedJwtAlgorithm {
  return (
    typeof alg === "string" &&
    (ALLOWED_JWT_ALGORITHMS as readonly string[]).includes(alg)
  );
}

function base64UrlDecode(segment: string): Buffer {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLength), "base64");
}

export type JwtHeader = { alg?: string; kid?: string; typ?: string };
export type JwtPayload = Record<string, unknown>;

export type ParsedJwt = {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: string;
  signature: Buffer;
};

/** Splits and base64url-decodes a compact JWT — throws on any structural malformation. Never verifies the signature (see `verifyJwtSignature`). */
export function parseJwt(token: string): ParsedJwt {
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected exactly 3 dot-separated parts.");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(
    base64UrlDecode(headerPart!).toString("utf8")
  ) as JwtHeader;
  const payload = JSON.parse(
    base64UrlDecode(payloadPart!).toString("utf8")
  ) as JwtPayload;

  return {
    header,
    payload,
    signingInput: `${headerPart}.${payloadPart}`,
    signature: base64UrlDecode(signaturePart!)
  };
}

export type Jwk = {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  // RSA
  n?: string;
  e?: string;
  // EC
  crv?: string;
  x?: string;
  y?: string;
};

/**
 * Selects the JWKS entry to verify with. Prefers an exact `kid` match (the
 * normal case — a provider rotates keys and the ID token's `kid` header names
 * which one signed it). If the token omits `kid` and the JWKS publishes exactly
 * one key, that single key is used; otherwise verification must fail closed
 * (ambiguous key selection is never guessed).
 */
export function findJwk(
  jwks: { keys: Jwk[] },
  kid: string | undefined
): Jwk | null {
  if (kid) {
    return jwks.keys.find((key) => key.kid === kid) ?? null;
  }

  return jwks.keys.length === 1 ? jwks.keys[0]! : null;
}

/**
 * Verifies a JWT signature over `signingInput` using a public JWK, via
 * WebCrypto — never a hand-rolled implementation. `alg` is the ALREADY
 * allow-list-validated header algorithm; this function additionally asserts it
 * matches the JWK's key type (the alg-confusion defense). Returns `false`
 * (never throws) for any unusable key/algorithm mismatch, so a bad JWKS
 * degrades to "verification failed", not a crash.
 */
export async function verifyJwtSignature(
  signingInput: string,
  signature: Buffer,
  jwk: Jwk,
  alg: string
): Promise<boolean> {
  if (!isAllowedJwtAlgorithm(alg)) {
    return false;
  }

  try {
    if (alg === "RS256") {
      if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
        return false;
      }

      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );

      return await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        new Uint8Array(signature),
        new TextEncoder().encode(signingInput)
      );
    }

    // ES256 — P-256 ECDSA. The JWKS `crv` MUST be P-256 (an ES256 token signed
    // with a P-384/P-521 key is rejected), and the signature is raw r||s
    // (64 bytes), which is exactly what WebCrypto's ECDSA verify expects.
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new Uint8Array(signature),
      new TextEncoder().encode(signingInput)
    );
  } catch {
    return false;
  }
}
