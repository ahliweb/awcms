/**
 * contract-fixture-pack-hygiene.ts -- what `bun run api:fixtures:check` proves
 * about the PINNED fixtures pack beyond freshness (Issue #1394, ADR-0167).
 *
 * The pack is published to consumers by commit SHA (data, not a service), so a
 * consumer cannot ask us to take a value back. Three things must therefore be
 * true of every pack that reaches `main`:
 *
 * 1. MANIFEST. `packVersion`, `contractVersion`, `contractSha256` and
 *    `contentSha256` are present and agree with the content and with the
 *    bundle file at the same commit (`verifyManifest`).
 * 2. NO SECRETS. No string value is secret-shaped (JWT, PEM private key, AWS key
 *    id, `Bearer`/`Basic` value, DSN with credentials) -- the same shapes the
 *    settings guard uses (`findSecretShapedValues`), plus the free-text variants
 *    of those shapes, because a pack value can be a longer sentence.
 * 3. NO PERSONAL DATA, NO FOREIGN NAMES. E-mail addresses use reserved domains
 *    (`findNonSyntheticEmails`), no 16-digit identifier (NIK shape), no NPWP
 *    shape, no Indonesian mobile number, and no repository name outside the
 *    family allow-list (`awcms`, `awcms-astro`, ADR-0055 / ADR-0070).
 *
 * Heuristics, not DLP: they close the accidental-paste gap, as the module they
 * reuse says of itself. Findings carry a JSON path and a rule, never the value.
 */
import { findSecretShapedValues } from "../../src/modules/_shared/redaction";
import { findNonSyntheticEmails } from "../api-contract-examples";
import {
  PACK_VERSION,
  computeContentSha256,
  type FixturePack
} from "../api-contract-fixtures";

/** Repositories a published pack may name. Everything else is refused. */
export const FAMILY_REPOSITORIES: readonly string[] = [
  "ahliweb/awcms",
  "ahliweb/awcms-astro"
];

export interface HygieneFinding {
  /** Stable rule id; tests and docs refer to it. */
  rule: string;
  /** JSON path of the offending value (never the value itself). */
  path: string;
}

const FREE_TEXT_SECRET_SHAPES: ReadonlyArray<{ rule: string; re: RegExp }> = [
  {
    rule: "secret-jwt",
    re: /eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]*/
  },
  { rule: "secret-pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: "secret-aws-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    rule: "secret-auth-header",
    re: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/
  },
  {
    rule: "secret-dsn-credentials",
    re: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@/\s]+:[^/\s]+@/
  },
  { rule: "secret-github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { rule: "secret-live-key", re: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{10,}\b/ }
];

const PERSONAL_SHAPES: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: "pii-nik-shape", re: /(?<![0-9])[0-9]{16}(?![0-9])/ },
  {
    rule: "pii-npwp-shape",
    re: /(?<![0-9])[0-9]{2}\.[0-9]{3}\.[0-9]{3}\.[0-9]-[0-9]{3}\.[0-9]{3}(?![0-9])/
  },
  {
    rule: "pii-id-mobile-number",
    re: /(?<![0-9])(?:\+62|62|0)8[0-9]{8,11}(?![0-9])/
  }
];

const REPO_TOKENS: readonly RegExp[] = [
  /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g,
  /\bahliweb\/([A-Za-z0-9_.-]+)/g
];
const FAMILY_STEM = /\bawcms-[a-z0-9][a-z0-9-]*/g;

function repoNameFindings(text: string): boolean {
  const family = new Set(FAMILY_REPOSITORIES.map((r) => r.toLowerCase()));
  for (const re of REPO_TOKENS) {
    for (const m of text.matchAll(re)) {
      const full = (m[1]!.includes("/") ? m[1]! : `ahliweb/${m[1]!}`).replace(
        /\.git$/,
        ""
      );
      if (!family.has(full.toLowerCase())) {
        return true;
      }
    }
  }
  const stems = new Set(
    FAMILY_REPOSITORIES.map((r) => r.split("/")[1]!.toLowerCase())
  );
  for (const m of text.matchAll(FAMILY_STEM)) {
    if (!stems.has(m[0].toLowerCase())) {
      return true;
    }
  }
  return false;
}

function walkStrings(
  node: unknown,
  path: string,
  visit: (path: string, value: string) => void
): void {
  if (typeof node === "string") {
    visit(path, node);
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => walkStrings(item, `${path}[${i}]`, visit));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walkStrings(value, path ? `${path}.${key}` : key, visit);
    }
  }
}

/** Scan a parsed pack for secrets, personal data and foreign repository names. */
export function scanPackHygiene(pack: unknown): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  const record =
    pack && typeof pack === "object" && !Array.isArray(pack)
      ? (pack as Record<string, unknown>)
      : {};
  for (const path of findSecretShapedValues(record)) {
    findings.push({ rule: "secret-shaped-value", path });
  }
  walkStrings(pack, "", (path, value) => {
    for (const { rule, re } of FREE_TEXT_SECRET_SHAPES) {
      if (re.test(value)) {
        findings.push({ rule, path });
      }
    }
    for (const { rule, re } of PERSONAL_SHAPES) {
      if (re.test(value)) {
        findings.push({ rule, path });
      }
    }
    if (findNonSyntheticEmails(value).length > 0) {
      findings.push({ rule: "pii-real-email-domain", path });
    }
    if (repoNameFindings(value)) {
      findings.push({ rule: "foreign-repository-name", path });
    }
  });
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.rule}|${f.path}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The manifest of a parsed pack must be complete and agree with the content
 * (`contentSha256`) and with the bundle file the pack claims it came from
 * (`contractSha256`, `contractVersion`).
 */
export function verifyManifest(
  pack: unknown,
  bundle: { sha256: string; version: string | undefined }
): string[] {
  const problems: string[] = [];
  const p = (pack ?? {}) as Partial<FixturePack>;
  if (p.packVersion !== PACK_VERSION) {
    problems.push(
      `packVersion is ${String(p.packVersion)}, expected ${PACK_VERSION}`
    );
  }
  if (typeof p.contractVersion !== "string" || p.contractVersion === "") {
    problems.push("contractVersion is missing");
  } else if (
    bundle.version !== undefined &&
    p.contractVersion !== bundle.version
  ) {
    problems.push(
      `contractVersion ${p.contractVersion} differs from the bundle's info.version ${bundle.version}`
    );
  }
  if (
    typeof p.contractSha256 !== "string" ||
    !SHA256_HEX.test(p.contractSha256)
  ) {
    problems.push("contractSha256 is missing or not a SHA-256 hex digest");
  } else if (p.contractSha256 !== bundle.sha256) {
    problems.push(
      "contractSha256 does not match the SHA-256 of the bundle file"
    );
  }
  if (
    typeof p.contentSha256 !== "string" ||
    !SHA256_HEX.test(p.contentSha256)
  ) {
    problems.push("contentSha256 is missing or not a SHA-256 hex digest");
  } else if (p.contentSha256 !== computeContentSha256(p as FixturePack)) {
    problems.push("contentSha256 does not match the content of the pack");
  }
  return problems;
}
