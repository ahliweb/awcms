/**
 * dependency-license-check.ts — `bun run deps:license:check` (Issue #1173).
 *
 * Aggregates the license of every package in `bun.lock`, refuses anything
 * outside the allow-list (`dependency-license-policy.ts`, with reasoned,
 * expiring exceptions), and writes a CycloneDX 1.6 SBOM of the same tree.
 * Bun-only: the lockfile is parsed here, the license is read from the installed
 * `node_modules/<pkg>/package.json`; no npm, no Node-only tool.
 *
 * ## What the lockfile does and does not say
 *
 * `bun.lock` names every package, its version, its integrity hash and its
 * dependency edges, but NOT its license. The license is read from the installed
 * package, so the gate needs `bun install` to have run (CI always has). A
 * package that cannot be read is `UNKNOWN`, never "fine": an unreadable tree
 * that printed "0 violations" would say the same as a clean one.
 *
 * Platform-specific optional packages (`os`/`cpu` in the lock) are not installed
 * on the machine that runs the gate; they are counted and listed as
 * `not installed here` rather than failed, and their license is recorded as
 * unverified in the SBOM. The exception list names their families
 * (`@img/sharp-libvips-*`), so the policy still covers them where they ARE
 * installed.
 *
 * ## Reuse by a downstream workspace
 *
 * Nothing here assumes this repository's layout:
 *
 *   --root <dir>     directory that holds `bun.lock`, `package.json` and
 *                    `node_modules` (a workspace root, not necessarily `cwd`)
 *   --policy <file>  module exporting `ALLOWED_LICENSES` and `LICENSE_EXCEPTIONS`
 *
 * Usage:
 *   bun run deps:license:check
 *   bun run deps:license:check --out-sbom sbom.cdx.json --out-json license.json
 *   bun run deps:license:check --root ../workspace --policy ./license-policy.ts
 *
 * Exit code 1 on: a license outside the allow-list, a package whose license
 * cannot be read, an exception that matches nothing, or an expired exception.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Finding, FindingFile } from "./lib/dependency-finding";
import {
  ALLOWED_LICENSES,
  LICENSE_EXCEPTIONS,
  type LicenseException
} from "./dependency-license-policy";

// ---------------------------------------------------------------------------
// bun.lock
// ---------------------------------------------------------------------------

export type LockPackage = {
  /** Install-path key in `bun.lock`: `astro`, or `astro/tinyglobby` when nested. */
  key: string;
  name: string;
  version: string;
  /** `sha512-...` integrity as the lock records it, when it has one. */
  integrity: string | null;
  /** `os`/`cpu` constrained: installed only on a matching platform. */
  platformSpecific: boolean;
  /** Names of declared dependencies (all kinds that the lock records). */
  dependencies: string[];
  /** The subset of `dependencies` declared as optional. */
  optionalDependencies: string[];
};

/**
 * `bun.lock` is JSONC (trailing commas). Strip a comma that directly precedes a
 * closing bracket OUTSIDE a string, then `JSON.parse` — `Bun.JSONC` would do it,
 * but is not present on the oldest Bun the CI matrix still runs.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (inString) {
      out += char;

      if (char === "\\") {
        index += 1;
        out += text[index] ?? "";
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;

      while (/\s/.test(text[lookahead] ?? "")) {
        lookahead += 1;
      }

      if (text[lookahead] === "}" || text[lookahead] === "]") {
        continue;
      }
    }

    out += char;
  }

  return JSON.parse(out);
}

/** Direct dependencies of the root workspace (`workspaces[""]`), all kinds. */
export function parseRootDependencies(text: string): string[] {
  const parsed = parseJsonc(text) as {
    workspaces?: Record<string, Record<string, unknown>>;
  };
  const root = parsed.workspaces?.[""] ?? {};
  const names = new Set<string>();

  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies"
  ]) {
    const group = root[field];

    if (group && typeof group === "object") {
      for (const name of Object.keys(group)) {
        names.add(name);
      }
    }
  }

  return [...names].sort();
}

