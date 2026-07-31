import { createHash, randomBytes } from "node:crypto";

import {
  MACHINE_CREDENTIAL_TOKEN_PREFIX,
  hashMachineCredentialToken,
  isMachineCredentialToken
} from "./machine-credential-token";

/** Opaque session tokens, not JWT — only the SHA-256 hash is ever persisted. */
export function generateSessionToken(): string {
  // base64url's alphabet includes `_`, so a random session token could in
  // principle begin with the machine-credential prefix (p ≈ 64^-7). Such a
  // token would be hashed into the MACHINE namespace by `hashSessionToken`
  // below and then looked up in a table it was never written to — an account
  // that silently cannot authenticate until it logs in again. Rerolling costs
  // nothing and removes the case entirely rather than reasoning about how
  // unlikely it is.
  for (;;) {
    const token = randomBytes(32).toString("base64url");
    if (!token.startsWith(MACHINE_CREDENTIAL_TOKEN_PREFIX)) return token;
  }
}

/**
 * Hashes a BEARER token into its kind-tagged namespace (ADR-0049 §4).
 *
 * - session token → `sha256:<hex>` (unchanged; every stored session hash keeps
 *   exactly the shape it has had since `sql/004`)
 * - machine credential → `mc-sha256:<hex>`
 *
 * The dispatch lives here rather than at the call sites because 183 route files
 * already call this function between `resolveAuthInputs` and
 * `authorizeInTransaction`. Tagging the hash means the guard chokepoint can
 * tell the two kinds apart from the hash ALONE — one lookup per request, in the
 * right table, with no signature change rippling through those 183 files and no
 * chance of one kind being searched in the other's namespace.
 *
 * The name is kept for the same reason: renaming it would be exactly the
 * 183-file diff this design avoids.
 */
export function hashSessionToken(token: string): string {
  if (isMachineCredentialToken(token)) {
    return hashMachineCredentialToken(token);
  }

  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
