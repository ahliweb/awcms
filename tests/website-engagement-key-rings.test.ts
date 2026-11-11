/**
 * `website_engagement` key rings (Issue #1262, ADR-0137 section 3): the
 * encryption ring and the hash ring share no key, at RUNTIME and in
 * `config:validate`, and the retired single ring is refused by name. Pure, no
 * database (the transition's DB behaviour is in
 * tests/integration/website-engagement-database.integration.test.ts).
 */
import { describe, expect, test } from "bun:test";

import {
  isLegacyHash,
  lookupHashCandidates,
  needsRehash,
  resolveWebsiteEngagementRings
} from "../src/modules/website-engagement/domain/engagement-config";
import {
  keyedHashPrimary,
  matchesAnyHash,
  parseKeyRing,
  type KeyRing
} from "../src/lib/security/field-encryption";
import {
  CRM_LEADS_FOREIGN_KEY_VARIABLES,
  validateEnv,
  WEBSITE_ENGAGEMENT_FOREIGN_KEY_VARIABLES,
  websiteEngagementKeyProblems
} from "../scripts/validate-env";
import {
  websiteEngagementContactMaterialProblem,
  websiteEngagementTokenMaterialProblem,
  withMaterialProbe
} from "../scripts/security-readiness";

const key = (seed: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * seed + 7) % 251)
  ).toString("base64");

const A = key(3);
const B = key(5);
const C = key(11);
const OLD = key(13);

const GOOD = {
  WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`,
  WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B}`
};

/** The documented transition (README runbook): old key LAST for decryption, verify-only for hashes. */
const TRANSITION = {
  WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A},k1:${OLD}`,
  WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B}`,
  WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS: `k1:${OLD}`
};

const runtime = (env: Record<string, string>) =>
  resolveWebsiteEngagementRings(env as NodeJS.ProcessEnv);

const noValueIn = (problems: string[]) => {
  const text = problems.join(" ");

  for (const material of [A, B, C, OLD]) expect(text).not.toContain(material);
};

