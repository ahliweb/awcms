/**
 * permission-enforcement-check.ts — `bun run access:permissions:enforcement:check`.
 *
 * ADR-0057 §F. The descriptors and the code must name the same permissions, in
 * both directions:
 *
 * - every permission a module descriptor DECLARES has an
 *   `authorizeInTransaction` guard somewhere in `src/`, or a recorded reason;
 * - every guard `src/` builds NAMES a permission some descriptor declares, or a
 *   recorded reason.
 *
 * Pure: registry + source text, no database, no network.
 *
 * The gate exists because two modules shipped seeded-but-unchecked permissions
 * and both were caught by hand, months later, only when someone tried to build
 * their admin screen. For `blog_content` the consequence was that a page could
 * never be published at all.
 *
 * The second direction was added later and catches the worse failure: a key no
 * descriptor declares has no catalogue row, no role can hold it, and the
 * endpoint denies everyone forever while looking exactly like a legitimate 403.
 * See `permission-enforcement-coverage.ts` for what this can and cannot prove.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { listModules } from "../src/modules";
import {
  evaluateEnforcementCoverage,
  type EnforcementException
} from "../src/modules/_shared/permission-enforcement-coverage";

/**
 * Permissions with no enforcer, each with the reason it stays that way.
 *
 * This list is a set of DECISIONS, not a backlog. A permission that ought to
 * be enforced belongs in code, not here — and the gate reports an entry whose
 * permission has since gained an enforcer as stale, so an exception cannot
 * outlive its reason unnoticed.
 *
 * ## It is empty, and that is the point
 *
 * The gate's first run reported six entries. ADR-0058 disposed of all of them
 * and none was excused:
 *
 * - `profile_identity.profile_management.restore` — SURFACE (§A,
 *   `POST /api/v1/profiles/{id}/restore`);
 * - `comments.moderation.delete` — SURFACE (§B,
 *   `POST /api/v1/comments/admin/{id}/delete`);
 * - `blog_content.seo.configure` — REVOKED (§C, `sql/089`);
 * - `blog_content.posts.export` — REVOKED (§D, `sql/089`);
 * - `visitor_analytics.settings.read` and `.update` — NOT GAPS AT ALL. Both are
 *   fully gated by `src/pages/api/v1/analytics/settings.ts`; this gate resolved
 *   the repo's constants as one flat namespace, `MODULE_KEY` is bound in five
 *   files to four different values, and the guard became invisible. Both were
 *   nonetheless written up here as reasoned decisions, asserting of a route that
 *   exists that no route named a settings activity. Fixed in PR #359 by
 *   resolving constants file-first (`resolveConstantsForSource`).
 *
 * An empty list is worth more than a short one: the NEXT exception anyone adds
 * is the only entry in it and cannot pass unnoticed in the middle of a list
 * that already looks settled. Adding one means naming the ADR that decided it.
 */
const EXCEPTIONS: readonly EnforcementException[] = [];

const SOURCE_ROOT = "src";
const SOURCE_EXTENSIONS = [".ts", ".astro"];

function collectSourceFiles(directory: string, into: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, into);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      into.push(path);
    }
  }
}

function main(): void {
  const files: string[] = [];
  collectSourceFiles(SOURCE_ROOT, files);

  const sources = files.map((file) => readFileSync(file, "utf8"));
  const result = evaluateEnforcementCoverage(
    listModules(),
    sources,
    EXCEPTIONS,
    files
  );

  if (result.valid) {
    console.log(
      `access:permissions:enforcement:check OK — ${result.enforcedCount}/${result.declaredCount} declared permission(s) have an authorizeInTransaction guard, and every guard names a declared permission; ${EXCEPTIONS.length} recorded exception(s).`
    );
    return;
  }

  console.error("access:permissions:enforcement:check FAILED —");

  for (const permission of result.unenforced) {
    console.error(
      `  ${permission.key} — declared by module "${permission.moduleKey}" and enforced by nothing. Add an authorizeInTransaction guard, or record the reason in EXCEPTIONS in this script (with the ADR that decided it).`
    );
  }

  for (const guard of result.undeclaredGuards) {
    console.error(
      `  ${guard.key} — guarded by ${guard.sources.join(", ") || "a scanned source"} and declared by no module. No catalogue row backs this key, so no role can hold it and authorizeInTransaction denies EVERY actor, including the tenant owner, in every deployment. Fix the spelling, declare it in the module descriptor with a seed migration, or record the reason in EXCEPTIONS in this script.`
    );
  }

  for (const key of result.staleExceptions) {
    console.error(
      `  ${key} — stale exception: the permission is no longer declared, or it now HAS an enforcer. Remove the entry from EXCEPTIONS.`
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
