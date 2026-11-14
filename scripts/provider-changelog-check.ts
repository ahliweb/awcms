/**
 * provider-changelog-check.ts — `bun run deps:provider-changelog:check`
 * (Issue #1173).
 *
 * Holds `provider-api-register.ts` to the code in both directions and to the
 * clock. See that file for what each rule means; in short:
 *
 *   1. every `pins` literal is still in its file       (register not stale)
 *   2. every source file naming a provider host is registered   (code not unregistered)
 *   3. a `planned` entry has no files/pins and its hosts are absent from source
 *   4. the changelog review is not overdue
 *
 * Pure inputs, no network: a gate that needed a provider to be up would make
 * every PR's required checks depend on a third party.
 *
 * Usage:
 *   bun run deps:provider-changelog:check
 *   bun run deps:provider-changelog:check --out-json findings.json --out-md report.md
 *   bun run deps:provider-changelog:check --skip-age     # rules 1-3 only
 *   bun run deps:provider-changelog:check --root <dir> --register <file> --src <dir>
 *
 * Exit code 1 on any failure. A review that is merely DUE SOON (within
 * `WARN_DAYS`) is a warning, reported and turned into an issue by the weekly
 * workflow, but not a failure: a deadline that goes red at the same moment for
 * every open PR is a deadline people learn to resent.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Finding, FindingFile } from "./lib/dependency-finding";
import {
  PROVIDER_HOSTS,
  PROVIDER_REGISTER,
  WARN_DAYS,
  type ProviderEntry
} from "./provider-api-register";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type ReviewState =
  "ok" | "due-soon" | "overdue" | "not-applicable" | "invalid";

export type EntryEvaluation = {
  entry: ProviderEntry;
  review: ReviewState;
  /** ISO date the review is due, or null for a planned entry. */
  dueOn: string | null;
  daysLeft: number | null;
  neverReviewed: boolean;
};

export type ProviderReport = {
  evaluations: EntryEvaluation[];
  /** Hard failures (gate goes red). */
  failures: string[];
  /** Reviews due within WARN_DAYS. */
  warnings: string[];
  findings: Finding[];
};

export function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function evaluateEntry(
  entry: ProviderEntry,
  today: string,
  warnDays: number
): EntryEvaluation {
  if (entry.status === "planned") {
    return {
      entry,
      review: "not-applicable",
      dueOn: null,
      daysLeft: null,
      neverReviewed: entry.lastReview === null
    };
  }

  const basis = entry.lastReview ?? entry.recordedOn;

  // A malformed date has already been reported as a failure; it must not also
  // crash the run and hide every other finding.
  if (!ISO_DATE.test(basis) || Number.isNaN(Date.parse(`${basis}T00:00:00Z`))) {
    return {
      entry,
      review: "invalid",
      dueOn: null,
      daysLeft: null,
      neverReviewed: entry.lastReview === null
    };
  }

  const dueOn = addDays(basis, entry.maxAgeDays);
  const daysLeft = dayNumber(dueOn) - dayNumber(today);

  return {
    entry,
    review: daysLeft < 0 ? "overdue" : daysLeft <= warnDays ? "due-soon" : "ok",
    dueOn,
    daysLeft,
    neverReviewed: entry.lastReview === null
  };
}

