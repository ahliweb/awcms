/**
 * access-chokepoint-check.ts — `bun run access:chokepoint:check`.
 *
 * Every handler that decides a tenant permission must decide it at the
 * chokepoint — across TWO roots since #450: `src/pages/api/v1` (route modules)
 * and `src/pages/admin` (SSR screens). Pure: no database, no network.
 *
 * One script, not two, and that is the load-bearing choice: two scripts means
 * two exemption lists that drift, and the second one always ends up the lenient
 * one. The roots differ in exactly two places — how a file is sliced, and what
 * counts as deciding — and both are written down at `sliceHandlers` and
 * `sliceScreen` respectively.
 *
 * ## The defect this exists for
 *
 * `authorizeInTransaction` is the only place ABAC policy evaluation, the
 * ADR-0053 platform-scope gate, ADR-0060 business-scope facts and #181 SoD are
 * applied. A handler that assembles its own decision from
 * `fetchGrantedPermissionKeys` plus a domain rule gets RBAC and **silently
 * loses all four** — no error, no failing test, no red gate. The visible symptom
 * is the worst kind: a tenant writes an ABAC `deny`, and it is honoured on some
 * routes and ignored on others.
 *
 * Three handlers were in that state when this gate was written
 * (`PATCH /blog/posts/{id}`, `POST /blog/posts/{id}/submit-review`,
 * `PATCH /blog/pages/{id}`), and they were not sloppy — they implemented an
 * ownership rule the chokepoint could not express until ADR-0063 added
 * `ownershipGrant`. The gate exists so the next such rule is a design
 * conversation instead of a quiet second authorization path.
 *
 * ## Why per-HANDLER and not per-FILE
 *
 * This is the load-bearing decision in the file, and it is the exact mistake the
 * assessment that prompted the gate made. `src/pages/api/v1/blog/posts/[id].ts`
 * calls `authorizeInTransaction` twice — in `GET` and in `DELETE` — while
 * `PATCH`, in the same file, did not. Any file-level check reads that file as
 * compliant. A reviewer reading it top to bottom reads it as compliant too.
 *
 * So handlers are split on `export const <METHOD>` boundaries and judged
 * individually. `defineTenantRoute` is the exception: it wraps at module level
 * and calls the chokepoint itself, so its presence covers every handler in that
 * file.
 *
 * ## What counts as deciding a permission
 *
 * A call to `fetchGrantedPermissionKeys`. That is the narrow, decidable signal:
 * a handler asking what the subject is granted is a handler making an
 * authorization decision. Reading intent from prose is not attempted anywhere
 * here — the same discipline `skills:check` and the permission-coverage gate
 * follow.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROUTES_ROOT = "src/pages/api/v1";
const SCREENS_ROOT = "src/pages/admin";

/**
 * Handlers allowed to decide access without the chokepoint, with the reason.
 *
 * Keyed `<file>#<METHOD>` so an exemption can never widen to a sibling handler
 * in the same file — which is precisely how the original defect hid.
 */
const CHOKEPOINT_EXEMPTIONS: Readonly<Record<string, string>> = {
  "auth/login.ts#POST":
    "pre-authentication: there is no authenticated subject to authorize yet, so the chokepoint has nothing to decide about. It resolves permissions only to build the session response.",
  "access/evaluate.ts#POST":
    "self-introspection: reflects what `evaluateAccess` would decide for the CALLER'S OWN request and calls that same evaluator directly, so ABAC is applied rather than skipped. It requires a session but deliberately no specific permission."
};

/**
 * Admin screens that still decide from `ssr.permissions.has(...)` — R3, issue
 * #450. **May only shrink.**
 *
 * Seeded with the 31 screens that were unmigrated when the second root landed
 * (32 minus `form-drafts.astro`, migrated in the same PR so the mechanism is
 * proven rather than merely provided). An entry whose screen no longer
 * bypasses is an error, not a tolerated leftover, so the list cannot rot into
 * an off-switch.
 *
 * Unlike `CHOKEPOINT_EXEMPTIONS` these carry no per-entry reason, and the
 * difference is deliberate: an exemption is a decision that this handler is
 * RIGHT to bypass, while these are debt that is WRONG and scheduled. Giving
 * each a sentence would dress 31 open defects as 31 decisions.
 */
