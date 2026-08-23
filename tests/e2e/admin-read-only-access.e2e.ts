/**
 * Every gated admin screen RENDERS for a minimum-privilege read-only operator.
 *
 * ## The inverse of the deny test, and a different defect class
 *
 * `admin-deny-path.e2e.ts` proves a user holding nothing is refused.
 * `admin-screens-render.e2e.ts` proves the OWNER — who holds everything — gets
 * a page. Between those two sits the user who actually exists in an
 * organisation: someone granted reads and no writes.
 *
 * Nothing checked that case, and it has two failure modes. A screen that
 * DENIES a user holding every tenant read is demanding more than it declares —
 * its `authorize` block says `read` while something inside needs `configure`.
 * A screen that THROWS is worse and more likely: page code dereferencing data
 * only present when a write flag is true renders perfectly for an owner and
 * breaks for everyone else, which is the `/admin/seo` class arriving through
 * authorization rather than through statement order.
 *
 * ## The platform boundary, which this also checks
 *
 * Two screens — `/admin/tenants` and `/admin/partner-registry` — authorize on
 * PLATFORM-scoped permissions, and a tenant-scoped operator must NOT see them.
 * That is ADR-0053's separation, and it had never been exercised at runtime
 * either. So the expectation is derived rather than uniform: a screen whose
 * authorize block names a platform-scope permission must DENY this user; every
 * other gated screen must render.
 *
 * The first version of this test asserted "every screen renders" and reported
 * those two as defects. They were not — the assumption was too broad. Checking
 * before reporting turned a wrong assertion into the stronger one.
 *
 * ## The grant comes from the catalogue, not from the pages
 *
 * Every tenant-scoped permission whose action is `read`. Extracting each
 * screen's own `authorize` triple was the obvious alternative and is a trap:
 * 10 of the 47 screens declare an ARRAY of triples rather than one, so a
 * regex over the source silently under-grants for those — and the test would
 * then report the screens as broken for denying a user it had failed to
 * authorise.
 *
 * ## What this does NOT assert, stated because a mutation proved it
 *
 * **That the RIGHT screens are platform-scoped.** The expectation is derived
 * from each screen's own `authorize` block, so changing that block changes the
 * expectation with it. Downgrading `/admin/tenants` to a tenant permission was
 * tried, and this test passed — correctly, by its own definition, and
 * uselessly. What it verifies is CONSISTENCY between a screen's declared scope
 * and its runtime behaviour:
 *
 * - declares platform, does not deny a tenant operator → the boundary is open;
 * - declares tenant, denies a user holding every read → demands more than it
 *   declares;
 * - throws for this user while rendering for an owner.
 *
 * Which permission a screen *should* authorize on is a different question,
 * answered by its own contract test. Proven by the mutation that DOES belong
 * to this assertion: granting the read-only role the two platform reads turns
 * it red naming both platform screens.
 *
 * **Which write controls the user should see.** Those expectations differ per
 * screen — per-screen knowledge, not one mechanical rule. Still open, and said
 * plainly rather than quietly claimed.
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { provideTenant } from "./support/e2e-auth";
import { seedRestrictedUser } from "./support/e2e-restricted-user";

const tenantId = process.env.E2E_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;

const seeded = Boolean(tenantId && databaseUrl);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ADMIN_PAGES_ROOT = path.resolve(HERE, "../../src/pages/admin");

type GatedScreen = {
  url: string;
  source: string;
  deniedId: string;
  triples: string[];
};

/**
 * Every `module.activity.action` triple in a screen's `authorize` block.
 *
 * Both shapes are handled — a single object and an array of them — because 10
 * of the 47 screens use the array form. The caller asserts that EVERY gated
 * screen yielded at least one triple, which is what keeps a parser change from
 * silently reclassifying a platform screen as an ordinary one.
 */
