/**
 * `/admin/form-drafts` gates against the endpoints it drives.
 *
 * The failure this pins is silent and looks correct in review: a page that
 * gates on a permission key NO migration seeds hides its controls from
 * everyone, INCLUDING the tenant owner, and renders as a working screen with a
 * missing section. This repo has shipped that bug twice (admin roles write,
 * admin ABAC policy write), both times by inventing a plausible action name —
 * `form_drafts` is unusually exposed to it because "submit" and "abandon" are
 * obvious-sounding actions that its catalog (`sql/063`, seeded from
 * `FORM_DRAFT_PERMISSIONS`) does not contain: the routes reuse `draft.update`
 * for submit and `draft.delete` for abandon.
 *
 * So: extract the guard triples from the route sources, extract the
 * `permissionKey(...)` triples from the page, and require the page's set to be
 * a subset of what the routes actually ENFORCE and of what the module
 * descriptor DECLARES (which `module-management`'s permission sync compares
 * against the seed migrations).
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/form-drafts.astro";
const ROUTES = [
  "src/pages/api/v1/form-drafts/index.ts",
  "src/pages/api/v1/form-drafts/[id].ts",
  "src/pages/api/v1/form-drafts/[id]/submit.ts"
];

type Triple = `${string}.${string}.${string}`;

/**
 * These routes express their guards as module-level literal objects, e.g.
 *
 *   const READ_GUARD = { moduleKey: "form_drafts", activityCode: "draft",
 *     action: "read" as const };
 *
 * so the extractor matches that shape (allowing the `as const` suffix and
 * arbitrary whitespace/newlines between fields) rather than the shared-constant
 * form some other modules use. If a route is ever refactored to import its
 * guard from `form-draft-permissions.ts`, this stops matching — and the
 * `enforced.size` guard below turns that into a RED test rather than a check
 * that silently passes on nothing.
 */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*(?:\/\/[^\n]*\n\s*)*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

/**
 * Both spellings a page may use.
 *
 * `permissionKey("form_drafts", "draft", "read")` is the pre-#450 form, still
 * used by the screens that have not been migrated. A screen routed through
 * `loadAdminScreen` writes an `AccessRequest` object literal instead — the SAME
 * shape `guardTriplesFrom` already parses out of the routes, which is the point:
 * after R3 a page states its guard the way a route does, so one extractor reads
 * both sides.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>(guardTriplesFrom(source));
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

async function enforcedTriples(): Promise<Set<Triple>> {
  const enforced = new Set<Triple>();

  for (const route of ROUTES) {
    for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
      enforced.add(triple);
    }
  }

  return enforced;
}

describe("/admin/form-drafts permission gates", () => {
  test("the extractors find something on both sides — no vacuous pass", async () => {
    // Both subset assertions below are trivially satisfied by an empty left
    // side or an over-large right side. Pin the fixture explicitly: the page
    // really does gate, and the routes really were parsed.
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    const enforced = await enforcedTriples();

    expect(pageKeys.size).toBeGreaterThan(0);
    expect(enforced.size).toBeGreaterThan(0);
    // The exact triples the three routes enforce today. Stated so a route that
    // loses or renames a guard is caught here, at the source of truth, instead
    // of quietly widening what the page is allowed to claim.
    expect([...enforced].sort()).toEqual([
      "form_drafts.draft.create",
      "form_drafts.draft.delete",
      "form_drafts.draft.read",
      "form_drafts.draft.update"
    ]);
  });

  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    const enforced = await enforcedTriples();

    expect([...pageKeys].filter((key) => !enforced.has(key)).sort()).toEqual(
      []
    );
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = new Set<Triple>(
      (listModules()
        .find((module) => module.key === "form_drafts")
        ?.permissions?.map(
          (permission) =>
            `form_drafts.${permission.activityCode}.${permission.action}`
        ) ?? []) as Triple[]
    );

    expect(declared.size).toBeGreaterThan(0);

    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    expect([...pageKeys].filter((key) => !declared.has(key)).sort()).toEqual(
      []
    );
  });

  test("the janitor screen gates exactly on read and delete", async () => {
    // Written down because both halves look like mistakes and are not.
    //
    // `delete` (not an invented `abandon`/`remove`): the DELETE route is a
    // soft-delete that flips `status` to `abandoned`, but the ABAC action it
    // guards on is `delete`.
    //
    // No `update`: the screen deliberately ships no submit button and no step
    // editor — submitting is a domain transition the owning wizard performs,
    // not a janitorial one (see the page's own header comment). If a future
    // increment adds one, this assertion is the place that must be updated
    // consciously.
    const pageKeys = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].sort();

    expect(pageKeys).toEqual([
      "form_drafts.draft.delete",
      "form_drafts.draft.read"
    ]);
  });

  test("the page never writes SQL itself — it calls the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // Reads go through the application layer; writes go out over fetch, so the
    // routes' ABAC guard and audit rows cannot be bypassed by a screen that
    // mutates for itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('sendJson("DELETE", `/api/v1/form-drafts/${id}`');
    // `.astro` is a blind spot for `tsc --noEmit`, so the tenant-context rule
    // (`db:tenant-context:check`) is asserted here too: the request-path
    // `withTenant` returns `T | Response`, which on an SSR page silently
    // renders a `Response` where rows are expected.
    //
    // Since #450 the page opens no transaction of its own at all —
    // `loadAdminScreen` owns it, uses the throwing form, and hands back a
    // discriminated union in which the busy case is a THIRD state rather than
    // an empty list. Asserting the old spelling here would have made this test
    // a reason not to route the page through the chokepoint.
    expect(page).toContain("loadAdminScreen(");
    expect(page).not.toMatch(/\bwithTenant\(/);
    expect(page).not.toMatch(/\bwithTenantOrThrow\(/);
  });

  test("the sidebar entry points at a page that exists and is gated on read", async () => {
    const nav = listModules()
      .find((module) => module.key === "form_drafts")
      ?.navigation?.find((entry) => entry.path === "/admin/form-drafts");

    expect(nav).toBeDefined();
    // A non-core entry without a `requiredPermission` renders for everyone.
    expect(nav!.requiredPermission).toBe("form_drafts.draft.read");
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS in both directions; this only pins the gate,
    // which it does not check.
    await expect(Bun.file(PAGE).exists()).resolves.toBe(true);
  });
});
