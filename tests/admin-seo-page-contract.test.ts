/**
 * `/admin/seo` gates against the endpoints it drives.
 *
 * Modelled on `admin-security-page-contract.test.ts`, which pins the silent
 * failure this repo has shipped TWICE (admin roles write, admin ABAC policy
 * write): a page that gates a section on a permission key NO migration seeds
 * hides that section from everyone — including the tenant owner — and still
 * looks like a working screen with an empty area. Both times the key was
 * invented by picking a plausible-sounding action name.
 *
 * Two differences from the security screen force a different extractor here:
 *
 * 1. **The seo routes express their guards through CONSTANTS**, not string
 *    literals (`moduleKey: SEO_MODULE_KEY, activityCode:
 *    SEO_REDIRECT_ACTIVITY_CODE`). A literal-only regex would parse ZERO guards
 *    from every seo route and the subset check would pass vacuously — the exact
 *    shape of gate this repo has already been burned by. So the constants are
 *    resolved from `domain/seo-permissions.ts` first.
 * 2. **`POST /redirects/{id}/lifecycle` derives its guard from the request
 *    BODY**: `action=purge` needs `redirect.delete`; `activate | deactivate |
 *    archive | restore` need `redirect.update`. A page that renders Purge to a
 *    holder of `redirect.update` shows a control that 403s every single time,
 *    and a page that renders Activate only to a holder of `redirect.delete`
 *    hides a control the viewer is entitled to. That mapping gets its own test.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/seo.astro";
const PERMISSION_CONSTANTS =
  "src/modules/seo-distribution/domain/seo-permissions.ts";
const LIFECYCLE_ROUTE = "src/pages/api/v1/seo/redirects/[id]/lifecycle.ts";
const ROUTES = [
  "src/pages/api/v1/seo/config.ts",
  "src/pages/api/v1/seo/redirects/index.ts",
  "src/pages/api/v1/seo/redirects/[id].ts",
  LIFECYCLE_ROUTE,
  "src/pages/api/v1/seo/redirects/validate.ts",
  "src/pages/api/v1/seo/redirects/import.ts",
  "src/pages/api/v1/seo/redirects/capture-url-change.ts",
  "src/pages/api/v1/seo/redirects/settings.ts",
  "src/pages/api/v1/seo/not-found/index.ts",
  "src/pages/api/v1/seo/not-found/[id].ts"
];

type Triple = `${string}.${string}.${string}`;

/** `export const SEO_MODULE_KEY = "seo_distribution";` → `{ SEO_MODULE_KEY: "seo_distribution" }`. */
async function constantMap(): Promise<Map<string, string>> {
  const source = await readFile(PERMISSION_CONSTANTS, "utf8");
  const map = new Map<string, string>();

  for (const match of source.matchAll(
    /export const ([A-Z][A-Z0-9_]*)\s*=\s*"([a-z_]+)"/g
  )) {
    map.set(match[1]!, match[2]!);
  }

  return map;
}

/** A guard operand is either a bare string literal or an identifier to resolve. */
function resolveOperand(
  raw: string,
  constants: ReadonlyMap<string, string>
): string | null {
  const literal = raw.match(/^"([a-z_]+)"$/);
  if (literal) return literal[1]!;
  return constants.get(raw) ?? null;
}

/**
 * Every `{ moduleKey, activityCode, action }` guard object in a route.
 *
 * `action` is captured as raw source up to the object's closing brace rather
 * than as a single literal, because the lifecycle route computes it
 * (`lifecycleAction === "purge" ? "delete" : "update"`). Every string literal in
 * that span is then kept if it names an action the module descriptor actually
 * declares — so the ternary contributes BOTH `delete` and `update`, and the
 * `"purge"` discriminant (an action name that does not exist in the access
 * model) is dropped.
 */