export function authorizeTriples(source: string): string[] {
  const start = source.indexOf("authorize:");
  if (start < 0) return [];

  const window = source.slice(start, start + 1200);
  const end = window.search(/\n\s{2}(load|onError|workClass):/);
  const block = end > 0 ? window.slice(0, end) : window;

  const triples: string[] = [];
  const pattern =
    /moduleKey:\s*"([^"]+)",\s*\n?\s*activityCode:\s*"([^"]+)",\s*\n?\s*action:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block))) {
    triples.push(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return triples;
}

/** Same walk as the deny test: gated screens, with the hook each page declares. */
function discoverGatedScreens(root: string, prefix = "/admin"): GatedScreen[] {
  const screens: GatedScreen[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      screens.push(...discoverGatedScreens(full, `${prefix}/${entry.name}`));
      continue;
    }

    if (!entry.name.endsWith(".astro")) continue;

    const source = readFileSync(full, "utf8");
    if (source.includes("loadSelfServiceScreen")) continue;

    const match = /id="([a-z0-9-]+-denied)"/.exec(source);
    if (!match?.[1]) continue;

    const base = entry.name.slice(0, -".astro".length);
    screens.push({
      url: base === "index" ? prefix : `${prefix}/${base}`,
      source: path.relative(process.cwd(), full),
      deniedId: match[1],
      triples: authorizeTriples(source)
    });
  }

  return screens.sort((a, b) => a.url.localeCompare(b.url));
}

const gatedScreens = discoverGatedScreens(ADMIN_PAGES_ROOT).filter(
  (screen) => !screen.url.includes("[")
);

// This spec authenticates as somebody other than the owner, so it must NOT
// inherit the shared owner session the `chromium` project supplies.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("admin screens render for a read-only operator", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant and DATABASE_URL — CI e2e-smoke provides both"
  );

  test("the screen walk found them, and every one declared its authorize", () => {
    expect(gatedScreens.length).toBeGreaterThan(40);

    // A screen whose triples came back empty would be silently classified as
    // tenant-scoped and then asserted to render — which is how a platform
    // screen leaking to a tenant operator would look like a passing test.
    const unparsed = gatedScreens
      .filter((screen) => screen.triples.length === 0)
      .map((screen) => screen.source);
    expect(
      unparsed,
      "authorize block not parsed for these screens, so their scope is unknown"
    ).toEqual([]);
  });

  test("tenant screens render and PLATFORM screens still deny", async ({
    page
  }) => {
    test.setTimeout(240_000);

    const user = await seedRestrictedUser(databaseUrl!, tenantId!, "read");

    // Scope comes from the live catalogue, not from a list in this file. A
    // permission that moves between scopes changes the expectation here in the
    // same deploy that changes the behaviour.
    const sql = new Bun.SQL(databaseUrl!, { max: 1 });
    let platformTriples: Set<string>;
    try {
      const rows = (await sql`
        SELECT module_key || '.' || activity_code || '.' || action AS triple
        FROM awcms_permissions
        WHERE scope = 'platform'
      `) as { triple: string }[];
      platformTriples = new Set(rows.map((row) => row.triple));
    } finally {
      await sql.end();
    }

    expect(
      platformTriples.size,
      "no platform-scope permissions found — the scope split would go unchecked"
    ).toBeGreaterThan(0);

    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(user.loginIdentifier);
    await page.locator("#password").fill(user.password);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    for (const screen of gatedScreens) {
      const response = await page.goto(screen.url);
      const status = response?.status() ?? 0;

      // A 404 means the screen THREW while rendering for this user — the class
      // that renders fine for an owner and breaks for everyone else. The
      // ReferenceError, or whatever it was, is in the SERVER log; the browser
      // is only told the page does not exist.
      expect
        .soft(
          status,
          `${screen.url} (${screen.source}) answered ${status} for a read-only ` +
            "user. A 404 here means the screen threw — check the server log."
        )
        .toBe(200);

      if (status !== 200) continue;

      const isPlatform = screen.triples.some((triple) =>
        platformTriples.has(triple)
      );
      const denial = await page.locator(`#${screen.deniedId}`).count();

      if (isPlatform) {
        // ADR-0053's separation, exercised for the first time at runtime: a
        // tenant-scoped operator must NOT reach a platform screen, however many
        // tenant reads they hold.
        expect
          .soft(
            denial,
            `${screen.url} (${screen.source}) did NOT deny a tenant-scoped ` +
              "read-only user, and it authorizes on a PLATFORM permission. " +
              "That is the cross-tenant boundary open."
          )
          .toBeGreaterThan(0);
        continue;
      }

      expect
        .soft(
          denial,
          `${screen.url} (${screen.source}) rendered #${screen.deniedId} for a ` +
            "user holding EVERY tenant read. The screen authorizes on a read " +
            "triple, so denying here means it demands more than it declares."
        )
        .toBe(0);
    }
  });
});
