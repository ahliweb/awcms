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
import { stripComments } from "./lib/source-text";

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
 * #450. **EMPTY, and that is the finished state.**
 *
 * It was seeded with the 31 screens unmigrated when the second root landed (32
 * minus `form-drafts.astro`, migrated in the same PR so the mechanism was
 * proven rather than merely provided) and drained to zero over eight PRs. All
 * 32 screens now decide at `authorizeInTransaction`.
 *
 * **Do not add a line here.** While the list had entries, "may only shrink" was
 * enforced by `findStaleLedgerEntries`: an entry whose screen no longer
 * bypassed was a finding. At zero that alarm has nothing to fire on, so
 * `tests/access-chokepoint.test.ts` asserts the emptiness directly instead. A
 * new entry means a new screen decides access outside the chokepoint — silently
 * losing ABAC policy evaluation, module availability, business-scope facts, SoD
 * and the decision log — which is the entire defect this drained.
 *
 * Unlike `CHOKEPOINT_EXEMPTIONS` these carried no per-entry reason, and the
 * difference was deliberate: an exemption is a decision that this handler is
 * RIGHT to bypass, while these were debt that was WRONG and scheduled. Giving
 * each a sentence would have dressed 31 open defects as 31 decisions.
 */
export const ADMIN_SCREEN_CHOKEPOINT_MIGRATION: readonly string[] = [];

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
    // `loadSelfServiceScreen` counts too, and the reason it is SAFE to count is
    // not that it authorizes — it does not — but that it is the only other way
    // to open a screen's transaction, and it cannot be reached by accident: it
    // demands a written `selfServiceReason`, and
    // `tests/admin-screen-self-service.test.ts` enumerates the screens allowed
    // to call it at all (ADR-0096 §1).
    //
    // Without it, a screen whose subject IS the caller — with no entry
    // permission that could honestly be evaluated — would have to invent one,
    // which is the ADR-0058 §E latent-authz trap: an action nothing seeds denies
    // everyone including the tenant owner, while the call site reads as guarded.
    usesChokepoint:
      /loadAdminScreen\(/.test(code) ||
      /loadSelfServiceScreen\(/.test(code) ||
      /authorizeInTransaction\(/.test(code)
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
    .filter((handler) => {
      if (!handler.decidesPermissions) return false;
      if (handler.id in exemptions || scheduled.has(handler.id)) return false;

      // Routes keep the FILE-WIDE allowance: `defineTenantRoute` wraps at module
      // level and calls the chokepoint itself, so its presence covers every
      // handler in the file.
      //
      // Screens no longer do, and the change is the point of this line. While
      // the migration ledger had entries the allowance was correct — a
      // half-migrated screen must not be reported twice — but it also meant a
      // screen could call `loadAdminScreen` for its entry and still decide an
      // AFFORDANCE from `ssr.permissions.has(...)`, with the gate green.
      //
      // That was found by mutation, not by reading: planting exactly that
      // hybrid into `users.astro` left the gate at exit 0 while its own summary
      // line said "1 still decide outside the chokepoint". With the ledger now
      // empty and no screen reading the grant set at all, the allowance has
      // nothing left to protect and only leaves a way back in one button at a
      // time.
      return !(handler.usesChokepoint && !handler.id.endsWith(".astro"));
    })
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

  // The screen-root self-test, and it had to change shape when R3 closed.
  //
  // It used to be "zero deciding screens while the ledger is non-empty means
  // the detector broke" — which is exactly the check that goes inert the moment
  // the last screen is migrated, because from then on zero deciding screens is
  // the CORRECT answer and an identically zero answer from a broken detector is
  // indistinguishable from it.
  //
  // So the probe is now synthetic: `sliceScreen` is asked about a screen that
  // definitely bypasses, and about one that definitely does not. Both answers
  // have to be right, at any ledger size.
  const legacyProbe = sliceScreen(
    "__probe__.astro",
    "---\nconst canRead = ssr.permissions.has(permissionKey('m', 'a', 'read'));\n---"
  );
  const routedProbe = sliceScreen(
    "__probe__.astro",
    "---\nconst screen = await loadAdminScreen({ ssr });\n---"
  );

  if (
    !legacyProbe.decidesPermissions ||
    legacyProbe.usesChokepoint ||
    routedProbe.decidesPermissions ||
    !routedProbe.usesChokepoint
  ) {
    console.error(
      "access:chokepoint:check FAILED — `sliceScreen` misread its own probes " +
        `(legacy: decides=${legacyProbe.decidesPermissions} chokepoint=${legacyProbe.usesChokepoint}; ` +
        `routed: decides=${routedProbe.decidesPermissions} chokepoint=${routedProbe.usesChokepoint}). ` +
        `The signals stopped matching under ${SCREENS_ROOT}, so every screen would ` +
        "pass vacuously. Fix `sliceScreen`."
    );

    process.exitCode = 1;
    return;
  }

  // And the corpus itself: every screen must be ROUTED, not merely silent. A
  // screen that reads no permissions at all and opens no chokepoint would slip
  // through the bypass filter above without being covered by anything.
  const unrouted = screens.filter((screen) => !screen.usesChokepoint);

  if (unrouted.length > 0) {
    console.error(
      "access:chokepoint:check FAILED — admin screens that do not call " +
        "`loadAdminScreen` at all:"
    );

    for (const screen of unrouted) console.error(`  - ${screen.id}`);

    process.exitCode = 1;
    return;
  }

  console.log(
    `access:chokepoint:check OK — ${routes.length} route handlers, ` +
      `${deciding.length} decide permissions, ` +
      `${Object.keys(CHOKEPOINT_EXEMPTIONS).length} reasoned exemption(s); ` +
      `${screens.length} admin screens, all routed through loadAdminScreen ` +
      `(R3 closed; ledger: ${ADMIN_SCREEN_CHOKEPOINT_MIGRATION.length}).`
  );
}

if (import.meta.main) {
  await main();
}

/**
 * Re-exported for the callers that already import it from here — finding D2
 * moved the implementation to `scripts/lib/source-text.ts` and left the name
 * reachable rather than editing 21 import lines in the same change.
 */
export { stripComments };
