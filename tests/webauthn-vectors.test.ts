/**
 * ADR-0168 S1 gates G1 and G2 for the passkey verifier.
 *
 * G1 — the runtime pinned by CI (`.github/workflows/ci.yml`, Bun 1.4.4) can
 * verify all three advertised algorithms, by a real round trip.
 *
 * G2 — published vectors, vendored under `tests/fixtures/webauthn/` (provenance
 * and licences in that folder's README):
 *  - the W3C WebAuthn Level 3 §16 test vectors, run end to end through
 *    `verifyRegistration`/`verifyAssertion`. Our policy is stricter than the
 *    spec's examples (UV is required, `crossOrigin`/`topOrigin` are refused,
 *    only ES256/EdDSA/RS256), so every vector has an EXPECTED POLICY OUTCOME,
 *    and for vectors refused only by policy the signature and key parsing are
 *    still proved correct underneath;
 *  - Wycheproof ECDSA P-256/SHA-256 (DER), Ed25519 and RSA PKCS#1 v1.5
 *    2048/SHA-256: every `valid` vector accepted and every `invalid` vector
 *    refused, through our own COSE key parser and `verifyCoseSignature`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseAuthenticatorData,
  verifyAssertion,
  verifyRegistration
} from "../src/modules/identity-access/domain/webauthn-verifier";
import {
  parseCoseKey,
  supportedCoseAlgorithms,
  verifyCoseSignature
} from "../src/modules/identity-access/domain/webauthn-cose";
import { decodeCbor } from "../src/modules/identity-access/domain/webauthn-cbor";
import {
  b64u,
  cbor,
  concat,
  fromHex,
  sha256,
  type Enc
} from "./support/webauthn-authenticator";

const dir = join(import.meta.dir, "fixtures", "webauthn");
const load = (name: string) =>
  JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("G1: algorithm availability on the CI-pinned Bun", () => {
  test("Bun version matches the CI pin", () => {
    const ci = readFileSync(
      join(import.meta.dir, "..", ".github", "workflows", "ci.yml"),
      "utf8"
    );
    const pinned = /bun-version:\s*"([\d.]+)"/.exec(ci)?.[1];
    expect(Bun.version).toBe(pinned!);
  });

  test("P-256 (ES256), Ed25519 (EdDSA) and RSA PKCS#1 v1.5/SHA-256 (RS256) all verify", () => {
    expect([...supportedCoseAlgorithms()].sort((a, b) => a - b)).toEqual([
      -257, -8, -7
    ]);
  });
});

describe("G2: W3C WebAuthn Level 3 §16 test vectors", () => {
  const spec = load("w3c-webauthn-l3-test-vectors.json");
  const { rpId, origin } = spec.source;

  // Our policy outcome per vector, derived from the vector's own flags/alg/
  // clientData — written out so a reviewer can check each line.
  // Registration flags / authentication flags / alg per vector, read from the
  // vectors themselves. The first check that fails names the outcome
  // (registration: client data, rpIdHash, flags, credential id, algorithm;
  // assertion: credential, client data, AT, rpIdHash, flags, BE, userHandle,
  // algorithm, signature, counter).
  const expected: Record<
    string,
    { registration: string; authentication: string }
  > = {
    "none-es256": { registration: "flags", authentication: "flags" }, // reg UV=0, auth UV=0
    "packed-self-es256": { registration: "ok", authentication: "flags" }, // auth UV=0
    "none-es256-crossOrigin": {
      registration: "client_data",
      authentication: "client_data"
    },
    "none-es256-topOrigin": {
      registration: "client_data",
      authentication: "client_data"
    },
    "none-es256-long-credential-id": {
      registration: "flags",
      authentication: "ok"
    }, // reg UV=0
    "packed-es256": { registration: "ok", authentication: "ok" },
    "packed-es384": { registration: "flags", authentication: "n/a" }, // reg UV=0; alg -35 refused below
    "packed-es512": { registration: "algorithm", authentication: "n/a" }, // alg -36
    "packed-rs256": { registration: "ok", authentication: "flags" }, // auth UV=0
    "packed-eddsa": { registration: "flags", authentication: "flags" }, // UV=0 both
    "packed-ed448": { registration: "flags", authentication: "n/a" }, // reg UV=0; alg -53 refused below
    "tpm-es256": { registration: "ok", authentication: "ok" }, // fmt tpm: attStmt ignored
    "android-key-es256": { registration: "ok", authentication: "flags" }, // auth UV=0
    "apple-es256": { registration: "flags", authentication: "flags" }, // UV=0 both
    "fido-u2f-es256": { registration: "flags", authentication: "flags" } // U2F has no UV
  };

  test("every vendored vector has an expected outcome", () => {
    expect(spec.vectors.map((v: { id: string }) => v.id).sort()).toEqual(
      Object.keys(expected).sort()
    );
  });

  for (const vector of spec.vectors) {
    test(`${vector.id}: policy outcome and underlying correctness`, () => {
      const reg = vector.registration;
      const credentialId = fromHex(reg.credential_id);
      const regResponse = {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64u(fromHex(reg.clientDataJSON)),
          attestationObject: b64u(fromHex(reg.attestationObject))
        }
      };
      const registration = verifyRegistration(regResponse, {
        challengeDigest: sha256(fromHex(reg.challenge)),
        origins: [origin],
        rpId
      });
      const want = expected[vector.id]!;
      expect(registration.ok ? "ok" : registration.reason).toBe(
        want.registration
      );

      // Underneath the policy: the attestation object parses, the rpIdHash is
      // the spec's RP ID, the credential id round-trips, and — for algorithms
      // we support — the key imports.
      const attestation = decodeCbor(fromHex(reg.attestationObject)) as Map<
        string,
        Enc
      >;
      const authData = parseAuthenticatorData(
        attestation.get("authData") as Uint8Array
      );
      expect(authData.rpIdHash).toEqual(sha256(rpId));
      expect(authData.attested?.credentialId).toEqual(credentialId);
      if (want.authentication === "n/a") {
        expect(() => parseCoseKey(authData.attested!.coseMap)).toThrow();
        return;
      }
      const key = parseCoseKey(authData.attested!.coseMap);

      const auth = vector.authentication;
      // Stored decomposed (see the fixture's source.storage note); recomposed
      // byte-for-byte here. The rpIdHash part must be SHA-256 of the RP ID.
      const parts = auth.authenticatorDataParts;
      expect(fromHex(parts.rpIdHash)).toEqual(sha256(rpId));
      expect(parts.flags).toMatch(/^[0-9a-f]{2}$/);
      expect(parts.signCount).toMatch(/^[0-9a-f]{8}$/);
      const authDataBytes = fromHex(
        parts.rpIdHash + parts.flags + parts.signCount
      );
      const clientData = fromHex(auth.clientDataJSON);
      const signature = fromHex(auth.signature);
      expect(
        verifyCoseSignature(
          key,
          concat(authDataBytes, sha256(clientData)),
          signature
        )
      ).toBe(true);

      const stored = {
        credentialId,
        publicKeyCose: authData.attested!.publicKeyCose,
        alg: key.alg,
        signCount: 0,
        backupEligible: authData.be,
        rpId
      };
      const assertion = verifyAssertion(
        {
          id: b64u(credentialId),
          rawId: b64u(credentialId),
          type: "public-key",
          response: {
            clientDataJSON: b64u(clientData),
            authenticatorData: b64u(authDataBytes),
            signature: b64u(signature)
          }
        },
        {
          challengeDigest: sha256(fromHex(auth.challenge)),
          origins: [origin],
          allowCredentialIds: [credentialId],
          userHandle: new Uint8Array(32)
        },
        stored
      );
      expect(assertion.ok ? "ok" : assertion.reason).toBe(want.authentication);
    });
  }
});

interface WycheproofFile {
  source: { commit: string; sha256: string };
  groups: {
    key: Record<string, string>;
    tests: [number, string, string, string, string][];
  }[];
}

function runWycheproof(
  file: string,
  coseFor: (key: Record<string, string>) => Map<number, Enc>
) {
  const doc: WycheproofFile = load(file);
  const tally = {
    valid: 0,
    invalid: 0,
    acceptable: 0,
    acceptableAccepted: 0,
    keyRefused: 0
  };
  const mismatches: string[] = [];
  for (const group of doc.groups) {
    let key;
    try {
      key = parseCoseKey(cbor(coseFor(group.key)));
    } catch {
      key = undefined;
    }
    for (const [tcId, result, msg, sig, comment] of group.tests) {
      if (!key) {
        tally.keyRefused++;
        continue;
      }
      const ok = verifyCoseSignature(key, fromHex(msg), fromHex(sig));
      if (result === "acceptable") {
        tally.acceptable++;
        if (ok) tally.acceptableAccepted++;
        continue;
      }
      tally[result as "valid" | "invalid"]++;
      if (ok !== (result === "valid"))
        mismatches.push(`tcId ${tcId} (${result}) ${comment}`);
    }
  }
  return { tally, mismatches };
}

describe("G2: Wycheproof (Apache-2.0), 100% classification", () => {
  test("ECDSA P-256 / SHA-256, DER signatures (incl. CVE-2022-21449 r = s = 0)", () => {
    const { tally, mismatches } = runWycheproof(
      "wycheproof-ecdsa_secp256r1_sha256_test.json",
      (k) =>
        new Map<number, Enc>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, fromHex(k.x!)],
          [-3, fromHex(k.y!)]
        ])
    );
    expect(mismatches).toEqual([]);
    expect(tally).toEqual({
      valid: 174,
      invalid: 310,
      acceptable: 0,
      acceptableAccepted: 0,
      keyRefused: 0
    });
  });

  test("the CVE-2022-21449 class is in the corpus and refused", () => {
    const doc: WycheproofFile = load(
      "wycheproof-ecdsa_secp256r1_sha256_test.json"
    );
    const zeros = doc.groups
      .flatMap((g) => g.tests)
      .filter(([, , , sig]) => sig === "3006020100020100");
    expect(zeros.length).toBeGreaterThan(0);
    expect(zeros.every(([, result]) => result === "invalid")).toBe(true);
  });

  test("Ed25519", () => {
    const { tally, mismatches } = runWycheproof(
      "wycheproof-ed25519_test.json",
      (k) =>
        new Map<number, Enc>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, fromHex(k.x!)]
        ])
    );
    expect(mismatches).toEqual([]);
    // Wycheproof carries only CANONICAL small-order keys; the non-canonical
    // ones (y >= p, #1456 G7 H1) are covered in webauthn-verifier.test.ts.
    // 8 small-order public keys (Wycheproof "acceptable") are refused at key
    // parse; the 21 mixed-order "acceptable" keys verify, which Wycheproof
    // allows and which grants nothing beyond the registrant's own key.
    expect(tally).toEqual({
      valid: 117,
      invalid: 64,
      acceptable: 21,
      acceptableAccepted: 21,
      keyRefused: 8
    });
  });

  test("RSA PKCS#1 v1.5 2048 / SHA-256 (e = 65537; e = 3 keys refused by policy)", () => {
    const { tally, mismatches } = runWycheproof(
      "wycheproof-rsa_signature_2048_sha256_test.json",
      (k) =>
        new Map<number, Enc>([
          [1, 3],
          [3, -257],
          [-1, fromHex(k.n!)],
          [-2, fromHex(k.e!.length % 2 ? `0${k.e}` : k.e!)]
        ])
    );
    expect(mismatches).toEqual([]);
    // The one "acceptable" vector (DigestInfo without the NULL) is refused.
    expect(tally).toEqual({
      valid: 7,
      invalid: 249,
      acceptable: 1,
      acceptableAccepted: 0,
      keyRefused: 2
    });
  });
});
