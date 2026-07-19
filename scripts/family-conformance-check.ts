/**
 * family-conformance-check.ts — `bun run family:conformance:check`.
 *
 * Issue #183 (epic #177 Wave 1, ADR-0032). Validates the family compatibility
 * manifest (`awcms-family-compatibility.yaml`) against its schema AND
 * cross-references every declared contract/stack version against the REAL
 * source of truth (module-contract, capability-contract-versions, package.json,
 * ci.yml, openapi/asyncapi). Pure code + a few local file reads — NO database,
 * NO network — so it is safe to run on every `bun run check` / CI build, the
 * same shape as `reporting:projections:registry:check` and
 * `identity-access:sod-registry:check`.
 *
 * The SEMANTIC behaviour of the reusable controls (RLS fail-closed, redaction,
 * audit, idempotency, envelope, migration immutability) is pinned by the
 * mutation-provable contract tests (`tests/family-conformance*.test.ts`); this
 * gate enforces that the manifest's DECLARED versions stay honest against the
 * code and toolchain, and that the intentional-divergence allow-list stays
 * well-formed, unexpired, and ADR-backed.
 *
 * Emits a pass/fail-per-contract evidence report to stdout, and optionally
 * writes it as JSON (`--report <path>` or `FAMILY_CONFORMANCE_REPORT_PATH`).
 * The report is built exclusively from version strings + contract names — it
 * NEVER touches secrets/DSN/environment (asserted by
 * `assertEvidenceReportSecretFree` + a contract test).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";
import {
  FAMILY_CONTRACT_VERSION,
  FAMILY_OWNED_CONTRACT_VERSIONS,
  MIGRATION_CHECKSUM_ALGORITHM,
  REQUIRED_TOP_LEVEL_KEYS,
  validateFamilyManifestShape,
  type FamilyCompatibilityManifest
} from "../src/modules/_shared/family-contract";
import { MODULE_CONTRACT_VERSION } from "../src/modules/_shared/module-contract";

const ROOT = process.cwd();
const MANIFEST_PATH = path.resolve(ROOT, "awcms-family-compatibility.yaml");
const SCHEMA_PATH = path.resolve(
  ROOT,
  "awcms-family-compatibility.schema.json"
);
const PACKAGE_JSON_PATH = path.resolve(ROOT, "package.json");
const CI_YML_PATH = path.resolve(ROOT, ".github/workflows/ci.yml");
const OPENAPI_PATH = path.resolve(
  ROOT,
  "openapi/awcms-public-api.openapi.yaml"
);
const ASYNCAPI_PATH = path.resolve(
  ROOT,
  "asyncapi/awcms-domain-events.asyncapi.yaml"
);
const ADR_DIR = path.resolve(ROOT, "docs/adr");

export type FamilyConformanceStack = {
  bunPackageManager: string;
  bunEngines: string;
  /** Every DISTINCT `bun-version:` CI declares — must be exactly {current pin, minimum-supported floor}. */
  bunCiVersions: string[];
  astro: string;
  astroNode: string;
  typescript: string;
  postgres: string;
};

/** `">=1.3.0"` / `"^1.3.0"` -> `"1.3.0"` — the exact floor version of a SemVer range. */
export function parseVersionFloor(range: string): string {
  return range.replace(/^[><=~^\s]+/, "").trim();
}

/**
 * The real, resolved facts the gate compares the manifest against. Injected
 * (rather than read inside the collector) so the contract tests can mutate any
 * single fact and prove the gate turns RED — the same policy-injection pattern
 * `checkRuntimeRoleGrants(policy?)` uses in `scripts/security-readiness.ts`.
 */
export type FamilyConformanceActuals = {
  moduleContractVersion: string;
  capabilityContractVersions: Record<string, string>;
  restApiInfoVersion: string;
  eventApiInfoVersion: string;
  stack: FamilyConformanceStack;
  migrationChecksumAlgorithm: string;
  familyContractVersion: string;
  familyOwnedContractVersions: Record<string, string>;
  schemaRequiredKeys: string[] | null;
  adrExists: (adr: string) => boolean;
  now: Date;
};

export type EvidenceCheck = {
  name: string;
  status: "pass" | "fail";
  declared?: string;
  actual?: string;
  detail?: string;
};

export type EvidenceReport = {
  tool: "family:conformance:check";
  generatedAt: string;
  familyContractVersion: string;
  manifestSchemaVersion: string;
  summary: { total: number; passed: number; failed: number };
  checks: EvidenceCheck[];
};

/** `"bun@1.3.14"` -> `"1.3.14"`; anything else passes through unchanged (a mismatch is then a finding, not a crash). */
export function parsePackageManagerVersion(packageManager: unknown): string {
  if (typeof packageManager !== "string") return "";
  const at = packageManager.indexOf("@");
  return at >= 0 ? packageManager.slice(at + 1) : packageManager;
}

