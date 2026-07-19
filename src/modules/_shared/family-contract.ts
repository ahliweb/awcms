/**
 * Family compatibility contract (Issue #183, epic #177 Wave 1 — "Compatibility
 * manifest dan CI conformance AWCMS terhadap standar AWCMS-Mini").
 *
 * AWCMS is a foundation/base REBUILD of the awcms-mini modular-monolith
 * STANDARD (ADR-0001). This file is the canonical, dependency-free source of
 * truth for the machine-readable statement of HOW this base declares its
 * conformance to that family standard: the family-contract version, the schema
 * of `awcms-family-compatibility.yaml`, and the structural/semantic validation
 * of a manifest instance.
 *
 * Deliberately ZERO-IMPORT — same rule as `module-contract.ts`. The
 * conformance GATE (`scripts/family-conformance-check.ts`) is what
 * cross-references a manifest instance against the REAL source-of-truth
 * constants (`MODULE_CONTRACT_VERSION`, `CAPABILITY_CONTRACT_VERSIONS`,
 * `package.json`, `openapi/`, `asyncapi/`); this file only owns the schema and
 * the family-owned contract versions, so it can be imported by both the gate
 * and the contract tests without dragging module/registry code into a schema
 * definition.
 */

/**
 * SemVer of the FAMILY compatibility contract as a whole — a SEVENTH
 * independent versioning scheme on top of the six ADR-0008/ADR-0015 already
 * document (package release, REST contract, event contract, module descriptor
 * contract, per-capability contract, extension-manifest schema). It is the
 * version every pinned conformance fixture/snapshot is anchored to.
 *
 * - MAJOR — a reusable control's SEMANTIC contract is weakened or removed in a
 *   way that breaks a derived application written against the previous family
 *   contract (default-deny/RLS/redaction/audit/idempotency/envelope/migration-
 *   immutability semantics change). Treat every such change as breaking.
 * - MINOR — a new contract is added to the family, or an existing one is
 *   tightened in a backward-compatible way.
 * - PATCH — documentation-only clarification.
 *
 * `1.0.0` — first declaration (Issue #183). Not a maturity claim, just the
 * first assigned number, same framing `MODULE_CONTRACT_VERSION` uses.
 */
export const FAMILY_CONTRACT_VERSION = "1.0.0";

/** SemVer of the `awcms-family-compatibility.yaml` document SCHEMA itself (this file's exported shape). */
export const MANIFEST_SCHEMA_VERSION = "1.0.0";

/**
 * Contracts whose version is OWNED BY THE FAMILY CONTRACT (not by a standalone
 * source constant like `MODULE_CONTRACT_VERSION`). Each is pinned by a SEMANTIC
 * contract test (`tests/family-conformance*.test.ts`) that goes RED if the
 * control drifts — the version number here is meaningless on its own; the test
 * is what gives it teeth. Bump a version here only in the SAME change that
 * intentionally alters the corresponding control's semantics (and then the
 * pinned test/snapshot must be updated in the same reviewed PR).
 */
export const FAMILY_OWNED_CONTRACT_VERSIONS = Object.freeze({
  /** `_shared/api-response.ts` envelope shape (`ApiSuccess`/`ApiErrorBody`/`ApiMeta`). */
  apiResponseEnvelope: "1.0.0",
  /** `withTenant` SET LOCAL tenant GUC + `FORCE ROW LEVEL SECURITY` fail-closed isolation (ADR-0003). */
  tenantContextRls: "1.0.0",
  /** `_shared/redaction.ts` key/value redaction used by the logger AND the audit trail (ADR-0004/doc 10). */
  auditRedaction: "1.0.0",
  /** `_shared/idempotency.ts` idempotency-key replay/conflict contract (ADR of doc 10). */
  idempotency: "1.0.0",
  /** `scripts/db-migrate.ts` `sha256:` checksum over the stripped file + reject-on-edit of an applied migration. */
  migrationChecksum: "1.0.0"
} as const);

export type FamilyOwnedContractKey =
  keyof typeof FAMILY_OWNED_CONTRACT_VERSIONS;

/** Migration checksum algorithm identifier the manifest must declare — must match `computeMigrationChecksum` in `scripts/db-migrate.ts`. */
export const MIGRATION_CHECKSUM_ALGORITHM = "sha256";

export type ManifestStackEntry = {
  /** The version/range as it appears in the authoritative source (e.g. `"^7.0.7"`, `">=1.3.0"`, `"18.4"`). */
  declared: string;
  /** Where the gate reads the real value from, for the evidence report — documentation only, not machine-resolved. */
  source: string;
};

