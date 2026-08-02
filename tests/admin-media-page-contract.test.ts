/**
 * `/admin/media` gates against the endpoints it drives, and is explicit about
 * the permissions it deliberately does NOT drive.
 *
 * Sixth of the admin page contracts, and the one that closes ADR-0021's first
 * criterion: after this, no module in this base is without a screen.
 *
 * What is specific here is that this page could not have existed before its
 * three ADR-0056 steps landed. So the assertions run in both directions: the
 * page drives exactly the four permissions that are now enforced, and the three
 * it skips are skipped for a stated reason rather than missed.
 *
 * Three traps specific to this module:
 *
 * - **`media.attach`/`media.detach` are REVOKED** (`sql/087`). A control gated
 *   on either would deny every caller including the owner, because no migration
 *   seeds them any more — the latent-authz shape, arrived at from the other
 *   direction than usual.
 * - **`enforcement.enable` is one-way and tenant-wide.** It is not an object
 *   action, and a button for it beside a row of thumbnails would misrepresent
 *   what it does. There is deliberately no `enforcement.disable` anywhere.
 * - **No `<img>` preview.** A registry row can be `pending_upload` or `failed`
 *   — the bytes may be absent, unverified, or the very thing the operator came
 *   to remove. Rendering them shows a policy-violating image one more time, to
 *   the person removing it.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { SIDEBAR_LABELS } from "../src/modules/module-management/domain/sidebar-menu";

const PAGE = "src/pages/admin/media.astro";
const LIST_ROUTE = "src/pages/api/v1/media/objects/list.ts";
const DELETE_ROUTE = "src/pages/api/v1/media/objects/[id].ts";
const RESTORE_ROUTE = "src/pages/api/v1/media/objects/[id]/restore.ts";
const PURGE_ROUTE = "src/pages/api/v1/media/objects/[id]/purge.ts";

const ROUTES = [LIST_ROUTE, DELETE_ROUTE, RESTORE_ROUTE, PURGE_ROUTE];

/** Exactly what the page gates on, enumerated so an addition is loud. */
const PAGE_KEYS = [
  "media_library.media.delete",
  "media_library.media.purge",
  "media_library.media.read",
  "media_library.media.restore"
] as const;

/** Declared and enforced, deliberately not on this page — see the header. */
const DELIBERATE_ABSENCES = [
  "media_library.media.create",
  "media_library.media.verify",
  "media_library.media.cancel",
  "media_library.enforcement.read",
  "media_library.enforcement.enable"
] as const;

type Triple = `${string}.${string}.${string}`;