describe("website_engagement key rings at runtime (Issue #1262)", () => {
  test("two distinct rings resolve; the transition shape resolves too", () => {
    expect(runtime(GOOD).ok).toBe(true);

    const transition = runtime(TRANSITION);

    expect(transition.ok).toBe(true);
    if (transition.ok) {
      expect(transition.rings.encryption.keys[0]!.id).toBe("e1");
      expect(transition.rings.hash.keys.map((k) => k.id)).toEqual(["h1"]);
      expect(transition.rings.legacyHash.map((k) => k.id)).toEqual(["k1"]);
    }
  });

  test("one key in both rings is refused at startup, whatever config:validate said", () => {
    const shared = runtime({
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`,
      WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${A}`
    });

    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.reason).not.toContain(A);

    // A shared key anywhere in the rings, not only in first position.
    expect(
      runtime({
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A},e0:${C}`,
        WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B},h0:${C}`
      }).ok
    ).toBe(false);
  });

  test("the retired single ring is refused alone and next to the new rings", () => {
    expect(runtime({ WEBSITE_ENGAGEMENT_KEYS: `k1:${OLD}` }).ok).toBe(false);
    expect(runtime({ ...GOOD, WEBSITE_ENGAGEMENT_KEYS: `k1:${OLD}` }).ok).toBe(
      false
    );
  });

  test("a missing half is refused", () => {
    expect(runtime({ WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}` }).ok).toBe(
      false
    );
    expect(runtime({ WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B}` }).ok).toBe(false);
  });

  test("a legacy key may not write: not the active encryption key, not a current hash key or key id", () => {
    // The old key FIRST in the encryption ring would keep encrypting new rows
    // while also being a hash oracle.
    expect(
      runtime({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `k1:${OLD},e1:${A}`
      }).ok
    ).toBe(false);
    expect(
      runtime({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B},k1:${OLD}`
      }).ok
    ).toBe(false);
    // Same id, different material: a stored `h1:` prefix would be ambiguous.
    expect(
      runtime({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS: `h1:${OLD}`
      }).ok
    ).toBe(false);
    expect(
      runtime({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS: "k1:not-base64"
      }).ok
    ).toBe(false);
  });

  test("a key id is never reused for new material (#1269 M-1), and legacy material is never a hash key under another id (M7b)", () => {
    const NEW = key(17);
    const WRONG = key(19);
    const refused = (env: Record<string, string>) => {
      const result = runtime(env);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("conflicting_keys");
        noValueIn([result.reason]);
      }
    };

    // k1 reused as the NEW writing encryption key while legacy k1 is the old one.
    refused({
      ...TRANSITION,
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `k1:${NEW}`
    });
    // An older encryption id carrying the wrong material.
    refused({
      ...TRANSITION,
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e2:${NEW},k1:${WRONG}`
    });
    // The old material decrypting under another id (old rows name k1).
    refused({
      ...TRANSITION,
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e2:${NEW},o1:${OLD}`
    });
    // Hash side: k1 reused as the writing hash key.
    refused({ ...TRANSITION, WEBSITE_ENGAGEMENT_HASH_KEYS: `k1:${NEW}` });
    // M7b: legacy material in the hash ring under ANOTHER id. The encryption
    // ring here does not carry the old key, so only the legacy-vs-hash
    // MATERIAL rule can refuse it.
    refused({
      ...TRANSITION,
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`,
      WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B},h2:${OLD}`
    });
    expect(
      websiteEngagementKeyProblems({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`,
        WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${B},h2:${OLD}`
      })
    ).toHaveLength(1);

    for (const env of [
      { ...TRANSITION, WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `k1:${NEW}` },
      {
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e2:${NEW},k1:${WRONG}`
      },
      { ...TRANSITION, WEBSITE_ENGAGEMENT_HASH_KEYS: `k1:${NEW}` }
    ]) {
      const problems = websiteEngagementKeyProblems(env);

      expect(problems.length).toBeGreaterThanOrEqual(1);
      noValueIn(problems);
    }
  });

  test("a refusal carries a fixed, value-free cause code (#1269 L-1)", () => {
    const codeOf = (env: Record<string, string>) => {
      const result = runtime(env);

      return result.ok ? null : result.code;
    };

    expect(codeOf({ ...GOOD, WEBSITE_ENGAGEMENT_KEYS: `k1:${OLD}` })).toBe(
      "retired_variable"
    );
    expect(codeOf({})).toBe("missing_or_invalid");
    expect(
      codeOf({
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`,
        WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${A}`
      })
    ).toBe("conflicting_keys");
  });

  test("any matched hash not under the ACTIVE hash key is re-hashed on use (#1269 L-2)", () => {
    const resolved = runtime({
      ...TRANSITION,
      WEBSITE_ENGAGEMENT_HASH_KEYS: `h2:${C},h1:${B}`
    });

    if (!resolved.ok) throw new Error(resolved.reason);

    expect(needsRehash(`h2:${"0".repeat(64)}`, resolved.rings)).toBe(false);
    expect(needsRehash(`h1:${"0".repeat(64)}`, resolved.rings)).toBe(true);
    expect(needsRehash(`k1:${"0".repeat(64)}`, resolved.rings)).toBe(true);
    expect(needsRehash("no-prefix", resolved.rings)).toBe(false);
  });

  test("lookups accept legacy hashes; writes never use a legacy key", () => {
    const resolved = runtime(TRANSITION);

    if (!resolved.ok) throw new Error(resolved.reason);

    const { rings } = resolved;
    const domain = {
      purpose: "website_engagement.source_token",
      tenantId: "t"
    };
    const oldRing = parseKeyRing(`k1:${OLD}`, "OLD") as KeyRing;
    const storedBefore = keyedHashPrimary("secret", domain, oldRing);

    expect(storedBefore.startsWith("k1:")).toBe(true);
    expect(isLegacyHash(storedBefore, rings)).toBe(true);
    expect(
      matchesAnyHash(
        storedBefore,
        lookupHashCandidates("secret", domain, rings)
      )
    ).toBe(true);

    const written = keyedHashPrimary("secret", domain, rings.hash);

    expect(written.startsWith("h1:")).toBe(true);
    expect(isLegacyHash(written, rings)).toBe(false);

    // Without the legacy keys the old hash no longer resolves (nothing silent).
    const after = runtime(GOOD);

    if (!after.ok) throw new Error(after.reason);
    expect(
      matchesAnyHash(
        storedBefore,
        lookupHashCandidates("secret", domain, after.rings)
      )
    ).toBe(false);

    // The candidate count never depends on the stored row.
    expect(lookupHashCandidates("x", domain, rings)).toHaveLength(2);
  });
});

