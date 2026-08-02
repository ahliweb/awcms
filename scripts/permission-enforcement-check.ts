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
      "Declared by the descriptor and seeded by sql/036, with no endpoint anywhere that enforces it — recorded in /admin/blog's header and in ADR-0057 §F as a revocation candidate awaiting its own ADR. Building a surface to justify the catalogue row would be the tail wagging the dog."
  },

  // The five below were found by this gate on its first run, and every one was
  // verified against the code before being written down. They are NOT excused
  // because they are acceptable — they are the same defect ADR-0057 documents
  // for `pages`, in five more places, and each needs the decision ADR-0057 §A
  // made: give it a surface, or revoke it.
  //
  // They are recorded rather than fixed here because closing five unrelated
  // holes inside a change about blog pages produces something nobody can
  // review as either. `docs/PROJECT_STATE.md` §4 carries them as backlog. What
  // this list buys today is that they are visible, counted, and that a SIXTH
  // one turns CI red instead of waiting for the next manual audit.
  {
    key: "blog_content.seo.configure",
    reason:
      'No route and no application function names activityCode "seo" anywhere — the only occurrence in the repo is the descriptor declaration itself. Blog SEO defaults are in fact configured through blog settings (blog_content.settings.configure), so this is most likely a revocation, not a missing endpoint. Needs its own ADR.'
  },
  {
    key: "comments.moderation.delete",
    reason:
      "The moderation surface enforces approve/reject (one conditional guard), archive and restore, plus a public delete-request flow — but nothing gates a moderator delete. ADR-0041's moderation model is archive-not-delete, so this is a revocation candidate rather than a missing route. Needs its own ADR."
  },
  {
    key: "profile_identity.profile_management.restore",
    reason:
      "profile_identity has no restore route at all; the five profile routes gate read/create/update/merge. Soft-deleted profiles therefore cannot be recovered through the API, which is a real hole rather than a spare permission — the same shape ADR-0056 §B closed for media objects. Needs its own ADR."
  },
  {
    key: "visitor_analytics.settings.read",
    reason:
      "Every analytics route gates on the dashboard/sessions/retention activities; no route names a settings activity. Per-tenant analytics settings have no surface at all. Needs its own ADR, together with the update below."
  },
  {
    key: "visitor_analytics.settings.update",
    reason:
      "Pair of the read above — declared and seeded, with no endpoint that enforces it."
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