function guardTriplesFrom(
  source: string,
  constants: ReadonlyMap<string, string>,
  knownActions: ReadonlySet<string>
): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*("[a-z_]+"|[A-Za-z_$][\w$]*)\s*,\s*activityCode:\s*("[a-z_]+"|[A-Za-z_$][\w$]*)\s*,\s*action:\s*([\s\S]*?)\n\s*\}/g;

  for (const match of source.matchAll(pattern)) {
    const moduleKey = resolveOperand(match[1]!, constants);
    const activityCode = resolveOperand(match[2]!, constants);
    if (!moduleKey || !activityCode) continue;

    for (const literal of match[3]!.matchAll(/"([a-z_]+)"/g)) {
      const action = literal[1]!;
      if (!knownActions.has(action)) continue;
      found.add(`${moduleKey}.${activityCode}.${action}` as Triple);
    }
  }

  return found;
}

/** `permissionKey("seo_distribution", "redirect", "read")` → `seo_distribution.redirect.read`. */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  const descriptor = listModules().find(
    (module) => module.key === "seo_distribution"
  );

  return new Set<Triple>(
    (descriptor?.permissions ?? []).map(
      (permission) =>
        `seo_distribution.${permission.activityCode}.${permission.action}` as Triple
    )
  );
}

function declaredActions(): Set<string> {
  const descriptor = listModules().find(
    (module) => module.key === "seo_distribution"
  );

  return new Set((descriptor?.permissions ?? []).map((p) => p.action));
}

async function enforcedTriples(): Promise<Set<Triple>> {
  const constants = await constantMap();
  const actions = declaredActions();
  const enforced = new Set<Triple>();

  for (const route of ROUTES) {
    for (const triple of guardTriplesFrom(
      await readFile(route, "utf8"),
      constants,
      actions
    )) {
      enforced.add(triple);
    }
  }

  return enforced;
}

/**
 * The exact set the seo routes enforce today. Pinned rather than merely
 * `size > 0`: a size check still passes when the extractor silently parses,
 * say, only the two `config` guards because a constant name changed, and a
 * two-element `enforced` makes the subset assertion below almost vacuous while
 * looking like a real gate.
 */
const EXPECTED_ENFORCED: Triple[] = [
  "seo_distribution.config.read",
  "seo_distribution.config.update",
  "seo_distribution.not_found.read",
  "seo_distribution.not_found.update",
  "seo_distribution.redirect.create",
  "seo_distribution.redirect.delete",
  "seo_distribution.redirect.read",
  "seo_distribution.redirect.update"
];

describe("/admin/seo permission gates", () => {
  test("the guard extractor really parses the constant-based guards", async () => {
    const enforced = await enforcedTriples();

    expect([...enforced].sort()).toEqual(EXPECTED_ENFORCED);
  });

  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    const enforced = await enforcedTriples();

    expect(pageKeys.size).toBeGreaterThan(0);
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key)).sort()).toEqual(
      []
    );
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBeGreaterThan(0);

    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    const missing = [...pageKeys].filter((key) => !declared.has(key)).sort();

    expect(missing).toEqual([]);
  });

  test("the page gates on seo_distribution keys only", async () => {
    // A gate borrowed from another module (say `tenant_admin.…`) would pass the
    // "enforced" check only if that module's routes were in ROUTES, and would
    // fail the descriptor check — but stating it directly makes the intent
    // legible: this screen drives seo endpoints and nothing else.
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    const foreign = [...pageKeys]
      .filter((key) => !key.startsWith("seo_distribution."))
      .sort();

    expect(foreign).toEqual([]);
  });
});

