/**
 * dependency-held-back-check.ts — `bun run deps:held-back:check` (Issue #1367).
 *
 * OFFLINE gate (part of `bun run check`; no network, unlike the weekly
 * `deps:freshness` report) that keeps `package.json` `overrides` and the
 * held-back register (`dependency-held-back.ts`) saying the same thing about
 * transitive packages:
 *
 * 1. Every `overrides` entry that pins an EXACT version (`0.5.2`) must have a
 *    register entry with `transitive: true` and the same `heldVersion`. An exact
 *    pin is a deliberate hold; without an entry it has no reason, owner or
 *    release condition and nobody notices when it stops being needed. Range
 *    overrides (`^8.5.23`, `>=`) are security floors and are NOT holds.
 * 2. Every `transitive` register entry must have a matching exact `overrides`
 *    pin AND `bun.lock` must resolve that package to the held version —
 *    otherwise the register claims a hold the install does not honour.
 * 3. A transitive entry must record a `releaseCondition`.
 *
 * Whether a NEWER release exists is the online report's job
 * (`deps:freshness`), not this gate's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { HELD_BACK, type HeldBackEntry } from "./dependency-held-back";

const EXACT_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isExactVersion(spec: string): boolean {
  return EXACT_VERSION.test(spec);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The version `bun.lock` resolves a package to at the top level of its
 * `packages` map (4-space-indented key), or `null` when it is absent.
 */
export function resolvedVersionFromLock(
  lockText: string,
  packageName: string
): string | null {
  const name = escapeRegExp(packageName);
  const pattern = new RegExp(`^ {4}"${name}": \\["${name}@([^"]+)"`, "m");

  return pattern.exec(lockText)?.[1] ?? null;
}

export function checkTransitiveHolds(input: {
  entries: readonly HeldBackEntry[];
  overrides: Record<string, string>;
  lockText: string;
}): string[] {
  const problems: string[] = [];
  const transitive = input.entries.filter((entry) => entry.transitive);

  for (const [name, spec] of Object.entries(input.overrides)) {
    if (!isExactVersion(spec)) {
      continue;
    }

    const entry = transitive.find(
      (candidate) => candidate.packageName === name
    );

    if (!entry) {
      problems.push(
        `overrides pins ${name} to exactly ${spec} but scripts/dependency-held-back.ts has no \`transitive: true\` entry for it — register the hold (reason, release condition, owner, review date), or use a range if it is only a security floor`
      );
    } else if (entry.heldVersion !== spec) {
      problems.push(
        `${name}: overrides pins ${spec} but the register holds ${entry.heldVersion} — they must be the same version`
      );
    }
  }

  for (const entry of transitive) {
    const name = entry.packageName;
    const spec = input.overrides[name];

    if (spec === undefined) {
      problems.push(
        `${name}: the register has a transitive hold but package.json \`overrides\` has no entry for it — the hold is not enforced; add the pin or remove the entry`
      );
    } else if (spec !== entry.heldVersion) {
      problems.push(
        `${name}: the register holds ${entry.heldVersion} but overrides says ${spec}`
      );
    }

    const resolved = resolvedVersionFromLock(input.lockText, name);

    if (resolved === null) {
      problems.push(
        `${name}: not found in bun.lock — run \`bun install\`, or remove the stale register entry`
      );
    } else if (resolved !== entry.heldVersion) {
      problems.push(
        `${name}: bun.lock resolves ${resolved} but the register holds ${entry.heldVersion} — run \`bun install\` so the lockfile honours the pin`
      );
    }

    if (!entry.releaseCondition || entry.releaseCondition.trim().length < 20) {
      problems.push(
        `${name}: a transitive hold must record a \`releaseCondition\` (what must be true to lift the pin)`
      );
    }
  }

  return problems;
}

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8")
  ) as { overrides?: Record<string, string> };
  const lockText = readFileSync(path.join(root, "bun.lock"), "utf8");
  const problems = checkTransitiveHolds({
    entries: HELD_BACK,
    overrides: pkg.overrides ?? {},
    lockText
  });

  if (problems.length > 0) {
    console.error("deps:held-back:check FAILED");

    for (const problem of problems) {
      console.error(`- ${problem}`);
    }

    process.exit(1);
  }

  console.log(
    `deps:held-back:check OK (${HELD_BACK.filter((e) => e.transitive).length} transitive hold(s) match overrides and bun.lock)`
  );
}

if (import.meta.main) {
  main();
}
