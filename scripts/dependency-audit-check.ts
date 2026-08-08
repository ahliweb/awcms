/**
 * dependency-audit-check.ts — `bun run deps:audit:check`.
 *
 * Runs `bun audit` and fails the chain on `high`/`critical` advisories.
 *
 * ## Why this had to exist
 *
 * `docs/awcms/standar-performa-dan-keamanan.md` listed `bun audit` as the
 * evidence for OWASP **A06 Vulnerable Components**, as ISO/IEC 27001 control
 * **A.8.8**, and as NIST SSDF **RV.1** — three compliance tables leaning on one
 * command that **nothing ran**. `grep -rn "bun audit" package.json
 * .github/workflows/ scripts/` returned zero hits while the ledger recorded
 * "`bun audit` bersih per 4 Agustus 2026". Run on 2026-08-08 it exited 1 with
 * three `high` advisories, and nobody had been told: `nanoid <3.3.17`
 * (GHSA-2v37-7h3g-55p8) reached through `astro › vite › postcss`, and `js-yaml`
 * on both its `>=3.0.0 <3.15.1` and `>=4.0.0 <4.3.1` ranges
 * (GHSA-5p4m-2wfm-xmqj, CVE-2026-59870).
 *
 * A claim that has gone stale is worse than no claim: it is the sentence people
 * cite when asked whether dependencies are checked. This is the checker that
 * sentence needed.
 *
 * ## Why `high` and not everything
 *
 * `bun audit` exits non-zero on ANY severity, including `low` advisories on
 * transitive dev tooling that no release can act on. A gate that fires on noise
 * is a gate someone deletes on a Friday. `high`/`critical` block; `moderate`
 * and `low` are printed so they are visible without being able to stop a merge.
 *
 * ## What it audits, stated honestly
 *
 * `bun audit` resolves against the **lockfile**, not the directory tree. Two
 * consequences learned by measurement while writing this, both of which make a
 * naive reading of a green run wrong:
 *
 * 1. An incremental `bun install` does NOT prune nested `node_modules/*\/
 *    node_modules/<pkg>` copies left by earlier installs, so a working tree can
 *    still hold a vulnerable copy on disk while this gate is green. The
 *    lockfile is the thing that ships (`bun install --frozen-lockfile` in CI
 *    and in the image), so auditing it is correct — but "green" means the
 *    lockfile is clean, not that every byte under `node_modules/` is.
 * 2. `bun update <name>` on a TRANSITIVE dependency does not upgrade the nested
 *    copy; it ADDS that package as a direct dependency of this repo. The fix
 *    for a transitive advisory is an `overrides` entry, never `bun update`.
 *
 * ## Network
 *
 * This gate needs the registry, and it FAILS when it cannot reach it rather
 * than passing. A security check that silently succeeds when it could not run
 * is the precise failure this repo keeps writing down — an unrunnable checker
 * reports the same green as a clean one, and only one of those is true.
 */
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";

import { EXCEPTIONS, type AuditException } from "./dependency-audit-exceptions";

/** One advisory as `bun audit --json` emits it. */
export type Advisory = {
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
};

/** `bun audit --json` output: package name -> advisories against it. */
export type AuditReport = Record<string, Advisory[]>;

export type AuditFinding = {
  packageName: string;
  advisory: Advisory;
};

export type AuditEvaluation = {
  ok: boolean;
  blocking: AuditFinding[];
  informational: AuditFinding[];
  /** Exceptions that matched nothing — a list that has outlived its reason. */
  staleExceptions: AuditException[];
  violations: string[];
};

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function matchesException(
  finding: AuditFinding,
  exception: AuditException
): boolean {
  return (
    finding.packageName === exception.packageName &&
    finding.advisory.url === exception.advisoryUrl
  );
}

/**
 * Pure evaluation, split from the `bun audit` invocation so the tests can feed
 * it a report without a registry round trip. Everything the gate decides is
 * decided here.
 */
