/**
 * permission-enforcement-check.ts — `bun run access:permissions:enforcement:check`.
 *
 * ADR-0057 §F. Every permission a module descriptor declares must have an
 * `authorizeInTransaction` guard somewhere in `src/`, or a recorded reason why
 * it does not. Pure: registry + source text, no database, no network.
 *
 * The gate exists because two modules shipped seeded-but-unchecked permissions
 * and both were caught by hand, months later, only when someone tried to build
 * their admin screen. For `blog_content` the consequence was that a page could
 * never be published at all. See `permission-enforcement-coverage.ts` for what
 * this can and cannot prove.
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
 */
const EXCEPTIONS: readonly EnforcementException[] = [
  {
    key: "blog_content.posts.export",
    reason:
      "Declared by the descriptor and seeded by sql/036, with no endpoint anywhere that enforces it — and no export machinery of any kind in the repo. ADR-0058 §D REVOKES it: building a surface to justify the catalogue row would be the tail wagging the dog. Removed when the revocation migration lands."
  },

  // ADR-0058 disposes of every entry left in this list, and the list is
  // therefore shrinking on a schedule rather than sitting still: two get a
  // surface, two are revoked. `profile_identity.profile_management.restore`
  // was the first to go — `POST /api/v1/profiles/{id}/restore` (§A). Each
  // remaining reason now names the section that decided it and the change that
  // will delete the entry, so an exception cannot quietly become permanent.
  //
  // The first run listed six, and two of them — `visitor_analytics.settings`
  // read and update — were the gate's own bug, not a gap: it read the repo's
  // constants as one flat namespace, `MODULE_KEY` is bound to four different
  // values across five files, and the guard in `analytics/settings.ts` became
  // invisible. Their written reasons asserted, of a route that exists, that no
  // route names a settings activity. Constants now resolve file-first
  // (`resolveConstantsForSource`), and the two entries are gone — the gate's
  // stale-exception rule would now reject them anyway.
  {
    key: "blog_content.seo.configure",
    reason:
      'No route and no application function names activityCode "seo" anywhere — the only occurrence in the repo is the descriptor declaration itself. ADR-0058 §C REVOKES it: blog SEO defaults (seoDefaultTitle/seoDefaultDescription) are already managed through PATCH /api/v1/blog/settings under blog_content.settings.configure, so this row is a second authorisation axis over columns that already have one. Removed when the revocation migration lands.'
  },
  {
    key: "comments.moderation.delete",
    reason:
      "The moderation surface enforces approve/reject (one conditional guard), archive and restore, plus a public delete-request flow — but nothing gates a moderator delete. ADR-0058 §B gives it a surface: the transition is already legal from all four non-terminal statuses and the admin queue can already filter `deleted`, while the only actor who can produce that state today is the comment's own author. Removed when that endpoint lands."
  }
];

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
    EXCEPTIONS
  );

  if (result.valid) {
    console.log(
      `access:permissions:enforcement:check OK — ${result.enforcedCount}/${result.declaredCount} declared permission(s) have an authorizeInTransaction guard; ${EXCEPTIONS.length} recorded exception(s).`
    );
    return;
  }

  console.error("access:permissions:enforcement:check FAILED —");

  for (const permission of result.unenforced) {
    console.error(
      `  ${permission.key} — declared by module "${permission.moduleKey}" and enforced by nothing. Add an authorizeInTransaction guard, or record the reason in EXCEPTIONS in this script (with the ADR that decided it).`
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