export function parseBunLock(text: string): LockPackage[] {
  const parsed = parseJsonc(text) as { packages?: Record<string, unknown[]> };

  if (!parsed.packages || typeof parsed.packages !== "object") {
    throw new Error("bun.lock has no `packages` object");
  }

  const result: LockPackage[] = [];

  for (const [key, entry] of Object.entries(parsed.packages)) {
    const ident = entry[0];

    if (typeof ident !== "string") {
      throw new Error(`bun.lock entry ${key} has no identifier`);
    }

    const at = ident.lastIndexOf("@");

    if (at <= 0) {
      throw new Error(`bun.lock entry ${key}: cannot split "${ident}"`);
    }

    const meta = (entry[2] ?? {}) as Record<string, unknown>;
    const edges = new Set<string>();
    const optionalEdges = new Set<string>();

    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies"
    ]) {
      const group = meta[field];

      if (group && typeof group === "object") {
        for (const name of Object.keys(group)) {
          edges.add(name);

          if (field === "optionalDependencies") {
            optionalEdges.add(name);
          }
        }
      }
    }

    const integrity = entry[3];

    result.push({
      key,
      name: ident.slice(0, at),
      version: ident.slice(at + 1),
      integrity: typeof integrity === "string" ? integrity : null,
      platformSpecific: "os" in meta || "cpu" in meta,
      dependencies: [...edges].sort(),
      optionalDependencies: [...optionalEdges].sort()
    });
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

/** `astro/tinyglobby` -> `node_modules/astro/node_modules/tinyglobby`. Scope-aware. */
export function installPathOf(key: string): string {
  const segments = key.split("/");
  const names: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;

    if (segment.startsWith("@") && index + 1 < segments.length) {
      names.push(`${segment}/${segments[index + 1]}`);
      index += 1;
    } else {
      names.push(segment);
    }
  }

  return names.map((name) => `node_modules/${name}`).join("/");
}

/**
 * Keys reachable from the root WITHOUT crossing an optional edge: what a plain
 * install must put on disk. Everything else is present only where an optional
 * platform package is selected (the wasm32 fallbacks, `os`/`cpu` binaries).
 */
export function requiredReachable(
  packages: readonly LockPackage[],
  rootDependencies: readonly string[]
): Set<string> {
  const keys = new Set(packages.map((pkg) => pkg.key));
  const byKey = new Map(packages.map((pkg) => [pkg.key, pkg]));
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const name of rootDependencies) {
    const key = resolveDependencyKey("", name, keys);

    if (key !== null) {
      queue.push(key);
    }
  }

  while (queue.length > 0) {
    const key = queue.pop() as string;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const pkg = byKey.get(key) as LockPackage;

    for (const name of pkg.dependencies) {
      if (pkg.optionalDependencies.includes(name)) {
        continue;
      }

      const next = resolveDependencyKey(key, name, keys);

      if (next !== null) {
        queue.push(next);
      }
    }
  }

  return seen;
}

