/**
 * `/admin/reporting` gates against the endpoints it drives.
 *
 * Sibling of `admin-data-lifecycle-page-contract.test.ts`, for the same silent
 * failure: a page gating on a permission key no migration seeds hides the
 * section from everyone — including the owner — while still looking like a
 * working screen with an empty area. This repo has shipped that bug twice, both
 * times by inventing a plausible action name.
 *
 * `reporting` is an unusually good place to repeat it. Its seven permissions
 * span three activity codes and four non-CRUD actions (`rebuild`, `analyze`,
 * `configure`, `export`), and the natural guesses are all wrong in the same
 * direction:
 *
 * - cancelling a rebuild reads like `projections.cancel` — the endpoint
 *   enforces `projections.rebuild`;
 * - reconciling reads like `projections.read` (it only compares numbers) — the
 *   endpoint enforces `projections.analyze`;
 * - triggering an export reads like `exports.configure` (it is an operator
 *   action on a schedule's projection) — the endpoint enforces
 *   `exports.export`.
 *
 * Each of those would render a control that denies every caller.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/reporting.astro";
const ROUTES = [
  "src/pages/api/v1/reports/email-health.ts",
  "src/pages/api/v1/reports/projections/index.ts",
  "src/pages/api/v1/reports/projections/[key]/index.ts",
  "src/pages/api/v1/reports/projections/[key]/rebuild/index.ts",
  "src/pages/api/v1/reports/projections/[key]/rebuild/cancel.ts",
  "src/pages/api/v1/reports/projections/[key]/reconcile.ts",
  "src/pages/api/v1/reports/exports/index.ts",
  "src/pages/api/v1/reports/exports/runs.ts",
  "src/pages/api/v1/reports/exports/trigger.ts",
  "src/pages/api/v1/reports/exports/[id]/disable.ts",
  "src/pages/api/v1/reports/exports/runs/[id]/download.ts"
];

type Triple = `${string}.${string}.${string}`;

/** `{ moduleKey: "reporting", activityCode: …, action: … }` → `module.activity.action`. */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

/** `permissionKey("reporting", "projections", "analyze")` → the same shape. */
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
      .find((module) => module.key === "reporting")
      ?.permissions?.map(
        (permission) =>
          `reporting.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/reporting permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(7);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check below pass vacuously, the shape of gate this repo has been burned
    // by before.
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBe(7);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page covers all seven — a screen for six leaves a surface curl-only", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // The whole reason this screen exists: `reporting` had seven permissions
    // and one page rendering four dashboard views. Enumerated rather than
    // compared as sets so a NEW permission added later fails here loudly and
    // its author has to decide whether the screen should drive it.
    expect([...pageKeys].sort()).toEqual([
      "reporting.dashboard.read",
      "reporting.exports.configure",
      "reporting.exports.export",
      "reporting.exports.read",
      "reporting.projections.analyze",
      "reporting.projections.read",
      "reporting.projections.rebuild"
    ]);
  });

  test("cancel is gated on rebuild, and the endpoint agrees", async () => {
    const cancel = await readFile(
      "src/pages/api/v1/reports/projections/[key]/rebuild/cancel.ts",
      "utf8"
    );

    // A `projections.cancel` key exists nowhere — not in the descriptor, not
    // in any migration — so a page inventing it would hide the button from
    // every operator including the owner.
    expect(guardTriplesFrom(cancel).has("reporting.projections.rebuild")).toBe(
      true
    );
    expect(
      declaredTriples().has("reporting.projections.cancel" as Triple)
    ).toBe(false);
  });

  test("reconcile is gated on analyze, not read", async () => {
    const reconcile = await readFile(
      "src/pages/api/v1/reports/projections/[key]/reconcile.ts",
      "utf8"
    );
    const enforced = guardTriplesFrom(reconcile);

    expect(enforced.has("reporting.projections.analyze")).toBe(true);
    expect(enforced.has("reporting.projections.read")).toBe(false);
  });

  test("triggering an export is gated on export, not configure", async () => {
    const trigger = await readFile(
      "src/pages/api/v1/reports/exports/trigger.ts",
      "utf8"
    );
    const enforced = guardTriplesFrom(trigger);

    expect(enforced.has("reporting.exports.export")).toBe(true);
    expect(enforced.has("reporting.exports.configure")).toBe(false);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch,
    // so the endpoints' audit rows, idempotency records and decision logs
    // cannot be bypassed by rendering a form that writes for itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain("/api/v1/reports/projections/${key}/rebuild`");
    expect(page).toContain(
      "/api/v1/reports/projections/${key}/rebuild/cancel`"
    );
    expect(page).toContain("/api/v1/reports/projections/${key}/reconcile`");
    expect(page).toContain('"/api/v1/reports/exports"');
    expect(page).toContain('"/api/v1/reports/exports/trigger"');
    expect(page).toContain("/api/v1/reports/exports/${id}/disable`");
  });

  test("the five mutating calls carry a fresh Idempotency-Key — reconcile carries none", async () => {
    const page = await readFile(PAGE, "utf8");

    // Rebuild, cancel, disable, create and trigger all answer
    // `IDEMPOTENCY_REQUIRED` without the header, so a screen that omitted it
    // would render controls that always fail. A per-click `crypto.randomUUID()`
    // is also what makes a deliberate second action actually run, instead of
    // replaying the first one's stored response.
    expect(
      page.match(/"Idempotency-Key": crypto\.randomUUID\(\)/g)
    ).toHaveLength(5);

    // Reconcile requires no key BECAUSE it mutates no business state — it only
    // appends a comparison snapshot. Scoped to the request that names that URL
    // so adding the header there turns this red while the five legitimate ones
    // stay untouched.
    const reconcileCall = page.slice(
      page.indexOf("/api/v1/reports/projections/${key}/reconcile`")
    );
    const reconcileOptions = reconcileCall.slice(
      0,
      reconcileCall.indexOf(");")
    );
    expect(reconcileOptions).not.toContain("Idempotency-Key");
  });

  test("form bounds come from the constants the endpoints validate against", async () => {
    const page = await readFile(PAGE, "utf8");

    // A hand-typed `min`/`max`/`maxlength` drifts into a browser that accepts
    // what the server rejects with a 400 the operator cannot act on.
    expect(page).toContain("MIN_EXPORT_INTERVAL_MINUTES");
    expect(page).toContain("MAX_EXPORT_INTERVAL_MINUTES");
    expect(page).toContain("MAX_REASON_LENGTH");
    expect(page).not.toMatch(/max=\{?"?\d/);

    for (const route of [
      "src/pages/api/v1/reports/exports/index.ts",
      "src/pages/api/v1/reports/exports/[id]/disable.ts",
      "src/pages/api/v1/reports/projections/[key]/rebuild/index.ts"
    ]) {
      expect(await readFile(route, "utf8")).toContain(
        "reporting/domain/operator-input-bounds"
      );
    }
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "reporting")
      ?.navigation?.find((entry) => entry.path === "/admin/reporting");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("reporting.projections.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});
