# WebAuthn verifier fixtures (ADR-0168 S1, gate G2)

Vendored test vectors for `tests/webauthn-vectors.test.ts`. Data only: nothing
here is executed.

| File                                             | Source                                                                                                                                                                                           | Licence                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `w3c-webauthn-l3-test-vectors.json`              | W3C WebAuthn Level 3 Editor's Draft, §16 Test Vectors (<https://w3c.github.io/webauthn/#sctn-test-vectors>), retrieved 2026-11-22; SHA-256 of the retrieved HTML is in the file's `source` block | W3C Software and Document License |
| `wycheproof-ecdsa_secp256r1_sha256_test.json`    | C2SP/wycheproof `testvectors_v1/ecdsa_secp256r1_sha256_test.json`                                                                                                                                | Apache-2.0 (`LICENSE-wycheproof`) |
| `wycheproof-ed25519_test.json`                   | C2SP/wycheproof `testvectors_v1/ed25519_test.json`                                                                                                                                               | Apache-2.0 (`LICENSE-wycheproof`) |
| `wycheproof-rsa_signature_2048_sha256_test.json` | C2SP/wycheproof `testvectors_v1/rsa_signature_2048_sha256_test.json`                                                                                                                             | Apache-2.0 (`LICENSE-wycheproof`) |

All Wycheproof files come from commit
`65ca494727a52944c204441c860b039e6786b99b`. Each file's `source.sha256` is the
checksum of the **upstream** file at that commit.

## The Wycheproof files are a projection, not a copy

To keep the repository small, each group keeps only the public key fields the
COSE parser needs (`x`/`y` for P-256, `x` for Ed25519, `n`/`e` for RSA, as hex)
and each test is reduced to `[tcId, result, msg, sig, comment]`. Nothing is
dropped: every upstream test is present, in order, with its result unchanged.

How to re-check (done on 2026-11-23 for this commit): download the three
upstream files at the commit above, confirm their SHA-256 equals
`source.sha256`, then compare `tcId|result|msg|sig` for every test and the key
values numerically (upstream `wx`/`wy` may carry a leading `00`). Result at the
time of writing: ECDSA 484/484, Ed25519 210/210, RSA 259/259 identical, zero
key mismatches.

The W3C file holds the §16 vectors as hex strings (`credential_id`,
`clientDataJSON`, `attestationObject`, `authenticatorData`, `signature`,
`challenge`) transcribed from the specification page; it was not regenerated
from a tool.

## What the vectors do not cover

Wycheproof `ed25519_test.json` contains small-order public keys only in their
**canonical** encoding. The runtime also accepts a non-canonical y (y >= p),
and y = p + 1 decodes to the identity, under which one constant signature
verifies every message. That class was found by the G7 review of #1456 (H1) and
is tested in `tests/webauthn-verifier.test.ts`, not here. "100%" in G2 means
every vector in these files is classified correctly — not that the files cover
every weak key.