export const ADMIN_SCREEN_CHOKEPOINT_MIGRATION: readonly string[] = [
  "approvals.astro",
  "blog-presentation.astro",
  "data-lifecycle.astro",
  "domain-events.astro",
  "reporting.astro",
  "security.astro",
  "seo.astro",
  "site-search.astro",
  "sync.astro"
];

/**
 * Drops block comments and whole-line `//` comments before matching.
 *
 * Not hygiene — a correctness fix caught on this gate's first run against the
 * screen root. `form-drafts.astro` was migrated and then explained itself with
 * "the decision is the chokepoint's, not `ssr.permissions.has()`", so the
 * signal matched the sentence saying the code no longer does it. This repo has
 * hit the same shape three times (`table-write-ownership-check` reporting
 * itself, and PR #404's mutation probe matching its own comment), and it is
 * always the FIX that plants the false positive, because a fix explains what it
 * removed.
 *
 * Trailing `// ...` after code is left alone on purpose: stripping it would
 * truncate any line containing `https://`, trading a false positive for a false
 * negative.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join("\n");
}

export type ChokepointProblem = { handler: string; message: string };

export type HandlerSlice = {
  /** `<file>#<METHOD>`, relative to `src/pages/api/v1`. */
  id: string;
  decidesPermissions: boolean;
  usesChokepoint: boolean;
};

