/**
 * access-chokepoint-check.ts — `bun run access:chokepoint:check`.
 *
 * Every handler that decides a tenant permission must decide it at the
 * chokepoint. Pure: no database, no network.
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
  const fileWideChokepoint = /defineTenantRoute\(/.test(source);

  const marks = [
    ...source.matchAll(/^export const (GET|POST|PATCH|PUT|DELETE)\b/gm)
  ].map((match) => ({ method: match[1]!, index: match.index! }));

  return marks.map((mark, position) => {
    const end =
      position + 1 < marks.length ? marks[position + 1]!.index : source.length;
    const body = source.slice(mark.index, end);

    return {
      id: `${relativeFile}#${mark.method}`,
      decidesPermissions: /fetchGrantedPermissionKeys\(/.test(body),
      usesChokepoint:
        fileWideChokepoint || /authorizeInTransaction\(/.test(body)
    };
  });
}

/** The rule, over already-classified handlers. */
export function findChokepointBypasses(
  handlers: readonly HandlerSlice[],
  exemptions: Readonly<Record<string, string>> = CHOKEPOINT_EXEMPTIONS
): ChokepointProblem[] {
  return handlers
    .filter(
      (handler) =>
        handler.decidesPermissions &&
        !handler.usesChokepoint &&
        !(handler.id in exemptions)
    )
    .map((handler) => ({
      handler: handler.id,
      message:
        "decides a permission (`fetchGrantedPermissionKeys`) without going through " +
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
  const handlers = await collectHandlers();
  const problems = [
    ...findChokepointBypasses(handlers),
    ...findStaleExemptions(handlers)
  ];

  if (problems.length > 0) {
    console.error("access:chokepoint:check FAILED");

    for (const problem of problems) {
      console.error(`  - ${problem.handler} ${problem.message}`);
    }

    process.exitCode = 1;
    return;
  }

  const deciding = handlers.filter((handler) => handler.decidesPermissions);

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

  console.log(
    `access:chokepoint:check OK — ${handlers.length} handlers, ` +
      `${deciding.length} decide permissions, ` +
      `${Object.keys(CHOKEPOINT_EXEMPTIONS).length} reasoned exemption(s).`
  );
}

if (import.meta.main) {
  await main();
}