export function evaluateRegister(input: {
  register: readonly ProviderEntry[];
  providerHosts: readonly string[];
  /** Repo-relative path -> file text, for every non-test source file. */
  sources: ReadonlyMap<string, string>;
  /** Text of a pinned file, or undefined when it does not exist. */
  readFile: (relativePath: string) => string | undefined;
  today: string;
  warnDays: number;
  checkAge: boolean;
}): ProviderReport {
  const failures: string[] = [];
  const warnings: string[] = [];
  const findings: Finding[] = [];
  const evaluations: EntryEvaluation[] = [];

  const fail = (key: string, title: string, detail: string) => {
    failures.push(title);
    findings.push({ key, title, detail });
  };

  const seenIds = new Set<string>();

  for (const entry of input.register) {
    if (seenIds.has(entry.id)) {
      fail(
        `provider:duplicate:${entry.id}`,
        `Provider register: duplicate id ${entry.id}`,
        "Every entry needs a unique `id`."
      );
    }

    seenIds.add(entry.id);

    for (const field of ["recordedOn", "lastReview"] as const) {
      const value = entry[field];

      if (value !== null && !ISO_DATE.test(value)) {
        fail(
          `provider:bad-date:${entry.id}:${field}`,
          `Provider register ${entry.id}: ${field} "${value}" is not YYYY-MM-DD`,
          "Dates are ISO `YYYY-MM-DD`."
        );
      }
    }

    if (!(entry.maxAgeDays > 0)) {
      fail(
        `provider:bad-age:${entry.id}`,
        `Provider register ${entry.id}: maxAgeDays must be positive`,
        "A review interval of zero or less makes the deadline meaningless."
      );
    }

    if (entry.lastReview !== null && entry.lastReview > input.today) {
      fail(
        `provider:future-review:${entry.id}`,
        `Provider register ${entry.id}: lastReview ${entry.lastReview} is in the future`,
        "A review date ahead of today is a typo or an attempt to defer the deadline."
      );
    }

    // Rule 1 (active): pins are still in the code.
    if (entry.status === "active") {
      if (entry.pins.length === 0) {
        fail(
          `provider:no-pins:${entry.id}`,
          `Provider register ${entry.id}: an active entry needs at least one pin`,
          "Without a pin nothing ties the entry to the code that uses it."
        );
      }

      for (const pin of entry.pins) {
        const text = input.readFile(pin.file);

        if (text === undefined) {
          fail(
            `provider:pin-file-missing:${entry.id}:${pin.file}`,
            `Provider register ${entry.id}: pinned file ${pin.file} does not exist`,
            "The code moved or was deleted. Update the pin and re-read the provider changelog if the version changed."
          );
        } else if (!text.includes(pin.literal)) {
          fail(
            `provider:pin-stale:${entry.id}:${pin.file}`,
            `Provider register ${entry.id}: \`${pin.literal}\` is no longer in ${pin.file}`,
            `The code no longer matches the register entry "${entry.usedVersion}". ` +
              "Update `usedVersion` and the pin, and read the provider changelog for the new version in the same PR."
          );
        }
      }
    }

    // Rule 3: a planned entry owns nothing.
    if (entry.status === "planned") {
      if (entry.files.length > 0 || entry.pins.length > 0) {
        fail(
          `provider:planned-has-code:${entry.id}`,
          `Provider register ${entry.id}: a planned entry must have no files or pins`,
          "Flip it to `active` when the connector lands."
        );
      }
    }

    // Rule 4.
    const evaluation = evaluateEntry(entry, input.today, input.warnDays);
    evaluations.push(evaluation);

    if (input.checkAge && evaluation.review === "overdue") {
      fail(
        `provider:review-overdue:${entry.id}`,
        `Provider changelog review overdue: ${entry.provider} (${entry.id}), was due ${evaluation.dueOn}`,
        `Read ${entry.changelogUrl} for everything since ${entry.lastReview ?? "the entry was recorded (" + entry.recordedOn + ")"}, ` +
          `confirm the used surface (${entry.usedVersion}) is still supported and no breaking change applies, ` +
          `then set \`lastReview\` in \`scripts/provider-api-register.ts\` in a reviewed PR. If a change does apply, open the migration issue first.`
      );
    } else if (evaluation.review === "due-soon") {
      const line = `${entry.provider} (${entry.id}) is due ${evaluation.dueOn}`;

      warnings.push(line);
      findings.push({
        key: `provider:review-due-soon:${entry.id}`,
        title: `Provider changelog review due soon: ${entry.provider} (${entry.id}), due ${evaluation.dueOn}`,
        detail:
          `Read ${entry.changelogUrl} and record the review by setting \`lastReview\` in ` +
          "`scripts/provider-api-register.ts`. After the due date the `deps:provider-changelog:check` gate fails."
      });
    }
  }

  // Rule 2 / 3: the code is in the register.
  for (const [file, text] of [...input.sources].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    for (const host of input.providerHosts) {
      if (!text.includes(host)) {
        continue;
      }

      const owners = input.register.filter((entry) =>
        entry.hosts.includes(host)
      );
      const covering = owners.filter(
        (entry) => entry.status === "active" && entry.files.includes(file)
      );

      if (covering.length === 0) {
        const planned = owners.find((entry) => entry.status === "planned");

        fail(
          `provider:unregistered:${file}:${host}`,
          `Provider register: ${file} names ${host} but no active entry lists it`,
          planned
            ? `Entry \`${planned.id}\` is still \`planned\`. Flip it to \`active\`, list this file and pin its version, and do the first changelog review in the same PR.`
            : "Add (or extend) an entry in `scripts/provider-api-register.ts` with this file, a pin, and a changelog URL."
        );
      }
    }
  }

  // An entry may not claim a file that does not name any of its hosts.
  for (const entry of input.register) {
    for (const file of entry.files) {
      const text = input.sources.get(file);

      if (text === undefined) {
        fail(
          `provider:file-missing:${entry.id}:${file}`,
          `Provider register ${entry.id}: listed file ${file} does not exist or is a test`,
          "Remove or correct the path."
        );
      } else if (!entry.hosts.some((host) => text.includes(host))) {
        fail(
          `provider:file-stale:${entry.id}:${file}`,
          `Provider register ${entry.id}: ${file} no longer names any of its hosts`,
          "The file stopped talking to this provider. Remove it from `files` (and re-check the pins)."
        );
      }
    }
  }

  return { evaluations, failures, warnings, findings };
}

