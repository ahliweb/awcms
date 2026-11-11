/**
 * Deployment configuration for `website_engagement` (Issue #1153, ADR-0155).
 *
 * TWO rings, never one (ADR-0137 section 3, Issue #1262):
 *
 *   `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS`  AES-256-GCM envelope of a submission's
 *                                         contact details.
 *   `WEBSITE_ENGAGEMENT_HASH_KEYS`        HMAC key of every source-token and
 *                                         identifier hash.
 *
 * Format of both: `keyId:base64` pairs separated by commas, the FIRST key
 * writes, ALL keys read, each exactly 32 random bytes. They live outside the
 * database and its backups and have no default and no plaintext fallback:
 * without them the public endpoint answers a generic refusal and no source can
 * be created (fail closed). The two rings must share no key; that is enforced
 * HERE, at runtime, and again by `config:validate`, so a deployment started
 * without the validator still refuses to run on overlapping rings.
 *
 * ## The transition from the retired single ring
 *
 * Until Issue #1262 one ring, `WEBSITE_ENGAGEMENT_KEYS`, did both jobs. Every
 * stored source-token hash and every stored ciphertext was produced under it.
 * The transition keeps them resolving WITHOUT one key keeping two roles for
 * longer than the operator says:
 *
 *   - the old key moves into `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS` as a
 *     NON-FIRST key: it decrypts old submissions and never encrypts a new one;
 *   - the old key ALSO goes into `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS`: a
 *     verify-only list that is accepted when a source token is checked and is
 *     never used to write a hash. A source whose token verifies under a legacy
 *     key has its stored hash re-written under the hash ring's active key in
 *     the same transaction (upgrade on use); a source that never submits is
 *     moved by rotating its token. `security:readiness` counts the sources
 *     still on a legacy key id, and the variable is removed when that is zero.
 *
 * `WEBSITE_ENGAGEMENT_KEYS` itself is RETIRED: if it is still set, every
 * resolver here refuses (fail closed) rather than guessing which role the
 * operator meant, and `config:validate` says how to split it.
 *
 * The variables are spelled out in full in `resolveKeyRing`'s argument because
 * the env-coverage scanner finds variables by that spelling.
 */
import {
  keyedHash,
  keyedHashCandidates,
  parseKeyRing,
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type HashDomain,
  type KeyRing,
  type KeyRingKey,
  type KeyRingResult
} from "../../../lib/security/field-encryption";
import { parsePositiveIntSetting } from "../../../lib/security/env-thresholds";

export const RETIRED_SINGLE_RING_REASON =
  "WEBSITE_ENGAGEMENT_KEYS is retired (Issue #1262): split it into WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS and WEBSITE_ENGAGEMENT_HASH_KEYS (see the module README transition runbook) and unset it.";

/** True when the retired single-ring variable is still set to anything. */
export function isRetiredSingleRingSet(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (env.WEBSITE_ENGAGEMENT_KEYS ?? "").trim() !== "";
}

/** The encryption ring as the environment spells it, with no cross-ring check (the validator words its own problem). */
export function resolveWebsiteEngagementEncryptionRingUnchecked(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS",
    {
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS
    },
    STRICT_KEY_RING_OPTIONS
  );
}