describe("website_engagement key rings in config:validate (Issue #1262)", () => {
  test("two distinct rings and the transition shape pass", () => {
    expect(websiteEngagementKeyProblems(GOOD)).toEqual([]);
    expect(websiteEngagementKeyProblems(TRANSITION)).toEqual([]);
    expect(websiteEngagementKeyProblems({})).toEqual([]);
  });

  test("one key in both rings fails config:validate, and validateEnv reports it", () => {
    const env = {
      WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`,
      WEBSITE_ENGAGEMENT_HASH_KEYS: `h1:${A}`
    };
    const problems = websiteEngagementKeyProblems(env);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("must not share a key");
    noValueIn(problems);
    expect(
      validateEnv(env).some((problem) =>
        problem.includes("must not share a key")
      )
    ).toBe(true);
  });

  test("the retired single ring fails config:validate by name, alone and next to the new rings", () => {
    for (const env of [
      { WEBSITE_ENGAGEMENT_KEYS: `k1:${OLD}` },
      { ...GOOD, WEBSITE_ENGAGEMENT_KEYS: `k1:${OLD}` }
    ]) {
      const problems = websiteEngagementKeyProblems(env);

      expect(
        problems.some((p) => p.includes("WEBSITE_ENGAGEMENT_KEYS is retired"))
      ).toBe(true);
      noValueIn(problems);
    }
  });

  test("halves, a lone legacy list and the legacy write rules fail config:validate", () => {
    expect(
      websiteEngagementKeyProblems({
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `e1:${A}`
      })
    ).toHaveLength(1);
    expect(
      websiteEngagementKeyProblems({
        WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS: `k1:${OLD}`
      })
    ).toHaveLength(1);
    expect(
      websiteEngagementKeyProblems({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS: `k1:${OLD},e1:${A}`
      })
      // The old key writing AND its id on the writing key: both reported.
    ).toHaveLength(2);
    expect(
      websiteEngagementKeyProblems({
        ...TRANSITION,
        WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS: `h1:${OLD}`
      })
      // Hash id repeated, old material under another id, legacy id on the writing hash key.
    ).toHaveLength(3);
  });

  test("no ring and no legacy key may share material with another module's ring or single-key secret", () => {
    expect(WEBSITE_ENGAGEMENT_FOREIGN_KEY_VARIABLES).toContain(
      "CRM_LEADS_HASH_KEYS"
    );
    expect(WEBSITE_ENGAGEMENT_FOREIGN_KEY_VARIABLES).toContain(
      "AUTH_MFA_SECRET_ENCRYPTION_KEY"
    );

    for (const other of WEBSITE_ENGAGEMENT_FOREIGN_KEY_VARIABLES) {
      const single = !other.endsWith("_KEYS");

      for (const [ours, material] of [
        ["WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS", A],
        ["WEBSITE_ENGAGEMENT_HASH_KEYS", B],
        ["WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS", OLD]
      ] as const) {
        const problems = websiteEngagementKeyProblems({
          ...TRANSITION,
          [other]: single ? material : `x1:${material}`
        });

        // OLD is also (deliberately) a non-first encryption key in TRANSITION,
        // so it is reported under both names.
        expect(problems.length).toBeGreaterThanOrEqual(1);
        expect(
          problems.some((p) => p.includes(ours) && p.includes(other))
        ).toBe(true);
        noValueIn(problems);
      }

      expect(
        websiteEngagementKeyProblems({
          ...TRANSITION,
          [other]: single ? C : `x1:${C}`
        })
      ).toEqual([]);
    }
  });

  test("crm_leads still refuses a key shared with any website_engagement ring (the retired name is gone from its list)", () => {
    expect(CRM_LEADS_FOREIGN_KEY_VARIABLES).toContain(
      "WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS"
    );
    expect(CRM_LEADS_FOREIGN_KEY_VARIABLES).toContain(
      "WEBSITE_ENGAGEMENT_HASH_KEYS"
    );
    expect(CRM_LEADS_FOREIGN_KEY_VARIABLES).toContain(
      "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS"
    );
    expect(CRM_LEADS_FOREIGN_KEY_VARIABLES as readonly string[]).not.toContain(
      "WEBSITE_ENGAGEMENT_KEYS"
    );
  });
});

describe("security:readiness observes the transition (Issue #1262)", () => {
  test("a material finding turns an id-only PASS into FAIL (#1269 M-1)", async () => {
    const base = {
      name: "x",
      severity: "warning" as const,
      status: "pass" as const,
      evidence: 'Every ciphertext row is under the active key "k1".'
    };
    const clean = {
      contactUnreadable: [],
      hashMismatch: [],
      tokenUnknown: []
    };

    expect(
      (
        await withMaterialProbe(
          base,
          websiteEngagementContactMaterialProblem,
          async () => ({ ...clean, contactUnreadable: ["k1"] })
        )
      ).status
    ).toBe("fail");
    expect(
      (
        await withMaterialProbe(
          base,
          websiteEngagementTokenMaterialProblem,
          async () => ({ ...clean, hashMismatch: ["k1"] })
        )
      ).status
    ).toBe("fail");
    expect(
      (
        await withMaterialProbe(
          base,
          websiteEngagementTokenMaterialProblem,
          async () => clean
        )
      ).status
    ).toBe("pass");
    // A probe that cannot run is a failure, never a silent pass.
    expect(
      (
        await withMaterialProbe(
          base,
          websiteEngagementContactMaterialProblem,
          async () => {
            throw new Error("down");
          }
        )
      ).status
    ).toBe("fail");
  });

  test("both key-id checks are registered before the shared pool is closed", async () => {
    const source = await Bun.file("scripts/security-readiness.ts").text();
    const body = source.slice(
      source.indexOf("export async function runSecurityReadinessChecks")
    );
    const close = body.indexOf("checkEntitlementBlastRadius");

    for (const name of [
      "checkWebsiteEngagementTokenKeyIds",
      "checkWebsiteEngagementContactKeyIds"
    ]) {
      const at = body.indexOf(name);

      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(close);
    }
  });
});