export type IntentionalDivergence = {
  /** Stable kebab-case identifier, unique across the allow-list. */
  id: string;
  /** One-line statement of how AWCMS deliberately differs from the awcms-mini standard. */
  summary: string;
  /** Why the divergence is correct/necessary (never "we didn't get to it" — that is drift, not an intentional divergence). */
  reason: string;
  /** GitHub handle accountable for keeping this divergence justified. */
  owner: string;
  /** ISO `YYYY-MM-DD` date by which the divergence must be re-reviewed; the gate fails once this is in the past. */
  reviewDate: string;
  /** ADR filename under `docs/adr/` that records the decision (e.g. `0028-oidc-sso-...md`). */
  adr: string;
  /** Issue/epic reference the divergence originates from (documentation only). */
  since?: string;
};

export type FamilyContracts = {
  moduleDescriptorContractVersion: string;
  capabilityContractVersions: Record<string, string>;
  apiResponseEnvelopeVersion: string;
  restApiInfoVersion: string;
  eventApiInfoVersion: string;
  tenantContextRlsContractVersion: string;
  auditRedactionContractVersion: string;
  idempotencyContractVersion: string;
  migrationChecksum: { algorithm: string; version: string };
};

export type FamilyStack = {
  bun: {
    packageManager: ManifestStackEntry;
    engines: ManifestStackEntry;
    /** The CURRENT (primary) Bun version CI pins for the full suite. */
    ci: ManifestStackEntry;
    /** The MINIMUM-supported Bun version a dedicated CI cell actually runs (Issue #183 AC "menguji current DAN minimum-supported"); must equal the `engines` floor. */
    ciMinimum: ManifestStackEntry;
  };
  astro: ManifestStackEntry;
  astroNode: ManifestStackEntry;
  typescript: ManifestStackEntry;
  postgres: ManifestStackEntry;
};

export type FamilyCompatibilityManifest = {
  manifestSchemaVersion: string;
  familyContractVersion: string;
  family: {
    standard: string;
    standardRepository: string;
    role: string;
  };
  contracts: FamilyContracts;
  stack: FamilyStack;
  intentionalDivergences: IntentionalDivergence[];
};

/** Top-level keys every manifest instance MUST declare — the JSON-schema `required` list and this validator share this single source. */
export const REQUIRED_TOP_LEVEL_KEYS: readonly (keyof FamilyCompatibilityManifest)[] =
  Object.freeze([
    "manifestSchemaVersion",
    "familyContractVersion",
    "family",
    "contracts",
    "stack",
    "intentionalDivergences"
  ]);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEMVER_ISH_PATTERN = /^\d+\.\d+\.\d+$/;
const DIVERGENCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkStackEntry(
  problems: string[],
  where: string,
  entry: unknown
): void {
  if (!isRecord(entry)) {
    problems.push(
      `stack.${where} must be an object with { declared, source }.`
    );
    return;
  }
  if (!isNonEmptyString(entry.declared)) {
    problems.push(`stack.${where}.declared must be a non-empty string.`);
  }
  if (!isNonEmptyString(entry.source)) {
    problems.push(`stack.${where}.source must be a non-empty string.`);
  }
}

/**
 * Structural + semantic SCHEMA validation of a parsed manifest instance
 * (the "manifest tervalidasi schema" acceptance criterion). Pure — no I/O, no
 * cross-reference against real source constants (that is the gate's job). A
 * `now` is injected so the reviewDate-expiry check is deterministic and
 * mutation-testable. Returns a flat list of human-readable problems; empty
 * means the document is well-formed against the family schema.
 */