describe("/admin/seo honors the DYNAMIC lifecycle permission", () => {
  /**
   * Which permission variable guards the control at `index`. Each control on
   * the page sits directly inside a `{canUpdateRedirect && …}` /
   * `{canDeleteRedirect && …}` block, so the nearest PRECEDING gate token is
   * the one that decides whether it renders.
   */
  const GATE_BY_TOKEN: Record<string, Triple> = {
    canUpdateRedirect: "seo_distribution.redirect.update",
    canDeleteRedirect: "seo_distribution.redirect.delete"
  };

  function gateFor(source: string, index: number): Triple | null {
    let bestToken: string | null = null;
    let bestPosition = -1;

    for (const token of Object.keys(GATE_BY_TOKEN)) {
      const position = source.lastIndexOf(token, index);
      if (position > bestPosition) {
        bestPosition = position;
        bestToken = token;
      }
    }

    return bestToken ? GATE_BY_TOKEN[bestToken]! : null;
  }

  test("the endpoint really does swap the guard on `action=purge`", async () => {
    const route = await readFile(LIFECYCLE_ROUTE, "utf8");

    // If this ever stops holding, the page's split below is wrong even though
    // every other assertion in this file still passes.
    expect(route).toMatch(
      /action:\s*\(?\s*lifecycleAction\s*===\s*"purge"\s*\?\s*"delete"\s*:\s*"update"/
    );
  });

  test("purge is gated on redirect.delete and the other four on redirect.update", async () => {
    const page = await readFile(PAGE, "utf8");
    const gates = new Map<string, Triple | null>();

    for (const match of page.matchAll(/data-lifecycle-action="([a-z]+)"/g)) {
      gates.set(match[1]!, gateFor(page, match.index!));
    }

    // Every lifecycle action the API accepts is reachable from this screen —
    // otherwise "the purge gate is correct" could be true because purge is not
    // rendered at all.
    expect([...gates.keys()].sort()).toEqual([
      "activate",
      "archive",
      "deactivate",
      "purge",
      "restore"
    ]);

    expect(gates.get("purge")).toBe("seo_distribution.redirect.delete");
    for (const action of ["activate", "deactivate", "archive", "restore"]) {
      expect(gates.get(action)).toBe("seo_distribution.redirect.update");
    }
  });
});

describe("/admin/seo writes only through the guarded endpoints", () => {
  test("the page never mutates directly and never self-posts", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    // A `<form action=…>` would post the page to itself; every write here goes
    // out over fetch to `/api/v1/seo/**`, where the ABAC guard and the audit
    // rows live. The two `method="get"` forms are list filters, not writes.
    expect(page).not.toMatch(/<form[^>]*\saction=/);
    // `.astro` files are a blind spot for `tsc --noEmit`, so the tenant-context
    // rule is asserted textually: a bare `withTenant(` here would open a
    // transaction whose 503 `Response` leaks into the render path.
    expect(page).not.toMatch(/[^r]\bwithTenant\(/);
    expect(page).toContain("withTenantOrThrow(sql, ssr.tenantId");
  });

  test("high-risk writes carry a fresh Idempotency-Key and the dry run does not", async () => {
    const page = await readFile(PAGE, "utf8");

    // One `crypto.randomUUID()` per call site (config PUT, settings PUT,
    // redirect POST, row lifecycle, recovery lifecycle) — a module-scope
    // constant would make a second click replay the first response.
    expect(
      page.match(/"Idempotency-Key": crypto\.randomUUID\(\)/g)?.length
    ).toBe(5);
    expect(page).not.toMatch(
      /const\s+\w*[iI]dempotency\w*\s*=\s*crypto\.randomUUID\(\)/
    );

    // The validate dry run writes nothing and the endpoint asks for no key, so
    // it must not mint one.
    const validateCall = page.slice(
      page.indexOf('fetch("/api/v1/seo/redirects/validate"'),
      page.indexOf("const createForm")
    );
    expect(validateCall.length).toBeGreaterThan(0);
    expect(validateCall).not.toContain("Idempotency-Key");
  });
});

describe("/admin/seo is reachable from the sidebar", () => {
  test("the descriptor claims the page with a gate that a migration seeds", async () => {
    const nav = listModules()
      .find((module) => module.key === "seo_distribution")
      ?.navigation?.find((entry) => entry.path === "/admin/seo");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("seo_distribution.config.read");
    // The gate on a nav entry is the same class of bug as a gate on a section:
    // name a permission nothing seeds and the link disappears for everyone.
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
    // `admin-navigation-registry.test.ts` binds path→file and
    // labelKey→SIDEBAR_LABELS in both directions; this only pins the gate.
    await expect(Bun.file(PAGE).exists()).resolves.toBe(true);
  });
});