/** Split a route module into its exported HTTP handlers and classify each. */
export function sliceHandlers(
  relativeFile: string,
  source: string
): HandlerSlice[] {
  // `defineTenantRoute` wraps at module scope and calls the chokepoint itself,
  // so it covers every handler the file exports.
  const code = stripComments(source);
  const fileWideChokepoint = /defineTenantRoute\(/.test(code);

  const marks = [
    ...code.matchAll(/^export const (GET|POST|PATCH|PUT|DELETE)\b/gm)
  ].map((match) => ({ method: match[1]!, index: match.index! }));

  return marks.map((mark, position) => {
    const end =
      position + 1 < marks.length ? marks[position + 1]!.index : code.length;
    const body = code.slice(mark.index, end);

    return {
      id: `${relativeFile}#${mark.method}`,
      decidesPermissions: /fetchGrantedPermissionKeys\(/.test(body),
      usesChokepoint:
        fileWideChokepoint || /authorizeInTransaction\(/.test(body)
    };
  });
}

/**
 * An admin screen, classified — one slice per FILE, and that is not a shortcut.
 *
 * A route module exports several handlers that are separately reachable, which
 * is why routes are split on `export const <METHOD>` (ADR-0063 §3, and the
 * defect that prompted it: one file where `GET` and `DELETE` used the
 * chokepoint and `PATCH` did not). An `.astro` page has ONE render path — the
 * frontmatter runs top to bottom for every request — so the file IS the unit.
 * Slicing it further would invent boundaries the runtime does not have.
 *
 * The signal differs from the routes' for the same reason the defect differs.
 * A route decides by calling `fetchGrantedPermissionKeys`; a screen decides by
 * reading the set that call already produced, handed to it as
 * `Astro.locals.ssrContext`. So `.permissions.has(` is the screen-side
 * equivalent, and it is just as narrow: it is the act of consulting raw RBAC,
 * not an attempt to read intent from prose.
 */
export function sliceScreen(
  relativeFile: string,
  source: string
): HandlerSlice {
  const code = stripComments(source);

  return {
    // No prefix: a route id always contains `#<METHOD>` and a screen id always
    // ends `.astro`, so the two namespaces cannot collide and the ledger below
    // needs no second spelling of the same path.
    id: relativeFile,
    decidesPermissions: /\.permissions\.has\(/.test(code),
    // `loadAdminScreen` opens the transaction and calls the chokepoint itself,
    // so its presence covers the file — the same reasoning `defineTenantRoute`
    // gets above. A screen that calls `authorizeInTransaction` by hand is
    // covered too; it did the work, just without the helper.
    usesChokepoint:
      /loadAdminScreen\(/.test(code) || /authorizeInTransaction\(/.test(code)
  };
}

/** The rule, over already-classified handlers. */
export function findChokepointBypasses(
  handlers: readonly HandlerSlice[],
  exemptions: Readonly<Record<string, string>> = CHOKEPOINT_EXEMPTIONS,
  ledger: readonly string[] = ADMIN_SCREEN_CHOKEPOINT_MIGRATION
): ChokepointProblem[] {
  const scheduled = new Set(ledger);

  return handlers
    .filter(
      (handler) =>
        handler.decidesPermissions &&
        !handler.usesChokepoint &&
        !(handler.id in exemptions) &&
        !scheduled.has(handler.id)
    )
    .map((handler) => ({
      handler: handler.id,
      // The two roots lose the same four things, but a reader fixing one is not
      // reading about the other: naming a route mechanism in a screen finding
      // sends them looking for an `export const GET` that is not there.
      message: handler.id.endsWith(".astro")
        ? "decides a permission from `ssr.permissions.has(...)` — raw RBAC — so ABAC " +
          "policy, module availability, business-scope facts, SoD and the decision log " +
          "are all skipped for it (R3, #450). Route it through `loadAdminScreen`, which " +
          "decides and reads in one transaction."
        : "decides a permission (`fetchGrantedPermissionKeys`) without going through " +
          "`authorizeInTransaction`/`defineTenantRoute`, so ABAC policy, the platform-scope " +
          "gate, business-scope facts and SoD are all skipped for it. If the access rule is " +
          "an ownership axis the catalogue cannot express, pass it as `ownershipGrant` " +
          "(ADR-0063) instead of deciding outside the chokepoint."
    }));
}

/** An exemption whose handler no longer bypasses is a stale claim — report it. */
export function findStaleExemptions(
  handlers: readonly HandlerSlice[],
  exemptions: Readonly<Record<string, string>> = CHOKEPOINT_EXEMPTIONS
): ChokepointProblem[] {
  const byId = new Map(handlers.map((handler) => [handler.id, handler]));

  return Object.keys(exemptions).flatMap((id) => {
    const handler = byId.get(id);

    if (!handler) {
      return [
        {
          handler: id,
          message:
            "is exempted but no longer exists as a handler — remove the entry."
        }
      ];
    }

    if (!handler.decidesPermissions || handler.usesChokepoint) {
      return [
        {
          handler: id,
          message:
            "is exempted but no longer bypasses the chokepoint — remove the entry so the list keeps meaning something."
        }
      ];
    }

    return [];
  });
}

/**
 * A ledger entry that no longer bypasses — or no longer exists — is reported,
 * so the list can only ever shrink.
 *
 * This is the half that stops a one-way list becoming a one-way ratchet in the
 * wrong direction: without it, a screen could be migrated and its line left
 * behind, and the next screen to regress would land on a line that already
 * excused it.
 */
export function findStaleLedgerEntries(
  handlers: readonly HandlerSlice[],
  ledger: readonly string[] = ADMIN_SCREEN_CHOKEPOINT_MIGRATION
): ChokepointProblem[] {
  const byId = new Map(handlers.map((handler) => [handler.id, handler]));

  return ledger.flatMap((id) => {
    const handler = byId.get(id);

    if (!handler) {
      return [
        {
          handler: id,
          message:
            "is on ADMIN_SCREEN_CHOKEPOINT_MIGRATION but no longer exists — remove the line."
        }
      ];
    }

    if (!handler.decidesPermissions || handler.usesChokepoint) {
      return [
        {
          handler: id,
          message:
            "is on ADMIN_SCREEN_CHOKEPOINT_MIGRATION but no longer bypasses the chokepoint. Delete the line in the same PR: the ledger only ever shrinks, and that is the only thing that makes its length mean something."
        }
      ];
    }

    return [];
  });
}

async function collectScreens(): Promise<HandlerSlice[]> {
  const screens: HandlerSlice[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!entry.name.endsWith(".astro")) continue;

      screens.push(
        sliceScreen(
          path.relative(SCREENS_ROOT, full),
          await readFile(full, "utf8")
        )
      );
    }
  }

  await walk(SCREENS_ROOT);

  return screens;
}

async function collectHandlers(): Promise<HandlerSlice[]> {
  const handlers: HandlerSlice[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!entry.name.endsWith(".ts")) {
        continue;
      }

      handlers.push(
        ...sliceHandlers(
          path.relative(ROUTES_ROOT, full),
          await readFile(full, "utf8")
        )
      );
    }
  }

  await walk(ROUTES_ROOT);

  return handlers;
}

async function main(): Promise<void> {
  const routes = await collectHandlers();
  const screens = await collectScreens();
  const handlers = [...routes, ...screens];
  const problems = [
    ...findChokepointBypasses(handlers),
    ...findStaleExemptions(routes),
    ...findStaleLedgerEntries(screens)
  ];

  if (problems.length > 0) {
    console.error("access:chokepoint:check FAILED");

    for (const problem of problems) {
      console.error(`  - ${problem.handler} ${problem.message}`);
    }

    process.exitCode = 1;
    return;
  }

  const deciding = routes.filter((handler) => handler.decidesPermissions);
  const decidingScreens = screens.filter((screen) => screen.decidesPermissions);

  // Issue #425 — the self-test.
  //
  // Every classification above keys on the literal `fetchGrantedPermissionKeys(`
  // (`sliceHandlers`). That name is about to change shape: the grant redesign
  // (#423) alters its RETURN TYPE, which is exactly the moment someone is
  // tempted to rename it. A rename makes every `decidesPermissions` false, so
  // `findChokepointBypasses` returns nothing, and this gate prints a cheerful
  // OK while checking nothing at all — the class of failure PROJECT_STATE §4 R9
  // records for five other gates.
  //
  // A gate that has only ever been observed passing has not been observed at
  // all. There are handlers that genuinely decide permissions; if we can no
  // longer find any, the detector is broken, not the tree.
  if (deciding.length === 0) {
    console.error(
      "access:chokepoint:check FAILED — 0 handlers were classified as deciding a " +
        "permission. That is not a clean tree, it is a blind detector: the signal " +
        "`fetchGrantedPermissionKeys(` no longer matches anything under " +
        `${ROUTES_ROOT}. If that function was renamed, update the signal in ` +
        "`sliceHandlers` in the same commit."
    );

    process.exitCode = 1;
    return;
  }

  // The same self-test for the screen root, and it is not symmetry for its own
  // sake: `.permissions.has(` is a shape, not an identifier, so it cannot be
  // caught by a rename — it disappears when the LAST screen is migrated, and at
  // that moment the ledger is empty too. Until then, zero deciding screens with
  // a non-empty ledger means the detector broke.
  if (
    decidingScreens.length === 0 &&
    ADMIN_SCREEN_CHOKEPOINT_MIGRATION.length > 0
  ) {
    console.error(
      "access:chokepoint:check FAILED — 0 admin screens were classified as deciding a " +
        `permission while ${ADMIN_SCREEN_CHOKEPOINT_MIGRATION.length} are still on the ` +
        "migration ledger. The signal `.permissions.has(` stopped matching under " +
        `${SCREENS_ROOT}; fix \`sliceScreen\` rather than the ledger.`
    );

    process.exitCode = 1;
    return;
  }

  console.log(
    `access:chokepoint:check OK — ${routes.length} route handlers, ` +
      `${deciding.length} decide permissions, ` +
      `${Object.keys(CHOKEPOINT_EXEMPTIONS).length} reasoned exemption(s); ` +
      `${screens.length} admin screens, ${decidingScreens.length} still decide ` +
      `outside the chokepoint (ledger: ${ADMIN_SCREEN_CHOKEPOINT_MIGRATION.length}, may only shrink).`
  );
}

if (import.meta.main) {
  await main();
}
