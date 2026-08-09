/**
 * `/admin/theming` gates against the endpoints it drives.
 *
 * Sibling of `admin-security-page-contract.test.ts` and
 * `admin-site-search-page-contract.test.ts`, for the same silent failure: a page
 * that gates on a permission key NO migration seeds hides the section from
 * everyone — including the owner — and still looks like a working screen with an
 * empty area. This repo has shipped that bug twice, both times by inventing a
 * plausible action name.
 *
 * `theming` is a high-risk place to repeat it. Its six permissions span three
 * activity codes (`config`, `version`, `preview`) and FOUR non-CRUD actions
 * (`publish`, `restore`, `archive`, `create`), and the screen's own vocabulary
 * disagrees with the permission's: the button says "Roll back" but the seeded
 * action is `restore`, the button says "Retire" but the action is `archive`.
 * `theming.version.rollback` / `theming.version.retire` / `theming.config.publish`
 * each read perfectly and would deny everyone.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/theming.astro";
const ROUTES = [
  "src/pages/api/v1/theming/index.ts",
  "src/pages/api/v1/theming/validate.ts",
  "src/pages/api/v1/theming/draft.ts",
  "src/pages/api/v1/theming/preview.ts",
  "src/pages/api/v1/theming/publish.ts",
  "src/pages/api/v1/theming/rollback.ts",
  "src/pages/api/v1/theming/retire.ts"
];

type Triple = `${string}.${string}.${string}`;

/**
 * The activity code each `THEMING_*_ACTIVITY_CODE` constant carries. The route
 * guards reference the constants rather than string literals, so a literal-only
 * regex would find nothing and pass vacuously — the extractor has to resolve
 * them, and the first test below pins this map against the descriptor so a
 * changed constant VALUE cannot silently produce wrong triples here.
 */
const ACTIVITY_BY_CONSTANT: Record<string, string> = {
  THEMING_CONFIG_ACTIVITY_CODE: "config",
  THEMING_VERSION_ACTIVITY_CODE: "version",
  THEMING_PREVIEW_ACTIVITY_CODE: "preview"
};

/** `{ moduleKey: THEMING_MODULE_KEY, activityCode: THEMING_VERSION_ACTIVITY_CODE, action: "restore" as const }` → `theming.version.restore`. */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*THEMING_MODULE_KEY,\s*activityCode:\s*(THEMING_[A-Z_]+_ACTIVITY_CODE),\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    const constantName = match[1];
    const action = match[2];
    if (!constantName || !action) continue;
    const activity = ACTIVITY_BY_CONSTANT[constantName];
    if (activity) found.add(`theming.${activity}.${action}` as Triple);
  }

  return found;
}

/** `permissionKey("theming", "version", "restore")` → the same shape. */
/**
 * Both spellings, and issue #450 is why the second exists: a screen routed
 * through `loadAdminScreen` states its guards as `AccessRequest` object
 * literals instead of `permissionKey(...)`.
 *
 * It cannot reuse `guardTriplesFrom` above — that one matches the ROUTES, which
 * compose their guards from the `THEMING_*_ACTIVITY_CODE` constants, while the
 * screen writes the activity codes out. Reading only the old spelling would
 * have made this test demand the screen keep deciding access from the raw grant
 * set, which is the defect.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "theming")
      ?.permissions?.map(
        (permission) =>
          `theming.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/theming permission gates", () => {
  test("the activity-code constants still resolve to the values assumed here", () => {
    const declared = listModules().find((module) => module.key === "theming");

    expect(declared).toBeDefined();
    const activityCodes = new Set(
      declared!.permissions?.map((permission) => permission.activityCode) ?? []
    );
    expect(activityCodes).toEqual(new Set(Object.values(ACTIVITY_BY_CONSTANT)));
  });

  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // All six: the screen renders or hides something for each one.
    expect(pageKeys.size).toBe(6);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check below pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("the non-CRUD actions are the seeded ones, not the ones the buttons say", () => {
    const declared = declaredTriples();

    // Spelled out because the mismatch is the trap: the UI verbs are "roll back"
    // and "retire", and the seeded actions are `restore` and `archive`.
    expect(declared).toContain("theming.version.restore");
    expect(declared).toContain("theming.version.archive");
    expect(declared).toContain("theming.version.publish");
    expect(declared).toContain("theming.preview.create");
    expect(declared).not.toContain("theming.version.rollback");
    expect(declared).not.toContain("theming.version.retire");
    expect(declared).not.toContain("theming.config.publish");
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();

    expect(declared.size).toBe(6);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows, idempotency records and immutability trigger
    // cannot be bypassed by rendering a form that writes for itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('"/api/v1/theming/validate"');
    expect(page).toContain('"/api/v1/theming/draft"');
    expect(page).toContain('"/api/v1/theming/preview"');
    expect(page).toContain('"/api/v1/theming/publish"');
    expect(page).toContain('"/api/v1/theming/rollback"');
    expect(page).toContain('"/api/v1/theming/retire"');
  });

  test("the four mutations carry a fresh Idempotency-Key and validate carries none", async () => {
    const page = await readFile(PAGE, "utf8");

    // draft PUT, publish, rollback and retire all reject a request without the
    // header (`IDEMPOTENCY_REQUIRED`), so a screen that omitted it would render
    // controls that always fail. A per-click `crypto.randomUUID()` is also what
    // makes a deliberate SECOND publish/rollback act instead of replaying the
    // first one's stored response.
    const keyed = page.match(/"Idempotency-Key": crypto\.randomUUID\(\)/g);
    // Two occurrences covering four mutations: the draft PUT has its own, and
    // publish/rollback/retire share `runLifecycleAction`.
    expect(keyed).toHaveLength(2);
    expect(page).toContain("async function runLifecycleAction(");

    // Validate is a read-only dry run on an endpoint that requires no key. It
    // goes through the local `requestJson`, which sends only `Content-Type` —
    // asserted structurally so a later edit cannot slip a key in.
    const requestJsonBody = page.slice(
      page.indexOf("async function requestJson("),
      page.indexOf("function collectConfig()")
    );
    expect(requestJsonBody.length).toBeGreaterThan(200);
    expect(requestJsonBody).not.toContain("Idempotency-Key");
    expect(page).toContain('requestJson("/api/v1/theming/validate", config)');
  });

  test("the sidebar entry points at this page and is gated on a real permission", async () => {
    const nav = listModules()
      .find((module) => module.key === "theming")
      ?.navigation?.find((entry) => entry.path === "/admin/theming");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("theming.config.read");
    expect(declaredTriples()).toContain(nav!.requiredPermission as Triple);
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
    await expect(Bun.file(PAGE).exists()).resolves.toBe(true);
  });
});