/** Every distinct `bun-version:` value declared in a raw ci.yml text (deduped, in order). */
export function extractCiBunVersions(ciYml: string): string[] {
  const out: string[] = [];
  const re = /bun-version:\s*["']?([^"'\s]+)["']?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ciYml)) !== null) {
    if (match[1] && !out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

/** Every distinct `image: postgres:<tag>` value declared in a raw ci.yml text (deduped, in order). */
export function extractCiPostgresVersions(ciYml: string): string[] {
  const out: string[] = [];
  const re = /image:\s*postgres:([^\s"']+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ciYml)) !== null) {
    if (match[1] && !out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

function pushCheck(
  checks: EvidenceCheck[],
  name: string,
  declared: string,
  actual: string
): void {
  checks.push({
    name,
    declared,
    actual,
    status: declared === actual ? "pass" : "fail"
  });
}

/**
 * Pure decision function — every version/allow-list comparison the gate makes,
 * as an ordered list of pass/fail checks. Takes the parsed manifest and the
 * injected real-world `actuals`; performs zero I/O itself. The contract tests
 * feed it a mutated manifest or mutated actuals and assert at least one check
 * flips to `fail`.
 */
export function collectFamilyConformanceChecks(
  manifest: FamilyCompatibilityManifest,
  actuals: FamilyConformanceActuals
): EvidenceCheck[] {
  const checks: EvidenceCheck[] = [];
  const c = manifest.contracts;

  pushCheck(
    checks,
    "family-contract version matches source constant",
    manifest.familyContractVersion,
    actuals.familyContractVersion
  );

  pushCheck(
    checks,
    "module descriptor contract version (MODULE_CONTRACT_VERSION)",
    c.moduleDescriptorContractVersion,
    actuals.moduleContractVersion
  );

  // Capability contract versions — must match key-for-key (both directions).
  const declaredCaps = c.capabilityContractVersions ?? {};
  const actualCaps = actuals.capabilityContractVersions;
  const capKeys = new Set([
    ...Object.keys(declaredCaps),
    ...Object.keys(actualCaps)
  ]);
  for (const key of [...capKeys].sort()) {
    pushCheck(
      checks,
      `capability contract version "${key}"`,
      declaredCaps[key] ?? "(absent)",
      actualCaps[key] ?? "(absent)"
    );
  }

  pushCheck(
    checks,
    "REST API contract version (openapi info.version)",
    c.restApiInfoVersion,
    actuals.restApiInfoVersion
  );
  pushCheck(
    checks,
    "event API contract version (asyncapi info.version)",
    c.eventApiInfoVersion,
    actuals.eventApiInfoVersion
  );

  // Family-owned semantic contracts — anchored to FAMILY_OWNED_CONTRACT_VERSIONS.
  const owned = actuals.familyOwnedContractVersions;
  pushCheck(
    checks,
    "API response envelope contract version",
    c.apiResponseEnvelopeVersion,
    owned.apiResponseEnvelope ?? "(absent)"
  );
  pushCheck(
    checks,
    "tenant-context/RLS contract version",
    c.tenantContextRlsContractVersion,
    owned.tenantContextRls ?? "(absent)"
  );
  pushCheck(
    checks,
    "audit/redaction contract version",
    c.auditRedactionContractVersion,
    owned.auditRedaction ?? "(absent)"
  );
  pushCheck(
    checks,
    "idempotency contract version",
    c.idempotencyContractVersion,
    owned.idempotency ?? "(absent)"
  );
  pushCheck(
    checks,
    "migration checksum contract version",
    c.migrationChecksum?.version ?? "(absent)",
    owned.migrationChecksum ?? "(absent)"
  );
  pushCheck(
    checks,
    "migration checksum algorithm",
    c.migrationChecksum?.algorithm ?? "(absent)",
    actuals.migrationChecksumAlgorithm
  );

  // Stack / compatibility matrix (declared == real toolchain).
  const s = manifest.stack;
  pushCheck(
    checks,
    "stack: Bun packageManager",
    s.bun?.packageManager?.declared ?? "(absent)",
    actuals.stack.bunPackageManager
  );
  pushCheck(
    checks,
    "stack: Bun engines (minimum-supported floor)",
    s.bun?.engines?.declared ?? "(absent)",
    actuals.stack.bunEngines
  );
  // The declared minimum-supported CI cell version must equal the engines floor
  // (so the "minimum" the CI cell runs really is the declared floor, not an
  // arbitrary version).
  pushCheck(
    checks,
    "stack: Bun ciMinimum equals engines floor",
    s.bun?.ciMinimum?.declared ?? "(absent)",
    parseVersionFloor(actuals.stack.bunEngines)
  );
  // CI must run EXACTLY {current pin, minimum-supported floor} — this is the AC
  // "menguji current DAN minimum-supported" encoded as a gate: deleting the
  // minimum-supported CI job (or adding a stray third Bun version) turns this
  // check RED.
  {
    const expected = new Set(
      [s.bun?.ci?.declared, s.bun?.ciMinimum?.declared].filter(
        (v): v is string => typeof v === "string"
      )
    );
    const actual = new Set(actuals.stack.bunCiVersions);
    const setsEqual =
      expected.size === actual.size &&
      [...expected].every((v) => actual.has(v));
    checks.push({
      name: "stack: CI runs exactly {current, minimum-supported} Bun versions",
      status: setsEqual ? "pass" : "fail",
      declared: [...expected].sort().join(","),
      actual: [...actual].sort().join(",")
    });
  }
  pushCheck(
    checks,
    "stack: Astro",
    s.astro?.declared ?? "(absent)",
    actuals.stack.astro
  );
  pushCheck(
    checks,
    "stack: @astrojs/node",
    s.astroNode?.declared ?? "(absent)",
    actuals.stack.astroNode
  );
  pushCheck(
    checks,
    "stack: TypeScript",
    s.typescript?.declared ?? "(absent)",
    actuals.stack.typescript
  );
  pushCheck(
    checks,
    "stack: PostgreSQL",
    s.postgres?.declared ?? "(absent)",
    actuals.stack.postgres
  );

  // Every intentional divergence must be backed by an ADR file that exists.
  for (const divergence of manifest.intentionalDivergences ?? []) {
    checks.push({
      name: `intentional divergence "${divergence.id}" ADR present`,
      status: actuals.adrExists(divergence.adr) ? "pass" : "fail",
      detail: divergence.adr
    });
  }

  // JSON-schema ↔ TS-validator parity: the shipped schema's required list must
  // equal the validator's REQUIRED_TOP_LEVEL_KEYS (so the two can't drift).
  if (actuals.schemaRequiredKeys === null) {
    checks.push({
      name: "JSON schema present and parseable",
      status: "fail",
      detail: "awcms-family-compatibility.schema.json missing or unparseable"
    });
  } else {
    const expected = [...REQUIRED_TOP_LEVEL_KEYS].sort();
    const got = [...actuals.schemaRequiredKeys].sort();
    checks.push({
      name: "JSON schema required-keys parity with validator",
      status:
        JSON.stringify(expected) === JSON.stringify(got) ? "pass" : "fail",
      declared: got.join(","),
      actual: expected.join(",")
    });
  }

  return checks;
}

export function buildEvidenceReport(
  manifest: FamilyCompatibilityManifest,
  checks: EvidenceCheck[],
  now: Date
): EvidenceReport {
  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.length - passed;
  return {
    tool: "family:conformance:check",
    generatedAt: now.toISOString(),
    familyContractVersion: manifest.familyContractVersion,
    manifestSchemaVersion: manifest.manifestSchemaVersion,
    summary: { total: checks.length, passed, failed },
    checks
  };
}

/**
 * Defense-in-depth: the report is assembled only from version strings and
 * contract names, but Issue #183 forbids ANY secret/DSN/env leaking into the
 * compatibility report — so we assert it, never assume it. Throws if the
 * serialized report contains a connection-string scheme or an obvious env-var
 * value.
 */
export function assertEvidenceReportSecretFree(report: EvidenceReport): void {
  const serialized = JSON.stringify(report);
  const forbidden = [/postgres(ql)?:\/\//i, /:\/\/[^:@\s/]+:[^@\s/]+@/];
  for (const pattern of forbidden) {
    if (pattern.test(serialized)) {
      throw new Error(
        "Family conformance report contains a connection-string-shaped value — refusing to emit it."
      );
    }
  }
  const dsn = process.env.DATABASE_URL;
  if (dsn && dsn.length > 0 && serialized.includes(dsn)) {
    throw new Error(
      "Family conformance report contains DATABASE_URL — refusing to emit it."
    );
  }
}

export function loadManifest(manifestPath = MANIFEST_PATH): unknown {
  return parseYaml(readFileSync(manifestPath, "utf8"));
}

function readInfoVersion(yamlPath: string): string {
  const doc = parseYaml(readFileSync(yamlPath, "utf8")) as {
    info?: { version?: unknown };
  };
  return typeof doc?.info?.version === "string" ? doc.info.version : "";
}

function readSchemaRequiredKeys(): string[] | null {
  if (!existsSync(SCHEMA_PATH)) return null;
  try {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as {
      required?: unknown;
    };
    return Array.isArray(schema.required)
      ? schema.required.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return null;
  }
}

/** Reads the real-world facts from disk/source. `bunCiVersions` is the full distinct CI Bun set (checked against {current, minimum}); `postgres` still asserts a single distinct CI value. */
export function gatherActuals(now = new Date()): FamilyConformanceActuals {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
    packageManager?: unknown;
    engines?: { bun?: unknown };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const ciYml = readFileSync(CI_YML_PATH, "utf8");
  const ciBun = extractCiBunVersions(ciYml);
  const ciPg = extractCiPostgresVersions(ciYml);

  return {
    moduleContractVersion: MODULE_CONTRACT_VERSION,
    capabilityContractVersions: { ...CAPABILITY_CONTRACT_VERSIONS },
    restApiInfoVersion: readInfoVersion(OPENAPI_PATH),
    eventApiInfoVersion: readInfoVersion(ASYNCAPI_PATH),
    stack: {
      bunPackageManager: parsePackageManagerVersion(pkg.packageManager),
      bunEngines: typeof pkg.engines?.bun === "string" ? pkg.engines.bun : "",
      // The full distinct CI Bun set — the gate asserts it equals {current pin,
      // minimum-supported floor}, so both the current AND the minimum cell must
      // exist in ci.yml.
      bunCiVersions: ciBun,
      astro: pkg.dependencies?.astro ?? "",
      astroNode: pkg.dependencies?.["@astrojs/node"] ?? "",
      typescript: pkg.devDependencies?.typescript ?? "",
      postgres: ciPg.length === 1 ? ciPg[0]! : ciPg.join("|")
    },
    migrationChecksumAlgorithm: MIGRATION_CHECKSUM_ALGORITHM,
    familyContractVersion: FAMILY_CONTRACT_VERSION,
    familyOwnedContractVersions: { ...FAMILY_OWNED_CONTRACT_VERSIONS },
    schemaRequiredKeys: readSchemaRequiredKeys(),
    adrExists: (adr: string) =>
      typeof adr === "string" &&
      adr.length > 0 &&
      existsSync(path.join(ADR_DIR, adr)),
    now
  };
}

function parseReportPathArg(argv: string[]): string | null {
  const envPath = process.env.FAMILY_CONFORMANCE_REPORT_PATH;
  if (envPath && envPath.length > 0) return envPath;
  const flagIndex = argv.indexOf("--report");
  if (flagIndex >= 0 && argv[flagIndex + 1]) return argv[flagIndex + 1]!;
  return null;
}

function printEvidence(report: EvidenceReport): void {
  console.log(
    `family:conformance:check — family contract v${report.familyContractVersion}, schema v${report.manifestSchemaVersion}`
  );
  for (const check of report.checks) {
    const mark = check.status === "pass" ? "PASS" : "FAIL";
    const cmp =
      check.declared !== undefined && check.actual !== undefined
        ? ` (declared ${check.declared} vs actual ${check.actual})`
        : check.detail
          ? ` (${check.detail})`
          : "";
    console.log(`  [${mark}] ${check.name}${cmp}`);
  }
}

function main(): void {
  const now = new Date();

  let raw: unknown;
  try {
    raw = loadManifest();
  } catch (error) {
    console.error(
      `family:conformance:check FAILED — cannot read/parse awcms-family-compatibility.yaml: ${safeErrorDetail(error)}`
    );
    process.exitCode = 1;
    return;
  }

  const shapeProblems = validateFamilyManifestShape(raw, now);
  if (shapeProblems.length > 0) {
    console.error("family:conformance:check FAILED — manifest schema invalid:");
    for (const problem of shapeProblems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const manifest = raw as FamilyCompatibilityManifest;
  const actuals = gatherActuals(now);
  const checks = collectFamilyConformanceChecks(manifest, actuals);
  const report = buildEvidenceReport(manifest, checks, now);

  assertEvidenceReportSecretFree(report);
  printEvidence(report);

  const reportPath = parseReportPathArg(process.argv.slice(2));
  if (reportPath) {
    Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  evidence report written to ${reportPath}`);
  }

  if (report.summary.failed > 0) {
    console.error(
      `family:conformance:check FAILED — ${report.summary.failed}/${report.summary.total} contract check(s) failed. The manifest no longer matches the code/toolchain, or a divergence is unreviewed/unbacked. Update awcms-family-compatibility.yaml (and its evidence/contract tests) in the same change.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `family:conformance:check OK — ${report.summary.passed}/${report.summary.total} contract checks pass; ${manifest.intentionalDivergences.length} intentional divergence(s) reviewed and ADR-backed.`
  );
}

if (import.meta.main) {
  main();
}