export function validateFamilyManifestShape(doc: unknown, now: Date): string[] {
  const problems: string[] = [];

  if (!isRecord(doc)) {
    return ["Manifest root must be a YAML/JSON object."];
  }

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in doc)) {
      problems.push(`Missing required top-level key "${key}".`);
    }
  }

  if (doc.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
    problems.push(
      `manifestSchemaVersion must be "${MANIFEST_SCHEMA_VERSION}" (this base understands only that schema), got ${JSON.stringify(doc.manifestSchemaVersion)}.`
    );
  }

  if (!SEMVER_ISH_PATTERN.test(String(doc.familyContractVersion))) {
    problems.push(
      `familyContractVersion must be an X.Y.Z string, got ${JSON.stringify(doc.familyContractVersion)}.`
    );
  }

  if (isRecord(doc.family)) {
    for (const key of ["standard", "standardRepository", "role"] as const) {
      if (!isNonEmptyString(doc.family[key])) {
        problems.push(`family.${key} must be a non-empty string.`);
      }
    }
  } else if ("family" in doc) {
    problems.push("family must be an object.");
  }

  if (isRecord(doc.contracts)) {
    const c = doc.contracts;
    const stringVersionKeys = [
      "moduleDescriptorContractVersion",
      "apiResponseEnvelopeVersion",
      "restApiInfoVersion",
      "eventApiInfoVersion",
      "tenantContextRlsContractVersion",
      "auditRedactionContractVersion",
      "idempotencyContractVersion"
    ] as const;
    for (const key of stringVersionKeys) {
      if (!isNonEmptyString(c[key])) {
        problems.push(`contracts.${key} must be a non-empty version string.`);
      }
    }
    if (!isRecord(c.capabilityContractVersions)) {
      problems.push(
        "contracts.capabilityContractVersions must be an object map."
      );
    } else {
      for (const [cap, version] of Object.entries(
        c.capabilityContractVersions
      )) {
        if (!isNonEmptyString(version)) {
          problems.push(
            `contracts.capabilityContractVersions.${cap} must be a non-empty version string.`
          );
        }
      }
    }
    if (!isRecord(c.migrationChecksum)) {
      problems.push(
        "contracts.migrationChecksum must be an object { algorithm, version }."
      );
    } else {
      if (!isNonEmptyString(c.migrationChecksum.algorithm)) {
        problems.push(
          "contracts.migrationChecksum.algorithm must be a non-empty string."
        );
      }
      if (!isNonEmptyString(c.migrationChecksum.version)) {
        problems.push(
          "contracts.migrationChecksum.version must be a non-empty string."
        );
      }
    }
  } else if ("contracts" in doc) {
    problems.push("contracts must be an object.");
  }

  if (isRecord(doc.stack)) {
    const s = doc.stack;
    if (isRecord(s.bun)) {
      checkStackEntry(problems, "bun.packageManager", s.bun.packageManager);
      checkStackEntry(problems, "bun.engines", s.bun.engines);
      checkStackEntry(problems, "bun.ci", s.bun.ci);
      checkStackEntry(problems, "bun.ciMinimum", s.bun.ciMinimum);
    } else {
      problems.push(
        "stack.bun must be an object with { packageManager, engines, ci, ciMinimum }."
      );
    }
    checkStackEntry(problems, "astro", s.astro);
    checkStackEntry(problems, "astroNode", s.astroNode);
    checkStackEntry(problems, "typescript", s.typescript);
    checkStackEntry(problems, "postgres", s.postgres);
  } else if ("stack" in doc) {
    problems.push("stack must be an object.");
  }

  if (!Array.isArray(doc.intentionalDivergences)) {
    if ("intentionalDivergences" in doc) {
      problems.push("intentionalDivergences must be an array.");
    }
  } else {
    const seenIds = new Set<string>();
    doc.intentionalDivergences.forEach((entry, index) => {
      problems.push(...validateDivergence(entry, index, now).map((p) => p));
      if (isRecord(entry) && typeof entry.id === "string") {
        if (seenIds.has(entry.id)) {
          problems.push(
            `intentionalDivergences[${index}].id "${entry.id}" is duplicated — every divergence id must be unique.`
          );
        }
        seenIds.add(entry.id);
      }
    });
  }

  return problems;
}

/**
 * Validate ONE intentional-divergence allow-list entry (Issue #183 "Ketentuan":
 * every intentional divergence needs a reason, owner, AND review date). The
 * reviewDate-in-the-past check is the expiry gate — an unreviewed divergence
 * cannot silently live forever.
 */
export function validateDivergence(
  entry: unknown,
  index: number,
  now: Date
): string[] {
  const problems: string[] = [];
  const at = `intentionalDivergences[${index}]`;

  if (!isRecord(entry)) {
    return [`${at} must be an object.`];
  }

  for (const key of ["id", "summary", "reason", "owner", "adr"] as const) {
    if (!isNonEmptyString(entry[key])) {
      problems.push(`${at}.${key} must be a non-empty string.`);
    }
  }

  if (typeof entry.id === "string" && !DIVERGENCE_ID_PATTERN.test(entry.id)) {
    problems.push(
      `${at}.id "${entry.id}" must be kebab-case (^[a-z][a-z0-9-]*$).`
    );
  }

  if (
    !isNonEmptyString(entry.reviewDate) ||
    !ISO_DATE_PATTERN.test(String(entry.reviewDate))
  ) {
    problems.push(`${at}.reviewDate must be an ISO YYYY-MM-DD date.`);
  } else {
    const review = new Date(`${entry.reviewDate}T00:00:00.000Z`);
    if (Number.isNaN(review.getTime())) {
      problems.push(
        `${at}.reviewDate "${entry.reviewDate}" is not a valid calendar date.`
      );
    } else if (review.getTime() < now.getTime()) {
      problems.push(
        `${at} (id "${String(entry.id)}") review date ${entry.reviewDate} is in the past — re-review the divergence and push the date forward, or remove the divergence.`
      );
    }
  }

  return problems;
}
