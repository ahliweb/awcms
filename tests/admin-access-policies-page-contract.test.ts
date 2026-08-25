/**
 * `/admin/access-policies` gates against the endpoints it drives, and stays
 * out of the half it deliberately does not.
 *
 * Sibling of `admin-approvals-page-contract.test.ts`, for the same silent
 * failure: a page gating on a permission key nothing seeds hides the control
 * from everyone — including the owner — while still looking like a working
 * screen.
 *
 * This screen sets a trap of its own, and it is the reason the screen exists.
 * There are TWO policy surfaces over one table:
 *
 * - the flat #171 CRUD at `/api/v1/abac/policies`, guarded by
 *   `identity_access.access_control.*`, driven by `/admin/abac-policies`;
 * - the DSL surface at `/api/v1/access/policies/*`, guarded by
 *   `identity_access.abac_policies.*`, driven by THIS screen.
 *
 * The names are one word apart, the module key is the same, and only the
 * second produces policies the evaluator consumes (`policy-cache.ts` filters
 * `is_dsl_managed`). A screen that reached for `access_control` here would look
 * right, work for an owner, and quietly defeat the independent grantability
 * `sql/032` created the second family for.
 *
 * It also pins the deliberate SCOPE: `abac_policies.configure` belongs to a
 * future authoring screen with a real condition-DSL editor, and this test fails
 * if it leaks into this one — the difference between a decision that was made
 * (`DELIBERATELY_UNSCREENED`) and a gap nobody noticed.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { DELIBERATELY_UNSCREENED } from "../scripts/admin-screen-coverage-check";

const PAGE = "src/pages/admin/access-policies.astro";
const ROUTES = [
  "src/pages/api/v1/access/policies/index.ts",
  "src/pages/api/v1/access/policies/[id].ts",
  "src/pages/api/v1/access/policies/simulate.ts"
];

type Triple = `${string}.${string}.${string}`;

function triplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)"\s*,\s*activityCode:\s*"([a-z_]+)"\s*,\s*action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "identity_access")
      ?.permissions?.map(
        (permission) =>
          `identity_access.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

const PAGE_KEYS = [
  "identity_access.abac_policies.read",
  "identity_access.abac_policies.analyze"
] as const;

describe("/admin/access-policies gates on keys that exist", () => {
  test("every permission the page names is declared by the module", async () => {
    const source = await readFile(PAGE, "utf8");
    const declared = declaredTriples();

    const undeclared = [...triplesFrom(source)].filter(
      (triple) => !declared.has(triple)
    );

    // Not "at least one is declared": EVERY one. A single invented action name
    // is a control nobody can ever see.
    expect(undeclared).toEqual([]);
  });

  test("it gates on both keys it needs, and they are the DSL family", async () => {
    const source = await readFile(PAGE, "utf8");
    const found = triplesFrom(source);

    for (const key of PAGE_KEYS) {
      expect(found.has(key)).toBe(true);
    }

    // The near-miss this screen exists to avoid. `access_control.*` guards the
    // OTHER policy surface; naming it here would hand this screen to a role
    // `sql/032` deliberately made able to be withheld from it.
    expect(found.has("identity_access.access_control.read")).toBe(false);
    expect(found.has("identity_access.access_control.configure")).toBe(false);
  });

  test("the routes it drives are guarded by exactly the keys it gates on", async () => {
    const routeKeys = new Set<Triple>();

    for (const route of ROUTES) {
      for (const triple of triplesFrom(await readFile(route, "utf8"))) {
        // The routes also name `identity_access.access_control.read` — the
        // simulator requires it to resolve a DIFFERENT tenant user's real
        // roles, an anti-enumeration guard rather than a surface gate. The
        // screen only ever simulates by ROLE CODES, so it needs neither.
        if (triple.startsWith("identity_access.abac_policies.")) {
          routeKeys.add(triple);
        }
      }
    }

    // Everything the page gates on must actually guard a route it calls.
    for (const key of PAGE_KEYS) {
      expect(routeKeys.has(key)).toBe(true);
    }
  });

  test("`configure` is absent from the page AND recorded as a decision", async () => {
    const source = await readFile(PAGE, "utf8");

    expect(
      triplesFrom(source).has("identity_access.abac_policies.configure")
    ).toBe(false);

    // Absent is not enough — absent WITHOUT a recorded reason is just a gap.
    // These two assertions are what make it a decision: the register says why,
    // and `admin:screen-coverage:check` fails if a screen ever claims it while
    // the entry still stands.
    expect(Object.keys(DELIBERATELY_UNSCREENED)).toContain(
      "identity_access.abac_policies.configure"
    );
    expect(
      DELIBERATELY_UNSCREENED["identity_access.abac_policies.configure"]
    ).toMatch(/editor/i);
  });
});
