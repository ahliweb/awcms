/**
 * Unit tests for OIDC ID-token JWT verification (Issue #185). All keys are
 * generated at RUNTIME via WebCrypto — no key material is ever hardcoded (a
 * static private key would trip GitGuardian). Proves the algorithm allow-list
 * (RS256/ES256), the `none`/alg-confusion rejections, and the WebCrypto
 * signature roundtrip for both supported algorithms.
 */
import { describe, expect, test } from "bun:test";

import {
  findJwk,
  isAllowedJwtAlgorithm,
  parseJwt,
  verifyJwtSignature,
  type Jwk
} from "../src/lib/auth/jwt-verify";

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function encodeSegment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

async function signRs256(
  privateKey: CryptoKey,
  header: object,
  payload: object
): Promise<{ token: string; signingInput: string }> {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return {
    token: `${signingInput}.${b64url(new Uint8Array(sig))}`,
    signingInput
  };
}

async function signEs256(
  privateKey: CryptoKey,
  header: object,
  payload: object
): Promise<{ token: string; signingInput: string }> {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return {
    token: `${signingInput}.${b64url(new Uint8Array(sig))}`,
    signingInput
  };
}

describe("jwt-verify — algorithm allow-list", () => {
  test("only RS256 and ES256 are allowed; none/HS256/RS384 rejected", () => {
    expect(isAllowedJwtAlgorithm("RS256")).toBe(true);
    expect(isAllowedJwtAlgorithm("ES256")).toBe(true);
    expect(isAllowedJwtAlgorithm("none")).toBe(false);
    expect(isAllowedJwtAlgorithm("HS256")).toBe(false);
    expect(isAllowedJwtAlgorithm("RS384")).toBe(false);
    expect(isAllowedJwtAlgorithm(undefined)).toBe(false);
    expect(isAllowedJwtAlgorithm(null)).toBe(false);
  });
});

describe("jwt-verify — RS256", () => {
  test("verifies a genuine RS256 signature and rejects a tampered payload", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
    jwk.kid = "rs-1";

    const { token } = await signRs256(
      pair.privateKey,
      { alg: "RS256", kid: "rs-1", typ: "JWT" },
      { sub: "user-1", iss: "https://idp.example" }
    );
    const parsed = parseJwt(token);
    expect(
      await verifyJwtSignature(
        parsed.signingInput,
        parsed.signature,
        jwk,
        "RS256"
      )
    ).toBe(true);

    // Tamper: flip the payload -> signature no longer matches.
    const tampered = await signRs256(
      pair.privateKey,
      { alg: "RS256", kid: "rs-1" },
      { sub: "user-1" }
    );
    const forgedPayload = encodeSegment({ sub: "attacker" });
    const forgedInput = `${tampered.signingInput.split(".")[0]}.${forgedPayload}`;
    const forged = parseJwt(`${forgedInput}.${token.split(".")[2]}`);
    expect(
      await verifyJwtSignature(
        forged.signingInput,
        forged.signature,
        jwk,
        "RS256"
      )
    ).toBe(false);
  });
});

describe("jwt-verify — ES256", () => {
  test("verifies a genuine ES256 (P-256) signature", async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
    jwk.kid = "ec-1";

    const { token } = await signEs256(
      pair.privateKey,
      { alg: "ES256", kid: "ec-1", typ: "JWT" },
      { sub: "user-2" }
    );
    const parsed = parseJwt(token);
    expect(
      await verifyJwtSignature(
        parsed.signingInput,
        parsed.signature,
        jwk,
        "ES256"
      )
    ).toBe(true);
  });
});

describe("jwt-verify — algorithm confusion", () => {
  test("an RS256 header against an EC key fails (kty mismatch)", async () => {
    const ec = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const ecJwk = (await crypto.subtle.exportKey("jwk", ec.publicKey)) as Jwk;

    const rsa = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const { token } = await signRs256(
      rsa.privateKey,
      { alg: "RS256", kid: "x" },
      { sub: "u" }
    );
    const parsed = parseJwt(token);

    // RS256 alg but an EC JWK -> refused (never coerced across key types).
    expect(
      await verifyJwtSignature(
        parsed.signingInput,
        parsed.signature,
        ecJwk,
        "RS256"
      )
    ).toBe(false);
    // A disallowed alg is refused outright.
    expect(
      await verifyJwtSignature(
        parsed.signingInput,
        parsed.signature,
        ecJwk,
        "none"
      )
    ).toBe(false);
    expect(
      await verifyJwtSignature(
        parsed.signingInput,
        parsed.signature,
        ecJwk,
        "HS256"
      )
    ).toBe(false);
  });
});

describe("jwt-verify — findJwk", () => {
  test("matches by kid, falls back to the sole key, refuses ambiguity", () => {
    const a: Jwk = { kty: "RSA", kid: "a" };
    const b: Jwk = { kty: "RSA", kid: "b" };
    expect(findJwk({ keys: [a, b] }, "b")).toBe(b);
    expect(findJwk({ keys: [a, b] }, "missing")).toBeNull();
    expect(findJwk({ keys: [a] }, undefined)).toBe(a);
    expect(findJwk({ keys: [a, b] }, undefined)).toBeNull();
  });
});
