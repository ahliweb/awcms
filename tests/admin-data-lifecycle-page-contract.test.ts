/**
 * `/admin/data-lifecycle` gates against the endpoints it drives.
 *
 * Sibling of `admin-site-search-page-contract.test.ts`, for the same silent
 * failure: a page that gates on a permission key NO migration seeds hides the
 * section from everyone — including the owner — and still looks like a working
 * screen with an empty area. This repo has shipped that bug twice, both times
 * by inventing a plausible action name.
 *
 * `data_lifecycle` is a fresh chance to repeat it. Its six permissions span
 * four activity codes and two non-CRUD actions (`release`, `analyze`), so tidy
 * guesses like `legal_hold.delete` for releasing a hold, or `plan.read` for the
 * dry-run, would each read perfectly and deny everyone.
 *
 * It also carries a trap the other screens do not: `create` and `release` are a
 * `critical` SoD maker/checker pair, so gating both controls on one permission
 * would be wrong for every real operator — and would look tidier in review.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/data-lifecycle.astro";
const ROUTES = [
  "src/pages/api/v1/data-lifecycle/registry.ts",
  "src/pages/api/v1/data-lifecycle/runs.ts",
  "src/pages/api/v1/data-lifecycle/legal-holds.ts",
  "src/pages/api/v1/data-lifecycle/dry-run.ts",
  "src/pages/api/v1/data-lifecycle/legal-holds/[id]/release.ts"
];

type Triple = `${string}.${string}.${string}`;

/** `{ moduleKey: "data_lifecycle", activityCode: …, action: … }` → `module.activity.action`. */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

/** `permissionKey("data_lifecycle", "legal_hold", "release")` → the same shape. */
/**
 * Both spellings, and issue #450 is why the second exists: a screen routed
 * through `loadAdminScreen` states its guards as `AccessRequest` object
 * literals — the SAME shape the routes use — instead of `permissionKey(...)`.
 *
 * Reading only the old spelling would have made this test demand the screen
 * keep deciding access from the raw grant set, which is the defect. A contract
 * test pins the PROPERTY, never the syntax that happened to express it.
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
      .find((module) => module.key === "data_lifecycle")
      ?.permissions?.map(
        (permission) =>
          `data_lifecycle.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/data-lifecycle permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
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

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBe(6);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("create and release are gated SEPARATELY, because SoD makes the pair a conflict", async () => {
    const page = await readFile(PAGE, "utf8");
    const keys = pageTriplesFrom(page);

    // The whole point: a screen gating both controls on one permission would be
    // unusable for the operators this module is designed around, since the SoD
    // rule below makes holding both a `critical` conflict.
    expect(keys.has("data_lifecycle.legal_hold.create")).toBe(true);
    expect(keys.has("data_lifecycle.legal_hold.release")).toBe(true);

    const rule = listModules()
      .find((module) => module.key === "data_lifecycle")
      ?.sodRules?.find(
        (candidate) =>
          candidate.ruleKey === "data_lifecycle.legal_hold_maker_checker"
      );

    expect(rule).toBeDefined();
    expect([...rule!.conflictingPermissionKeys].sort()).toEqual([
      "data_lifecycle.legal_hold.create",
      "data_lifecycle.legal_hold.release"
    ]);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed by
    // rendering a form that writes for itself. Real archive/purge is job-only
    // (ADR-0037) and has no HTTP surface for this page to call at all.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('"/api/v1/data-lifecycle/legal-holds"');
    expect(page).toContain("/api/v1/data-lifecycle/legal-holds/${");
    expect(page).toContain('"/api/v1/data-lifecycle/dry-run"');
  });

  test("both hold mutations carry a fresh Idempotency-Key — and the dry-run carries none", async () => {
    const page = await readFile(PAGE, "utf8");

    // Create and release both reject a request without the header
    // (`IDEMPOTENCY_REQUIRED`), so a screen that omitted it would render
    // controls that always fail. A per-click `crypto.randomUUID()` is also what
    // makes a deliberate second action actually run, instead of replaying the
    // first one's stored response.
    expect(
      page.match(/"Idempotency-Key": crypto\.randomUUID\(\)/g)
    ).toHaveLength(2);

    // The dry-run endpoint requires no key BECAUSE it mutates nothing — not
    // even a run row. Sending one would imply a replay contract it does not
    // have. Scoped to the submit handler that names that URL, so adding the
    // header there turns this red while the two legitimate ones stay
    // untouched — and comments are stripped first, because the handler
    // EXPLAINS in prose that it sends no key.
    const dryRunCall = stripComments(
      page.slice(
        page.indexOf('onSubmit("data-lifecycle-plan-form"'),
        page.indexOf('onSubmit("data-lifecycle-hold-form"')
      )
    );
    expect(dryRunCall.length).toBeGreaterThan(200);
    expect(dryRunCall).toContain('"/api/v1/data-lifecycle/dry-run"');
    expect(dryRunCall).not.toContain("Idempotency-Key");
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "data_lifecycle")
      ?.navigation?.find((entry) => entry.path === "/admin/data-lifecycle");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("data_lifecycle.registry.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});