function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  // Both spellings: these routes use the shared activity-code constant, and a
  // literal-only regex would see zero guards and pass vacuously.
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*(?:MEDIA_PERMISSION_ACTIVITY_CODE|"([a-z_]+)"),\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2] ?? "media"}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "media_library")
      ?.permissions?.map(
        (permission) =>
          `media_library.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/media permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(PAGE_KEYS.length);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Non-vacuous: an empty `enforced` would make the subset check pass while
    // proving nothing, the shape of gate this repo has been burned by.
    expect(enforced.size).toBe(4);

    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBe(9);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page claims exactly the lifecycle four", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    expect([...pageKeys].sort()).toEqual([...PAGE_KEYS]);
  });

  test("the revoked attach/detach appear nowhere on the page", async () => {
    const page = await readFile(PAGE, "utf8");
    const declared = declaredTriples();

    // Revoked by sql/087 — a control gated on either would deny every caller
    // including the owner, because nothing seeds them any more.
    for (const action of ["attach", "detach"]) {
      expect(declared.has(`media_library.media.${action}` as Triple)).toBe(
        false
      );
      expect(page).not.toContain(`"media", "${action}"`);
    }
  });

  test("the deliberate absences stay absent, and stay enforced elsewhere", async () => {
    const page = await readFile(PAGE, "utf8");
    const pageKeys = pageTriplesFrom(page);
    const declared = declaredTriples();

    for (const key of DELIBERATE_ABSENCES) {
      // Still real: each is declared, seeded, and enforced by its own route.
      // These are decisions about scope, not permissions left dangling.
      expect(declared.has(key as Triple)).toBe(true);
      expect(pageKeys.has(key as Triple)).toBe(false);
    }

    // And the page says why, so the split survives the next reader.
    expect(page).toContain("presigned upload");
    expect(page).toContain("ONE-WAY");
  });

  test("there is no enforcement.disable to gate on, and never may be", () => {
    const declared = declaredTriples();

    expect(declared.has("media_library.enforcement.disable" as Triple)).toBe(
      false
    );
  });
});

describe("/admin/media behaviour", () => {
  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain("/api/v1/media/objects/${id}`");
    expect(page).toContain("/api/v1/media/objects/${id}/restore`");
    expect(page).toContain("/api/v1/media/objects/${id}/purge`");
  });

  test("all three mutations carry an Idempotency-Key, because all three require one", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const route of [DELETE_ROUTE, RESTORE_ROUTE, PURGE_ROUTE]) {
      expect(await readFile(route, "utf8")).toContain("IDEMPOTENCY_REQUIRED");
    }

    // Spelled once, applied by every call. Unlike `/admin/blog` there is no
    // opt-out here, and unlike `/admin/sync` there is no endpoint that declines
    // the header.
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(page).not.toContain("idempotent: false");

    // Three call sites plus the helper declaration.
    expect([...page.matchAll(/(?<!function )idempotency\(\)/g)].length).toBe(3);
  });

  test("no <img> renders registry bytes", async () => {
    const page = await readFile(PAGE, "utf8");

    // Scoped to the TEMPLATE, not the whole file: the frontmatter comment
    // explains this rule and names the tag while doing so, which would fail
    // the assertion for the opposite of the reason it exists.
    const template = page.slice(page.indexOf("\n---\n", 4) + 5);
    expect(template).toContain("<AdminLayout");

    // A row can be `pending_upload` or `failed`: the bytes may be absent,
    // unverified, or the very thing the operator is here to delete.
    expect(template).not.toMatch(/<img\b/i);
    expect(template).not.toContain("item.publicUrl");
  });

  test("caller-supplied text is escaped, never interpolated as markup", async () => {
    const page = await readFile(PAGE, "utf8");

    // A filename reaches this table verbatim from whoever uploaded it.
    expect(page).toContain("set:text={item.originalFilename");
    expect(page).toContain("set:text={item.objectKey}");
    expect(page).not.toContain("set:html");
  });

  test("reads run in one transaction and page by keyset, not offset", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("withTenantOrThrow");
    expect(page).toContain("decodeKeysetCursor");

    // Case-sensitive on the SQL keyword, plus the query parameter a page-number
    // pager would need. A case-insensitive `\boffset\b` would match this
    // screen's own comment explaining why it does NOT use one.
    expect(page).not.toMatch(/\bOFFSET\b/);
    expect(page).not.toContain('"offset"');
    expect(page).not.toContain("offset=");
    // Concurrent queries on one transaction connection leak it.
    expect(page).not.toContain("Promise.all");
  });

  test("a load failure renders as a failure, never as an empty library", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("loadError");
    expect(page).toContain("logAdminPageError");
    expect(page).toContain("not an empty library");
  });

  test("the delete bound comes from the constant the validator enforces", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("MAX_DELETE_REASON_LENGTH");
    // A hand-typed number drifts into the browser accepting what the server
    // rejects with a 400 the author cannot act on.
    expect(page).not.toMatch(/at most 500 characters/);

    const validation = await readFile(
      "src/modules/media-library/domain/media-lifecycle-validation.ts",
      "utf8"
    );
    expect(validation).toContain("export const MAX_DELETE_REASON_LENGTH");
  });

  test("the purge failure that retrying cannot fix is named", async () => {
    const page = await readFile(PAGE, "utf8");

    // "Please try again" is wrong for a live foreign key — retrying will never
    // succeed, and the caller has an action available.
    expect(page).toContain("MEDIA_OBJECT_REFERENCED");
    expect(page).toContain("Remove that reference first");
  });
});

describe("/admin/media sidebar entry", () => {
  test("points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "media_library")
      ?.navigation?.find((entry) => entry.path === "/admin/media");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("media_library.media.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);

    // ONE entry: this module's screen is the object lifecycle and nothing else.
    expect(
      listModules().find((module) => module.key === "media_library")?.navigation
    ).toHaveLength(1);
  });

  test("its label resolves rather than rendering the raw key", () => {
    const nav = listModules().find((module) => module.key === "media_library")
      ?.navigation?.[0];

    expect(nav).toBeDefined();
    expect(SIDEBAR_LABELS[nav!.labelKey]).toBe("Media library");
  });
});

describe("ADR-0021 criterion 1", () => {
  test("no active module is left without an admin screen — ZERO exceptions", () => {
    const withoutScreen = listModules()
      .filter((module) => module.status === "active")
      .filter((module) => (module.navigation ?? []).length === 0)
      .map((module) => module.key);

    // `media_library` was the last one, and there is no carve-out. An earlier
    // draft of this test excused `idn_admin_regions` as "deliberately
    // screenless" — a claim `docs/PROJECT_STATE.md` also carried and PR #345's
    // body repeated. It was stale: `/admin/idn-regions` landed in #332.
    // ADR-0052 moved that module's dataset LIFECYCLE to operator jobs, not the
    // whole module, and the two read permissions it kept are exactly what that
    // screen drives.
    //
    // The excuse mattered in the wrong direction too: with it, `idn_admin_regions`
    // could have LOST its screen and this test would still have passed.
    expect(withoutScreen).toEqual([]);
  });
});
