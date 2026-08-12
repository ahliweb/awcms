import { createHash, randomBytes } from "node:crypto";

import {
  MACHINE_CREDENTIAL_TOKEN_PREFIX,
  hashMachineCredentialToken,
  isMachineCredentialToken
} from "./machine-credential-token";
import {
  PRINCIPAL_SELECTION_TOKEN_PREFIX,
  hashPrincipalSelectionToken,
  isPrincipalSelectionToken
} from "./principal-selection-token";

/** Opaque session tokens, not JWT — only the SHA-256 hash is ever persisted. */
export function generateSessionToken(): string {
  // base64url's alphabet includes `_`, so a random session token could in
  // principle begin with the machine-credential prefix (p ≈ 64^-7). Such a
  // token would be hashed into the MACHINE namespace by `hashSessionToken`
  // below and then looked up in a table it was never written to — an account
  // that silently cannot authenticate until it logs in again. Rerolling costs
  // nothing and removes the case entirely rather than reasoning about how
  // unlikely it is.
  //
  // ADR-0088 adds a THIRD namespace, and it is the one where the collision
  // would be worst: a session token that happened to start with `awcmsp_`
  // would hash into the selection namespace, and the guard refuses that kind
  // OUTRIGHT — the person would hold a valid session row their every request
  // is answered with 401. Both prefixes are therefore rerolled, and the loop is
  // written over the LIST so a fourth kind cannot be added without landing
  // here.
  for (;;) {
    const token = randomBytes(32).toString("base64url");

    if (!RESERVED_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))) {
      return token;
    }
  }
}

/**
 * Prefixes a random session token must never begin with, because each is
 * another bearer KIND's discriminator.
 */
const RESERVED_TOKEN_PREFIXES = [
  MACHINE_CREDENTIAL_TOKEN_PREFIX,
  PRINCIPAL_SELECTION_TOKEN_PREFIX
] as const;

/**
 * Hashes a BEARER token into its kind-tagged namespace (ADR-0049 §4).
 *
 * - session token → `sha256:<hex>` (unchanged; every stored session hash keeps
 *   exactly the shape it has had since `sql/004`)
 * - machine credential → `mc-sha256:<hex>`
 * - tenant-selection token → `pt-sha256:<hex>` (ADR-0088)
 *
 * The third kind is not a bearer that authorizes anything — it is the one the
 * guard must REFUSE. Routing it through the same dispatcher is what makes the
 * refusal reachable: the chokepoint sees a hash, and the namespace is the only
 * thing that survives hashing to tell it what it is holding.
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

  if (isPrincipalSelectionToken(token)) {
    return hashPrincipalSelectionToken(token);
  }

  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