export function renderProviderReport(report: ProviderReport): string {
  const lines = [
    "## Provider API changelog review",
    "",
    "| Provider | Surface used | Last review | Due | State |",
    "| --- | --- | --- | --- | --- |",
    ...report.evaluations.map(
      ({ entry, review, dueOn, daysLeft, neverReviewed }) => {
        const state =
          review === "not-applicable"
            ? "planned, no code"
            : review === "invalid"
              ? "INVALID date"
              : review === "overdue"
                ? `OVERDUE by ${Math.abs(daysLeft as number)} d`
                : review === "due-soon"
                  ? `due in ${daysLeft} d`
                  : `ok, ${daysLeft} d left`;

        return `| ${entry.provider} | ${entry.usedVersion} | ${
          neverReviewed ? "never (baseline only)" : entry.lastReview
        } | ${dueOn ?? "-"} | ${state} |`;
      }
    ),
    ""
  ];

  if (report.failures.length > 0) {
    lines.push("**Failures**", "", ...report.failures.map((f) => `- ${f}`), "");
  }

  if (report.warnings.length > 0) {
    lines.push("**Due soon**", "", ...report.warnings.map((w) => `- ${w}`), "");
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Source scan and CLI
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".astro", ".mjs", ".js"]);

function isTest(relative: string): boolean {
  return (
    /\.(test|spec)\.[a-z]+$/.test(relative) ||
    relative.split("/").includes("__tests__")
  );
}

export function collectSources(
  root: string,
  srcDir: string
): Map<string, string> {
  const result = new Map<string, string>();

  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const stat = statSync(absolute);

      if (stat.isDirectory()) {
        if (name !== "node_modules") {
          walk(absolute);
        }

        continue;
      }

      const relative = path.relative(root, absolute).split(path.sep).join("/");

      if (SOURCE_EXTENSIONS.has(path.extname(name)) && !isTest(relative)) {
        result.set(relative, readFileSync(absolute, "utf8"));
      }
    }
  };

  walk(path.join(root, srcDir));

  return result;
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

async function loadRegister(file: string | undefined): Promise<{
  register: readonly ProviderEntry[];
  hosts: readonly string[];
}> {
  if (!file) {
    return { register: PROVIDER_REGISTER, hosts: PROVIDER_HOSTS };
  }

  const module = (await import(pathToFileURL(path.resolve(file)).href)) as {
    PROVIDER_REGISTER?: readonly ProviderEntry[];
    PROVIDER_HOSTS?: readonly string[];
  };

  if (!module.PROVIDER_REGISTER || !module.PROVIDER_HOSTS) {
    throw new Error(`${file} must export PROVIDER_REGISTER and PROVIDER_HOSTS`);
  }

  return { register: module.PROVIDER_REGISTER, hosts: module.PROVIDER_HOSTS };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = path.resolve(argValue(args, "--root") ?? process.cwd());
  const { register, hosts } = await loadRegister(argValue(args, "--register"));
  const sources = collectSources(root, argValue(args, "--src") ?? "src");

  const report = evaluateRegister({
    register,
    providerHosts: hosts,
    sources,
    readFile: (relative) => {
      try {
        return readFileSync(path.join(root, relative), "utf8");
      } catch {
        return undefined;
      }
    },
    today: new Date().toISOString().slice(0, 10),
    warnDays: WARN_DAYS,
    checkAge: !args.includes("--skip-age")
  });

  const outJson = argValue(args, "--out-json");
  const outMd = argValue(args, "--out-md");
  const markdown = renderProviderReport(report);

  if (outJson) {
    const file: FindingFile = {
      source: "deps:provider-changelog:check",
      findings: report.findings
    };

    writeFileSync(outJson, `${JSON.stringify(file, null, 2)}\n`);
  }

  if (outMd) {
    writeFileSync(outMd, markdown);
  }

  if (report.failures.length > 0) {
    process.stderr.write(markdown);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `deps:provider-changelog:check OK: ${report.evaluations.length} provider entries, ${report.warnings.length} review(s) due within ${WARN_DAYS} days.\n`
  );
}

if (import.meta.main) {
  await main();
}