export function evaluateAudit(
  report: AuditReport,
  exceptions: readonly AuditException[] = EXCEPTIONS
): AuditEvaluation {
  const findings: AuditFinding[] = [];

  for (const [packageName, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      findings.push({ packageName, advisory });
    }
  }

  const blocking: AuditFinding[] = [];
  const informational: AuditFinding[] = [];
  const usedExceptions = new Set<AuditException>();

  for (const finding of findings) {
    const severity = finding.advisory.severity?.toLowerCase() ?? "";

    if (!BLOCKING_SEVERITIES.has(severity)) {
      informational.push(finding);
      continue;
    }

    const exception = exceptions.find((entry) =>
      matchesException(finding, entry)
    );

    if (exception) {
      usedExceptions.add(exception);
      informational.push(finding);
      continue;
    }

    blocking.push(finding);
  }

  // A stale exception is its own failure. Left alone, the list becomes a
  // record of advisories that USED to exist, and the next reviewer reads a
  // long list as "these are all still real" — which is how an exception list
  // stops being a decision and becomes decoration.
  const staleExceptions = exceptions.filter(
    (entry) => !usedExceptions.has(entry)
  );

  const violations: string[] = [];

  for (const finding of blocking) {
    violations.push(
      `${finding.packageName}: [${finding.advisory.severity}] ${finding.advisory.title} ` +
        `(rentan: ${finding.advisory.vulnerable_versions}) — ${finding.advisory.url}`
    );
  }

  for (const entry of staleExceptions) {
    violations.push(
      `pengecualian usang: ${entry.packageName} / ${entry.advisoryUrl} tidak lagi cocok dengan advisory mana pun — hapus entrinya.`
    );
  }

  return {
    ok: violations.length === 0,
    blocking,
    informational,
    staleExceptions,
    violations
  };
}

/** Parses `bun audit --json` stdout. Throws on anything that is not a report. */
export function parseAuditOutput(stdout: string): AuditReport {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    throw new Error("`bun audit --json` tidak mengeluarkan apa pun.");
  }

  // Bun prefixes stdout with dotenv/banner lines; the report is the last
  // JSON object. Anchoring on the first `{` would swallow those lines.
  const start = trimmed.indexOf("{");

  if (start === -1) {
    throw new Error(
      `keluaran \`bun audit --json\` bukan JSON: ${trimmed.slice(0, 200)}`
    );
  }

  const parsed: unknown = JSON.parse(trimmed.slice(start));

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("keluaran `bun audit --json` bukan objek laporan.");
  }

  return parsed as AuditReport;
}

async function runAudit(): Promise<AuditReport> {
  const proc = Bun.spawn(["bun", "audit", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" }
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  await proc.exited;

  // Exit code is NOT the signal: `bun audit` exits 1 whenever any advisory
  // exists, including the `moderate`/`low` ones this gate deliberately does
  // not block on. The report body is what decides. An unparseable body IS a
  // failure though — that is the "could not run" case.
  try {
    return parseAuditOutput(stdout);
  } catch (error) {
    const detail = safeErrorDetail(error);
    throw new Error(
      `tidak dapat menjalankan \`bun audit\` (registry tak terjangkau?): ${detail}` +
        (stderr.trim() ? `\nstderr: ${stderr.trim().slice(0, 400)}` : "")
    );
  }
}

async function main(): Promise<void> {
  let report: AuditReport;

  try {
    report = await runAudit();
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error(`deps:audit:check GAGAL — ${detail}`);
    console.error(
      "Gerbang ini gagal-TERTUTUP: audit yang tidak bisa dijalankan melaporkan hijau yang sama dengan audit yang bersih."
    );
    process.exitCode = 1;
    return;
  }

  const evaluation = evaluateAudit(report);

  for (const finding of evaluation.informational) {
    console.log(
      `  (info) ${finding.packageName}: [${finding.advisory.severity}] ${finding.advisory.title}`
    );
  }

  if (!evaluation.ok) {
    console.error("deps:audit:check GAGAL:");
    for (const violation of evaluation.violations) {
      console.error(`  - ${violation}`);
    }
    console.error(
      "\nAdvisory transitif ditutup lewat `overrides` di package.json, BUKAN `bun update <nama>` " +
        "(itu menambahkan paketnya sebagai dependensi LANGSUNG dan meninggalkan salinan bersarang yang rentan)."
    );
    process.exitCode = 1;
    return;
  }

  const total = evaluation.informational.length;
  console.log(
    `deps:audit:check OK — tidak ada advisory high/critical yang tidak tertangani` +
      (total > 0 ? ` (${total} advisory non-pemblokir di atas)` : "") +
      `; ${EXCEPTIONS.length} pengecualian terdaftar.`
  );
}

if (import.meta.main) {
  await main();
}
