/**
 * `/admin/audit-trail` gates against the endpoint it reads.
 *
 * Sibling of `admin-security-page-contract.test.ts` and
 * `admin-site-search-page-contract.test.ts`, for the same silent failure: a
 * page that gates on a permission key NO migration seeds hides the screen from
 * everyone — including the owner — while looking perfectly correct. This repo
 * has shipped that bug twice.
 *
 * `logging` declares exactly ONE permission, which makes a wrong guess here
 * total rather than partial: `logging.audit.read` or `logging.audit_trail.view`
 * both read naturally and would deny every caller with no visible clue.
 *
 * Also pinned: this screen must stay READ-ONLY. The audit trail is append-only
 * by design — `recordAuditEvent` is the only writer, called by other modules
 * inside their own transactions. A mutation control appearing on this page
 * would mean someone had invented a way to edit an audit log.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/audit-trail.astro";
const ROUTE = "src/pages/api/v1/logs/audit.ts";

type Triple = `${string}.${string}.${string}`;

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    const [, moduleKey, activityCode, action] = match;
    if (moduleKey && activityCode && action) {
      found.add(`${moduleKey}.${activityCode}.${action}` as Triple);
    }
  }

  return found;
}

/**
 * Both spellings. `permissionKey("logging", "audit_trail", "read")` is the
 * pre-#450 form; a page routed through `loadAdminScreen` states its guard as an
 * `AccessRequest` object literal — the SAME shape `guardTriplesFrom` reads out
 * of the route, which is the point: after R3 a page states its guard the way a
 * route does.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>(guardTriplesFrom(source));
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    const [, moduleKey, activityCode, action] = match;
    if (moduleKey && activityCode && action) {
      found.add(`${moduleKey}.${activityCode}.${action}` as Triple);
    }
  }

  return found;
}

describe("/admin/audit-trail permission gate", () => {
  test("the key the page gates on is the one the endpoint enforces", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    const enforced = guardTriplesFrom(await readFile(ROUTE, "utf8"));

    // Neither side may be empty, or the subset check below passes vacuously —
    // the shape of gate this repo has already been burned by.
    expect(pageKeys.size).toBe(1);
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = new Set<Triple>(
      (listModules()
        .find((module) => module.key === "logging")
        ?.permissions?.map(
          (permission) =>
            `logging.${permission.activityCode}.${permission.action}`
        ) ?? []) as Triple[]
    );

    expect(declared.size).toBeGreaterThan(0);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the screen is read-only — no SQL write, no mutating fetch", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    // No mutation helper is IMPORTED. Matched as an import statement, not as a
    // substring: the page's own header comment names `admin-form-client` while
    // explaining why this screen does not need it, and a bare `toContain` would
    // fail on the explanation rather than on the behaviour.
    expect(page).not.toMatch(
      /import\s*\{[^}]*\}\s*from\s*["'][^"']*admin-form-client/
    );
    expect(page).not.toMatch(/sendJson\(\s*"(POST|PATCH|PUT|DELETE)"/);
    // The filter is a GET form, which is why the page needs no script at all.
    expect(page).toContain('method="get"');
  });

  test("the bounded 100-row window is disclosed, not silently truncated", async () => {
    const page = await readFile(PAGE, "utf8");

    // `listAuditEvents` clamps to MAX_LIST_LIMIT = 100 with no cursor. A page
    // that renders the cap without saying so reads as "this is everything that
    // happened", which for an AUDIT log is the worst possible wrong impression.
    expect(page).toContain("possiblyTruncated");
    expect(page).toContain("audit-trail-truncated");
  });

  test("the endpoint's clamp is still 100, so the page's constant is not stale", async () => {
    const source = await readFile(
      "src/modules/logging/application/audit-log.ts",
      "utf8"
    );
    const match = source.match(/MAX_LIST_LIMIT\s*=\s*(\d+)/);

    expect(match?.[1]).toBe("100");
    expect(await readFile(PAGE, "utf8")).toContain("const MAX_LIMIT = 100");
  });

  test("the sidebar entry points at this page and is gated on that same key", () => {
    const nav = listModules()
      .find((module) => module.key === "logging")
      ?.navigation?.find((entry) => entry.path === "/admin/audit-trail");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("logging.audit_trail.read");
  });
});