/** The hash ring as the environment spells it, with no cross-ring check. */
export function resolveWebsiteEngagementHashRingUnchecked(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "WEBSITE_ENGAGEMENT_HASH_KEYS",
    { WEBSITE_ENGAGEMENT_HASH_KEYS: env.WEBSITE_ENGAGEMENT_HASH_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

/**
 * The verify-only legacy hash keys. Unset is the normal, post-transition state
 * (an empty list); set, it must parse as strictly as any ring.
 */
export function resolveWebsiteEngagementLegacyHashKeysUnchecked(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; keys: KeyRingKey[] } | { ok: false; reason: string } {
  const raw = env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS;

  if ((raw ?? "").trim() === "") return { ok: true, keys: [] };

  const parsed = parseKeyRing(
    raw,
    "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS",
    STRICT_KEY_RING_OPTIONS
  );

  return parsed.ok ? { ok: true, keys: parsed.keys } : parsed;
}

function sharesMaterial(left: KeyRingKey[], right: KeyRingKey[]): boolean {
  return left.some((a) => right.some((b) => a.key.equals(b.key)));
}

/**
 * Every reason the three key sets cannot be used together, in a fixed order;
 * empty when they can. Pure, so the runtime and `config:validate` decide with
 * the same predicate.
 *
 *   1. encryption and hash rings share no key (ADR-0137 section 3);
 *   2. a legacy hash key is not also a CURRENT hash key, by material or by id
 *      (a stored `keyId:` prefix must say unambiguously which role wrote it);
 *   3. a legacy hash key is not the encryption ring's ACTIVE key: the old key
 *      may keep decrypting old rows, but a key that still writes ciphertext
 *      must not also be a hash oracle;
 *   4. a key id is never reused for new material (#1269 audit M-1): a legacy
 *      key and an encryption key agree exactly (same id <=> same material), and
 *      neither ring's WRITING (first) key carries a legacy key id. A `k1` that
 *      means the old key in one variable and a new key in another would make
 *      old rows look current while they no longer open.
 */
export function websiteEngagementRingConflicts(
  encryption: KeyRing,
  hash: KeyRing,
  legacyHash: KeyRingKey[]
): string[] {
  const conflicts: string[] = [];

  if (sharesMaterial(encryption.keys, hash.keys)) {
    conflicts.push(
      "WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS and WEBSITE_ENGAGEMENT_HASH_KEYS must not share a key."
    );
  }

  if (
    sharesMaterial(legacyHash, hash.keys) ||
    legacyHash.some((legacy) => hash.keys.some((key) => key.id === legacy.id))
  ) {
    conflicts.push(
      "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS must not repeat a key or a key id of WEBSITE_ENGAGEMENT_HASH_KEYS."
    );
  }

  const activeEncryptionKey = encryption.keys[0];

  if (
    activeEncryptionKey &&
    legacyHash.some((legacy) => legacy.key.equals(activeEncryptionKey.key))
  ) {
    conflicts.push(
      "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS must not contain the active (first) key of WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS; put a new key first."
    );
  }

  if (
    legacyHash.some((legacy) =>
      encryption.keys.some(
        (key) => (key.id === legacy.id) !== key.key.equals(legacy.key)
      )
    )
  ) {
    conflicts.push(
      "A key id of WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS names different key material in WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS (or the same material sits under another id); never reuse a key id for new material."
    );
  }

  const activeHashKey = hash.keys[0];

  if (
    legacyHash.some(
      (legacy) =>
        legacy.id === activeEncryptionKey?.id || legacy.id === activeHashKey?.id
    )
  ) {
    conflicts.push(
      "The first (writing) key of WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS or WEBSITE_ENGAGEMENT_HASH_KEYS must not use a key id of WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS; give every new key a new id."
    );
  }

  return conflicts;
}

export type WebsiteEngagementRings = {
  /** Encrypts (first key) and decrypts (all keys) contact details. */
  encryption: KeyRing;
  /** Writes (first key) and verifies (all keys) every hash. */
  hash: KeyRing;
  /** Verify-only, source tokens only, during the #1262 transition. */
  legacyHash: KeyRingKey[];
};

/**
 * Why the key configuration was refused, as a fixed code that is safe to log
 * (it never carries a value): the retired variable is set, a ring is missing
 * or malformed, or the rings conflict (a shared key or a reused key id).
 */
export type WebsiteEngagementRingRefusal =
  "retired_variable" | "missing_or_invalid" | "conflicting_keys";

export type WebsiteEngagementRingsResult =
  | { ok: true; rings: WebsiteEngagementRings }
  | { ok: false; code: WebsiteEngagementRingRefusal; reason: string };

/**
 * All key material, checked: the retired variable is unset, both rings parse,
 * the legacy list parses, and none of the conflicts above holds. Every code
 * path that encrypts, decrypts or hashes goes through this.
 */
export function resolveWebsiteEngagementRings(
  env: NodeJS.ProcessEnv = process.env
): WebsiteEngagementRingsResult {
  if (isRetiredSingleRingSet(env)) {
    return {
      ok: false,
      code: "retired_variable",
      reason: RETIRED_SINGLE_RING_REASON
    };
  }

  const encryption = resolveWebsiteEngagementEncryptionRingUnchecked(env);
  const hash = resolveWebsiteEngagementHashRingUnchecked(env);
  const legacy = resolveWebsiteEngagementLegacyHashKeysUnchecked(env);
  const invalid = (reason: string): WebsiteEngagementRingsResult => ({
    ok: false,
    code: "missing_or_invalid",
    reason
  });

  if (!encryption.ok) return invalid(encryption.reason);
  if (!hash.ok) return invalid(hash.reason);
  if (!legacy.ok) return invalid(legacy.reason);

  const conflicts = websiteEngagementRingConflicts(
    encryption,
    hash,
    legacy.keys
  );

  if (conflicts.length > 0) {
    return { ok: false, code: "conflicting_keys", reason: conflicts[0]! };
  }

  return {
    ok: true,
    rings: { encryption, hash, legacyHash: legacy.keys }
  };
}

/**
 * Every hash a stored value may carry, for a LOOKUP (never a write): one per
 * current hash key (active first), then one per legacy key. Always the same
 * count for a given deployment, so the work does not depend on which key the
 * row was written under. The intake uses it for source tokens; an identifier
 * hash written before #1262 resolves through it too, while the legacy keys are
 * configured. A new hash is written ONLY with `keyedHashPrimary(..., rings.hash)`.
 */
export function lookupHashCandidates(
  secret: string,
  domain: HashDomain,
  rings: WebsiteEngagementRings
): string[] {
  return [
    ...keyedHashCandidates(secret, domain, rings.hash),
    ...rings.legacyHash.map((key) => keyedHash(secret, domain, key))
  ];
}

/** The `keyId` of a stored `keyId:hex` hash, or `null` without an id prefix. */
function hashKeyId(stored: string): string | null {
  const separator = stored.indexOf(":");

  return separator < 1 ? null : stored.slice(0, separator);
}

/** True when a stored `keyId:hex` hash was written under a legacy key id. */
export function isLegacyHash(
  stored: string,
  rings: WebsiteEngagementRings
): boolean {
  const keyId = hashKeyId(stored);

  return rings.legacyHash.some((key) => key.id === keyId);
}

/**
 * True when a stored hash that has just MATCHED should be re-written under the
 * hash ring's active key: it carries any other key id, a legacy key of the
 * #1262 transition or an older key of an ordinary hash-ring rotation (#1269
 * audit L-2).
 */
export function needsRehash(
  stored: string,
  rings: WebsiteEngagementRings
): boolean {
  const keyId = hashKeyId(stored);

  return keyId !== null && keyId !== rings.hash.keys[0]?.id;
}

export type IntakeLimits = {
  perIpMax: number;
  perIpWindowSec: number;
  perSourceMax: number;
  perSourceWindowSec: number;
  /** Interactions have their own, lower, ceiling (audit M1). */
  perSourceInteractionMax: number;
};

/** Parsed, never coerced: `Number("x")` is NaN and `count > NaN` is false, which switches a limiter OFF. */
export function resolveIntakeLimits(
  env: NodeJS.ProcessEnv = process.env
): IntakeLimits {
  return {
    perIpMax: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX,
      10,
      "WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX"
    ),
    perIpWindowSec: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_RATE_LIMIT_WINDOW_SEC,
      300,
      "WEBSITE_ENGAGEMENT_RATE_LIMIT_WINDOW_SEC"
    ),
    perSourceMax: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX,
      300,
      "WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX"
    ),
    perSourceWindowSec: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_WINDOW_SEC,
      300,
      "WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_WINDOW_SEC"
    ),
    perSourceInteractionMax: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX,
      120,
      "WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX"
    )
  };
}