/** Which lock entry satisfies `dependency` for `parent`: nearest enclosing first. */
export function resolveDependencyKey(
  parentKey: string,
  dependency: string,
  keys: ReadonlySet<string>
): string | null {
  const segments = parentKey === "" ? [] : parentKey.split("/");
  const parentNames: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;

    if (segment.startsWith("@") && index + 1 < segments.length) {
      parentNames.push(`${segment}/${segments[index + 1]}`);
      index += 1;
    } else {
      parentNames.push(segment);
    }
  }

  for (let depth = parentNames.length; depth >= 0; depth -= 1) {
    const candidate = [...parentNames.slice(0, depth), dependency].join("/");

    if (keys.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

/** What `package.json` says, normalised to one SPDX-ish string, or null. */
export function declaredLicense(packageJson: unknown): string | null {
  if (!packageJson || typeof packageJson !== "object") {
    return null;
  }

  const record = packageJson as Record<string, unknown>;
  const single = record.license;

  if (typeof single === "string" && single.trim() !== "") {
    return single.trim();
  }

  if (single && typeof single === "object") {
    const type = (single as { type?: unknown }).type;

    if (typeof type === "string" && type.trim() !== "") {
      return type.trim();
    }
  }

  const many = record.licenses;

  if (Array.isArray(many)) {
    const types = many
      .map((item) =>
        item && typeof item === "object"
          ? (item as { type?: unknown }).type
          : undefined
      )
      .filter(
        (type): type is string => typeof type === "string" && type.trim() !== ""
      );

    if (types.length > 0) {
      return types.length === 1
        ? (types[0] as string)
        : `(${types.join(" OR ")})`;
    }
  }

  return null;
}

type Token = string;

function tokenize(expression: string): Token[] {
  return expression.match(/\(|\)|[^\s()]+/g) ?? [];
}

/**
 * SPDX expression against an allow-list. `A OR B` passes when ANY side passes,
 * `A AND B` only when BOTH do, `X WITH Y` is one atom that must be allow-listed
 * as written (a license plus an exception is a different license). Anything it
 * cannot parse is NOT allowed: fail closed.
 */
export function expressionAllowed(
  expression: string,
  allowed: ReadonlySet<string>
): boolean {
  const tokens = tokenize(expression);
  let position = 0;

  const peek = () => tokens[position];
  const isOperator = (token: string | undefined, word: string) =>
    token !== undefined && token.toUpperCase() === word;

  function parseOr(): boolean | null {
    let value = parseAnd();

    if (value === null) {
      return null;
    }

    while (isOperator(peek(), "OR")) {
      position += 1;
      const right = parseAnd();

      if (right === null) {
        return null;
      }

      value = value || right;
    }

    return value;
  }

  function parseAnd(): boolean | null {
    let value = parseAtom();

    if (value === null) {
      return null;
    }

    while (isOperator(peek(), "AND")) {
      position += 1;
      const right = parseAtom();

      if (right === null) {
        return null;
      }

      value = value && right;
    }

    return value;
  }

  function parseAtom(): boolean | null {
    const token = peek();

    if (token === undefined || token === ")") {
      return null;
    }

    if (token === "(") {
      position += 1;
      const inner = parseOr();

      if (inner === null || peek() !== ")") {
        return null;
      }

      position += 1;
      return inner;
    }

    if (isOperator(token, "OR") || isOperator(token, "AND")) {
      return null;
    }

    position += 1;
    let id = token;

    if (isOperator(peek(), "WITH")) {
      position += 1;
      const exception = peek();

      if (exception === undefined || exception === "(" || exception === ")") {
        return null;
      }

      position += 1;
      id = `${token} WITH ${exception}`;
    }

    return allowed.has(id);
  }

  const result = parseOr();

  return result === true && position === tokens.length;
}

export function exceptionMatches(
  exception: LicenseException,
  packageName: string,
  license: string
): boolean {
  const nameMatches = exception.packageName.endsWith("*")
    ? packageName.startsWith(exception.packageName.slice(0, -1))
    : packageName === exception.packageName;

  return nameMatches && exception.license === license;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How far ahead an exception's `reviewDate` may be set. */
export const MAX_EXCEPTION_HORIZON_DAYS = 400;

export type Component = LockPackage & {
  /** null = could not be read (installed package missing or no license field). */
  license: string | null;
  installed: boolean;
};

export type LicenseReport = {
  components: Component[];
  /** Outside the allow-list and not excepted. */
  violations: string[];
  /** Installed (or required to be) but no readable license. */
  unreadable: string[];
  /** Platform-specific packages absent from this machine. */
  notInstalled: string[];
  /** Exception entries nothing matched. */
  staleExceptions: string[];
  /** Exceptions whose `reviewDate` is not a real, near date. */
  invalidExceptions: string[];
  expiredExceptions: string[];
  /** Count of packages per declared license (for the summary). */
  byLicense: Record<string, number>;
  failures: string[];
};

export function evaluateLicenses(input: {
  packages: readonly LockPackage[];
  /** Root workspace dependency names (see `parseRootDependencies`). */
  rootDependencies: readonly string[];
  readPackageJson: (installPath: string) => unknown | undefined;
  allowed: readonly string[];
  exceptions: readonly LicenseException[];
  today: string;
}): LicenseReport {
  const allowed = new Set(input.allowed);
  const used = new Set<LicenseException>();
  const components: Component[] = [];
  const violations: string[] = [];
  const unreadable: string[] = [];
  const notInstalled: string[] = [];
  const byLicense: Record<string, number> = {};
  const required = requiredReachable(input.packages, input.rootDependencies);

  for (const pkg of input.packages) {
    const packageJson = input.readPackageJson(installPathOf(pkg.key));
    const installed = packageJson !== undefined;
    const license = installed ? declaredLicense(packageJson) : null;

    components.push({ ...pkg, license, installed });

    if (!installed) {
      if (pkg.platformSpecific || !required.has(pkg.key)) {
        notInstalled.push(`${pkg.name}@${pkg.version}`);
      } else {
        unreadable.push(
          `${pkg.name}@${pkg.version}: not found at ${installPathOf(pkg.key)} (run bun install)`
        );
      }

      continue;
    }

    if (license === null) {
      unreadable.push(`${pkg.name}@${pkg.version}: no license field`);
      continue;
    }

    byLicense[license] = (byLicense[license] ?? 0) + 1;

    if (expressionAllowed(license, allowed)) {
      continue;
    }

    const excepted = input.exceptions.find((exception) =>
      exceptionMatches(exception, pkg.name, license)
    );

    if (excepted) {
      used.add(excepted);
      continue;
    }

    violations.push(`${pkg.name}@${pkg.version}: ${license}`);
  }

  // A family exception may be satisfied only by packages that are not installed
  // here (a platform variant). Count that as use: the entry is meant to cover them.
  for (const exception of input.exceptions) {
    if (used.has(exception)) {
      continue;
    }

    const prefix = exception.packageName.endsWith("*")
      ? exception.packageName.slice(0, -1)
      : null;
    const coversUninstalled = components.some(
      (component) =>
        !component.installed &&
        (prefix === null
          ? component.name === exception.packageName
          : component.name.startsWith(prefix))
    );

    if (coversUninstalled) {
      used.add(exception);
    }
  }

  const staleExceptions = input.exceptions
    .filter((exception) => !used.has(exception))
    .map(
      (exception) =>
        `${exception.packageName} (${exception.license}) matches no package in the lock`
    );
  // A review date is a deadline, so it must be a real date and near enough to
  // be one: `"never"` sorts after every ISO date and would never expire, and a
  // year-9999 date is the same thing spelled as a number.
  const horizon = new Date(
    Date.parse(`${input.today}T00:00:00Z`) +
      MAX_EXCEPTION_HORIZON_DAYS * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const invalidExceptions = input.exceptions
    .filter(
      (exception) =>
        !ISO_DATE.test(exception.reviewDate) ||
        Number.isNaN(Date.parse(`${exception.reviewDate}T00:00:00Z`)) ||
        exception.reviewDate > horizon
    )
    .map(
      (exception) =>
        `${exception.packageName} (${exception.license}): review date "${exception.reviewDate}" is not a YYYY-MM-DD date within ${MAX_EXCEPTION_HORIZON_DAYS} days`
    );
  const expiredExceptions = input.exceptions
    .filter(
      (exception) =>
        ISO_DATE.test(exception.reviewDate) &&
        exception.reviewDate < input.today
    )
    .map(
      (exception) =>
        `${exception.packageName} (${exception.license}): review date ${exception.reviewDate} has passed`
    );

  const failures = [
    ...violations.map((line) => `license outside the allow-list: ${line}`),
    ...unreadable.map((line) => `license UNKNOWN: ${line}`),
    ...staleExceptions.map((line) => `stale license exception: ${line}`),
    ...invalidExceptions.map((line) => `invalid license exception: ${line}`),
    ...expiredExceptions.map((line) => `expired license exception: ${line}`)
  ];

  return {
    components,
    violations,
    unreadable,
    notInstalled,
    staleExceptions,
    invalidExceptions,
    expiredExceptions,
    byLicense,
    failures
  };
}

// ---------------------------------------------------------------------------
// CycloneDX
// ---------------------------------------------------------------------------

export function purlOf(name: string, version: string): string {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;

  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

function sha512Hex(integrity: string | null): string | null {
  if (!integrity?.startsWith("sha512-")) {
    return null;
  }

  return Buffer.from(integrity.slice("sha512-".length), "base64").toString(
    "hex"
  );
}

export function buildCycloneDx(input: {
  root: { name: string; version: string };
  rootDependencies: readonly string[];
  components: readonly Component[];
  generatedAt: string;
}): unknown {
  const keys = new Set(input.components.map((component) => component.key));
  const byKey = new Map(
    input.components.map((component) => [component.key, component])
  );
  const ref = (component: Component) =>
    `${purlOf(component.name, component.version)}#${component.key}`;
  const rootRef = `${purlOf(input.root.name, input.root.version)}#root`;

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      timestamp: input.generatedAt,
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: input.root.name,
        version: input.root.version
      }
    },
    components: input.components.map((component) => {
      const hash = sha512Hex(component.integrity);

      return {
        type: "library",
        "bom-ref": ref(component),
        name: component.name,
        version: component.version,
        purl: purlOf(component.name, component.version),
        ...(component.license
          ? {
              licenses: [
                /[()\s]/.test(component.license)
                  ? { expression: component.license }
                  : { license: { id: component.license } }
              ]
            }
          : {}),
        ...(hash ? { hashes: [{ alg: "SHA-512", content: hash }] } : {}),
        ...(component.platformSpecific || !component.license
          ? {
              properties: [
                ...(component.platformSpecific
                  ? [{ name: "awcms:platform-specific", value: "true" }]
                  : []),
                ...(!component.license
                  ? [{ name: "awcms:license-unverified", value: "true" }]
                  : [])
              ]
            }
          : {})
      };
    }),
    dependencies: [
      {
        ref: rootRef,
        dependsOn: input.rootDependencies
          .map((name) => resolveDependencyKey("", name, keys))
          .filter((key): key is string => key !== null)
          .map((key) => ref(byKey.get(key) as Component))
      },
      ...input.components.map((component) => ({
        ref: ref(component),
        dependsOn: component.dependencies
          .map((name) => resolveDependencyKey(component.key, name, keys))
          .filter((key): key is string => key !== null)
          .map((key) => ref(byKey.get(key) as Component))
      }))
    ]
  };
}

// ---------------------------------------------------------------------------
// Findings, rendering
// ---------------------------------------------------------------------------

export function licenseFindings(report: LicenseReport): FindingFile {
  const findings: Finding[] = [];

  for (const line of report.violations) {
    const name = line.slice(0, line.lastIndexOf("@", line.indexOf(":")));

    findings.push({
      key: `license:violation:${name}`,
      title: `License outside the allow-list: ${line}`,
      detail:
        `\`${line}\` is in the dependency tree and its license is not in ` +
        "`scripts/dependency-license-policy.ts` `ALLOWED_LICENSES`. Remove or replace the " +
        "package, or add a reasoned, expiring `LICENSE_EXCEPTIONS` entry in a reviewed PR."
    });
  }

  for (const line of report.unreadable) {
    const name = line.slice(0, line.lastIndexOf("@", line.indexOf(":")));

    findings.push({
      key: `license:unknown:${name}`,
      title: `License cannot be determined: ${line}`,
      detail:
        `\`${line}\`. An unreadable license is not a pass. Run \`bun install\` ` +
        "so the package is on disk, or record the license by an exception once a maintainer has read it."
    });
  }

  for (const line of report.staleExceptions) {
    findings.push({
      key: `license:stale-exception:${line.split(" ")[0]}`,
      title: `Stale license exception: ${line}`,
      detail: `${line}. Remove the entry from \`scripts/dependency-license-policy.ts\`.`
    });
  }

  for (const line of report.invalidExceptions) {
    findings.push({
      key: `license:invalid-exception:${line.split(" ")[0]}`,
      title: `Invalid license exception: ${line}`,
      detail: `${line}. Set a real review date in \`scripts/dependency-license-policy.ts\` in a reviewed PR.`
    });
  }

  for (const line of report.expiredExceptions) {
    findings.push({
      key: `license:expired-exception:${line.split(" ")[0]}`,
      title: `Expired license exception: ${line}`,
      detail: `${line}. Re-justify with a new date or remove it, in a reviewed PR.`
    });
  }

  return { source: "deps:license:check", findings };
}

export function renderLicenseSummary(report: LicenseReport): string {
  const rows = Object.entries(report.byLicense).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const lines = [
    "## Dependency licenses",
    "",
    `${report.components.length} packages in the lock; ${report.notInstalled.length} platform-specific package(s) not installed here (license unverified).`,
    "",
    "| License | Packages |",
    "| --- | --- |",
    ...rows.map(([license, count]) => `| ${license} | ${count} |`),
    ""
  ];

  if (report.failures.length === 0) {
    lines.push("No violations: every license is allow-listed or excepted.");
  } else {
    lines.push("**Failures**", "", ...report.failures.map((f) => `- ${f}`));
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

async function loadPolicy(file: string | undefined): Promise<{
  allowed: readonly string[];
  exceptions: readonly LicenseException[];
}> {
  if (!file) {
    return { allowed: ALLOWED_LICENSES, exceptions: LICENSE_EXCEPTIONS };
  }

  const module = (await import(pathToFileURL(path.resolve(file)).href)) as {
    ALLOWED_LICENSES?: readonly string[];
    LICENSE_EXCEPTIONS?: readonly LicenseException[];
  };

  if (!module.ALLOWED_LICENSES || !module.LICENSE_EXCEPTIONS) {
    throw new Error(
      `${file} must export ALLOWED_LICENSES and LICENSE_EXCEPTIONS`
    );
  }

  return {
    allowed: module.ALLOWED_LICENSES,
    exceptions: module.LICENSE_EXCEPTIONS
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = path.resolve(argValue(args, "--root") ?? process.cwd());
  const lockPath = path.join(root, "bun.lock");

  if (!existsSync(lockPath)) {
    process.stderr.write(`deps:license:check: no bun.lock in ${root}\n`);
    process.exitCode = 1;
    return;
  }

  const lockText = readFileSync(lockPath, "utf8");
  const packages = parseBunLock(lockText);
  const { allowed, exceptions } = await loadPolicy(argValue(args, "--policy"));
  const generatedAt = new Date().toISOString();

  const report = evaluateLicenses({
    packages,
    rootDependencies: parseRootDependencies(lockText),
    readPackageJson: (installPath) => {
      const file = path.join(root, installPath, "package.json");

      return existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as unknown)
        : undefined;
    },
    allowed,
    exceptions,
    today: generatedAt.slice(0, 10)
  });

  const rootPackage = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8")
  ) as { name?: string; version?: string };

  const outSbom = argValue(args, "--out-sbom");
  const outJson = argValue(args, "--out-json");
  const outMd = argValue(args, "--out-md");

  if (outSbom) {
    writeFileSync(
      outSbom,
      `${JSON.stringify(
        buildCycloneDx({
          root: {
            name: rootPackage.name ?? "workspace",
            version: rootPackage.version ?? "0.0.0"
          },
          rootDependencies: parseRootDependencies(lockText),
          components: report.components,
          generatedAt
        }),
        null,
        2
      )}\n`
    );
  }

  if (outJson) {
    writeFileSync(
      outJson,
      `${JSON.stringify(licenseFindings(report), null, 2)}\n`
    );
  }

  const summary = renderLicenseSummary(report);

  if (outMd) {
    writeFileSync(outMd, summary);
  }

  if (report.failures.length > 0) {
    process.stderr.write(summary);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `deps:license:check OK: ${report.components.length} packages, ${Object.keys(report.byLicense).length} distinct licenses, ${report.notInstalled.length} platform package(s) not installed here.\n`
    );
  }
}

if (import.meta.main) {
  await main();
}
